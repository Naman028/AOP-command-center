import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PERMISSIONS, ROLES } from "../../constants/permissions.js";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { validateObjectIdParam, validateSchema } from "../../middleware/validate.js";
import { Plant } from "../../models/Plant.js";
import { Session } from "../../models/Session.js";
import { User } from "../../models/User.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { isDuplicateKeyError } from "../masterData/common.js";

const scopedRoles = new Set([ROLES.TEAM_LEAD, ROLES.STAFF]);
const allowedSorts = ["email", "-email", "name", "-name", "role", "-role", "isActive", "-isActive", "createdAt", "-createdAt"];

const listQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sort: z.enum(allowedSorts).optional().default("email"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();

const createUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum(Object.values(ROLES)),
  temporaryPassword: z.string().min(12).max(200),
  assignedPlants: z.array(z.string()).max(100).optional().default([]),
  isActive: z.boolean().optional().default(true)
}).strict();

const updateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  assignedPlants: z.array(z.string()).max(100).optional(),
  isActive: z.boolean().optional()
}).strict();

const statusSchema = z.object({
  isActive: z.boolean()
}).strict();

const plantScopeSchema = z.object({
  assignedPlants: z.array(z.string()).max(100).default([])
}).strict();

export function createUserRouter({ store, sessionService, auditService, config }) {
  const router = express.Router();
  router.use(authenticate(sessionService));
  router.use(requirePermission(PERMISSIONS.USERS_MANAGE));

  router.get("/", validateSchema(listQuerySchema, "query"), asyncHandler(async (req, res) => {
    res.json(await listUsers(store, req.validatedQuery));
  }));

  router.post("/", validateSchema(createUserSchema), asyncHandler(async (req, res) => {
    const assignedPlants = await normalizeAssignedPlants(store, req.body.role, req.body.assignedPlants);
    const payload = {
      email: req.body.email,
      name: req.body.name,
      passwordHash: await bcrypt.hash(req.body.temporaryPassword, config.bcryptWorkFactor),
      role: req.body.role,
      assignedPlants,
      isActive: req.body.isActive,
      mustChangePassword: true,
      createdBy: req.user.id,
      updatedBy: req.user.id
    };
    try {
      const created = await createUser(store, payload);
      await auditService.record({
        actorUserId: req.user.id,
        action: "CREATE_USER",
        entityType: "User",
        entityId: created.id,
        after: publicManagedUser(created),
        requestId: req.id
      }, req);
      res.status(201).json({ user: publicManagedUser(created) });
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new HttpError(409, "Email already exists", "DUPLICATE_EMAIL");
      }
      throw error;
    }
  }));

  router.get("/:id", validateObjectIdParam("id"), asyncHandler(async (req, res) => {
    const user = await requireUser(store, req.params.id);
    res.json({ user: publicManagedUser(user) });
  }));

  router.patch("/:id", validateObjectIdParam("id"), validateSchema(updateUserSchema), asyncHandler(async (req, res) => {
    const user = await requireUser(store, req.params.id);
    const nextRole = req.body.role ?? user.role;
    const updates = {};
    if (req.body.email) updates.email = req.body.email;
    if (req.body.name) updates.name = req.body.name;
    if (req.body.role) updates.role = req.body.role;
    if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
    if (req.body.assignedPlants) {
      updates.assignedPlants = await normalizeAssignedPlants(store, nextRole, req.body.assignedPlants ?? user.assignedPlants);
    } else if (req.body.role && !scopedRoles.has(nextRole)) {
      updates.assignedPlants = [];
    }
    await assertAdminChangeAllowed(store, req.user, user, updates);
    const result = await updateUserAndRevoke({ store, auditService, actor: req.user, target: user, updates, req });
    res.json({ user: publicManagedUser(result.user) });
  }));

  router.patch("/:id/status", validateObjectIdParam("id"), validateSchema(statusSchema), asyncHandler(async (req, res) => {
    const user = await requireUser(store, req.params.id);
    const updates = { isActive: req.body.isActive };
    await assertAdminChangeAllowed(store, req.user, user, updates);
    const result = await updateUserAndRevoke({ store, auditService, actor: req.user, target: user, updates, req });
    res.json({ user: publicManagedUser(result.user) });
  }));

  router.patch("/:id/plant-scope", validateObjectIdParam("id"), validateSchema(plantScopeSchema), asyncHandler(async (req, res) => {
    const user = await requireUser(store, req.params.id);
    const updates = { assignedPlants: await normalizeAssignedPlants(store, user.role, req.body.assignedPlants) };
    const result = await updateUserAndRevoke({ store, auditService, actor: req.user, target: user, updates, req });
    res.json({ user: publicManagedUser(result.user) });
  }));

  return router;
}

