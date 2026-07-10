# Security

## Phase Gate

Before writing each project phase, state:

- Security controls affected.
- Files to be created or changed.
- Exact tests required.
- Security acceptance criteria.

Do not claim a security feature is complete until it has been tested with allowed and denied scenarios.

## Production Baseline

Use TLS/HTTPS, secure cookies, Helmet, brute-force protection, input sanitization, dependency checks, and safe centralized error handling in production.

## Authentication And Sessions

- Use HttpOnly cookie sessions, not JWTs in localStorage or sessionStorage.
- Passwords are never stored in plain text.
- Use bcrypt with a work factor of at least 12.
- Return generic login errors only.
- Rate-limit login attempts by account and IP.
- Block inactive users.
- Log successful and failed login events safely.
- Revoke active sessions after password changes, role changes, or account deactivation.
- Add MFA later for Admin accounts.

Access token:

- Short lifetime: 15 minutes.
- HttpOnly.
- Secure in production.
- SameSite=Lax when frontend and backend are same-site subdomains.
- SameSite=None only when truly cross-site, with HTTPS and CSRF protection.

Refresh token:

- Longer lifetime: 7 days.
- HttpOnly.
- Secure.
- Rotated whenever refreshed.
- Hash stored in `Session` collection.
- Revoked on logout, password change, role change, or account deactivation.

Session model:

```text
userId
refreshTokenHash
jti
expiresAt
revokedAt
createdAt
lastUsedAt
ipHash
userAgentHash
```

Because cookies are automatically sent by browsers, write requests must use CSRF protection plus strict Origin checking.

## Frontend Security

Build:

- `AuthProvider`
- `SessionBootstrap`
- `RequireAuth`
- `RequirePermission`
- `RequirePlantAccess`
- `UnauthorizedPage`
- `NotFoundPage`
- Loading screen

On app load, call `GET /api/auth/me` before rendering protected layout or page content. Protected content must not appear while session validation is pending.

Direct URL behavior:

- No session: redirect to `/login?returnTo=<requested-path>`.
- Valid session but insufficient permission: redirect to `/unauthorized`.
- Valid session and required permission: render page.

Hiding a sidebar option is not security. Backend authorization remains mandatory.

## Backend Authorization

- Validate authentication, permission, and plant-level scope on every protected API request.
- Never trust a role, plantId, userId, or permission sent by the frontend.
- Derive identity, role, and assignedPlants from the verified session/JWT.
- For Team Lead queries, add a server-side plant filter using assignedPlants.
- Return 401 for missing or invalid authentication.
- Return 403 for authenticated-but-forbidden access.

For a Team Lead, never fetch an unrestricted record first. For example, update queries must search within allowed plant scope.

## API Security

- Use central error handling with no stack traces or database details in production.
- Validate body, params, query fields, ObjectIds, allowed sort fields, pagination limits, dates, metric types, and values.
- Reject unexpected fields and unsafe MongoDB query operators.
- Use database-level unique compound indexes for duplicate prevention.
- Apply `Cache-Control: no-store` to sensitive dashboard and report responses.

## File Upload And Export Security

Uploads:

1. Authenticate user.
2. Check permission and plant scope.
3. Check file extension: `.xlsx` or `.csv` only.
4. Check MIME type and file signature.
5. Reject `.xlsm` and macro-enabled files.
6. Enforce 5 MB maximum file size.
7. Enforce maximum rows and cells.
8. Store temporary file outside public folder.
9. Generate server-side filename.
10. Parse and validate every row.
11. Show preview and row-level errors.
12. Confirm import separately.
13. Re-check permission and plant scope during confirmation.
14. Import inside controlled transaction-like workflow.
15. Delete temporary file.
16. Save ImportBatch and audit event.

Exports use authenticated POST requests so Origin and CSRF validation apply before workbook generation. Export filters are accepted only from a strict request body, and unknown fields, unsafe query operators, invalid ObjectIds, invalid month ranges, invalid metric types, unsupported units, oversized exports, and rate-limit violations fail safely.

