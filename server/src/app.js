import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { loadConfig } from "./config/env.js";
import { PERMISSIONS } from "./constants/permissions.js";
import { authenticate, requirePermission, requirePlantAccess, serverPlantFilter } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";
import {
  configureProxy,
  corsAllowlist,
  createLoginRateLimiter,
  generalRateLimiter,
  originAndCsrf,
  securityHeaders
} from "./middleware/security.js";
import { rejectUnsafeInput, validateSchema } from "./middleware/validate.js";
import { createAuditService } from "./services/auditService.js";
import { createSessionService, normalizeUser } from "./services/sessionService.js";
import { createSeedStore } from "./services/userStore.js";
import { createFinancialYearRouter } from "./modules/financialYears/routes.js";
import { createMaterialRouter } from "./modules/materials/routes.js";
import { createPlantRouter } from "./modules/plants/routes.js";
import { createTargetRouter } from "./modules/targets/routes.js";
import { createActualRouter } from "./modules/actuals/routes.js";
import { createImportRouter } from "./modules/imports/routes.js";
import { createReportingRouter } from "./modules/reports/routes.js";
import { createUserRouter } from "./modules/users/routes.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { HttpError, forbidden } from "./utils/httpError.js";
import { User } from "./models/User.js";

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
}).strict();

const targetSchema = z.object({
  plantId: z.string().min(1),
  financialYear: z.string().regex(/^\d{4}$/),
  metricType: z.enum(["output", "cost", "efficiency"]),
  value: z.number().nonnegative()
}).strict();

const actualSchema = targetSchema.extend({
  period: z.string().regex(/^\d{4}-\d{2}$/)
}).strict();

