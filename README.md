# AOP Command Center

Secure MERN command center for planning, actuals, imports, reports, and plant-scoped operations.

## Phase Status

Current step: Phase 2 - master data management implemented.

The security foundation, role permissions, plant-scope checks, audit logging, and acceptance tests are in place. Phase 2 adds Plants, Materials, and Financial Years master data.

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
npm run security:check
```