Exports must escape every string value beginning with `=`, `+`, `-`, `@`, tab, carriage return, line feed, `＝`, `＋`, `－`, or `＠` to reduce spreadsheet-formula injection. Genuine numbers remain numeric, and database values must never be assigned as workbook formulas. Only export records the authenticated user is authorized to view.

Exports are generated in memory only, never persisted to local disk, database, or public folders, and are capped at 10,000 rows, 200,000 worksheet cells, and 10 export requests per user/IP per 10 minutes. `EXPORT_REPORT` is written only after report data and workbook generation succeed; if durable audit logging fails, the export is not delivered.

## Audit Logging

Audit:

- `LOGIN_SUCCESS`
- `LOGIN_FAILED`
- `LOGOUT`
- `REFRESH_TOKEN_USED`
- `CREATE_USER`
- `CHANGE_ROLE`
- `DEACTIVATE_USER`
- `CREATE_TARGET`
- `UPDATE_TARGET`
- `DELETE_TARGET`
- `CREATE_ACTUAL`
- `UPDATE_ACTUAL`
- `DELETE_ACTUAL`
- `IMPORT_PREVIEW`
- `IMPORT_CONFIRMED`
- `IMPORT_REJECTED`
- `EXPORT_REPORT`
- `ACCESS_DENIED`

Do not log passwords, cookies, JWTs, database URLs, or raw uploaded file contents.

AuditLog:

```text
actorUserId
action
entityType
entityId
plantId
before
after
requestId
ipHash
userAgentHash
timestamp
```

## Deployment Security

Frontend:

- Vercel or equivalent.
- HTTPS only.
- No private secrets in `VITE_` variables.

Backend:

- Render, Railway, or equivalent.
- HTTPS only.
- Environment variables configured in deployment dashboard.
- Health endpoint.
- CORS allowlist only for permitted frontend origins.
- Cookie settings set for production proxy.
- Pin Node 22 for deployment.
- Bind to Render's `PORT` on `0.0.0.0`.
- Set `TRUST_PROXY=1` behind the Render HTTPS proxy.
- Use `npm ci` as the deployment build command.
- Do not set broad `COOKIE_DOMAIN`; use host-only secure cookies.
- Same-site custom-domain deployment uses `COOKIE_SAMESITE=lax`.
- Temporary cross-site Vercel/Render default-domain staging uses `COOKIE_SAMESITE=none` and HTTPS.
- Production must not include default demo users such as `admin@aop.local` / `Password123!`.
- Production startup must fail without `MONGODB_URI` and strong token secrets.

GitHub:

- `.env` ignored.
- `.env.example` included.
- Secret scanning enabled.
- Dependency updates enabled.
- CI runs lint, tests, client build, Chromium E2E, security checks, and workspace audit.
- CI does not run `mongo:gate`; the Atlas transaction gate is opt-in because it requires an external database URI.

Release QA:

- `npm run qa:release` verifies local release readiness and writes reports under `reports/`.
- `npm run qa:secrets` scans tracked files only and reports file path plus reason, never the secret value.
- `npm run qa:licenses` records installed package licenses and flags AGPL, GPL, LGPL, UNKNOWN, UNLICENSED, and custom/non-standard license strings for review.
- `npm run qa:unused` runs Knip in report-only mode. Unused-code findings must be reviewed before deletion.
- `npm run qa:security-checklist` checks static evidence for authentication, authorization, CSRF/origin, plant scope, audit, import, export, CORS, rate-limit, and error-handling controls.

E2E security:

- Browser E2E runs only with `NODE_ENV=test`.
- The E2E server rejects `MONGODB_URI` and uses the in-memory test store only.
- Playwright uses Chromium only and one worker.
- E2E test credentials, cookies, and secrets are test-local and must not come from `server/.env` or production deployments.

MongoDB Atlas:

- IP/network restrictions.
- Least-privilege app database user.
- Backups enabled.
- Replace temporary broad network access with Render outbound CIDR ranges or dedicated outbound IPs after initial testing.
- Use a replica-set-capable Atlas database for all-or-nothing import confirmation tests.
