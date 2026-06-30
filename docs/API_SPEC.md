# API Spec

All API routes are prefixed with `/api`.

## Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Authenticate and set cookies. |
| `POST` | `/auth/refresh` | Rotate refresh token and set new access cookie. |
| `POST` | `/auth/logout` | Revoke current session and clear cookies. |
| `GET` | `/auth/me` | Return verified session user and permissions. |
| `POST` | `/auth/change-password` | Change password and revoke active sessions. |

Rules:

- Generic login errors only.
- Login attempts rate-limited by account and IP.
- Inactive users blocked.
- Successful and failed login events audited safely.

## Authorization Examples

| Endpoint | Required Authorization |
| --- | --- |
| `GET /users` | `USERS_MANAGE` |
| `POST /users` | `USERS_MANAGE` |
| `GET /audit-logs` | `AUDIT_LOGS_VIEW` |
| `POST /targets` | `TARGETS_MANAGE`; Team Lead plant must be in assignedPlants |
| `PATCH /targets/:id` | Find target only within allowed plant scope |
| `POST /imports/confirm` | `IMPORTS_MANAGE`; every row checked against allowed plants |
| `GET /reports/summary` | `REPORTS_VIEW`; server-derived plant filter |
| `GET /reports/export` | `REPORTS_EXPORT`; same report scope rules before workbook generation |

## Status Codes

- 200 or 201 for successful reads and writes.
- 400 for validation failures.
- 401 for missing or invalid authentication.
- 403 for authenticated-but-forbidden access.
- 404 for missing resources that are safe to reveal.
- 409 for duplicate or business-state conflicts.
- 429 for rate-limit failures.

Do not reveal stack traces, database errors, or internal route information to the browser.

## Sensitive Response Headers

Dashboard, reports, exports, user data, and audit responses must include:

```http
Cache-Control: no-store
```

