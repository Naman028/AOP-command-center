# AOP Command Center

Secure MERN command center for planning, actuals, imports, reports, and plant-scoped operations.

## Phase Status

**Current step: Phase 10 - Release hardening and production-readiness review.**

Completed:

- Security foundation and authorization controls
- Master Data
- Target Planning
- Persistent MongoDB audit logs
- Manual Actual Data Entry
- Secure File Drop preview/import workflow
- Dashboard and reporting calculations
- Secure Excel report export
- Production deployment readiness configuration
- MongoDB Atlas transaction/import confirmation
- Admin user management, plant assignment, forced password change, session revocation, and final-admin protection
- Chromium browser E2E release-hardening coverage

Deferred:

- Render backend deployment
- Vercel frontend deployment
- Production end-to-end verification

Next:

- Release checklist review
- Accessibility and responsive UI pass
- Production deployment when ready

## Architecture

- Frontend: React, Vite, Tailwind
- Backend: Node.js, Express
- Database: MongoDB Atlas with Mongoose
- Sessions: HttpOnly cookie access token plus rotated hashed refresh-token records
- Authorization: permission constants mapped from roles, plus backend plant-scope checks

React must never connect directly to MongoDB. Database credentials and private secrets belong only in local `.env` files or deployment secret stores.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Permission Matrix](docs/PERMISSION_MATRIX.md)
- [API Spec](docs/API_SPEC.md)
- [Import Template](docs/IMPORT_TEMPLATE.md)
- [Test Plan](docs/TEST_PLAN.md)
- [Known Limitations](docs/KNOWN_LIMITATIONS.md)
- [Project Progress](docs/PROJECT_PROGRESS.md)

## Development

Install workspace dependencies:

```sh
npm install
```

Start frontend and backend together:

```sh
npm run dev
```

If ports are stuck from an old run:

```sh
npm run dev:stop
```

Run all checks:

```sh
npm run lint
npm test
npm run build --workspace client
npm run test:e2e
npm run security:check
npm audit --workspaces
```

Run the Atlas transaction gate only when `server/.env` contains a safe Atlas `MONGODB_URI` for verification:

```sh
npm run mongo:gate
```