async function listUsers(store, query) {
  if (store.useMongo) {
    const filter = {};
    if (query.role) filter.role = query.role;
    if (query.isActive) filter.isActive = query.isActive === "true";
    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), "i");
      filter.$or = [{ email: regex }, { name: regex }];
    }
    const [rows, total] = await Promise.all([
      User.find(filter).sort(toMongoSort(query.sort)).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      User.countDocuments(filter)
    ]);
    return { rows: rows.map(publicManagedUser), page: query.page, limit: query.limit, total };
  }

  let rows = store.users.map(normalizeMemoryUser);
  if (query.role) rows = rows.filter((user) => user.role === query.role);
  if (query.isActive) rows = rows.filter((user) => String(user.isActive) === query.isActive);
  if (query.search) {
    const needle = query.search.toLowerCase();
    rows = rows.filter((user) => user.email.toLowerCase().includes(needle) || user.name.toLowerCase().includes(needle));
  }
  const direction = query.sort.startsWith("-") ? -1 : 1;
  const field = query.sort.replace(/^-/, "");
  rows.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * direction);
  const total = rows.length;
  const start = (query.page - 1) * query.limit;
  return { rows: rows.slice(start, start + query.limit).map(publicManagedUser), page: query.page, limit: query.limit, total };
}

async function createUser(store, payload) {
  if (store.useMongo) {
    const created = await User.create(payload);
    return normalizeMongoUser(created);
  }
  if (store.users.some((user) => user.email.toLowerCase() === payload.email.toLowerCase())) {
    throw new HttpError(409, "Email already exists", "DUPLICATE_EMAIL");
  }
  const now = new Date().toISOString();
  const created = { id: new mongoose.Types.ObjectId().toString(), ...payload, createdAt: now, updatedAt: now };
  store.users.push(created);
  return created;
}

async function requireUser(store, id) {
  const user = store.useMongo
    ? normalizeMongoUser(await User.findById(id).lean())
    : store.users.find((candidate) => candidate.id === id);
  if (!user) {
    throw new HttpError(404, "User not found", "USER_NOT_FOUND");
  }
  return user;
}

async function normalizeAssignedPlants(store, role, plantIds) {
  if (!scopedRoles.has(role)) {
    return [];
  }
  const uniquePlantIds = [...new Set((plantIds ?? []).map(String))];
  if (!uniquePlantIds.every((id) => mongoose.isValidObjectId(id))) {
    throw new HttpError(400, "Invalid plant identifier", "INVALID_OBJECT_ID");
  }
  if (uniquePlantIds.length === 0) {
    return [];
  }

  const plants = store.useMongo
    ? await Plant.find({ _id: { $in: uniquePlantIds }, isActive: true }).lean()
    : store.plants.filter((plant) => uniquePlantIds.includes(String(plant.id)) && plant.isActive);
  if (plants.length !== uniquePlantIds.length) {
    throw new HttpError(400, "Assigned plants must be active", "INVALID_PLANT_SCOPE");
  }
  return [...new Set(plants.map((plant) => plant.code))];
}

async function assertAdminChangeAllowed(store, actor, target, updates) {
  const targetIsActor = String(actor.id) === String(target.id);
  const adminWouldBeRemoved = target.role === ROLES.ADMIN && (updates.role && updates.role !== ROLES.ADMIN || updates.isActive === false);
  if (adminWouldBeRemoved) {
    const remainingAdmins = store.useMongo
      ? await User.countDocuments({ _id: { $ne: target.id }, role: ROLES.ADMIN, isActive: true })
      : store.users.filter((user) => user.id !== target.id && user.role === ROLES.ADMIN && user.isActive).length;
    if (remainingAdmins === 0) {
      throw new HttpError(400, "At least one active Admin is required", "FINAL_ADMIN_REQUIRED");
    }
  }

  if (targetIsActor && (updates.role || updates.isActive === false)) {
    throw new HttpError(400, "Admins cannot remove their own admin access", "SELF_ADMIN_CHANGE_DENIED");
  }
}

