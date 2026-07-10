import fs from "node:fs";
import { ensureReportsDir, reportsDir, run, writeReport } from "./qa-shared.js";

ensureReportsDir();

const steps = [
  ["git status", "git", ["status", "--short"], true],
  ["git diff --check", "git", ["diff", "--check"], false],
  ["server/.env ignored", "git", ["check-ignore", "server/.env"], false],
  ["server/.env untracked", "git", ["ls-files", "server/.env"], false, (result) => result.stdout.trim() === ""],
  ["secret scan", "npm", ["run", "qa:secrets"], false],
  ["lint", "npm", ["run", "lint"], false],
  ["unit/integration tests", "npm", ["test"], false],
  ["client build", "npm", ["run", "build", "--workspace", "client"], false],
  ["browser E2E", "npm", ["run", "test:e2e"], false],
  ["security audit high", "npm", ["run", "security:check"], false],
  ["workspace audit strict", "npm", ["audit", "--workspaces"], false],
  ["license report", "npm", ["run", "qa:licenses"], false],
  ["unused-code report", "npm", ["run", "qa:unused"], true],
  ["security checklist", "npm", ["run", "qa:security-checklist"], false]
];

const results = [];
let failed = false;

for (const [name, command, args, informational, customPass] of steps) {
  process.stdout.write(`\n[qa:release] ${name}\n`);
  const result = run(command, args);
  const pass = customPass ? customPass(result) : result.status === 0;
  results.push({ name, command: result.command, status: result.status, pass, informational, error: result.error });
  if (!pass && !informational) failed = true;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error}\n`);
}

const report = [
  "# Release Readiness Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Overall status: ${failed ? "FAIL" : "PASS"}`,
  "",
  "## Gate Results",
  "",
  "| Step | Required | Status | Exit | Command | Error |",
  "| --- | --- | --- | ---: | --- | --- |",
  ...results.map((item) => `| ${item.name} | ${item.informational ? "No" : "Yes"} | ${item.pass ? "PASS" : "FAIL"} | ${item.status} | \`${item.command}\` | ${item.error ? escapeCell(item.error) : ""} |`),
  "",
  "## Report Files",
  "",
  ...listReports().map((file) => `- reports/${file}`),
  "",
  "## Notes",
  "",
  "- Atlas transaction verification remains separate: run `npm run mongo:gate` only when intentionally testing Atlas.",
  "- Unused-code findings are review-only and are not auto-deleted by this gate.",
  "- Generated Playwright artifacts remain ignored by `.gitignore`."
].join("\n");

writeReport("release-readiness-report.md", report);

if (failed) {
  process.stderr.write("\nqa:release failed. See reports/release-readiness-report.md\n");
  process.exit(1);
}

function listReports() {
  return fs.readdirSync(reportsDir)
    .filter((file) => file !== ".gitkeep")
    .sort();
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
