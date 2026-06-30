import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { HttpError } from "../../utils/httpError.js";
import { duplicateConflict, listRecords, normalizeCode, parseListQuery, registerReadWriteRoutes, requireObjectId } from "../masterData/common.js";

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

  router.get("/", (req, res) => {
    const query = activeOnlyUnlessMasterDataViewer(req, parseListQuery(req.query));
    res.json(listRecords(store.materials, query, ["code", "name", "category", "unit"], ["code", "name", "category", "unit"]));
  });

  router.post("/", requireWrite, validateBody(materialSchema), (req, res) => {
    if (store.materials.some((material) => material.code === req.body.code)) {
      throw duplicateConflict("Material code already exists");
    }
    const material = { id: newId(), ...req.body, createdBy: req.user.id, updatedBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.materials.push(material);
    auditService.record({ actorUserId: req.user.id, action: "CREATE_MATERIAL", entityType: "Material", entityId: material.id, after: material, requestId: req.id });
    res.status(201).json({ material });
  });

  router.patch("/:id", requireWrite, validateId, validateBody(materialSchema.partial()), (req, res) => {
    const material = findMaterial(store, req.params.id);
    const nextCode = req.body.code ?? material.code;
    if (store.materials.some((candidate) => candidate.id !== material.id && candidate.code === nextCode)) {
      throw duplicateConflict("Material code already exists");
    }
    const before = { ...material };
    Object.assign(material, req.body, { updatedBy: req.user.id, updatedAt: new Date().toISOString() });
    auditService.record({ actorUserId: req.user.id, action: material.isActive ? "UPDATE_MATERIAL" : "DEACTIVATE_MATERIAL", entityType: "Material", entityId: material.id, before, after: material, requestId: req.id });
    res.json({ material });
  });

  router.delete("/:id", requireWrite, validateId, (req, res) => {
    const material = findMaterial(store, req.params.id);
    store.materials = store.materials.filter((candidate) => candidate.id !== material.id);
    auditService.record({ actorUserId: req.user.id, action: "DELETE_MATERIAL", entityType: "Material", entityId: material.id, before: material, requestId: req.id });
    res.status(204).send();
  });

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
