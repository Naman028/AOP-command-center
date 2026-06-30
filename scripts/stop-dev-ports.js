import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ports = [4000, 5173];

async function windowsPidsForPort(port) {
  const { stdout } = await execFileAsync("netstat", ["-ano"]);
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(`:${port}`) && line.includes("LISTENING"))
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter(Boolean);
}

async function stopPid(pid) {
  await execFileAsync("taskkill", ["/PID", pid, "/F"]);
}

for (const port of ports) {
  const pids = process.platform === "win32" ? await windowsPidsForPort(port) : [];
  for (const pid of new Set(pids)) {
    await stopPid(pid);
    process.stdout.write(`Stopped PID ${pid} on port ${port}\n`);
  }
}
