// Logger is the first module loaded on startup — emit the banner before any
// other work, with the effective LOG_LEVEL and corelib SysInfo (server-side).
import { getSysInfo, getVersion, isFfiAvailable, logger } from "@ckirg/corelib";
import { createHealthServer } from "./server.ts";

const log = logger.child({ app: "backend" });
const sys = getSysInfo();

log.info("Starting backend", {
  logLevel: log.level,
  runtime: sys.runtime,
  os: sys.os,
  arch: sys.arch,
  pid: sys.pid,
  cwd: sys.cwd,
});
// Full SysInfo minus the (redacted but verbose) env dump.
const { env: _env, ...sysBasics } = sys;
log.debug("System info", { sysInfo: sysBasics });

const ffi = isFfiAvailable();
log.info("corelib FFI", { available: ffi, version: ffi ? getVersion() : "n/a" });

// Child-app contract (processmanager.md §4): serve /health on the daemon-injected
// CONTROL_PORT, and on SIGTERM/SIGINT flush then exit 3 ("handled — do not restart").
const controlPort = process.env.CONTROL_PORT ? Number(process.env.CONTROL_PORT) : 3001;
const app = createHealthServer("backend");
const server = Bun.serve({ fetch: app.fetch, hostname: "127.0.0.1", port: controlPort });
log.info("Backend control API listening", { url: `http://127.0.0.1:${controlPort}` });

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Backend received signal — flushing", { signal });
  server.stop(true);
  process.exit(3); // 3 = "I handled the signal — do not restart me"
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
