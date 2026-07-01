import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import express from "express";
import JSZip from "jszip";
import mongoose from "mongoose";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { authenticate, requirePermission, serverPlantFilter } from "../../middleware/auth.js";
import { validateObjectIdParam, validateSchema } from "../../middleware/validate.js";
import { Actual } from "../../models/Actual.js";
import { FinancialYear } from "../../models/FinancialYear.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { Material } from "../../models/Material.js";
import { Plant } from "../../models/Plant.js";
import { Target } from "../../models/Target.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { forbidden, HttpError } from "../../utils/httpError.js";
import { containsUnsafeMongoOperator } from "../../utils/sanitize.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const uploadDir = path.resolve(appRoot, "storage", "temporary-uploads");
const allowedHeaders = ["plantCode", "financialYearLabel", "month", "metricType", "category", "materialCode", "actualValue", "unit", "notes"];
const requiredHeaders = allowedHeaders.filter((header) => header !== "notes");
const metricTypes = ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"];
const templateVersion = "actual-import-v1";
const previewTtlMs = 30 * 60 * 1000;
const maxRows = 2000;
const maxCells = 25000;

const historyQuerySchema = z.object({
  status: z.enum(["PREVIEWED", "CONFIRMING", "IMPORTED", "REJECTED", "FAILED", "EXPIRED"]).optional(),
  sort: z.enum(["createdAt", "-createdAt", "status", "-status"]).optional().default("-createdAt"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();

export function createImportRouter({ store, sessionService, auditService, config }) {
  const router = express.Router();
  const upload = buildUpload(config);

  router.use(authenticate(sessionService));
  router.use(requirePermission(PERMISSIONS.IMPORTS_MANAGE));

  router.post("/preview", upload.single("file"), asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "File is required", "FILE_REQUIRED");
      }
      const parsedRows = await parseRows(req.file);
      const { stagedRows, validationErrors, permittedPlantIds } = store.useMongo
        ? await validateMongoRows(parsedRows, req.user)
        : validateMemoryRows(store, parsedRows, req.user);
      const batch = await createBatch({
        store,
        userId: req.user.id,
        file: req.file,
        stagedRows,
        validationErrors,
        permittedPlantIds,
        totalRows: parsedRows.length
      });
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_PREVIEW", entityType: "ImportBatch", entityId: batch.id, after: summarizeBatch(batch), requestId: req.id }, req);
      res.status(201).json({ batch: summarizeBatch(batch), rows: previewRows(stagedRows, validationErrors), transactionAvailable: store.useMongo ? await supportsTransactions() : false });
    } finally {
      await cleanupUpload(req.file);
    }
  }));

  router.post("/:id/confirm", validateObjectIdParam("id"), asyncHandler(async (req, res) => {
    const batch = await findBatchForUser(store, req.user, req.params.id);
    await auditService.record({ actorUserId: req.user.id, action: "IMPORT_CONFIRM_STARTED", entityType: "ImportBatch", entityId: batch.id, requestId: req.id }, req);
    if (new Date(batch.expiresAt) <= new Date() || batch.status !== "PREVIEWED") {
      await markBatch(store, batch, { status: "EXPIRED" });
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_REJECTED", entityType: "ImportBatch", entityId: batch.id, after: { reason: "expired_or_reused" }, requestId: req.id }, req);
      throw new HttpError(400, "Import batch is expired or unavailable", "IMPORT_BATCH_UNAVAILABLE");
    }
    if (batch.invalidRows > 0) {
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_REJECTED", entityType: "ImportBatch", entityId: batch.id, after: { reason: "validation_errors" }, requestId: req.id }, req);
      throw new HttpError(400, "Import has unresolved row errors", "IMPORT_HAS_ERRORS");
    }
    const forbiddenPlant = serverPlantFilter(req.user) && batch.permittedPlantIds.some((plantCode) => !req.user.assignedPlants.includes(plantCode));
    if (forbiddenPlant) {
      throw forbidden("Plant access denied");
    }
    if (!store.useMongo || !await supportsTransactions()) {
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_REJECTED", entityType: "ImportBatch", entityId: batch.id, after: { reason: "transactions_required" }, requestId: req.id }, req);
      throw new HttpError(409, "Transactional import requires a replica set or sharded MongoDB deployment", "TRANSACTIONAL_IMPORT_REQUIRED");
    }

    const revalidated = await revalidateMongoStagedRows(batch.stagedRows, req.user);
    if (revalidated.validationErrors.length > 0) {
      await markBatch(store, batch, { status: "FAILED", validationErrors: revalidated.validationErrors, invalidRows: revalidated.validationErrors.length });
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_FAILED", entityType: "ImportBatch", entityId: batch.id, after: { invalidRows: revalidated.validationErrors.length }, requestId: req.id }, req);
      throw new HttpError(409, "Import rows are no longer valid", "IMPORT_REVALIDATION_FAILED");
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await ImportBatch.updateOne({ _id: batch.id }, { status: "CONFIRMING", confirmedAt: new Date() }, { session });
        await Actual.insertMany(batch.stagedRows.map((row) => ({
          plant: row.plant,
          financialYear: row.financialYear,
          month: row.month,
          metricType: row.metricType,
          category: row.category,
          material: row.material,
          actualValue: row.actualValue,
          unit: row.unit,
          source: "EXCEL_IMPORT",
          importBatch: batch.id,
          notes: row.notes,
          createdBy: req.user.id,
          updatedBy: req.user.id
        })), { session });
        await ImportBatch.updateOne({ _id: batch.id }, { status: "IMPORTED", importedAt: new Date() }, { session });
      });
    } catch (error) {
      await auditService.record({ actorUserId: req.user.id, action: "IMPORT_FAILED", entityType: "ImportBatch", entityId: batch.id, after: { reason: "transaction_failed" }, requestId: req.id }, req);
      throw error;
    } finally {
      await session.endSession();
    }

    await auditService.record({ actorUserId: req.user.id, action: "IMPORT_CONFIRMED", entityType: "ImportBatch", entityId: batch.id, after: { importedRows: batch.stagedRows.length }, requestId: req.id }, req);
    res.json({ batchId: batch.id, status: "IMPORTED", importedRows: batch.stagedRows.length });
  }));

  router.get("/history", validateSchema(historyQuerySchema, "query"), asyncHandler(async (req, res) => {
    res.json(await listBatches(store, req.user, req.validatedQuery));
  }));

  router.get("/:id", validateObjectIdParam("id"), asyncHandler(async (req, res) => {
    const batch = await findBatchForUser(store, req.user, req.params.id);
    res.json({ batch: summarizeBatch(batch), rows: previewRows(batch.stagedRows, batch.validationErrors) });
  }));

  return router;
}