const reportQuerySchema = z.object({
  plantId: z.string().optional(),
  sort: z.enum(["plantId", "financialYear", "metricType", "value"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12)
}).strict();

const auditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(120).optional(),
  plantId: z.string().trim().min(1).max(80).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  sort: z.enum(["createdAt", "-createdAt", "action", "-action", "entityType", "-entityType"]).optional().default("-createdAt"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sensitiveNoStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

function buildUpload(config) {
  const uploadDir = path.resolve(appRoot, "storage", "temporary-uploads");
  const storage = multer.diskStorage({
    destination: uploadDir,
    filename(_req, file, callback) {
      const ext = path.extname(file.originalname).toLowerCase();
      callback(null, `${uuidv4()}${ext}`);
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

async function validateSignature(file) {
  const buffer = await fs.readFile(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeAllowed = {
    ".csv": ["text/csv", "application/vnd.ms-excel", "application/csv", "text/plain"],
    ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
  };
  if (!mimeAllowed[ext]?.includes(file.mimetype)) {
    throw new HttpError(400, "Invalid MIME type", "INVALID_MIME");
  }
  if (ext === ".xlsx" && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new HttpError(400, "Invalid xlsx signature", "INVALID_SIGNATURE");
  }
  return buffer;
}

async function parseImportRows(file, config) {
  const buffer = await validateSignature(file);
  const ext = path.extname(file.originalname).toLowerCase();
  let rows;
  if (ext === ".csv") {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } else {
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

  const cellCount = rows.reduce((total, row) => total + Object.keys(row).length, 0);
  if (rows.length > config.maxImportRows || cellCount > config.maxImportCells) {
    throw new HttpError(400, "Import file exceeds row or cell limits", "IMPORT_TOO_LARGE");
  }
  return rows;
}

async function cleanupUpload(file) {
  if (file?.path) {
    await fs.unlink(file.path).catch(() => {});
  }
}

function validateImportRows(rows, user) {
  const allowedPlants = serverPlantFilter(user);
  return rows.map((row, index) => {
    const errors = [];
    if (!row.plantId) {
      errors.push("plantId is required");
    }
    if (allowedPlants && !allowedPlants.has(String(row.plantId))) {
      errors.push("plant is outside assigned scope");
    }
    if (!row.metricType || !["output", "cost", "efficiency"].includes(String(row.metricType))) {
      errors.push("metricType is invalid");
    }
    if (Number.isNaN(Number(row.value))) {
      errors.push("value must be numeric");
    }
    return { rowNumber: index + 2, row, errors };
  });
}

function visibleTargets(store, user, query = {}) {
  const allowedPlants = serverPlantFilter(user);
  return store.targets
    .filter((target) => !query.plantId || target.plant?.code === query.plantId || target.plantId === query.plantId)
    .filter((target) => !allowedPlants || allowedPlants.has(target.plant?.code ?? target.plantId));
}

function visibleActuals(store, user, query = {}) {
  const allowedPlants = serverPlantFilter(user);
  return store.actuals
    .filter((actual) => !query.plantId || actual.plant?.code === query.plantId || actual.plantId === query.plantId)
    .filter((actual) => !allowedPlants || allowedPlants.has(actual.plant?.code ?? actual.plantId));
}

function requireActiveMasterData(store, body) {
  const plant = store.plants.find((candidate) => candidate.code === body.plantId && candidate.isActive);
  if (!plant) {
    throw new HttpError(400, "Plant is inactive or unknown", "INVALID_PLANT");
  }
  const financialYear = store.financialYears.find((candidate) => candidate.label === body.financialYear && candidate.isActive);
  if (!financialYear) {
    throw new HttpError(400, "Financial year is inactive or unknown", "INVALID_FINANCIAL_YEAR");
  }
}

function scopedTarget(store, user, targetId) {
  const allowedPlants = serverPlantFilter(user);
  const target = store.targets.find((candidate) => candidate.id === targetId);
  if (!target) {
    throw new HttpError(404, "Target not found", "TARGET_NOT_FOUND");
  }
  if (allowedPlants && !allowedPlants.has(target.plantId)) {
    throw forbidden("Plant access denied");
  }
  return target;
}

function scopedActual(store, user, actualId) {
  const allowedPlants = serverPlantFilter(user);
  const actual = store.actuals.find((candidate) => candidate.id === actualId);
  if (!actual) {
    throw new HttpError(404, "Actual not found", "ACTUAL_NOT_FOUND");
  }
  if (allowedPlants && !allowedPlants.has(actual.plantId)) {
    throw forbidden("Plant access denied");
  }
  return actual;
}

export function createApp(options = {}) {
  const config = loadConfig(options.config);
  const store = createAppStore(config, options.store);
  const auditService = createAuditService(store);
  const sessionService = createSessionService({ config, store, auditService });
  const upload = buildUpload(config);
  const app = express();

  configureProxy(app, config);
  app.use(securityHeaders());
  app.use(corsAllowlist(config));
  app.use(express.json({ limit: "100kb" }));
  app.use(requestContext);
  app.use(generalRateLimiter());
  app.use(cookieParser());
  app.use(originAndCsrf(config));
  app.use(rejectUnsafeInput);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/master-data/plants", createPlantRouter({ store, sessionService, auditService }));
  app.use("/api/master-data/materials", createMaterialRouter({ store, sessionService, auditService }));
  app.use("/api/master-data/financial-years", createFinancialYearRouter({ store, sessionService, auditService }));
  app.use("/api/targets", createTargetRouter({ store, sessionService, auditService }));
  app.use("/api/actuals", createActualRouter({ store, sessionService, auditService }));
  app.use("/api/imports", createImportRouter({ store, sessionService, auditService, config }));
  app.use("/api/users", createUserRouter({ store, sessionService, auditService, config }));

  app.post(
    "/api/auth/login",
    createLoginRateLimiter(),
    validateSchema(loginSchema),
    asyncHandler(async (req, res) => {
      const user = await findUserByEmail(store, req.body.email);
      const valid = user?.isActive && await bcrypt.compare(req.body.password, user.passwordHash);
      if (!valid) {
        await auditService.record({ action: "LOGIN_FAILED", entityType: "User", requestId: req.id }, req);
        throw new HttpError(401, "Invalid email or password", "LOGIN_FAILED");
      }
      const csrfToken = await sessionService.setAuthCookies(res, user, req);
      await auditService.record({ actorUserId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id, requestId: req.id }, req);
      res.json({ user: sessionService.publicUser(user), csrfToken });
    })
  );

  app.post("/api/auth/refresh", asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
    }
    const result = await sessionService.rotateRefreshToken(refreshToken, req, res);
    res.json(result);
  }));

  app.post("/api/auth/logout", authenticate(sessionService), asyncHandler(async (req, res) => {
    await sessionService.revokeCurrentRefreshToken(req.cookies?.refreshToken);
    sessionService.clearAuthCookies(res);
    await auditService.record({ actorUserId: req.user.id, action: "LOGOUT", entityType: "Session", requestId: req.id }, req);
    res.json({ ok: true });
  }));

  app.post(
    "/api/auth/change-password",
    authenticate(sessionService),
    validateSchema(changePasswordSchema),
    asyncHandler(async (req, res) => {
      const user = await findActiveUserById(store, req.user.id);
      const valid = user && await bcrypt.compare(req.body.currentPassword, user.passwordHash);
      if (!valid) {
        throw new HttpError(400, "Current password is invalid", "INVALID_CURRENT_PASSWORD");
      }
      await updateUserRecord(store, user.id, {
        passwordHash: await bcrypt.hash(req.body.newPassword, config.bcryptWorkFactor),
        mustChangePassword: false,
        updatedBy: user.id
      });
      await sessionService.revokeUserSessions(user.id);
      sessionService.clearAuthCookies(res);
      await auditService.record({ actorUserId: user.id, action: "CHANGE_PASSWORD", entityType: "User", entityId: user.id, requestId: req.id }, req);
      res.json({ ok: true });
    })
  );

  app.get("/api/auth/me", authenticate(sessionService), sensitiveNoStore, (req, res) => {
    res.json({ user: req.user });
  });

  app.use("/api", createReportingRouter({ store, sessionService, auditService }));

  app.get(
    "/api/dashboard",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.DASHBOARD_VIEW),
    sensitiveNoStore,
    (req, res) => {
      res.json({ targets: visibleTargets(store, req.user), user: req.user });
    }
  );

  app.get(
    "/api/reports/summary",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.REPORTS_VIEW),
    validateSchema(reportQuerySchema, "query"),
    sensitiveNoStore,
    (req, res) => {
      res.json({
        rows: visibleTargets(store, req.user, req.validatedQuery),
        actuals: visibleActuals(store, req.user, req.validatedQuery)
      });
    }
  );

  app.post(
    "/api/targets",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.TARGETS_MANAGE),
    requirePlantAccess(),
    validateSchema(targetSchema),
    (req, res) => {
      requireActiveMasterData(store, req.body);
      if (store.targets.some((target) => target.plantId === req.body.plantId && target.financialYear === req.body.financialYear && target.metricType === req.body.metricType)) {
        throw new HttpError(409, "Duplicate target", "DUPLICATE_TARGET");
      }
      const target = { id: uuidv4(), ...req.body, createdBy: req.user.id };
      store.targets.push(target);
      auditService.record({ actorUserId: req.user.id, action: "CREATE_TARGET", entityType: "Target", entityId: target.id, plantId: target.plantId, requestId: req.id });
      res.status(201).json({ target });
    }
  );

  app.get(
    "/api/targets/:targetId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.TARGETS_VIEW),
    sensitiveNoStore,
    (req, res) => {
      res.json({ target: scopedTarget(store, req.user, req.params.targetId) });
    }
  );

  app.patch(
    "/api/targets/:targetId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.TARGETS_MANAGE),
    validateSchema(targetSchema),
    (req, res) => {
      requireActiveMasterData(store, req.body);
      const target = scopedTarget(store, req.user, req.params.targetId);
      if (req.body.plantId !== target.plantId) {
        requirePlantAccess()(req, res, (error) => {
          if (error) {
            throw error;
          }
        });
      }
      Object.assign(target, req.body);
      auditService.record({ actorUserId: req.user.id, action: "UPDATE_TARGET", entityType: "Target", entityId: target.id, plantId: target.plantId, requestId: req.id });
      res.json({ target });
    }
  );

  app.delete(
    "/api/targets/:targetId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.TARGETS_MANAGE),
    (req, res) => {
      const target = scopedTarget(store, req.user, req.params.targetId);
      store.targets = store.targets.filter((candidate) => candidate.id !== target.id);
      auditService.record({ actorUserId: req.user.id, action: "DELETE_TARGET", entityType: "Target", entityId: target.id, plantId: target.plantId, requestId: req.id });
      res.status(204).send();
    }
  );

  app.get(
    "/api/actuals/:actualId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.ACTUALS_VIEW),
    sensitiveNoStore,
    (req, res) => {
      res.json({ actual: scopedActual(store, req.user, req.params.actualId) });
    }
  );

  app.post(
    "/api/actuals",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.ACTUALS_MANAGE),
    requirePlantAccess(),
    validateSchema(actualSchema),
    (req, res) => {
      requireActiveMasterData(store, req.body);
      if (store.actuals.some((actual) => actual.plantId === req.body.plantId && actual.financialYear === req.body.financialYear && actual.metricType === req.body.metricType && actual.period === req.body.period)) {
        throw new HttpError(409, "Duplicate actual", "DUPLICATE_ACTUAL");
      }
      const actual = { id: uuidv4(), ...req.body, createdBy: req.user.id };
      store.actuals.push(actual);
      auditService.record({ actorUserId: req.user.id, action: "CREATE_ACTUAL", entityType: "Actual", entityId: actual.id, plantId: actual.plantId, requestId: req.id });
      res.status(201).json({ actual });
    }
  );

  app.patch(
    "/api/actuals/:actualId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.ACTUALS_MANAGE),
    validateSchema(actualSchema),
    (req, res) => {
      requireActiveMasterData(store, req.body);
      const actual = scopedActual(store, req.user, req.params.actualId);
      if (req.body.plantId !== actual.plantId) {
        requirePlantAccess()(req, res, (error) => {
          if (error) {
            throw error;
          }
        });
      }
      Object.assign(actual, req.body);
      auditService.record({ actorUserId: req.user.id, action: "UPDATE_ACTUAL", entityType: "Actual", entityId: actual.id, plantId: actual.plantId, requestId: req.id });
      res.json({ actual });
    }
  );

  app.delete(
    "/api/actuals/:actualId",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.ACTUALS_MANAGE),
    (req, res) => {
      const actual = scopedActual(store, req.user, req.params.actualId);
      store.actuals = store.actuals.filter((candidate) => candidate.id !== actual.id);
      auditService.record({ actorUserId: req.user.id, action: "DELETE_ACTUAL", entityType: "Actual", entityId: actual.id, plantId: actual.plantId, requestId: req.id });
      res.status(204).send();
    }
  );

  app.get(
    "/api/audit-logs",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.AUDIT_LOGS_VIEW),
    sensitiveNoStore,
    validateSchema(auditLogQuerySchema, "query"),
    asyncHandler(async (req, res) => {
      res.json(await auditService.list(req.validatedQuery));
    })
  );

  app.post(
    "/api/imports/preview",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.IMPORTS_MANAGE),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      try {
        if (!req.file) {
          throw new HttpError(400, "File is required", "FILE_REQUIRED");
        }
        const rows = await parseImportRows(req.file, config);
        const preview = validateImportRows(rows, req.user);
        const errorCount = preview.filter((row) => row.errors.length).length;
        if (errorCount > 0) {
          await cleanupUpload(req.file);
        }
        const batch = {
          id: uuidv4(),
          createdBy: req.user.id,
          originalName: req.file.originalname,
          tempName: req.file.filename,
          tempPath: errorCount > 0 ? null : req.file.path,
          status: "PREVIEWED",
          rowCount: rows.length,
          errorCount,
          plantIds: [...new Set(rows.map((row) => String(row.plantId)).filter(Boolean))]
        };
        store.importBatches.push(batch);
        auditService.record({ actorUserId: req.user.id, action: "IMPORT_PREVIEW", entityType: "ImportBatch", entityId: batch.id, requestId: req.id });
        res.status(201).json({ batchId: batch.id, preview });
      } catch (error) {
        await cleanupUpload(req.file);
        throw error;
      }
    })
  );

  app.post(
    "/api/imports/:batchId/confirm",
    authenticate(sessionService),
    requirePermission(PERMISSIONS.IMPORTS_MANAGE),
    asyncHandler(async (req, res) => {
      const batch = store.importBatches.find((candidate) => candidate.id === req.params.batchId && candidate.createdBy === req.user.id);
      if (!batch) {
        throw new HttpError(404, "Import batch not found", "IMPORT_NOT_FOUND");
      }
      const forbiddenPlant = serverPlantFilter(req.user) && batch.plantIds.some((plantId) => !req.user.assignedPlants.includes(plantId));
      if (forbiddenPlant) {
        throw forbidden("Plant access denied");
      }
      if (batch.errorCount > 0 || !batch.tempPath) {
        batch.status = "FAILED";
        auditService.record({ actorUserId: req.user.id, action: "IMPORT_REJECTED", entityType: "ImportBatch", entityId: batch.id, requestId: req.id });
        throw new HttpError(400, "Import has unresolved row errors", "IMPORT_HAS_ERRORS");
      }
      batch.status = "CONFIRMED";
      await cleanupUpload({ path: batch.tempPath });
      auditService.record({
        actorUserId: req.user.id,
        action: "IMPORT_CONFIRMED",
        entityType: "ImportBatch",
        entityId: batch.id,
        requestId: req.id
      });
      res.json({ batchId: batch.id, status: batch.status });
    })
  );

  app.use(notFound);
  app.use(errorHandler(config, auditService));

  app.locals.store = store;
  app.locals.config = config;
  return app;
}

