import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { authenticate, requirePermission, serverPlantFilter } from "../../middleware/auth.js";
import { validateObjectIdParam, validateSchema } from "../../middleware/validate.js";
import { Actual } from "../../models/Actual.js";
import { FinancialYear } from "../../models/FinancialYear.js";
import { Material } from "../../models/Material.js";
import { Plant } from "../../models/Plant.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { forbidden, HttpError } from "../../utils/httpError.js";
import { isDuplicateKeyError, listRecords, requireObjectId, toApiRecord } from "../masterData/common.js";

const metricTypes = ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"];
const allowedSorts = ["month", "metricType", "category", "actualValue", "unit", "source"];

const listQuerySchema = z.object({
  plant: z.string().optional(),
  financialYear: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  metricType: z.enum(metricTypes).optional(),
  category: z.string().trim().max(80).optional(),
  material: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sort: z.enum(allowedSorts).optional().default("month"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();

const actualBodySchema = z.object({
  plant: z.string(),
  financialYear: z.string(),
  month: z.number().int().min(1).max(12),
  metricType: z.enum(metricTypes),
  category: z.string().trim().min(1).max(80).optional().default("TOTAL").transform(normalizeCategory),
  material: z.string().nullable().optional(),
  actualValue: z.number().positive(),
  unit: z.string().trim().min(1).max(24),
  source: z.enum(["MANUAL"]).optional().default("MANUAL"),
  notes: z.string().trim().max(500).optional().default("")
}).strict();

const statusSchema = z.object({
  isActive: z.boolean()
}).strict();

export function createActualRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  router.use(authenticate(sessionService));
  router.use(requirePermission(PERMISSIONS.ACTUALS_VIEW));

  router.get("/", validateSchema(listQuerySchema, "query"), asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    if (store.useMongo) {
      const rows = await listMongoActuals(req.user, query);
      res.json(listRecords(rows, query, allowedSorts, ["category", "unit", "source"]));
      return;
    }
    res.json(listRecords(visibleMemoryActuals(store, req.user, query), query, allowedSorts, ["category", "unit", "source"]));
  }));

  router.post("/", requirePermission(PERMISSIONS.ACTUALS_MANAGE), validateSchema(actualBodySchema), asyncHandler(async (req, res) => {
    const body = validateActualBody(req.body);
    if (store.useMongo) {
      const refs = await loadMongoRefs(body, true);
      requireScopedPlant(req.user, refs.plant.code);
      const actual = await createMongoActual(body, refs, req.user.id);
      await auditService.record({ actorUserId: req.user.id, action: "CREATE_ACTUAL", entityType: "Actual", entityId: actual.id, plantId: refs.plant.code, after: actual, requestId: req.id }, req);
      res.status(201).json({ actual });
      return;
    }
    const refs = loadMemoryRefs(store, body, true);
    requireScopedPlant(req.user, refs.plant.code);
    if (hasMemoryDuplicate(store, body)) {
      throw duplicateActual();
    }
    const actual = serializeMemoryActual({
      id: newId(),
      ...body,
      material: body.material ?? null,
      isActive: true,
      createdBy: req.user.id,
      updatedBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, refs);
    store.actuals.push(actual);
    await auditService.record({ actorUserId: req.user.id, action: "CREATE_ACTUAL", entityType: "Actual", entityId: actual.id, plantId: refs.plant.code, after: actual, requestId: req.id }, req);
    res.status(201).json({ actual });
  }));

  router.get("/:id", validateObjectIdParam("id"), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      res.json({ actual: await findMongoActualForUser(req.user, req.params.id) });
      return;
    }
    res.json({ actual: findMemoryActualForUser(store, req.user, req.params.id) });
  }));

  router.patch("/:id", requirePermission(PERMISSIONS.ACTUALS_MANAGE), validateObjectIdParam("id"), validateSchema(actualBodySchema), asyncHandler(async (req, res) => {
    const body = validateActualBody(req.body);
    if (store.useMongo) {
      const existing = await findMongoActualForUser(req.user, req.params.id);
      const refs = await loadMongoRefs(body, true);
      requireScopedPlant(req.user, refs.plant.code);
      const updated = await updateMongoActual(req.params.id, body, refs, req.user.id);
      await auditService.record({ actorUserId: req.user.id, action: "UPDATE_ACTUAL", entityType: "Actual", entityId: updated.id, plantId: refs.plant.code, before: existing, after: updated, requestId: req.id }, req);
      res.json({ actual: updated });
      return;
    }
    const existing = findMemoryActualForUser(store, req.user, req.params.id);
    const refs = loadMemoryRefs(store, body, true);
    requireScopedPlant(req.user, refs.plant.code);
    if (hasMemoryDuplicate(store, body, req.params.id)) {
      throw duplicateActual();
    }
    const updated = serializeMemoryActual({ ...existing, ...body, material: body.material ?? null, updatedBy: req.user.id, updatedAt: new Date().toISOString() }, refs);
    store.actuals = store.actuals.map((actual) => actual.id === req.params.id ? updated : actual);
    await auditService.record({ actorUserId: req.user.id, action: "UPDATE_ACTUAL", entityType: "Actual", entityId: updated.id, plantId: refs.plant.code, before: existing, after: updated, requestId: req.id }, req);
    res.json({ actual: updated });
  }));

  router.patch("/:id/status", requirePermission(PERMISSIONS.ACTUALS_MANAGE), validateObjectIdParam("id"), validateSchema(statusSchema), asyncHandler(async (req, res) => {
    const action = req.body.isActive ? "REACTIVATE_ACTUAL" : "DEACTIVATE_ACTUAL";
    if (store.useMongo) {
      const existing = await findMongoActualForUser(req.user, req.params.id);
      const updated = await Actual.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive, updatedBy: req.user.id }, { new: true }).populate(["plant", "financialYear", "material"]).lean();
      const actual = serializeMongoActual(updated);
      await auditService.record({ actorUserId: req.user.id, action, entityType: "Actual", entityId: actual.id, plantId: actual.plant.code, before: existing, after: actual, requestId: req.id }, req);
      res.json({ actual });
      return;
    }
    const existing = findMemoryActualForUser(store, req.user, req.params.id);
    const updated = { ...existing, isActive: req.body.isActive, updatedBy: req.user.id, updatedAt: new Date().toISOString() };
    store.actuals = store.actuals.map((actual) => actual.id === req.params.id ? updated : actual);
    await auditService.record({ actorUserId: req.user.id, action, entityType: "Actual", entityId: updated.id, plantId: updated.plant.code, before: existing, after: updated, requestId: req.id }, req);
    res.json({ actual: updated });
  }));

  router.delete("/:id", requirePermission(PERMISSIONS.ACTUALS_MANAGE), validateObjectIdParam("id"), (_req, _res, next) => {
    next(new HttpError(405, "Actuals are deactivated instead of deleted", "ACTUAL_DELETE_NOT_ALLOWED"));
  });

  return router;
}

