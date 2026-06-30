import crypto from "node:crypto";
import { AuditLog } from "../models/AuditLog.js";
import { redactSensitive } from "../utils/sanitize.js";

export function hashClientValue(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createAuditService(store) {
  return {
    async record(event, req) {
      const entry = {
        ...redactSensitive(event),
        ipHash: event.ipHash ?? (req ? hashClientValue(req.ip ?? "") : undefined),
        userAgentHash: event.userAgentHash ?? (req ? hashClientValue(req.get?.("user-agent") ?? "") : undefined),
        createdAt: new Date().toISOString()
      };

      if (store.useMongo) {
        try {
          const created = await AuditLog.create(entry);
          return normalizeAuditLog(created.toObject());
        } catch {
          throw new Error("Audit write failed");
        }
      }

      store.auditLogs.push(entry);
      return entry;
    },

    async list(query = {}) {
      if (store.useMongo) {
        const { filter, sort, page, limit } = buildMongoQuery(query);
        const [rows, total] = await Promise.all([
          AuditLog.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
          AuditLog.countDocuments(filter)
        ]);
        return { rows: rows.map(normalizeAuditLog), page, limit, total };
      }

      return listMemoryAuditLogs(store.auditLogs, query);
    }
  };
}

function normalizeAuditLog(record) {
  if (!record) {
    return record;
  }
  const normalized = redactSensitive({
    ...record,
    id: String(record._id ?? record.id),
    actorUserId: record.actorUserId ? String(record.actorUserId) : undefined,
    createdAt: record.createdAt?.toISOString?.() ?? record.createdAt
  });
  delete normalized._id;
  delete normalized.__v;
  return normalized;
}

function buildMongoQuery(query) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const filter = {};
  for (const field of ["action", "entityType", "entityId", "plantId"]) {
    if (query[field]) {
      filter[field] = query[field];
    }
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) {
      filter.createdAt.$gte = new Date(query.dateFrom);
    }
    if (query.dateTo) {
      filter.createdAt.$lte = new Date(query.dateTo);
    }
  }
  return { filter, sort: buildSort(query.sort), page, limit };
}

function buildSort(sort = "-createdAt") {
  const direction = sort.startsWith("-") ? -1 : 1;
  const field = sort.replace(/^-/, "");
  return { [field]: direction };
}

function listMemoryAuditLogs(records, query) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const sort = query.sort ?? "-createdAt";
  let rows = records.map(normalizeAuditLog);
  for (const field of ["action", "entityType", "entityId", "plantId"]) {
    if (query[field]) {
      rows = rows.filter((entry) => entry[field] === query[field]);
    }
  }
  if (query.dateFrom) {
    rows = rows.filter((entry) => new Date(entry.createdAt) >= new Date(query.dateFrom));
  }
  if (query.dateTo) {
    rows = rows.filter((entry) => new Date(entry.createdAt) <= new Date(query.dateTo));
  }
  const field = sort.replace(/^-/, "");
  const direction = sort.startsWith("-") ? -1 : 1;
  rows.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * direction);
  const total = rows.length;
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), page, limit, total };
}