function createAppStore(config, overrideStore) {
  const useProductionMongo = config.isProduction && overrideStore?.useMongo;
  const baseStore = useProductionMongo
    ? {
        users: [],
        sessions: [],
        auditLogs: [],
        plants: [],
        materials: [],
        financialYears: [],
        targets: [],
        actuals: [],
        importBatches: []
      }
    : createSeedStore(config.bcryptWorkFactor);
  return overrideStore ? { ...baseStore, ...overrideStore } : baseStore;
}

async function findUserByEmail(store, email) {
  if (store.useMongo) {
    return normalizeUser(await User.findOne({ email }).lean());
  }
  return store.users.find((candidate) => candidate.email === email);
}

async function findUserById(store, id) {
  if (store.useMongo) {
    return normalizeUser(await User.findById(id).lean());
  }
  return store.users.find((candidate) => candidate.id === id);
}

async function findActiveUserById(store, id) {
  const user = await findUserById(store, id);
  return user?.isActive ? user : null;
}

async function updateUserRecord(store, id, updates) {
  if (store.useMongo) {
    return normalizeUser(await User.findByIdAndUpdate(id, updates, { new: true }).lean());
  }
  const user = store.users.find((candidate) => candidate.id === id);
  Object.assign(user, updates);
  return user;
}
