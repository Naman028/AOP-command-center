# AOP Command Center

Secure MERN command center for planning, actuals, imports, reports, and plant-scoped operations.

## Phase Status

Current step: Phase 0 - final architecture and security structure complete.

Phase 0 defines the target architecture, project structure, roles, permissions, security controls, API boundaries, upload rules, audit model, deployment requirements, and acceptance criteria. Implementation phases must not claim a security feature is complete until allowed and denied scenarios are tested.

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

Install workspace dependencies after implementation packages are added:

```sh
npm install
```

Run all checks:

```sh
npm run lint
npm test
npm run security:check
```

