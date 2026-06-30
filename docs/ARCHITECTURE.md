# Architecture

## Final Secure Architecture

```text
Browser
  |
  | HTTPS only
  v
React + Vite + Tailwind
  |
  | HTTPS requests with credentials
  | Axios sends CSRF header for write requests
  v
Express API
  |
  | Helmet + CSP + CORS allowlist + rate limiting
  | Authentication + authorization + plant-scope checks
  | Request validation + business-rule validation
  v
Service layer + Mongoose
  |
  v
MongoDB Atlas
  |
  +-- application data
  +-- sessions / refresh-token records
  +-- immutable-style audit logs
  +-- backups
```

## Stack

- Modular MERN monolith.
- React, Vite, and Tailwind frontend.
- Node.js and Express backend.
- MongoDB Atlas and Mongoose database.
- HTTPS in production for frontend, backend, and database communication.

React never connects directly to MongoDB. The database URI exists only in backend deployment secrets.

## Project Structure

The repository is organized as:

- `client/` for React, routes, guards, API clients, pages, components, hooks, utils, and styles.
- `server/` for Express app setup, config, middleware, modules, models, services, policies, scripts, and tests.
- `docs/` for architecture, security, permissions, API, imports, testing, and progress tracking.
- `.github/workflows/` for CI.

## Request Pipeline

```text
Request arrives
   |
   v
HTTPS / reverse-proxy validation
   |
   v
Helmet + CSP + security headers
   |
   v
CORS allowlist check
   |
   v
Body-size limit / upload-size limit
   |
   v
Request ID + safe request logging
   |
   v
Rate limiter
   |
   v
Cookie parsing
   |
   v
CSRF + Origin verification for POST/PATCH/DELETE
   |
   v
JWT authentication
   |
   v
Permission authorization
   |
   v
Plant-scope authorization
   |
   v
Request/schema validation
   |
   v
Business-state validation
   |
   v
Controller -> service -> MongoDB
   |
   v
Audit event written
   |
   v
Sanitized success/error response
```

## Database And Cloud Structure

```text
MongoDB Atlas
  |
  +-- aop_app_user
  |   +-- least privilege: read/write only required application database
  |
  +-- aop_backup_user
  |   +-- backup-only permission
  |
  +-- admin user
      +-- used only for administration, never from the application
```

Rules:

- Restrict Atlas network access.
- Use separate development and production databases.
- Enable backups and test restoration.
- Use TLS between backend and MongoDB.
- Never include real company data in seed files.

