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

Error handling and logging:

- Production errors omit stack traces and database details.
- Audit logs exclude passwords, cookies, JWTs, database URIs, and raw uploaded file contents.
- Authorization failures emit safe `ACCESS_DENIED` audit events.