function buildUpload(config) {
  const storage = multer.diskStorage({
    async destination(_req, _file, callback) {
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        callback(null, uploadDir);
      } catch (error) {
        callback(error);
      }
    },
    filename(_req, file, callback) {
      callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: config.uploadMaxBytes, files: 1 },
    fileFilter(_req, file, callback) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (![".csv", ".xlsx"].includes(ext) || ext === ".xlsm") {
        callback(new HttpError(400, "Only .csv and .xlsx files are allowed", "INVALID_FILE_TYPE"));
        return;
      }
      callback(null, true);
    }
  });
}

async function parseRows(file) {
  const buffer = await fs.readFile(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  validateMime(file, ext);
  let rows;
  if (ext === ".csv") {
    if (buffer.length > 0 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      throw new HttpError(400, "Invalid csv content", "INVALID_SIGNATURE");
    }
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } else {
    await validateXlsxZip(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    const headers = [];
    rows = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1);
      if (rowNumber === 1) {
        headers.push(...values.map((value) => String(value ?? "").trim()));
        return;
      }
      rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index]])));
    });
  }
  validateHeaders(rows);
  const cellCount = rows.reduce((total, row) => total + Object.keys(row).length, 0);
  if (rows.length > maxRows || cellCount > maxCells) {
    throw new HttpError(400, "Import file exceeds row or cell limits", "IMPORT_TOO_LARGE");
  }
  return rows;
}

function validateMime(file, ext) {
  const allowed = {
    ".csv": ["text/csv", "application/vnd.ms-excel", "application/csv", "text/plain"],
    ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]
  };
  if (!allowed[ext]?.includes(file.mimetype)) {
    throw new HttpError(400, "Invalid MIME type", "INVALID_MIME");
  }
}

async function validateXlsxZip(buffer) {
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new HttpError(400, "Invalid xlsx signature", "INVALID_SIGNATURE");
  }
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > 200 || !zip.files["[Content_Types].xml"] || !zip.files["xl/workbook.xml"] || entries.some((entry) => entry.name.toLowerCase().includes("vbaproject"))) {
    throw new HttpError(400, "Suspicious workbook content", "SUSPICIOUS_WORKBOOK");
  }
}

function validateHeaders(rows) {
  const headers = Object.keys(rows[0] ?? {});
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  const unexpected = headers.filter((header) => !allowedHeaders.includes(header));
  if (missing.length || unexpected.length) {
    throw new HttpError(400, "Import template headers are invalid", "INVALID_IMPORT_HEADERS");
  }
}

