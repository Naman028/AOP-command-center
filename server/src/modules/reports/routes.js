import express from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { PERMISSIONS, ROLES } from "../../constants/permissions.js";
import { authenticate, requirePermission, serverPlantFilter } from "../../middleware/auth.js";
import { validateSchema } from "../../middleware/validate.js";
import { Actual } from "../../models/Actual.js";
import { Plant } from "../../models/Plant.js";
import { Target } from "../../models/Target.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError, forbidden } from "../../utils/httpError.js";
import { escapeFormulaValue } from "../../utils/sanitize.js";
import { requireObjectId, toApiRecord } from "../masterData/common.js";

const metricTypes = ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"];
const supportedUnits = ["USD", "EUR", "EA", "KG", "TON", "L", "KWH", "MWH", "PCS"];
const allowedSorts = ["plant", "financialYear", "month", "metricType", "category", "dataStatus", "performanceStatus", "variance"];
const exportRowLimit = 10000;
const exportCellLimit = 200000;
const exportRateWindowMs = 10 * 60 * 1000;
const exportRateMax = 10;
const exportColumns = [
  { header: "Plant Code", key: "plantCode", width: 14 },
  { header: "Plant Name", key: "plantName", width: 24 },
  { header: "Financial Year", key: "financialYear", width: 16 },
  { header: "Month", key: "month", width: 10 },
  { header: "Metric Type", key: "metricType", width: 18 },
  { header: "Category", key: "category", width: 18 },
  { header: "Material Code", key: "materialCode", width: 16 },
  { header: "Material Name", key: "materialName", width: 24 },
  { header: "Planned Value", key: "plannedValue", width: 16, numeric: true },
  { header: "Actual Value", key: "actualValue", width: 16, numeric: true },
  { header: "Unit", key: "unit", width: 10 },
  { header: "Variance", key: "variance", width: 16, numeric: true },
  { header: "Attainment %", key: "attainmentPct", width: 16, numeric: true },
  { header: "Data Status", key: "dataStatus", width: 20 },
  { header: "Performance Status", key: "performanceStatus", width: 22 }
];

const reportQuerySchema = z.object({
  plant: z.string().optional(),
  financialYear: z.string(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  metricType: z.enum(metricTypes).optional(),
  category: z.string().trim().max(80).optional(),
  material: z.string().optional(),
  sort: z.enum(allowedSorts).optional().default("plant"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
}).strict();
const dashboardQuerySchema = z.object({
  financialYear: z.string()
}).strict();
const exportBodySchema = z.object({
  financialYear: z.string(),
  plant: z.string().optional(),
  monthFrom: z.number().int().min(1).max(12).optional(),
  monthTo: z.number().int().min(1).max(12).optional(),
  metricType: z.enum(metricTypes).optional(),
  category: z.string().trim().max(80).optional(),
  material: z.string().optional(),
  unit: z.enum(supportedUnits).optional(),
  includeHistorical: z.boolean().optional()
}).strict().superRefine((body, context) => {
  if (body.monthFrom && body.monthTo && body.monthFrom > body.monthTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["monthFrom"], message: "monthFrom must be before or equal to monthTo" });
  }
});