function validateObjectIdFilters(query) {
  for (const field of ["plant", "financialYear", "material"]) {
    if (query[field]) {
      requireObjectId(query[field]);
    }
  }
  return query;
}

function validateActualBody(body) {
  for (const field of ["plant", "financialYear"]) {
    requireObjectId(body[field]);
  }
  if (body.material) {
    requireObjectId(body.material);
  }
  if (body.source !== "MANUAL") {
    throw new HttpError(400, "Only manual actual entry is allowed in this phase", "INVALID_ACTUAL_SOURCE");
  }
  if (body.metricType === "CONSUMPTION" && !body.material) {
    throw new HttpError(400, "Consumption actuals require material", "MATERIAL_REQUIRED");
  }
  if (body.metricType !== "CONSUMPTION" && body.material) {
    throw new HttpError(400, "Material is only allowed for consumption actuals", "MATERIAL_NOT_ALLOWED");
  }
  return { ...body, source: "MANUAL", material: body.material ?? null };
}

async function loadMongoRefs(body, requireActive) {
  const [plant, financialYear, material] = await Promise.all([
    Plant.findById(body.plant).lean(),
    FinancialYear.findById(body.financialYear).lean(),
    body.material ? Material.findById(body.material).lean() : null
  ]);
  validateRefs({ plant, financialYear, material }, body, requireActive);
  return { plant: toApiRecord(plant), financialYear: toApiRecord(financialYear), material: toApiRecord(material) };
}

function loadMemoryRefs(store, body, requireActive) {
  const refs = {
    plant: store.plants.find((plant) => plant.id === body.plant),
    financialYear: store.financialYears.find((year) => year.id === body.financialYear),
    material: body.material ? store.materials.find((material) => material.id === body.material) : null
  };
  validateRefs(refs, body, requireActive);
  return refs;
}

function validateRefs(refs, body, requireActive) {
  if (!refs.plant || (requireActive && !refs.plant.isActive)) {
    throw new HttpError(400, "Plant is inactive or unknown", "INVALID_PLANT");
  }
  if (!refs.financialYear || (requireActive && !refs.financialYear.isActive)) {
    throw new HttpError(400, "Financial year is inactive or unknown", "INVALID_FINANCIAL_YEAR");
  }
  if (body.metricType === "CONSUMPTION" && (!refs.material || (requireActive && !refs.material.isActive))) {
    throw new HttpError(400, "Material is inactive or unknown", "INVALID_MATERIAL");
  }
}

