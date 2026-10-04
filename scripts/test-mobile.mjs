import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

const platform = process.env.BRANDSPARQ_MOBILE_PLATFORM || "android";
const command = process.platform === "win32" ? "maestro.bat" : "maestro";
const version = spawnSync(command, ["--version"], { stdio: "ignore" });
if (version.error || version.status !== 0) {
  console.error(
    "Install Maestro and boot an emulator/simulator before running native E2E. See docs/SPRINT9.md.",
  );
  process.exit(1);
}
if (!["android", "ios"].includes(platform))
  throw new Error("BRANDSPARQ_MOBILE_PLATFORM must be android or ios.");
if (platform === "android") {
  const reverse = spawnSync("adb", ["reverse", "tcp:8788", "tcp:8788"], { stdio: "inherit" });
  if (reverse.error || reverse.status !== 0)
    throw new Error("A booted Android emulator/device and adb are required.");
}
const server = spawn(
  process.execPath,
  ["--import", "./tests/register.mjs", "tests/e2e/server.mjs"],
  { stdio: "inherit" },
);
let serverFailed = false;
server.on("exit", () => {
  serverFailed = true;
});
let maestro;
const cleanup = () => {
  maestro?.kill();
  server.kill();
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverFailed)
      throw new Error(
        "The isolated test server could not start. Stop any process using port 8788.",
      );
    try {
      ready = (await fetch("http://127.0.0.1:8788/health", { signal: AbortSignal.timeout(1000) }))
        .ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Test workspace did not become ready.");
  await mkdir("test-results", { recursive: true });
  maestro = spawn(
    command,
    ["test", "--format", "junit", "--output", "test-results/native.xml", ".maestro/workspace.yaml"],
    { stdio: "inherit" },
  );
  const code = await new Promise((resolve, reject) => {
    maestro.on("error", reject);
    maestro.on("exit", resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  cleanup();
}
