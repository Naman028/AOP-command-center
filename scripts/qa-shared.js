import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const reportsDir = path.join(rootDir, "reports");

export function ensureReportsDir() {
  fs.mkdirSync(reportsDir, { recursive: true });
}

export function run(command, args, options = {}) {
  const result = spawnSync(resolveCommand(command), args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: shouldUseShell(command),
    ...options
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? ""
  };
}

export function runChecked(command, args, options = {}) {
  const output = execFileSync(resolveCommand(command), args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });
  return output.trim();
}

export function writeReport(fileName, content) {
  ensureReportsDir();
  fs.writeFileSync(path.join(reportsDir, fileName), `${content.trim()}\n`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function relative(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  return command;
}

function shouldUseShell(command) {
  return process.platform === "win32" && (command === "npm" || command === "npx");
}
