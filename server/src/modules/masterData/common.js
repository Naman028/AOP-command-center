import mongoose from "mongoose";
import { z } from "zod";
import { PERMISSIONS } from "../../constants/permissions.js";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { validateObjectIdParam, validateSchema } from "../../middleware/validate.js";
import { HttpError } from "../../utils/httpError.js";

export const listQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();

export function parseListQuery(query) {
  const result = listQuerySchema.safeParse(query);
  if (!result.success) {
    throw new HttpError(400, "Validation failed", "VALIDATION_FAILED");
  }
  return result.data;
}

export function normalizeCode(value) {
  return String(value).trim().toUpperCase();
}

export function listRecords(records, query, allowedSorts, searchFields) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const sort = query.sort ?? allowedSorts[0];
  if (!allowedSorts.includes(sort)) {
    throw new HttpError(400, "Invalid sort field", "INVALID_SORT");
  }

  let rows = [...records];
  if (query.isActive) {
    rows = rows.filter((record) => String(record.isActive) === query.isActive);
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    rows = rows.filter((record) => searchFields.some((field) => String(record[field] ?? "").toLowerCase().includes(needle)));
  }

  rows.sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? "")));
  const total = rows.length;
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), page, limit, total };
}

export function toApiRecord(record) {
  if (!record) {
    return record;
  }
  const id = String(record._id ?? record.id);
  const apiRecord = { ...record, id };
  delete apiRecord._id;
  delete apiRecord.__v;
  return apiRecord;
}

export function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function requireObjectId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "Invalid identifier", "INVALID_OBJECT_ID");
  }
}

export function duplicateConflict(message) {
  return new HttpError(409, message, "DUPLICATE_MASTER_DATA");
}

export function registerReadWriteRoutes(router, sessionService, config) {
  router.use(authenticate(sessionService));
  return {
    requireWrite: requirePermission(PERMISSIONS.MASTER_DATA_MANAGE),
    validateId: validateObjectIdParam("id"),
    validateBody: (schema) => validateSchema(schema),
    config
  };
}
