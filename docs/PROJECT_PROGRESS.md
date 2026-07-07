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

## Phase 8 - Production Deployment And Replica-Set Import Confirmation

Status: Phase 8.1 Atlas transaction/import gate complete. Phase 8.2 through Phase 8.4 deployment work is deferred.

Completed:

- Phase 8.0 production deployment readiness configuration.
- Phase 8.1 Atlas transaction/import confirmation.
- Atlas gate proves transaction capability is available.
- Valid two-row import confirms successfully and inserts both `EXCEL_IMPORT` Actual records.
- `ImportBatch` is marked `IMPORTED` after successful confirmation.
- `IMPORT_CONFIRMED` audit records persist.
- A conflicting import confirms zero imported Actual records.
- Failed import batches are marked `FAILED` and write `IMPORT_FAILED`.
- Default demo credentials cannot authenticate.

Deferred:

- Phase 8.2 Render backend deployment.
- Phase 8.3 Vercel frontend deployment and exact CORS/cookie verification.
- Phase 8.4 production end-to-end verification.

Deployment choice:

- Frontend: Vercel.
- Backend: Render.
- Database: MongoDB Atlas.

Corrected cookie plan:

- Temporary Vercel + Render default-domain staging is cross-site:
  - `COOKIE_SECURE=true`
  - `COOKIE_SAMESITE=none`
  - `CLIENT_ORIGINS=https://your-vercel-app.vercel.app`
- Final portfolio deployment should use custom same-site subdomains:
  - `https://app.yourdomain.com` for Vercel
  - `https://api.yourdomain.com` for Render
  - `COOKIE_SECURE=true`
  - `COOKIE_SAMESITE=lax`
  - `CLIENT_ORIGINS=https://app.yourdomain.com`
- Do not set broad `COOKIE_DOMAIN`; keep host-only secure cookies.

Render backend settings:

- Service type: Web Service.
- Root directory: repository root.
- Build command: `npm ci`.
- Start command: `npm run start --workspace server`.
- Health check path: `/health`.
- Node version: pinned to Node 22.
- Backend binds to `0.0.0.0` and uses `process.env.PORT`.
- `TRUST_PROXY=1` is required behind Render HTTPS proxy.

Production variables supported by `env.js`:

```env
NODE_ENV=production
MONGODB_URI=...
CLIENT_ORIGINS=https://app.yourdomain.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
ACCESS_TOKEN_SECRET=long-random-secret
REFRESH_TOKEN_SECRET=long-random-secret
BCRYPT_WORK_FACTOR=12
TRUST_PROXY=1
```

Temporary staging with default Vercel/Render domains changes only:

```env
CLIENT_ORIGINS=https://your-vercel-app.vercel.app
COOKIE_SAMESITE=none
```

Mandatory Phase 8 production checks:

- No default production users: `admin@aop.local` / `Password123!` must not work in production.
- Production Admin must be created through a protected one-time bootstrap process, and bootstrap credentials must be removed immediately afterward.
- Deployed app must report transaction support on Atlas.
- Successful import confirmation must insert all rows.
- One invalid or conflicting row must insert zero rows.
- Atlas network access must be narrowed to Render outbound CIDR ranges or dedicated outbound IPs after initial testing.

## Phase 9 - User Management And Plant Scope Administration

Status: Next local-development phase.

Objective:

- Replace seeded-test-user dependence with a usable Admin user-management area.
- Keep deployment deferred while continuing local development.
- Use Atlas only when transactional import behavior needs verification.

Planned backend scope:

- Admin-only user CRUD APIs.
- Create users with role `ADMIN`, `MANAGER`, `TEAM_LEAD`, or `STAFF`.
- Assign permitted plants to Team Leads and Staff.
- Activate and deactivate users.
- Revoke sessions when role, plant scope, or active status changes.
- Prevent Admins from removing their own final admin access.
- Protect `/admin/users` with backend `USERS_MANAGE` permission checks.

Planned frontend scope:

- Admin-only `/admin/users` page.
- Page guards deny non-admin direct URL access.
- User list with role, active status, and plant scope.
- Create/edit user form.
- Plant assignment controls for scoped roles.
- Clear deactivate/reactivate and session-revocation behavior.

Acceptance checks:

- Admin can create, update, activate, and deactivate users.
- Manager, Team Lead, and Staff cannot access `/admin/users` or user-management APIs.
- Team Lead and Staff assignments are limited to selected plants.
- Changing role, plant scope, or active status revokes existing sessions.
- The last active Admin cannot be deactivated, demoted, or stripped of final admin access.
- Inactive users cannot authenticate or continue existing sessions.
- User-management audit records contain no passwords or secrets.
