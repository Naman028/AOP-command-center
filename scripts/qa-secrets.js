import fs from "node:fs";
import path from "node:path";
import { runChecked, rootDir, writeReport } from "./qa-shared.js";

const tracked = runChecked("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
const findings = [];
const safeExampleFiles = new Set(["server/.env.example", "client/.env.example"]);

const rules = [
  { reason: "MongoDB URI", pattern: /mongodb(?:\+srv)?:\/\/(?!<|example|localhost|127\.0\.0\.1|unavailable)/i, allowFixtures: true },
  { reason: "JWT or refresh token secret assignment", pattern: /\b(?:ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET|JWT_SECRET)\s*[:=]\s*["']?(?!<|change-me|example|your-|replace-with-|long-random-secret|production-test-|test-|dev-|$).{12,}/i, allowFixtures: true },
  { reason: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/i },
  { reason: "cookie/session secret assignment", pattern: /\b(?:COOKIE_SECRET|SESSION_SECRET)\s*=\s*(?!<|change-me|example|your-|$).{12,}/i },
  { reason: "tracked environment file", pattern: /^.*$/i, fileOnly: /\.env(?:\.|$)/i },
  { reason: "possible plaintext password", pattern: /\bpassword\s*[:=]\s*["'][^"'<>{}\s]{10,}["']/i, allowExamples: true }
];

for (const file of tracked) {
  const normalized = file.replaceAll("\\", "/");
  if (isBinaryLike(normalized)) continue;
  const content = fs.readFileSync(path.join(rootDir, file), "utf8");
  for (const rule of rules) {
    if (rule.fileOnly) {
      if (rule.fileOnly.test(normalized) && !safeExampleFiles.has(normalized)) {
        findings.push({ file: normalized, reason: rule.reason });
      }
      continue;
    }
    if (safeExampleFiles.has(normalized)) continue;
    if (rule.allowFixtures && isFixtureFile(normalized)) continue;
    if (rule.allowExamples && isFixtureFile(normalized)) continue;
    if (rule.pattern.test(content)) {
      findings.push({ file: normalized, reason: rule.reason });
    }
  }
}

const lines = [
  "# Secret Scan",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  findings.length ? "## Findings" : "No committed secret patterns found.",
  "",
  ...findings.map((finding) => `- ${finding.file}: ${finding.reason}`)
];

writeReport("secret-scan-report.md", lines.join("\n"));

if (findings.length) {
  process.stderr.write(`Secret scan failed with ${findings.length} finding(s). See reports/secret-scan-report.md\n`);
  process.exit(1);
}

function isBinaryLike(file) {
  return /\.(?:png|jpg|jpeg|gif|webp|ico|xlsx|zip|gz|pdf|woff2?)$/i.test(file);
}

function isFixtureFile(file) {
  return file.includes("/tests/") || file.includes(".test.") || file === "scripts/mongodb-persistence-gate.js";
}
