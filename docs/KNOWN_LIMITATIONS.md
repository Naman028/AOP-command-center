# Known Limitations

Deployment is deferred.

- Render backend deployment is not live yet.
- Vercel frontend deployment is not live yet.
- Production CORS, CSRF, cookie, HTTPS, and custom-domain behavior still need deployed-URL verification.
- Production end-to-end testing remains pending.

Atlas transaction proof is separate.

- `npm run mongo:gate` is the opt-in Atlas verification path.
- The normal local and CI test suites do not use Atlas credentials.
- Browser E2E intentionally rejects `MONGODB_URI` and uses the in-memory test store only.

Browser coverage is intentionally narrow.

- Playwright currently runs Chromium only.
- Firefox, WebKit, mobile-device emulation, and visual regression testing are not included yet.
- Accessibility has not been certified by a full manual audit or assistive-technology pass.

Cleanup remains review-first.

- `npm run qa:unused` generates cleanup candidates but does not remove files, folders, exports, or dependencies.
- License findings are marked for review; they are not legal advice.
- Generated reports under `reports/` are local QA artifacts and may need regeneration after dependency or code changes.

Operational hardening still required before public production use.

- MFA for Admin accounts is documented as future work.
- Production secrets must be configured only in deployment settings.
- A production bootstrap process must create the first real Admin without default demo credentials.
- Atlas Network Access must be restricted to deployment outbound ranges after hosting is created.
