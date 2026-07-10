# Final Release Review

## Status

The project is a local/demo release candidate. Production deployment remains deferred.

## Functionality Checklist

- Authentication, logout, refresh, and forced password change are covered by automated tests.
- Admin user management, role changes, plant assignment, session revocation, and final-admin protection are covered by automated tests.
- Master data, target planning, manual actuals, import preview, reports, audit logs, and Excel exports are covered by unit/integration and Chromium E2E tests.
- Browser E2E creates master data, target data, and actual data from the UI.
- Atlas transaction success and rollback proof remains covered by `npm run mongo:gate`.

## Security Checklist

- HttpOnly cookies, production secure-cookie configuration, SameSite settings, CSRF/origin checks, and CORS allowlist are documented and tested.
- Backend authorization remains mandatory for permissions and plant scope.
- Forced password change blocks normal protected APIs until completion.
- Import confirmation fails closed without transaction support.
- Excel export uses POST, CSRF/origin checks, rate limits, row/cell limits, formula-injection protection, and durable audit policy.
- Secret scanning checks tracked files and reports only file path plus reason.

## License Summary

Run:

```sh
npm run qa:licenses
```

Generated files:

- `reports/licenses-full.json`
- `reports/licenses-summary.md`

AGPL, GPL, LGPL, UNKNOWN, UNLICENSED, and custom/non-standard license strings are marked for review.

## Unused-Code Cleanup Candidates

Run:

```sh
npm run qa:unused
```

Generated file:

- `reports/unused-code-report.md`

Findings are review-only. Do not delete files or dependencies until the report is reviewed and approved.

## Unresolved Risks

- Render and Vercel deployment are deferred.
- Production HTTPS, deployed CORS, cross-site cookie behavior, and custom-domain behavior are not verified.
- MFA for Admin accounts is future work.
- Accessibility has not received a full manual assistive-technology audit.

## Release Tag Readiness

- Ready for local demo after `npm run qa:release`, `npm run mongo:gate`, and `git diff --check` pass.
- Not ready for a GitHub release tag that claims production readiness until deployed end-to-end verification is complete.