export function createReportingRouter({ store, sessionService, auditService }) {
  const router = express.Router();
  const exportRateLimiter = createExportRateLimiter();
  router.use(authenticate(sessionService));
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const overview = asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    const comparisons = await buildComparisons(store, req.user, query);
    res.json({ dashboard: dashboardPayload(comparisons) });
  });
  router.get("/dashboard/overview", requirePermission(PERMISSIONS.DASHBOARD_VIEW), validateSchema(dashboardQuerySchema, "query"), overview);
  router.get("/dashboard", requirePermission(PERMISSIONS.DASHBOARD_VIEW), validateSchema(dashboardQuerySchema, "query"), overview);

  router.get("/reports/target-data", requirePermission(PERMISSIONS.REPORTS_VIEW), validateSchema(reportQuerySchema, "query"), asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    const rows = sortComparisons(await buildComparisons(store, req.user, query), query.sort);
    res.json(paginate(rows, query));
  }));

  router.get("/reports/summary", requirePermission(PERMISSIONS.REPORTS_VIEW), validateSchema(reportQuerySchema, "query"), asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    const comparisons = await buildComparisons(store, req.user, query);
    res.json({ rows: summarizeBy(comparisons, ["metricType", "unit"]), dataStatusCounts: countDataStatuses(comparisons), performanceStatusCounts: countPerformanceStatuses(comparisons) });
  }));

  router.get("/reports/plant-performance", requirePermission(PERMISSIONS.REPORTS_VIEW), validateSchema(reportQuerySchema, "query"), asyncHandler(async (req, res) => {
    const query = validateObjectIdFilters(req.validatedQuery);
    const comparisons = await buildComparisons(store, req.user, query);
    res.json({ rows: summarizeBy(comparisons, ["plant", "metricType", "unit"]), dataStatusCounts: countDataStatuses(comparisons), performanceStatusCounts: countPerformanceStatuses(comparisons) });
  }));

  const exportHandler = (reportType) => [
    requirePermission(PERMISSIONS.REPORTS_EXPORT),
    exportRateLimiter,
    validateSchema(exportBodySchema),
    asyncHandler(async (req, res) => {
      if (req.body.includeHistorical && req.user.role !== ROLES.ADMIN) {
        throw forbidden("Historical export is not permitted");
      }
      const query = normalizeExportQuery(validateObjectIdFilters(req.body));
      const comparisons = sortComparisons(await buildComparisons(store, req.user, query), "plant");
      const rows = exportRowsForType(reportType, comparisons, query);
      enforceExportLimits(rows, exportColumns.length);
      const workbook = buildExportWorkbook(reportType, rows, query, req.user);
      const buffer = await workbook.xlsx.writeBuffer();
      await auditService.record({
        actorUserId: req.user.id,
        action: "EXPORT_REPORT",
        entityType: "Report",
        entityId: reportType,
        reportType,
        filters: sanitizeExportFilters(query),
        permittedPlantScope: permittedPlantScope(req.user),
        requestId: req.id
      }, req);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeExportFilename(reportType)}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(Buffer.from(buffer));
    })
  ];

  router.post("/reports/target-data/export", ...exportHandler("target-data"));
  router.post("/reports/summary/export", ...exportHandler("summary"));
  router.post("/reports/plant-performance/export", ...exportHandler("plant-performance"));

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

async function buildComparisons(store, user, query) {
  const { targets, actuals } = store.useMongo
    ? await loadMongoRows(user, query)
    : loadMemoryRows(store, user, query);
  return compareTargetActualRows(targets, actuals);
}

async function loadMongoRows(user, query) {
  const filter = buildMongoFilter(query);
  const allowedPlants = serverPlantFilter(user);
  if (allowedPlants) {
    const plants = await Plant.find({ code: { $in: [...allowedPlants] } }).select("_id").lean();
    filter.plant = { $in: plants.map((plant) => plant._id) };
  }
  const [targets, actuals] = await Promise.all([
    Target.find(filter).populate(["plant", "financialYear", "material"]).lean(),
    Actual.find(filter).populate(["plant", "financialYear", "material"]).lean()
  ]);
  return {
    targets: targets.map((row) => serializeRow(row, "target")),
    actuals: actuals.map((row) => serializeRow(row, "actual"))
  };
}

function buildMongoFilter(query) {
  const filter = { isActive: true };
  for (const field of ["plant", "financialYear", "metricType"]) {
    if (query[field] !== undefined) {
      filter[field] = query[field];
    }
  }
  if (query.month !== undefined) {
    filter.month = query.month;
  }
  if (query.monthFrom !== undefined || query.monthTo !== undefined) {
    filter.month = {};
    if (query.monthFrom !== undefined) filter.month.$gte = query.monthFrom;
    if (query.monthTo !== undefined) filter.month.$lte = query.monthTo;
  }
  if (query.category) {
    filter.category = normalizeCategory(query.category);
  }
  if (query.material) {
    filter.material = query.material;
  }
  return filter;
}

function loadMemoryRows(store, user, query) {
  const allowedPlants = serverPlantFilter(user);
  const visible = (row) => {
    if (!row.isActive) return false;
    if (allowedPlants && !allowedPlants.has(row.plant?.code ?? row.plantId)) return false;
    if (query.plant && row.plant?.id !== query.plant) return false;
    if (query.financialYear && row.financialYear?.id !== query.financialYear) return false;
    if (query.month && row.month !== query.month) return false;
    if (query.monthFrom && row.month < query.monthFrom) return false;
    if (query.monthTo && row.month > query.monthTo) return false;
    if (query.metricType && row.metricType !== query.metricType) return false;
    if (query.category && row.category !== normalizeCategory(query.category)) return false;
    if (query.material && row.material?.id !== query.material) return false;
    return true;
  };
  return {
    targets: store.targets.filter(visible).map((row) => serializeRow(row, "target")),
    actuals: store.actuals.filter(visible).map((row) => serializeRow(row, "actual"))
  };
}

