import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { Material } from "../../models/Material.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { duplicateConflict, isDuplicateKeyError, listRecords, normalizeCode, parseListQuery, registerReadWriteRoutes, requireObjectId, toApiRecord } from "../masterData/common.js";

const materialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9-]+$/).transform(normalizeCode),
  category: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(24),
  isActive: z.boolean().optional().default(true)
}).strict();

export function createMaterialRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  const { requireWrite, validateId, validateBody } = registerReadWriteRoutes(router, sessionService);

  router.get("/", asyncHandler(async (req, res) => {
    const query = activeOnlyUnlessMasterDataViewer(req, parseListQuery(req.query));
    const records = store.useMongo ? (await Material.find().lean()).map(toApiRecord) : store.materials;
    res.json(listRecords(records, query, ["code", "name", "category", "unit"], ["code", "name", "category", "unit"]));
  }));

  router.post("/", requireWrite, validateBody(materialSchema), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      try {
        const created = await Material.create({ ...req.body, createdBy: req.user.id, updatedBy: req.user.id });
        const material = toApiRecord(created.toObject());
        await auditService.record({ actorUserId: req.user.id, action: "CREATE_MASTER_DATA", entityType: "Material", entityId: material.id, after: material, requestId: req.id }, req);
        res.status(201).json({ material });
        return;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw duplicateConflict("Material code already exists");
        }
        throw error;
      }
    }
    if (store.materials.some((material) => material.code === req.body.code)) {
      throw duplicateConflict("Material code already exists");
    }
    const material = { id: newId(), ...req.body, createdBy: req.user.id, updatedBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.materials.push(material);
    await auditService.record({ actorUserId: req.user.id, action: "CREATE_MASTER_DATA", entityType: "Material", entityId: material.id, after: material, requestId: req.id }, req);
    res.status(201).json({ material });
  }));

  router.patch("/:id", requireWrite, validateId, validateBody(materialSchema.partial()), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      const existing = await Material.findById(req.params.id).lean();
      if (!existing) {
        throw new HttpError(404, "Material not found", "MATERIAL_NOT_FOUND");
      }
      try {
        const updated = await Material.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user.id }, { new: true, runValidators: true }).lean();
        const before = toApiRecord(existing);
        const material = toApiRecord(updated);
        await auditService.record({ actorUserId: req.user.id, action: material.isActive ? "UPDATE_MASTER_DATA" : "DEACTIVATE_MASTER_DATA", entityType: "Material", entityId: material.id, before, after: material, requestId: req.id }, req);
        res.json({ material });
        return;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw duplicateConflict("Material code already exists");
        }
        throw error;
      }
    }
    const material = findMaterial(store, req.params.id);
    const nextCode = req.body.code ?? material.code;
    if (store.materials.some((candidate) => candidate.id !== material.id && candidate.code === nextCode)) {
      throw duplicateConflict("Material code already exists");
    }
    const before = { ...material };
    Object.assign(material, req.body, { updatedBy: req.user.id, updatedAt: new Date().toISOString() });
    await auditService.record({ actorUserId: req.user.id, action: material.isActive ? "UPDATE_MASTER_DATA" : "DEACTIVATE_MASTER_DATA", entityType: "Material", entityId: material.id, before, after: material, requestId: req.id }, req);
    res.json({ material });
  }));

  router.delete("/:id", requireWrite, validateId, asyncHandler(async (req, res) => {
    if (store.useMongo) {
      const existing = await Material.findById(req.params.id).lean();
      if (!existing) {
        throw new HttpError(404, "Material not found", "MATERIAL_NOT_FOUND");
      }
      const material = toApiRecord(existing);
      await Material.deleteOne({ _id: req.params.id });
      await auditService.record({ actorUserId: req.user.id, action: "DELETE_MASTER_DATA", entityType: "Material", entityId: material.id, before: material, requestId: req.id }, req);
      res.status(204).send();
      return;
    }
    const material = findMaterial(store, req.params.id);
    store.materials = store.materials.filter((candidate) => candidate.id !== material.id);
    await auditService.record({ actorUserId: req.user.id, action: "DELETE_MASTER_DATA", entityType: "Material", entityId: material.id, before: material, requestId: req.id }, req);
    res.status(204).send();
  }));

  return router;
}

function findMaterial(store, id) {
  requireObjectId(id);
  const material = store.materials.find((candidate) => candidate.id === id);
  if (!material) {
    throw new HttpError(404, "Material not found", "MATERIAL_NOT_FOUND");
  }
  return material;
}

function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function activeOnlyUnlessMasterDataViewer(req, query) {
  return req.user.permissions.includes(PERMISSIONS.MASTER_DATA_VIEW) ? query : { ...query, isActive: "true" };
}
