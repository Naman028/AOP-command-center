import fs from "node:fs";
import path from "node:path";
import { ensureReportsDir, readJson, relative, rootDir, writeReport } from "./qa-shared.js";

const reviewPatterns = [/\bAGPL\b/i, /\bGPL\b/i, /\bLGPL\b/i, /UNKNOWN/i, /UNLICENSED/i];
const standardPattern = /^(MIT|ISC|BSD-\d-Clause|Apache-2\.0|MPL-2\.0|0BSD|\(MIT OR Apache-2\.0\)|MIT OR Apache-2\.0)$/i;

ensureReportsDir();

const lock = readJson(path.join(rootDir, "package-lock.json"));
const packages = [];

for (const [lockPath, meta] of Object.entries(lock.packages ?? {})) {
  if (!lockPath.includes("node_modules/") || !meta.version) continue;
  const packageJsonPath = path.join(rootDir, lockPath, "package.json");
  let packageJson = {};
  if (fs.existsSync(packageJsonPath)) {
    packageJson = readJson(packageJsonPath);
  }
  const license = normalizeLicense(packageJson.license ?? meta.license ?? packageJson.licenses);
  packages.push({
    name: packageJson.name ?? lockPath.split("node_modules/").at(-1),
    version: packageJson.version ?? meta.version,
    license,
    path: lockPath,
    dependencyType: meta.dev ? "dev" : "production",
    reviewNeeded: isReviewNeeded(license)
  });
}

packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

fs.writeFileSync(path.join(rootDir, "reports", "licenses-full.json"), `${JSON.stringify(packages, null, 2)}\n`);

const reviewItems = packages.filter((item) => item.reviewNeeded);
const licenseCounts = new Map();
for (const item of packages) {
  licenseCounts.set(item.license, (licenseCounts.get(item.license) ?? 0) + 1);
}

const summary = [
  "# License Summary",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Installed packages reviewed: ${packages.length}`,
  `Review-needed packages: ${reviewItems.length}`,
  "",
  "## License Counts",
  "",
  "| License | Count |",
  "| --- | ---: |",
  ...Array.from(licenseCounts.entries()).sort((a, b) => b[1] - a[1]).map(([license, count]) => `| ${escapeCell(license)} | ${count} |`),
  "",
  "## Review Needed",
  "",
  reviewItems.length
    ? [
        "| Package | Version | License | Type | Path |",
        "| --- | --- | --- | --- | --- |",
        ...reviewItems.map((item) => `| ${item.name} | ${item.version} | ${escapeCell(item.license)} | ${item.dependencyType} | ${relative(path.join(rootDir, item.path))} |`)
      ].join("\n")
    : "No review-needed licenses found.",
  "",
  "Policy: AGPL, GPL, LGPL, UNKNOWN, UNLICENSED, and non-standard/custom license strings are flagged for review, not deleted or auto-remediated."
].join("\n");

writeReport("licenses-summary.md", summary);

function normalizeLicense(value) {
  if (!value) return "UNKNOWN";
  if (Array.isArray(value)) return value.map(normalizeLicense).join(" OR ");
  if (typeof value === "object") return value.type ?? "custom/non-standard";
  return String(value).trim() || "UNKNOWN";
}

function isReviewNeeded(license) {
  return reviewPatterns.some((pattern) => pattern.test(license)) || !standardPattern.test(license);
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}