function compareTargetActualRows(targets, actuals) {
  const actualByKey = new Map(actuals.map((actual) => [comparisonKey(actual), actual]));
  const usedActualKeys = new Set();
  const rows = [];
  for (const target of targets) {
    const key = comparisonKey(target);
    const actual = actualByKey.get(key);
    if (actual) {
      usedActualKeys.add(key);
    }
    rows.push(comparisonRow(target, actual));
  }
  for (const actual of actuals) {
    const key = comparisonKey(actual);
    if (!usedActualKeys.has(key)) {
      rows.push(comparisonRow(null, actual));
    }
  }
  return rows;
}

function comparisonRow(target, actual) {
  const basis = target ?? actual;
  const unit = target?.unit ?? actual?.unit ?? "";
  const plannedValue = target?.plannedValue ?? null;
  const actualValue = actual?.actualValue ?? null;
  const sameUnit = !target || !actual || target.unit === actual.unit;
  const dataStatus = comparisonDataStatus(target, actual, sameUnit);
  const performanceStatus = comparisonPerformanceStatus(dataStatus, basis.metricType, plannedValue, actualValue);
  const variance = dataStatus === "MATCHED" || dataStatus === "ZERO_TARGET" ? round(actualValue - plannedValue) : null;
  const attainmentPct = dataStatus === "MATCHED" && plannedValue > 0 ? round((actualValue / plannedValue) * 100) : null;
  return {
    plant: basis.plant,
    financialYear: basis.financialYear,
    month: basis.month,
    metricType: basis.metricType,
    category: basis.category,
    material: basis.material,
    plannedValue,
    actualValue,
    targetUnit: target?.unit ?? null,
    actualUnit: actual?.unit ?? null,
    unit,
    variance,
    attainmentPct,
    dataStatus,
    performanceStatus
  };
}

function comparisonDataStatus(target, actual, sameUnit) {
  if (!target) return "MISSING_TARGET";
  if (!actual) return "MISSING_ACTUAL";
  if (!sameUnit) return "UNIT_MISMATCH";
  if (target.plannedValue === 0) return "ZERO_TARGET";
  return "MATCHED";
}

function comparisonPerformanceStatus(dataStatus, metricType, plannedValue, actualValue) {
  if (dataStatus !== "MATCHED") return null;
  if (metricType === "TURNOVER" || metricType === "EARNINGS") {
    if (actualValue >= plannedValue) return "ON_TRACK";
    if (actualValue >= plannedValue * 0.9) return "WARNING";
    return "CRITICAL";
  }
  if (actualValue <= plannedValue) return "ON_TRACK";
  if (actualValue <= plannedValue * 1.1) return "WARNING";
  return "CRITICAL";
}

