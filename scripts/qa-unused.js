import { run, writeReport } from "./qa-shared.js";

const result = run("npx", ["knip", "--reporter", "json"]);
let parsed = null;

try {
  parsed = JSON.parse(result.stdout || "{}");
} catch {
  parsed = null;
}

const sections = [
  "# Unused Code Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "Policy: This report is review-only. Phase 10.2 does not auto-delete files, dependencies, or exports.",
  "",
  `Knip exit status: ${result.status}`,
  ""
];

if (parsed) {
  const normalized = normalizeKnip(parsed);
  addJsonSection("Unused files", normalized.files);
  addJsonSection("Unused dependencies", normalized.dependencies);
  addJsonSection("Unused devDependencies", normalized.devDependencies);
  addJsonSection("Unused exports", normalized.exports);
  addJsonSection("Missing dependencies", normalized.missing);
  addJsonSection("Unlisted dependencies", normalized.unlisted);
  addJsonSection("Unresolved imports", normalized.unresolved);
} else {
  sections.push("## Raw Output", "", "```text", `${result.stdout}\n${result.stderr}`.trim() || "No output.", "```");
}

function normalizeKnip(parsed) {
  if (!Array.isArray(parsed.issues)) {
    return {
      files: parsed.files,
      dependencies: parsed.dependencies,
      devDependencies: parsed.devDependencies,
      exports: parsed.exports,
      missing: parsed.missing,
      unlisted: parsed.unlisted,
      unresolved: parsed.unresolved
    };
  }

  const normalized = {
    files: [],
    dependencies: [],
    devDependencies: [],
    exports: [],
    missing: [],
    unlisted: [],
    unresolved: []
  };

  for (const issue of parsed.issues) {
    for (const item of issue.files ?? []) normalized.files.push(`${issue.file}: ${item.name}`);
    for (const item of issue.dependencies ?? []) normalized.dependencies.push(`${issue.file}: ${item.name}`);
    for (const item of issue.devDependencies ?? []) normalized.devDependencies.push(`${issue.file}: ${item.name}`);
    for (const item of issue.exports ?? []) normalized.exports.push(`${issue.file}: ${item.name}`);
    for (const item of issue.unlisted ?? []) normalized.unlisted.push(`${issue.file}: ${item.name}`);
    for (const item of issue.unresolved ?? []) normalized.unresolved.push(`${issue.file}: ${item.name}`);
  }

  return normalized;
}

writeReport("unused-code-report.md", sections.join("\n"));

function addJsonSection(title, value) {
  sections.push(`## ${title}`, "");
  const rows = flatten(value);
  if (!rows.length) {
    sections.push("None reported.", "");
    return;
  }
  for (const row of rows) sections.push(`- ${row}`);
  sections.push("");
}

function flatten(value, prefix = "") {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(nested)) return nested.map((item) => `${nextPrefix}: ${JSON.stringify(item)}`);
      if (nested && typeof nested === "object") return flatten(nested, nextPrefix);
      return [`${nextPrefix}: ${String(nested)}`];
    });
  }
  return [String(value)];
}