async function validateMongoRows(rows, user) {
  const [plants, years, materials, actuals, targets] = await Promise.all([
    Plant.find({ isActive: true }).lean(),
    FinancialYear.find({ isActive: true }).lean(),
    Material.find({ isActive: true }).lean(),
    Actual.find({ isActive: true }).lean(),
    Target.find({ isActive: true }).lean()
  ]);
  return validateRows(rows, user, { plants: plants.map(apiMaster), years: years.map(apiMaster), materials: materials.map(apiMaster), actuals: actuals.map(apiActual), targets: targets.map(apiTarget) });
}

function validateMemoryRows(store, rows, user) {
  return validateRows(rows, user, {
    plants: store.plants.filter((row) => row.isActive),
    years: store.financialYears.filter((row) => row.isActive),
    materials: store.materials.filter((row) => row.isActive),
    actuals: store.actuals.filter((row) => row.isActive),
    targets: store.targets.filter((row) => row.isActive)
  });
}

function validateRows(rows, user, refs) {
  const stagedRows = [];
  const validationErrors = [];
  const seen = new Set();
  const allowedPlants = serverPlantFilter(user);
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors = [];
    if (containsUnsafeMongoOperator(row)) {
      errors.push("row contains unsafe keys");
    }
    const normalized = normalizeRow(row);
    const plant = refs.plants.find((candidate) => candidate.code === normalized.plantCode);
    const year = refs.years.find((candidate) => candidate.label === normalized.financialYearLabel);
    const material = normalized.materialCode ? refs.materials.find((candidate) => candidate.code === normalized.materialCode) : null;
    if (!plant) errors.push("plant is inactive or unknown");
    if (plant && allowedPlants && !allowedPlants.has(plant.code)) errors.push("plant is outside assigned scope");
    if (!year) errors.push("financial year is inactive or unknown");
    if (!metricTypes.includes(normalized.metricType)) errors.push("metricType is invalid");
    if (!Number.isInteger(normalized.month) || normalized.month < 1 || normalized.month > 12) errors.push("month is invalid");
    if (!(normalized.actualValue >= 0)) errors.push("actualValue must be nonnegative");
    if (!normalized.unit) errors.push("unit is required");
    if (normalized.metricType === "CONSUMPTION" && !material) errors.push("material is required for consumption");
    if (normalized.metricType !== "CONSUMPTION" && normalized.materialCode) errors.push("material is only allowed for consumption");
    const key = plant && year ? duplicateKey({ ...normalized, plant: plant.id, financialYear: year.id, material: material?.id ?? null }) : null;
    if (key && seen.has(key)) errors.push("duplicate row in file");
    if (key && refs.actuals.some((actual) => duplicateKey(actual) === key)) errors.push("actual already exists");
    if (key && refs.targets.some((target) => duplicateKey(target) === key && target.unit !== normalized.unit)) errors.push("actual unit conflicts with existing target unit");
    if (key) seen.add(key);
    if (errors.length) {
      validationErrors.push({ rowNumber, errors });
      return;
    }
    stagedRows.push({ rowNumber, plant: plant.id, financialYear: year.id, month: normalized.month, metricType: normalized.metricType, category: normalized.category, material: material?.id ?? null, actualValue: normalized.actualValue, unit: normalized.unit, source: "EXCEL_IMPORT", notes: normalized.notes, plantCode: plant.code, financialYearLabel: year.label, materialCode: material?.code ?? "" });
  });
  return { stagedRows, validationErrors, permittedPlantIds: [...new Set(stagedRows.map((row) => row.plantCode))] };
}

function normalizeRow(row) {
  return {
    plantCode: String(row.plantCode ?? "").trim().toUpperCase(),
    financialYearLabel: String(row.financialYearLabel ?? "").trim(),
    month: Number(row.month),
    metricType: String(row.metricType ?? "").trim().toUpperCase(),
    category: String(row.category ?? "TOTAL").trim().toUpperCase(),
    materialCode: String(row.materialCode ?? "").trim().toUpperCase(),
    actualValue: Number(row.actualValue),
    unit: String(row.unit ?? "").trim(),
    notes: String(row.notes ?? "").trim()
  };
}

