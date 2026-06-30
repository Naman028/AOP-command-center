import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { FinancialYear } from "../../models/FinancialYear.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { duplicateConflict, isDuplicateKeyError, listRecords, parseListQuery, registerReadWriteRoutes, requireObjectId, toApiRecord } from "../masterData/common.js";

const financialYearBaseSchema = z.object({
  label: z.string().trim().min(4).max(24),
  startDate: z.string().date(),
  endDate: z.string().date(),
  isActive: z.boolean().optional().default(false)
}).strict();

const financialYearCreateSchema = financialYearBaseSchema.refine((value) => new Date(value.startDate) < new Date(value.endDate), {
  message: "startDate must be before endDate"
});

const financialYearUpdateSchema = financialYearBaseSchema.partial();

export function createFinancialYearRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  const { requireWrite, validateId, validateBody } = registerReadWriteRoutes(router, sessionService);

  router.get("/", asyncHandler(async (req, res) => {
    const query = activeOnlyUnlessMasterDataViewer(req, parseListQuery(req.query));
    const records = store.useMongo ? (await FinancialYear.find().lean()).map(toApiRecord) : store.financialYears;
    res.json(listRecords(records, query, ["label", "startDate", "endDate"], ["label"]));
  }));

  router.post("/", requireWrite, validateBody(financialYearCreateSchema), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      if (req.body.isActive && await FinancialYear.exists({ isActive: true })) {
        throw new HttpError(409, "Only one financial year may be active", "ACTIVE_FINANCIAL_YEAR_EXISTS");
      }
      try {
        const created = await FinancialYear.create({ ...req.body, createdBy: req.user.id, updatedBy: req.user.id });
        const financialYear = toApiRecord(created.toObject());
        await auditService.record({ actorUserId: req.user.id, action: "CREATE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, after: financialYear, requestId: req.id }, req);
        res.status(201).json({ financialYear });
        return;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw duplicateConflict("Financial year label already exists");
        }
        throw error;
      }
    }
    assertUnique(store, req.body.label);
    assertOnlyOneActive(store, req.body.isActive);
    const financialYear = { id: newId(), ...req.body, createdBy: req.user.id, updatedBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.financialYears.push(financialYear);
    await auditService.record({ actorUserId: req.user.id, action: "CREATE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, after: financialYear, requestId: req.id }, req);
    res.status(201).json({ financialYear });
  }));

  router.patch("/:id", requireWrite, validateId, validateBody(financialYearUpdateSchema), asyncHandler(async (req, res) => {
    if (store.useMongo) {
      const existing = await FinancialYear.findById(req.params.id).lean();
      if (!existing) {
        throw new HttpError(404, "Financial year not found", "FINANCIAL_YEAR_NOT_FOUND");
      }
      if (req.body.isActive === true && !existing.isActive && await FinancialYear.exists({ isActive: true })) {
        throw new HttpError(409, "Only one financial year may be active", "ACTIVE_FINANCIAL_YEAR_EXISTS");
      }
      const next = { ...existing, ...req.body };
      if (new Date(next.startDate) >= new Date(next.endDate)) {
        throw new HttpError(400, "startDate must be before endDate", "INVALID_FINANCIAL_YEAR_DATES");
      }
      try {
        const updated = await FinancialYear.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user.id }, { new: true, runValidators: true }).lean();
        const before = toApiRecord(existing);
        const financialYear = toApiRecord(updated);
        await auditService.record({ actorUserId: req.user.id, action: financialYear.isActive ? "UPDATE_MASTER_DATA" : "DEACTIVATE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, before, after: financialYear, requestId: req.id }, req);
        res.json({ financialYear });
        return;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw duplicateConflict("Financial year label already exists");
        }
        throw error;
      }
    }
    const financialYear = findFinancialYear(store, req.params.id);
    if (req.body.label && req.body.label !== financialYear.label) {
      assertUnique(store, req.body.label);
    }
    if (req.body.isActive === true && !financialYear.isActive) {
      assertOnlyOneActive(store, true);
    }
    const before = { ...financialYear };
    const next = { ...financialYear, ...req.body };
    if (new Date(next.startDate) >= new Date(next.endDate)) {
      throw new HttpError(400, "startDate must be before endDate", "INVALID_FINANCIAL_YEAR_DATES");
    }
    Object.assign(financialYear, req.body, { updatedBy: req.user.id, updatedAt: new Date().toISOString() });
    await auditService.record({ actorUserId: req.user.id, action: financialYear.isActive ? "UPDATE_MASTER_DATA" : "DEACTIVATE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, before, after: financialYear, requestId: req.id }, req);
    res.json({ financialYear });
  }));

  router.delete("/:id", requireWrite, validateId, asyncHandler(async (req, res) => {
    if (store.useMongo) {
      const existing = await FinancialYear.findById(req.params.id).lean();
      if (!existing) {
        throw new HttpError(404, "Financial year not found", "FINANCIAL_YEAR_NOT_FOUND");
      }
      const financialYear = toApiRecord(existing);
      const referenced = store.targets.some((target) => target.financialYear?.label === financialYear.label || target.financialYear === financialYear.label) || store.actuals.some((actual) => actual.financialYear?.label === financialYear.label || actual.financialYear === financialYear.label);
      if (referenced) {
        throw new HttpError(409, "Financial year is referenced by operational data", "MASTER_DATA_REFERENCED");
      }
      await FinancialYear.deleteOne({ _id: req.params.id });
      await auditService.record({ actorUserId: req.user.id, action: "DELETE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, before: financialYear, requestId: req.id }, req);
      res.status(204).send();
      return;
    }
    const financialYear = findFinancialYear(store, req.params.id);
    const referenced = store.targets.some((target) => target.financialYear?.label === financialYear.label || target.financialYear === financialYear.label) || store.actuals.some((actual) => actual.financialYear?.label === financialYear.label || actual.financialYear === financialYear.label);
    if (referenced) {
      throw new HttpError(409, "Financial year is referenced by operational data", "MASTER_DATA_REFERENCED");
    }
    store.financialYears = store.financialYears.filter((candidate) => candidate.id !== financialYear.id);
    await auditService.record({ actorUserId: req.user.id, action: "DELETE_MASTER_DATA", entityType: "FinancialYear", entityId: financialYear.id, before: financialYear, requestId: req.id }, req);
    res.status(204).send();
  }));

  return router;
}

function assertUnique(store, label) {
  if (store.financialYears.some((candidate) => candidate.label === label)) {
    throw duplicateConflict("Financial year label already exists");
  }
}

function assertOnlyOneActive(store, isActive) {
  if (isActive && store.financialYears.some((candidate) => candidate.isActive)) {
    throw new HttpError(409, "Only one financial year may be active", "ACTIVE_FINANCIAL_YEAR_EXISTS");
  }
}

function findFinancialYear(store, id) {
  requireObjectId(id);
  const financialYear = store.financialYears.find((candidate) => candidate.id === id);
  if (!financialYear) {
    throw new HttpError(404, "Financial year not found", "FINANCIAL_YEAR_NOT_FOUND");
  }
  return financialYear;
}

function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function activeOnlyUnlessMasterDataViewer(req, query) {
  return req.user.permissions.includes(PERMISSIONS.MASTER_DATA_VIEW) ? query : { ...query, isActive: "true" };
}
