# Project Progress

## Phase 0 - Final Architecture And Security Structure

Status: Complete.

Security controls affected:

- Secure architecture definition.
- Project structure.
- Role and permission model.
- Page and direct-URL protection model.
- Secure backend request pipeline.
- Cookie session model.
- Authentication requirements.
- API and record-level authorization.
- Excel upload and export security.
- MongoDB Atlas least-privilege structure.
- Audit logging.
- Deployment security requirements.
- Phase acceptance rules.

Files created or changed:

- `README.md`
- `package.json`
- `.gitignore`
- `client/package.json`
- `client/.env.example`
- `client/public/favicon.svg`
- `client/src/**/.gitkeep`
- `server/package.json`
- `server/.env.example`
- `server/src/**/.gitkeep`
- `server/storage/temporary-uploads/.gitkeep`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/API_SPEC.md`
- `docs/IMPORT_TEMPLATE.md`
- `docs/TEST_PLAN.md`
- `docs/PROJECT_PROGRESS.md`
- `.github/workflows/ci.yml`

Exact tests required:

- Documentation consistency review against the Phase 0 prompt.
- Workspace structure check.

Security acceptance criteria:

- Architecture states that React never connects directly to MongoDB.
- Session design requires HttpOnly cookies and hashed rotated refresh tokens.
- Authorization design uses permissions and server-side plant scope.
- Direct URL protection prevents protected-content flash while session validation is pending.
- API requirements distinguish 401 from 403.
- Upload and export security requirements are documented.
- Deployment requirements exclude committed secrets and require HTTPS.

## Phase 7 - Secure Report Exports

Status: Plan updated before implementation; implementation complete.

Revised Phase 7 file list:

- `server/src/modules/reports/routes.js` - POST export endpoints, strict request validation, report-service reuse, workbook generation, resource limits, export rate limit, and audit handoff.
- `server/src/utils/sanitize.js` - formula-injection escape rules for ASCII and fullwidth spreadsheet formula prefixes.
- `server/src/app.js` - remove legacy GET CSV export and pass `auditService` into the reporting router.
- `server/src/tests/security.test.js` - export authorization, CSRF/origin, workbook, formula, audit, disk, limit, and rate-limit coverage.
- `docs/API_SPEC.md` - replace the legacy GET export API map with the three POST workbook endpoints.
- `docs/SECURITY.md` - document export CSRF/origin, resource-limit, formula-defense, no-disk, and audit requirements.
- `docs/TEST_PLAN.md` - add the Phase 7 export test matrix.

Revised API map:

- `POST /api/reports/target-data/export`
- `POST /api/reports/summary/export`
- `POST /api/reports/plant-performance/export`

Request body is strict JSON. `financialYear` is required. Optional filters are `plant`, `monthFrom`, `monthTo`, `metricType`, `category`, `material`, `unit`, and `includeHistorical`. Unknown fields, unsafe query operators, invalid ObjectIds, invalid month ranges, invalid metric types, unsupported units, and oversized export requests must fail safely.

Permission map:

- `ADMIN` - may export all permitted report data.
- `MANAGER` - may export permitted report data.
- `TEAM_LEAD` - may export assigned-plant report data only.
- `STAFF` - denied by default because the role does not have `REPORTS_EXPORT`.
- Exported rows must be produced by the same reporting service and server-side plant-scope rules used by report pages.

Workbook layout:

- One in-memory `.xlsx` workbook with a `Report` worksheet.
- Title, generated timestamp, permitted scope, sanitized filter summary, and row count appear before the table.
- Table headers include plant, financial year, month, metric, category, material, planned value, actual value, unit, variance, attainment, data status, and performance status columns.
- Header rows are frozen. Numeric columns use numeric cell values and numeric formats. Totals are compatible with the exported numeric columns.

Formula-defense approach:

- Every exported string field is passed through formula escaping before being written.
- Strings beginning with `=`, `+`, `-`, `@`, tab, carriage return, line feed, `＝`, `＋`, `－`, or `＠` are prefixed with a single quote and written as text.
- Genuine numeric values remain numeric.
- Workbook generation never assigns formula objects or formula strings from database values.

Audit policy:

- Write `EXPORT_REPORT` only after report data retrieval and workbook generation succeed.
- Store actor, report type, sanitized filters, permitted plant scope, requestId, and timestamp.
- Do not store workbook bytes, exported rows, secrets, or raw notes.
- Keep the durable audit-write failure policy: if persistent audit logging fails, return a sanitized error and do not deliver the workbook.

Resource limits:

- Maximum 10,000 exported rows.
- Maximum 200,000 worksheet cells.
- Maximum 10 export requests per user/IP per 10 minutes.
- Workbooks are generated in memory only and are never saved to local disk, database, or public folders.
- Limit failures return sanitized `EXPORT_LIMIT_EXCEEDED` or export rate-limit errors.

Test matrix:

- POST export requires authentication, `REPORTS_EXPORT`, CSRF/origin validation, and `financialYear`.
- STAFF cannot export.
- Team Lead A cannot export Plant B rows even with manipulated filters.
- Dangerous formula-like strings are exported as text, not formulas.
- No generated export files remain on disk.
- Workbook title, scope, filters, headers, status columns, numeric formats, freeze panes, and compatible totals are present.
- Export audit records persist and contain no secrets, workbook data, rows, or raw notes.
- Export row/cell limits and export rate limits reject safely.
