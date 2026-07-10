import fs from "node:fs";
import path from "node:path";
import { rootDir, writeReport } from "./qa-shared.js";

const files = {
  app: read("server/src/app.js"),
  auth: read("server/src/middleware/auth.js"),
  security: read("server/src/middleware/security.js"),
  errors: read("server/src/middleware/errorHandler.js"),
  imports: read("server/src/modules/imports/routes.js"),
  reports: read("server/src/modules/reports/routes.js"),
  users: read("server/src/modules/users/routes.js"),
  sessions: read("server/src/services/sessionService.js"),
  env: read("server/src/config/env.js"),
  tests: read("server/src/tests/security.test.js"),
  guards: read("client/src/guards/RequireAuth.jsx"),
  routes: read("client/src/app/App.jsx"),
  packageJson: read("package.json")
};

const checks = [
  check("HttpOnly cookies", files.sessions, /httpOnly:\s*true/),
  check("Secure cookies in production", files.sessions + files.env, /secure:\s*config\.cookieSecure|cookieSecure/),
  check("SameSite configuration", files.sessions + files.env, /sameSite:\s*config\.cookieSameSite|cookieSameSite/),
  check("CSRF/origin checks", files.security + files.tests, /csrf|Origin/i),
  check("Route guards", files.guards + files.routes, /RequireAuth|RequirePermission|RequirePlantAccess/),
  check("Backend permission checks", files.auth + files.tests, /requirePermission|403/),
  check("Plant-scope checks", files.auth + files.tests, /plant scope|requirePlantAccess|assignedPlants/i),
  check("Forced password change", files.auth + files.tests, /PASSWORD_CHANGE_REQUIRED|mustChangePassword/),
  check("Session revocation", files.users + files.tests, /revoke|revokes/i),
  check("Final-admin protection", files.users + files.tests, /final-admin|LAST_ADMIN|final active Admin/i),
  check("Audit logs", files.tests, /AuditLog|audit/i),
  check("Import transaction fail-closed behavior", files.imports + files.tests, /TRANSACTIONAL_IMPORT_REQUIRED|transaction/i),
  check("Formula-injection protection", files.reports + files.tests, /formula|escapeExcelString|EXPORT_REPORT/i),
  check("File upload type/size validation", files.imports + files.tests, /fileSize|mime|unsupported|multer/i),
  check("No secrets in responses", files.tests, /plaintext|password|secret/i),
  check("No stack traces in production errors", files.errors, /config\.isProduction|Internal server error/),
  check("CORS allowlist", files.app + files.tests, /CLIENT_ORIGINS|cors|allowed origins/i),
  check("Rate limits", files.security + files.reports + files.tests, /rateLimit|EXPORT_LIMIT_EXCEEDED/i),
  check("Safe pagination/sorting/filtering", files.tests, /unsafe operators|pagination|sort|filter/i),
  check("Dependency audit", files.packageJson, /security:check|qa:release/)
];

const failed = checks.filter((item) => !item.pass);
const report = [
  "# Security Checklist",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "| Check | Status | Evidence |",
  "| --- | --- | --- |",
  ...checks.map((item) => `| ${item.name} | ${item.pass ? "PASS" : "FAIL"} | ${item.evidence} |`),
  "",
  failed.length
    ? `Unsafe checklist failure count: ${failed.length}`
    : "All required security checklist items have static evidence."
].join("\n");

writeReport("security-checklist.md", report);

if (failed.length) {
  process.stderr.write(`Security checklist failed with ${failed.length} missing item(s).\n`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function check(name, content, pattern) {
  const pass = pattern.test(content);
  return {
    name,
    pass,
    evidence: pass ? `Matched ${pattern.source.replaceAll("|", "\\|")}` : "No static evidence found"
  };
}