function summarizeBy(comparisons, fields) {
  const groups = new Map();
  for (const row of comparisons) {
    const unit = row.dataStatus === "UNIT_MISMATCH" ? "MIXED" : row.unit;
    const keyParts = fields.map((field) => field === "plant" ? row.plant.code : field === "unit" ? unit : row[field]);
    const key = keyParts.join("|");
    const current = groups.get(key) ?? {
      plant: fields.includes("plant") ? row.plant : undefined,
      metricType: fields.includes("metricType") ? row.metricType : undefined,
      unit: fields.includes("unit") ? unit : undefined,
      plannedValue: 0,
      actualValue: 0,
      variance: 0,
      attainmentPct: null,
      rowCount: 0,
      dataStatusCounts: emptyDataStatusCounts(),
      performanceStatusCounts: emptyPerformanceStatusCounts()
    };
    current.rowCount += 1;
    current.dataStatusCounts[row.dataStatus] += 1;
    if (row.performanceStatus) {
      current.performanceStatusCounts[row.performanceStatus] += 1;
    }
    if (row.dataStatus !== "UNIT_MISMATCH") {
      current.plannedValue += row.plannedValue ?? 0;
      current.actualValue += row.actualValue ?? 0;
      current.variance = round(current.actualValue - current.plannedValue);
      current.attainmentPct = current.plannedValue > 0 ? round((current.actualValue / current.plannedValue) * 100) : null;
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => `${a.plant?.code ?? ""}${a.metricType ?? ""}${a.unit ?? ""}`.localeCompare(`${b.plant?.code ?? ""}${b.metricType ?? ""}${b.unit ?? ""}`));
}

function dashboardPayload(comparisons) {
  const dataStatusCounts = countDataStatuses(comparisons);
  const performanceStatusCounts = countPerformanceStatuses(comparisons);
  const summary = summarizeBy(comparisons, ["metricType", "unit"]);
  const matched = comparisons.filter((row) => row.dataStatus === "MATCHED");
  const plannedValue = matched.reduce((total, row) => total + row.plannedValue, 0);
  const actualValue = matched.reduce((total, row) => total + row.actualValue, 0);
  return {
    totals: {
      rowCount: comparisons.length,
      matchedRows: dataStatusCounts.MATCHED,
      missingActualRows: dataStatusCounts.MISSING_ACTUAL,
      missingTargetRows: dataStatusCounts.MISSING_TARGET,
      zeroTargetRows: dataStatusCounts.ZERO_TARGET,
      unitMismatchRows: dataStatusCounts.UNIT_MISMATCH,
      matchedPlannedValue: round(plannedValue),
      matchedActualValue: round(actualValue),
      matchedAttainmentPct: plannedValue > 0 ? round((actualValue / plannedValue) * 100) : null
    },
    dataStatusCounts,
    performanceStatusCounts,
    byMetric: summary,
    attentionRows: comparisons.filter((row) => row.dataStatus !== "MATCHED" || row.performanceStatus !== "ON_TRACK").slice(0, 10)
  };
}

function countDataStatuses(comparisons) {
  return comparisons.reduce((counts, row) => {
    counts[row.dataStatus] += 1;
    return counts;
  }, emptyDataStatusCounts());
}

function countPerformanceStatuses(comparisons) {
  return comparisons.reduce((counts, row) => {
    if (row.performanceStatus) {
      counts[row.performanceStatus] += 1;
    }
    return counts;
  }, emptyPerformanceStatusCounts());
}

function emptyDataStatusCounts() {
  return {
    MATCHED: 0,
    MISSING_ACTUAL: 0,
    MISSING_TARGET: 0,
    ZERO_TARGET: 0,
    UNIT_MISMATCH: 0
  };
}

function emptyPerformanceStatusCounts() {
  return {
    ON_TRACK: 0,
    WARNING: 0,
    CRITICAL: 0
  };
}

function sortComparisons(rows, sort) {
  return [...rows].sort((a, b) => {
    if (sort === "plant") return a.plant.code.localeCompare(b.plant.code);
    if (sort === "financialYear") return a.financialYear.label.localeCompare(b.financialYear.label);
    if (sort === "variance") return Number(a.variance ?? Number.NEGATIVE_INFINITY) - Number(b.variance ?? Number.NEGATIVE_INFINITY);
    return String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""));
  });
}

function paginate(rows, query) {
  const total = rows.length;
  const start = (query.page - 1) * query.limit;
  return { rows: rows.slice(start, start + query.limit), page: query.page, limit: query.limit, total };
}

function createExportRateLimiter() {
  const attempts = new Map();
  return (req, _res, next) => {
    const key = `${req.user?.id ?? "anonymous"}:${req.ip}`;
    const now = Date.now();
    const current = attempts.get(key) ?? { count: 0, resetAt: now + exportRateWindowMs };
    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + exportRateWindowMs;
    }
    current.count += 1;
    attempts.set(key, current);
    if (current.count > exportRateMax) {
      next(new HttpError(429, "Export request limit exceeded", "EXPORT_RATE_LIMITED"));
      return;
    }
    next();
  };
}

function normalizeExportQuery(body) {
  const query = { ...body };
  if (query.category) {
    query.category = normalizeCategory(query.category);
  }
  return query;
}

function exportRowsForType(reportType, comparisons, query) {
  const rows = reportType === "target-data"
    ? comparisons
    : summarizeBy(comparisons, reportType === "plant-performance" ? ["plant", "metricType", "unit"] : ["metricType", "unit"]);
  return rows
    .filter((row) => !query.unit || row.unit === query.unit)
    .map((row) => reportType === "target-data" ? flattenComparisonRow(row) : flattenSummaryRow(row, reportType));
}

function flattenComparisonRow(row) {
  return {
    plantCode: row.plant.code,
    plantName: row.plant.name,
    financialYear: row.financialYear.label,
    month: row.month,
    metricType: row.metricType,
    category: row.category,
    materialCode: row.material?.code ?? "",
    materialName: row.material?.name ?? "",
    plannedValue: row.plannedValue,
    actualValue: row.actualValue,
    unit: row.dataStatus === "UNIT_MISMATCH" ? `${row.targetUnit ?? ""}/${row.actualUnit ?? ""}` : row.unit,
    variance: row.variance,
    attainmentPct: row.attainmentPct,
    dataStatus: row.dataStatus,
    performanceStatus: row.performanceStatus ?? ""
  };
}