async function createBatch({ store, userId, file, stagedRows, validationErrors, permittedPlantIds, totalRows }) {
  const batch = {
    id: new mongoose.Types.ObjectId().toString(),
    uploadedBy: userId,
    fileNameSafe: safeFileName(file.originalname),
    fileSha256: await sha256File(file.path),
    templateVersion,
    status: "PREVIEWED",
    totalRows,
    validRows: stagedRows.length,
    invalidRows: validationErrors.length,
    stagedRows,
    validationErrors,
    permittedPlantIds,
    expiresAt: new Date(Date.now() + previewTtlMs).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (store.useMongo) {
    const created = await ImportBatch.create({ ...batch, _id: batch.id });
    return serializeBatch(created.toObject());
  }
  store.importBatches.push(batch);
  return batch;
}

async function findBatchForUser(store, user, id) {
  const batch = store.useMongo ? serializeBatch(await ImportBatch.findById(id).lean()) : store.importBatches.find((candidate) => candidate.id === id);
  if (!batch) throw new HttpError(404, "Import batch not found", "IMPORT_NOT_FOUND");
  if (user.role !== "ADMIN" && batch.uploadedBy !== user.id) throw forbidden("Import batch access denied");
  return batch;
}

async function listBatches(store, user, query) {
  if (store.useMongo) {
    const filter = user.role === "ADMIN" ? {} : { uploadedBy: user.id };
    if (query.status) filter.status = query.status;
    const sort = { [query.sort.replace(/^-/, "")]: query.sort.startsWith("-") ? -1 : 1 };
    const [rows, total] = await Promise.all([
      ImportBatch.find(filter).sort(sort).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      ImportBatch.countDocuments(filter)
    ]);
    return { rows: rows.map(serializeBatch).map(summarizeBatch), page: query.page, limit: query.limit, total };
  }
  let rows = store.importBatches.filter((batch) => user.role === "ADMIN" || batch.uploadedBy === user.id);
  if (query.status) rows = rows.filter((batch) => batch.status === query.status);
  const total = rows.length;
  return { rows: rows.slice((query.page - 1) * query.limit, query.page * query.limit).map(summarizeBatch), page: query.page, limit: query.limit, total };
}

async function markBatch(store, batch, update) {
  Object.assign(batch, update, { updatedAt: new Date().toISOString() });
  if (store.useMongo) await ImportBatch.updateOne({ _id: batch.id }, update);
}

async function revalidateMongoStagedRows(stagedRows, user) {
  return validateMongoRows(stagedRows.map((row) => ({
    plantCode: row.plantCode,
    financialYearLabel: row.financialYearLabel,
    month: row.month,
    metricType: row.metricType,
    category: row.category,
    materialCode: row.materialCode,
    actualValue: row.actualValue,
    unit: row.unit,
    notes: row.notes
  })), user);
}

async function supportsTransactions() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 }).catch(() => ({}));
  return Boolean(hello.setName || hello.msg === "isdbgrid");
}

function duplicateKey(row) {
  return [row.plant, row.financialYear, row.month, row.metricType, row.category, row.material ?? ""].join("|");
}

function apiMaster(row) {
  return { id: String(row._id ?? row.id), code: row.code, label: row.label, isActive: row.isActive };
}

function apiActual(row) {
  return { plant: String(row.plant?.id ?? row.plant), financialYear: String(row.financialYear?.id ?? row.financialYear), month: row.month, metricType: row.metricType, category: row.category, material: row.material ? String(row.material?.id ?? row.material) : null, unit: row.unit };
}

function apiTarget(row) {
  return { plant: String(row.plant?.id ?? row.plant), financialYear: String(row.financialYear?.id ?? row.financialYear), month: row.month, metricType: row.metricType, category: row.category, material: row.material ? String(row.material?.id ?? row.material) : null, unit: row.unit };
}

function serializeBatch(batch) {
  if (!batch) return batch;
  return { ...batch, id: String(batch._id ?? batch.id), uploadedBy: String(batch.uploadedBy), expiresAt: batch.expiresAt?.toISOString?.() ?? batch.expiresAt, createdAt: batch.createdAt?.toISOString?.() ?? batch.createdAt, updatedAt: batch.updatedAt?.toISOString?.() ?? batch.updatedAt };
}

function summarizeBatch(batch) {
  return { id: batch.id, uploadedBy: batch.uploadedBy, fileNameSafe: batch.fileNameSafe, templateVersion: batch.templateVersion, status: batch.status, totalRows: batch.totalRows, validRows: batch.validRows, invalidRows: batch.invalidRows, validationErrors: batch.validationErrors, permittedPlantIds: batch.permittedPlantIds, expiresAt: batch.expiresAt, createdAt: batch.createdAt, updatedAt: batch.updatedAt };
}

function previewRows(stagedRows, validationErrors) {
  return { valid: stagedRows.map(({ rowNumber, plantCode, month, metricType, category, actualValue, unit }) => ({ rowNumber, plantCode, month, metricType, category, actualValue, unit })), errors: validationErrors };
}

function safeFileName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function cleanupUpload(file) {
  if (file?.path) await fs.unlink(file.path).catch(() => {});
}
