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
import { Target } from "../../models/Target.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { forbidden, HttpError } from "../../utils/httpError.js";
import { isDuplicateKeyError, listRecords, requireObjectId, toApiRecord } from "../masterData/common.js";

const metricTypes = ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"];
const allowedSorts = ["month", "metricType", "category", "plannedValue", "unit"];

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

const targetBodySchema = z.object({
  plant: z.string(),
  financialYear: z.string(),
  month: z.number().int().min(1).max(12),
  metricType: z.enum(metricTypes),
  category: z.string().trim().min(1).max(80).optional().default("TOTAL").transform(normalizeCategory),
  material: z.string().nullable().optional(),
  plannedValue: z.number().nonnegative(),
  unit: z.string().trim().min(1).max(24),
  notes: z.string().trim().max(500).optional().default("")
}).strict();

const statusSchema = z.object({
  isActive: z.boolean()
}).strict();

export function createTargetRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  router.use(authenticate(sessionService));
  router.use(requirePermission(PERMISSIONS.TARGETS_VIEW));

  router.get("/", validateSchema(listQuerySchema, "query"), asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    if (store.useMongo) {
      const rows = await listMongoTargets(req.user, query);
      res.json(paginate(rows, query));
      return;
    }
    const scoped = visibleMemoryTargets(store, req.user, query);
    res.json(listRecords(scoped, query, allowedSorts, ["category", "unit"]));
  }));

  router.post("/", requirePermission(PERMISSIONS.TARGETS_MANAGE), validateSchema(targetBodySchema), asyncHandler(async (req, res) => {
    const body = validateTargetBody(req.body);
    if (store.useMongo) {
      const refs = await loadMongoRefs(body, true);
      requireScopedPlant(req.user, refs.plant.code);
      await rejectMongoUnitMismatch(body, "target");
      const target = await createMongoTarget(body, refs, req.user.id);
      await auditService.record({ actorUserId: req.user.id, action: "CREATE_TARGET", entityType: "Target", entityId: target.id, plantId: refs.plant.code, after: target, requestId: req.id }, req);
      res.status(201).json({ target });
      return;
    }
    const refs = loadMemoryRefs(store, body, true);
    requireScopedPlant(req.user, refs.plant.code);
    rejectMemoryUnitMismatch(store.actuals, body, "target");
    if (hasMemoryDuplicate(store, body)) {
      throw duplicateTarget();
    }
    const target = serializeMemoryTarget({
      id: newId(),
      ...body,
      material: body.material ?? null,
      isActive: true,
      createdBy: req.user.id,
      updatedBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, refs);
    store.targets.push(target);
    await auditService.record({ actorUserId: req.user.id, action: "CREATE_TARGET", entityType: "Target", entityId: target.id, plantId: refs.plant.code, after: target, requestId: req.id }, req);
    res.status(201).json({ target });
  }));

  router.get("/:id", validateObjectIdParam("id"), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      const target = await findMongoTargetForUser(req.user, req.params.id);
      res.json({ target });
      return;
    }
    res.json({ target: findMemoryTargetForUser(store, req.user, req.params.id) });
  }));

  router.patch("/:id", requirePermission(PERMISSIONS.TARGETS_MANAGE), validateObjectIdParam("id"), validateSchema(targetBodySchema), asyncHandler(async (req, res) => {
    const body = validateTargetBody(req.body);
    if (store.useMongo) {
      const existing = await findMongoTargetForUser(req.user, req.params.id);
      const refs = await loadMongoRefs(body, true);
      requireScopedPlant(req.user, refs.plant.code);
      await rejectMongoUnitMismatch(body, "target");
      const updated = await updateMongoTarget(req.params.id, body, refs, req.user.id, existing);
      await auditService.record({ actorUserId: req.user.id, action: "UPDATE_TARGET", entityType: "Target", entityId: updated.id, plantId: refs.plant.code, before: existing, after: updated, requestId: req.id }, req);
      res.json({ target: updated });
      return;
    }
    const existing = findMemoryTargetForUser(store, req.user, req.params.id);
    const refs = loadMemoryRefs(store, body, true);
    requireScopedPlant(req.user, refs.plant.code);
    rejectMemoryUnitMismatch(store.actuals, body, "target");
    if (hasMemoryDuplicate(store, body, req.params.id)) {
      throw duplicateTarget();
    }
    const updated = serializeMemoryTarget({ ...existing, ...body, material: body.material ?? null, updatedBy: req.user.id, updatedAt: new Date().toISOString() }, refs);
    store.targets = store.targets.map((target) => target.id === req.params.id ? updated : target);
    await auditService.record({ actorUserId: req.user.id, action: "UPDATE_TARGET", entityType: "Target", entityId: updated.id, plantId: refs.plant.code, before: existing, after: updated, requestId: req.id }, req);
    res.json({ target: updated });
  }));

  router.patch("/:id/status", requirePermission(PERMISSIONS.TARGETS_MANAGE), validateObjectIdParam("id"), validateSchema(statusSchema), asyncHandler(async (req, res) => {
    const action = req.body.isActive ? "REACTIVATE_TARGET" : "DEACTIVATE_TARGET";
    if (store.useMongo) {
      const existing = await findMongoTargetForUser(req.user, req.params.id);
      const updated = await Target.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive, updatedBy: req.user.id }, { new: true }).populate(["plant", "financialYear", "material"]).lean();
      const target = serializeMongoTarget(updated);
      await auditService.record({ actorUserId: req.user.id, action, entityType: "Target", entityId: target.id, plantId: target.plant.code, before: existing, after: target, requestId: req.id }, req);
      res.json({ target });
      return;
    }
    const existing = findMemoryTargetForUser(store, req.user, req.params.id);
    const updated = { ...existing, isActive: req.body.isActive, updatedBy: req.user.id, updatedAt: new Date().toISOString() };
    store.targets = store.targets.map((target) => target.id === req.params.id ? updated : target);
    await auditService.record({ actorUserId: req.user.id, action, entityType: "Target", entityId: updated.id, plantId: updated.plant.code, before: existing, after: updated, requestId: req.id }, req);
    res.json({ target: updated });
  }));

  router.delete("/:id", requirePermission(PERMISSIONS.TARGETS_MANAGE), validateObjectIdParam("id"), (_req, _res, next) => {
    next(new HttpError(405, "Targets are deactivated instead of deleted", "TARGET_DELETE_NOT_ALLOWED"));
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

function validateTargetBody(body) {
  for (const field of ["plant", "financialYear"]) {
    requireObjectId(body[field]);
  }
  if (body.material) {
    requireObjectId(body.material);
  }
  if (body.metricType === "CONSUMPTION" && !body.material) {
    throw new HttpError(400, "Consumption targets require material", "MATERIAL_REQUIRED");
  }
  if (body.metricType !== "CONSUMPTION" && body.material) {
    throw new HttpError(400, "Material is only allowed for consumption targets", "MATERIAL_NOT_ALLOWED");
  }
  return { ...body, material: body.material ?? null };
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

async function createMongoTarget(body, refs, userId) {
  try {
    const created = await Target.create({ ...body, createdBy: userId, updatedBy: userId });
    const target = await Target.findById(created._id).populate(["plant", "financialYear", "material"]).lean();
    return serializeMongoTarget(target, refs);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateTarget();
    }
    throw error;
  }
}

async function updateMongoTarget(id, body, refs, userId) {
  try {
    const updated = await Target.findByIdAndUpdate(id, { ...body, updatedBy: userId }, { new: true, runValidators: true }).populate(["plant", "financialYear", "material"]).lean();
    return serializeMongoTarget(updated, refs);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateTarget();
    }
    throw error;
  }
}

async function listMongoTargets(user, query) {
  const filter = buildMongoFilter(query);
  const allowedPlants = serverPlantFilter(user);
  if (allowedPlants) {
    const plants = await Plant.find({ code: { $in: [...allowedPlants] } }).select("_id").lean();
    filter.plant = { $in: plants.map((plant) => plant._id) };
  }
  const rows = await Target.find(filter).populate(["plant", "financialYear", "material"]).lean();
  return rows.map((row) => serializeMongoTarget(row));
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

async function findMongoTargetForUser(user, id) {
  const target = await Target.findById(id).populate(["plant", "financialYear", "material"]).lean();
  if (!target) {
    throw new HttpError(404, "Target not found", "TARGET_NOT_FOUND");
  }
  const serialized = serializeMongoTarget(target);
  requireScopedPlant(user, serialized.plant.code);
  return serialized;
}

function visibleMemoryTargets(store, user, query) {
  const allowedPlants = serverPlantFilter(user);
  return store.targets
    .filter((target) => !allowedPlants || allowedPlants.has(target.plant.code))
    .filter((target) => !query.plant || target.plant.id === query.plant)
    .filter((target) => !query.financialYear || target.financialYear.id === query.financialYear)
    .filter((target) => !query.month || target.month === query.month)
    .filter((target) => !query.metricType || target.metricType === query.metricType)
    .filter((target) => !query.category || target.category === normalizeCategory(query.category))
    .filter((target) => !query.material || target.material?.id === query.material)
    .filter((target) => !query.isActive || String(target.isActive) === query.isActive);
}

function findMemoryTargetForUser(store, user, id) {
  requireObjectId(id);
  const target = store.targets.find((candidate) => candidate.id === id);
  if (!target) {
    throw new HttpError(404, "Target not found", "TARGET_NOT_FOUND");
  }
  requireScopedPlant(user, target.plant.code);
  return target;
}

function requireScopedPlant(user, plantCode) {
  const allowedPlants = serverPlantFilter(user);
  if (allowedPlants && !allowedPlants.has(plantCode)) {
    throw forbidden("Plant access denied");
  }
}

function hasMemoryDuplicate(store, body, excludeId) {
  return store.targets.some((target) => target.id !== excludeId
    && target.plant.id === body.plant
    && target.financialYear.id === body.financialYear
    && target.month === body.month
    && target.metricType === body.metricType
    && target.category === body.category
    && (target.material?.id ?? null) === (body.material ?? null));
}

async function rejectMongoUnitMismatch(body) {
  const counterpart = await Actual.findOne({
    plant: body.plant,
    financialYear: body.financialYear,
    month: body.month,
    metricType: body.metricType,
    category: body.category,
    material: body.material ?? null,
    isActive: true
  }).lean();
  if (counterpart && counterpart.unit !== body.unit) {
    throw new HttpError(400, "Target unit conflicts with existing actual unit", "UNIT_MISMATCH");
  }
}

function rejectMemoryUnitMismatch(actuals, body) {
  const counterpart = actuals.find((actual) => actual.isActive
    && actual.plant?.id === body.plant
    && actual.financialYear?.id === body.financialYear
    && actual.month === body.month
    && actual.metricType === body.metricType
    && actual.category === body.category
    && (actual.material?.id ?? null) === (body.material ?? null));
  if (counterpart && counterpart.unit !== body.unit) {
    throw new HttpError(400, "Target unit conflicts with existing actual unit", "UNIT_MISMATCH");
  }
}

function serializeMongoTarget(target, refs = {}) {
  return {
    ...toApiRecord(target),
    plant: refs.plant ?? toApiRecord(target.plant),
    financialYear: refs.financialYear ?? toApiRecord(target.financialYear),
    material: refs.material ?? toApiRecord(target.material),
    createdAt: target.createdAt?.toISOString?.() ?? target.createdAt,
    updatedAt: target.updatedAt?.toISOString?.() ?? target.updatedAt
  };
}

function serializeMemoryTarget(target, refs) {
  return {
    ...target,
    plant: refs.plant,
    financialYear: refs.financialYear,
    material: refs.material ?? null
  };
}

function paginate(rows, query) {
  const result = listRecords(rows, query, allowedSorts, ["category", "unit"]);
  return result;
}

function normalizeCategory(value) {
  return String(value || "TOTAL").trim().toUpperCase();
}

function duplicateTarget() {
  return new HttpError(409, "Duplicate target", "DUPLICATE_TARGET");
}

function newId() {
  return new mongoose.Types.ObjectId(crypto.randomBytes(12)).toString();
}