function flattenSummaryRow(row, reportType) {
  return {
    plantCode: reportType === "plant-performance" ? row.plant.code : "ALL",
    plantName: reportType === "plant-performance" ? row.plant.name : "All permitted plants",
    financialYear: "",
    month: "",
    metricType: row.metricType,
    category: "SUMMARY",
    materialCode: "",
    materialName: "",
    plannedValue: round(row.plannedValue),
    actualValue: round(row.actualValue),
    unit: row.unit,
    variance: round(row.variance),
    attainmentPct: row.attainmentPct,
    dataStatus: statusCountText(row.dataStatusCounts),
    performanceStatus: statusCountText(row.performanceStatusCounts)
  };
}

function enforceExportLimits(rows, columnCount) {
  if (rows.length > exportRowLimit || rows.length * columnCount > exportCellLimit) {
    throw new HttpError(400, "Export limit exceeded", "EXPORT_LIMIT_EXCEEDED");
  }
}

function buildExportWorkbook(reportType, rows, query, user) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AOP Command Center";
  const generatedAt = new Date();
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  const worksheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 7 }]
  });
  worksheet.addRow([reportTitle(reportType)]);
  worksheet.addRow(["Generated At", generatedAt.toISOString()]);
  worksheet.addRow(["Scope", permittedPlantScope(user).join(", ")]);
  worksheet.addRow(["Filters", filterSummary(query)]);
  worksheet.addRow(["Rows", rows.length]);
  worksheet.addRow([]);
  worksheet.addRow(exportColumns.map((column) => column.header));
  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.getRow(7).font = { bold: true };
  worksheet.columns = exportColumns.map((column) => ({ key: column.key, width: column.width }));
  for (const row of rows) {
    worksheet.addRow(Object.fromEntries(
      exportColumns.map((column) => [column.key, exportCellValue(row[column.key])])
    ));
  }
  addTotalsRow(worksheet, rows.length);
  for (const column of exportColumns) {
    if (column.numeric) {
      worksheet.getColumn(column.key).numFmt = "#,##0.00";
    }
  }
  return workbook;
}

function addTotalsRow(worksheet, rowCount) {
  const totalRowNumber = rowCount + 8;
  const totalRow = worksheet.getRow(totalRowNumber);
  totalRow.getCell(1).value = "Totals";
  for (const key of ["plannedValue", "actualValue", "variance"]) {
    const columnNumber = exportColumns.findIndex((column) => column.key === key) + 1;
    const values = [];
    for (let rowNumber = 8; rowNumber < totalRowNumber; rowNumber += 1) {
      const value = worksheet.getRow(rowNumber).getCell(columnNumber).value;
      if (typeof value === "number") values.push(value);
    }
    totalRow.getCell(columnNumber).value = round(values.reduce((total, value) => total + value, 0));
    totalRow.getCell(columnNumber).numFmt = "#,##0.00";
  }
  totalRow.font = { bold: true };
}

function exportCellValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  return escapeFormulaValue(String(value));
}

function reportTitle(reportType) {
  return {
    "target-data": "Target Data Export",
    summary: "Summary Export",
    "plant-performance": "Plant Performance Export"
  }[reportType];
}

function filterSummary(query) {
  return Object.entries(sanitizeExportFilters(query))
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function sanitizeExportFilters(query) {
  const allowed = ["financialYear", "plant", "monthFrom", "monthTo", "metricType", "category", "material", "unit", "includeHistorical"];
  return Object.fromEntries(allowed.filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
}

function permittedPlantScope(user) {
  return serverPlantFilter(user) ? [...serverPlantFilter(user)] : ["ALL"];
}

function safeExportFilename(reportType) {
  return `aop-${reportType}-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function statusCountText(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}:${count}`)
    .join("; ");
}

function comparisonKey(row) {
  return [
    row.plant.id,
    row.financialYear.id,
    row.month,
    row.metricType,
    row.category,
    row.material?.id ?? "none"
  ].join("|");
}

function serializeRow(row, kind) {
  const apiRow = toApiRecord(row);
  return {
    ...apiRow,
    plant: toApiRecord(apiRow.plant),
    financialYear: toApiRecord(apiRow.financialYear),
    material: toApiRecord(apiRow.material) ?? null,
    category: normalizeCategory(apiRow.category),
    plannedValue: kind === "target" ? Number(apiRow.plannedValue) : undefined,
    actualValue: kind === "actual" ? Number(apiRow.actualValue) : undefined
  };
}

function normalizeCategory(value) {
  return String(value || "TOTAL").trim().toUpperCase();
}

function round(value) {
  if (!Number.isFinite(value)) {
    throw new HttpError(500, "Invalid report calculation", "INVALID_REPORT_CALCULATION");
  }
  return Math.round(value * 100) / 100;
}
