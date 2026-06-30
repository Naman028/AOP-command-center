import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { HttpError } from "../../utils/httpError.js";
import { duplicateConflict, listRecords, normalizeCode, parseListQuery, registerReadWriteRoutes, requireObjectId } from "../masterData/common.js";

const plantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9-]+$/).transform(normalizeCode),
  location: z.string().trim().min(1).max(120),
  businessUnit: z.string().trim().min(1).max(120),
  isActive: z.boolean().optional().default(true)
}).strict();

export function createPlantRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  const { requireWrite, validateId, validateBody } = registerReadWriteRoutes(router, sessionService);

  router.get("/", (req, res) => {
    const query = activeOnlyUnlessMasterDataViewer(req, parseListQuery(req.query));
    res.json(listRecords(store.plants, query, ["code", "name", "location", "businessUnit"], ["code", "name", "location", "businessUnit"]));
  });

  router.post("/", requireWrite, validateBody(plantSchema), (req, res) => {
    if (store.plants.some((plant) => plant.code === req.body.code)) {
      throw duplicateConflict("Plant code already exists");
    }
    const plant = { id: newId(), ...req.body, createdBy: req.user.id, updatedBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.plants.push(plant);
    auditService.record({ actorUserId: req.user.id, action: "CREATE_PLANT", entityType: "Plant", entityId: plant.id, after: plant, requestId: req.id });
    res.status(201).json({ plant });
  });

  router.patch("/:id", requireWrite, validateId, validateBody(plantSchema.partial()), (req, res) => {
    const plant = findPlant(store, req.params.id);
    const nextCode = req.body.code ?? plant.code;
    if (store.plants.some((candidate) => candidate.id !== plant.id && candidate.code === nextCode)) {
      throw duplicateConflict("Plant code already exists");
    }
    const before = { ...plant };
    Object.assign(plant, req.body, { updatedBy: req.user.id, updatedAt: new Date().toISOString() });
    auditService.record({ actorUserId: req.user.id, action: plant.isActive ? "UPDATE_PLANT" : "DEACTIVATE_PLANT", entityType: "Plant", entityId: plant.id, before, after: plant, requestId: req.id });
    res.json({ plant });
  });

  router.delete("/:id", requireWrite, validateId, (req, res) => {
    const plant = findPlant(store, req.params.id);
    const referenced = store.targets.some((target) => target.plantId === plant.code) || store.actuals.some((actual) => actual.plantId === plant.code) || store.importBatches.some((batch) => batch.plantIds?.includes(plant.code));
    if (referenced) {
      throw new HttpError(409, "Plant is referenced by operational data", "MASTER_DATA_REFERENCED");
    }
    store.plants = store.plants.filter((candidate) => candidate.id !== plant.id);
    auditService.record({ actorUserId: req.user.id, action: "DELETE_PLANT", entityType: "Plant", entityId: plant.id, before: plant, requestId: req.id });
    res.status(204).send();
  });

  return router;
}

function findPlant(store, id) {
  requireObjectId(id);
  const plant = store.plants.find((candidate) => candidate.id === id);
  if (!plant) {
    throw new HttpError(404, "Plant not found", "PLANT_NOT_FOUND");
  }
  return plant;
}

function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function activeOnlyUnlessMasterDataViewer(req, query) {
  return req.user.permissions.includes(PERMISSIONS.MASTER_DATA_VIEW) ? query : { ...query, isActive: "true" };
}