async function updateUserAndRevoke({ store, auditService, actor, target, updates, req }) {
  const before = publicManagedUser(target);
  const securityChanged = updates.role !== undefined || updates.isActive !== undefined || updates.assignedPlants !== undefined;
  const updatePayload = { ...updates, updatedBy: actor.id };

  let updated;
  try {
    if (store.useMongo) {
      updated = await updateMongoUserAndRevoke(target.id, updatePayload, securityChanged);
    } else {
      updated = updateMemoryUserAndRevoke(store, target.id, updatePayload, securityChanged);
    }
  } catch (error) {
    if (isDuplicateEmail(error)) {
      throw new HttpError(409, "Email already exists", "DUPLICATE_EMAIL");
    }
    throw error;
  }

  await writeUserAudit({ auditService, actor, before, after: publicManagedUser(updated), securityChanged, updates, req });
  return { user: updated };
}

async function updateMongoUserAndRevoke(id, updates, securityChanged) {
  const transactionAvailable = await supportsTransactions();
  if (transactionAvailable) {
    const session = await mongoose.startSession();
    try {
      let updated;
      await session.withTransaction(async () => {
        updated = await User.findByIdAndUpdate(id, updates, { new: true, session }).lean();
        if (securityChanged) {
          await Session.updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
        }
      });
      return normalizeMongoUser(updated);
    } finally {
      await session.endSession();
    }
  }

  if (securityChanged) {
    await Session.updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  return normalizeMongoUser(await User.findByIdAndUpdate(id, updates, { new: true }).lean());
}

function updateMemoryUserAndRevoke(store, id, updates, securityChanged) {
  if (securityChanged) {
    for (const session of store.sessions) {
      if (String(session.userId) === String(id) && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  }
  const user = store.users.find((candidate) => candidate.id === id);
  Object.assign(user, updates, { updatedAt: new Date().toISOString() });
  return user;
}

async function writeUserAudit({ auditService, actor, before, after, securityChanged, updates, req }) {
  const actions = [];
  if (!before && after) actions.push("CREATE_USER");
  if (updates.role && updates.role !== before.role) actions.push("CHANGE_ROLE");
  if (updates.assignedPlants) actions.push("UPDATE_PLANT_SCOPE");
  if (updates.isActive === false && before.isActive) actions.push("DEACTIVATE_USER");
  if (updates.isActive === true && !before.isActive) actions.push("REACTIVATE_USER");
  if (actions.length === 0) actions.push("UPDATE_USER");

  for (const action of actions) {
    await auditService.record({ actorUserId: actor.id, action, entityType: "User", entityId: after.id, before, after, requestId: req.id }, req);
  }
  if (securityChanged) {
    await auditService.record({ actorUserId: actor.id, action: "REVOKE_USER_SESSIONS", entityType: "User", entityId: after.id, requestId: req.id }, req);
  }
}

function publicManagedUser(user) {
  const normalized = normalizeMongoUser(user);
  const publicUser = {
    id: normalized.id,
    email: normalized.email,
    name: normalized.name,
    role: normalized.role,
    assignedPlants: normalized.assignedPlants ?? [],
    isActive: Boolean(normalized.isActive),
    mustChangePassword: Boolean(normalized.mustChangePassword),
    createdAt: normalized.createdAt?.toISOString?.() ?? normalized.createdAt,
    updatedAt: normalized.updatedAt?.toISOString?.() ?? normalized.updatedAt
  };
  return publicUser;
}

function normalizeMongoUser(user) {
  if (!user) return user;
  const record = user.toObject?.() ?? user;
  return { ...record, id: String(record._id ?? record.id), assignedPlants: record.assignedPlants ?? [] };
}

function normalizeMemoryUser(user) {
  return { mustChangePassword: false, ...user, assignedPlants: user.assignedPlants ?? [] };
}

function toMongoSort(sort) {
  const direction = sort.startsWith("-") ? -1 : 1;
  return { [sort.replace(/^-/, "")]: direction };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDuplicateEmail(error) {
  return isDuplicateKeyError(error) || error?.code === "DUPLICATE_EMAIL";
}

async function supportsTransactions() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 }).catch(() => ({}));
  return Boolean(hello.setName || hello.msg === "isdbgrid");
}

export function generateTemporaryPassword() {
  return crypto.randomBytes(18).toString("base64url");
}
