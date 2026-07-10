# Test Plan

## Phase Checklist Template

Each implementation phase must include:

- Security controls affected.
- Files created or changed.
- Exact automated tests required.
- Manual verification steps when automation is not enough.
- Security acceptance criteria.

## Required Security Tests

Authentication:

- Login succeeds with valid active user.
- Login fails with generic error for invalid password.
- Login fails for inactive user.
- Login rate limit applies by account and IP.
- Refresh rotates refresh token.
- Logout revokes current session.
- Password change revokes active sessions.

Frontend route protection:

- Protected page does not render while `GET /api/auth/me` is pending.
- Direct protected URL without session redirects to `/login?returnTo=<path>`.
- Authenticated user without permission redirects to `/unauthorized`.
- Authenticated user with permission renders the page.

Authorization:

- Admin can access users and audit logs.
- Manager cannot access users or audit logs.
- Team Lead cannot access another plant by editing URL, request body, query string, or API call.
- Staff cannot perform writes, imports, deletes, user administration, or exports unless explicitly permitted.

API validation:

- Invalid ObjectIds are rejected.
- Unexpected fields are rejected.
- Unsafe MongoDB query operators are rejected.
- Invalid sort, pagination, dates, metric types, and values are rejected.

Imports and exports:

- `.xlsx` and `.csv` accepted when valid.
- `.xlsm` rejected.
- Oversized files rejected.
- Invalid MIME or signature rejected.
- Unauthorized plant rows rejected in preview and confirmation.
- Temporary files are deleted after processing.
- Formula-like export values are escaped.
- POST report exports require authentication, permission, CSRF/origin validation, and `financialYear`.
- Staff cannot export, and Team Leads cannot export rows outside assigned plant scope through manipulated filters.
- Export workbooks keep dangerous strings as text, contain no formula cells from database values, leave no generated files on disk, and include title, scope, filters, headers, status columns, numeric formats, freeze panes, and compatible totals.
- Export audit records persist without secrets, workbook data, rows, or raw notes.
- Export row/cell limits and the 10-per-user/IP-per-10-minute export rate limit reject safely.

Error handling and logging:

- Production errors omit stack traces and database details.
- Audit logs exclude passwords, cookies, JWTs, database URIs, and raw uploaded file contents.
- Authorization failures emit safe `ACCESS_DENIED` audit events.

## Phase 10 Browser E2E

Playwright is configured for Chromium only.

Safeguards:

- E2E must run with `NODE_ENV=test`.
- The E2E server refuses any `MONGODB_URI`; Atlas and production databases are never used by browser tests.
- The in-memory test store is used only.
- Workers are pinned to 1 because state is shared.
- Test data uses unique `E2E-*` prefixes.
- Temporary import fixture files are removed after each test.
- `mongo:gate` remains separate and opt-in for Atlas transaction proof.

Release-hardening flows:

- Admin creates master data from the UI: plant, material, and financial year.
- Admin user creation, forced password change, direct URL redirect, and Team Lead Plant A scope.
- Planning and manual actual entry create Turnover, Expense, Consumption, and Earnings records from the UI.
- Dashboard, target-data report, summary report, plant-performance report, and secure report export.
- Role authorization regression for Admin, Manager, Team Lead, and Staff.
- Team Lead Plant B manipulation returns no Plant B data.
- Session revocation after plant-scope change.
- In-memory import confirmation fails closed when transaction support is unavailable.

Commands:

```sh
npm run test:e2e
npm run test:e2e:ui
```

## Phase 10.2 Release QA Gate

`npm run qa:release` runs the local release-candidate gate and writes reports under `reports/`.

Required-failure conditions:

- committed secrets or tracked `.env` files
- whitespace errors
- lint, unit/integration, client build, or Playwright E2E failure
- dependency audit vulnerabilities from `npm audit --workspaces`
- unsafe security-checklist failure

Review-only conditions:

- Knip unused files, dependencies, devDependencies, exports, or missing dependencies
- LGPL/GPL/custom/unknown license findings, unless later policy decides to block them

Atlas transaction testing remains outside normal QA:

```sh
npm run mongo:gate
```
