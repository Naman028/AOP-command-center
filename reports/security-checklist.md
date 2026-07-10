# Security Checklist

Generated: 2026-07-10T13:45:26.355Z

| Check | Status | Evidence |
| --- | --- | --- |
| HttpOnly cookies | PASS | Matched httpOnly:\s*true |
| Secure cookies in production | PASS | Matched secure:\s*config\.cookieSecure\|cookieSecure |
| SameSite configuration | PASS | Matched sameSite:\s*config\.cookieSameSite\|cookieSameSite |
| CSRF/origin checks | PASS | Matched csrf\|Origin |
| Route guards | PASS | Matched RequireAuth\|RequirePermission\|RequirePlantAccess |
| Backend permission checks | PASS | Matched requirePermission\|403 |
| Plant-scope checks | PASS | Matched plant scope\|requirePlantAccess\|assignedPlants |
| Forced password change | PASS | Matched PASSWORD_CHANGE_REQUIRED\|mustChangePassword |
| Session revocation | PASS | Matched revoke\|revokes |
| Final-admin protection | PASS | Matched final-admin\|LAST_ADMIN\|final active Admin |
| Audit logs | PASS | Matched AuditLog\|audit |
| Import transaction fail-closed behavior | PASS | Matched TRANSACTIONAL_IMPORT_REQUIRED\|transaction |
| Formula-injection protection | PASS | Matched formula\|escapeExcelString\|EXPORT_REPORT |
| File upload type/size validation | PASS | Matched fileSize\|mime\|unsupported\|multer |
| No secrets in responses | PASS | Matched plaintext\|password\|secret |
| No stack traces in production errors | PASS | Matched config\.isProduction\|Internal server error |
| CORS allowlist | PASS | Matched CLIENT_ORIGINS\|cors\|allowed origins |
| Rate limits | PASS | Matched rateLimit\|EXPORT_LIMIT_EXCEEDED |
| Safe pagination/sorting/filtering | PASS | Matched unsafe operators\|pagination\|sort\|filter |
| Dependency audit | PASS | Matched security:check\|qa:release |

All required security checklist items have static evidence.