async function createMongoActual(body, refs, userId) {
  try {
    const created = await Actual.create({ ...body, createdBy: userId, updatedBy: userId });
    const actual = await Actual.findById(created._id).populate(["plant", "financialYear", "material"]).lean();
    return serializeMongoActual(actual, refs);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateActual();
    }
    throw error;
  }
}

async function updateMongoActual(id, body, refs, userId) {
  try {
    const updated = await Actual.findByIdAndUpdate(id, { ...body, updatedBy: userId }, { new: true, runValidators: true }).populate(["plant", "financialYear", "material"]).lean();
    return serializeMongoActual(updated, refs);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateActual();
    }
    throw error;
  }
}

async function listMongoActuals(user, query) {
  const filter = buildMongoFilter(query);
  const allowedPlants = serverPlantFilter(user);
  if (allowedPlants) {
    const plants = await Plant.find({ code: { $in: [...allowedPlants] } }).select("_id").lean();
    filter.plant = { $in: plants.map((plant) => plant._id) };
  }
  const rows = await Actual.find(filter).populate(["plant", "financialYear", "material"]).lean();
  return rows.map((row) => serializeMongoActual(row));
}

function buildMongoFilter(query) {
  const filter = {};
  for (const field of ["plant", "financialYear", "month", "metricType", "isActive"]) {
    if (query[field] !== undefined) {
      filter[field] = field === "isActive" ? query[field] === "true" : query[field];
    }
  }
  if (query.category) {
    filter.category = normalizeCategory(query.category);
  }
  if (query.material) {
    filter.material = query.material;
  }
  return filter;
}

async function findMongoActualForUser(user, id) {
  const actual = await Actual.findById(id).populate(["plant", "financialYear", "material"]).lean();
  if (!actual) {
    throw new HttpError(404, "Actual not found", "ACTUAL_NOT_FOUND");
  }
  const serialized = serializeMongoActual(actual);
  requireScopedPlant(user, serialized.plant.code);
  return serialized;
}

function visibleMemoryActuals(store, user, query) {
  const allowedPlants = serverPlantFilter(user);
  return store.actuals
    .filter((actual) => !allowedPlants || allowedPlants.has(actual.plant?.code ?? actual.plantId))
    .filter((actual) => !query.plant || actual.plant?.id === query.plant)
    .filter((actual) => !query.financialYear || actual.financialYear?.id === query.financialYear)
    .filter((actual) => !query.month || actual.month === query.month)
    .filter((actual) => !query.metricType || actual.metricType === query.metricType)
    .filter((actual) => !query.category || actual.category === normalizeCategory(query.category))
    .filter((actual) => !query.material || actual.material?.id === query.material)
    .filter((actual) => !query.isActive || String(actual.isActive) === query.isActive);
}

function findMemoryActualForUser(store, user, id) {
  requireObjectId(id);
  const actual = store.actuals.find((candidate) => candidate.id === id);
  if (!actual) {
    throw new HttpError(404, "Actual not found", "ACTUAL_NOT_FOUND");
  }
  requireScopedPlant(user, actual.plant?.code ?? actual.plantId);
  return actual;
}

function requireScopedPlant(user, plantCode) {
  const allowedPlants = serverPlantFilter(user);
  if (allowedPlants && !allowedPlants.has(plantCode)) {
    throw forbidden("Plant access denied");
  }
}

function hasMemoryDuplicate(store, body, excludeId) {
  return store.actuals.some((actual) => actual.id !== excludeId
    && actual.plant?.id === body.plant
    && actual.financialYear?.id === body.financialYear
    && actual.month === body.month
    && actual.metricType === body.metricType
    && actual.category === body.category
    && (actual.material?.id ?? null) === (body.material ?? null));
}

function serializeMongoActual(actual, refs = {}) {
  return {
    ...toApiRecord(actual),
    plant: refs.plant ?? toApiRecord(actual.plant),
    financialYear: refs.financialYear ?? toApiRecord(actual.financialYear),
    material: refs.material ?? toApiRecord(actual.material),
    createdAt: actual.createdAt?.toISOString?.() ?? actual.createdAt,
    updatedAt: actual.updatedAt?.toISOString?.() ?? actual.updatedAt
  };
}

function serializeMemoryActual(actual, refs) {
  return {
    ...actual,
    plant: refs.plant,
    financialYear: refs.financialYear,
    material: refs.material ?? null
  };
}

function normalizeCategory(value) {
  return String(value || "TOTAL").trim().toUpperCase();
}

function duplicateActual() {
  return new HttpError(409, "Duplicate actual", "DUPLICATE_ACTUAL");
}

function newId() {
  return new mongoose.Types.ObjectId(crypto.randomBytes(12)).toString();
}
