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
  addJsonSection("Unused files", parsed.files);
  addJsonSection("Unused dependencies", parsed.dependencies);
  addJsonSection("Unused devDependencies", parsed.devDependencies);
  addJsonSection("Unused exports", parsed.exports);
  addJsonSection("Missing dependencies", parsed.missing);
} else {
  sections.push("## Raw Output", "", "```text", `${result.stdout}\n${result.stderr}`.trim() || "No output.", "```");
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
