// Logger is the first module loaded on startup — emit the banner before any
// other work, with the effective LOG_LEVEL and corelib SysInfo (server-side).

import { resolve } from "node:path";
import { getSysInfo, getVersion, isFfiAvailable, logger } from "@ckirg/corelib";
import { daemonConfig, loadServices } from "./config.ts";
import { RotatingSink } from "./log-sink.ts";
import { Proc } from "./proc.ts";
import { createServer } from "./server.ts";
import { Supervisor } from "./supervisor.ts";
import type { LogRecord } from "./types.ts";

const log = logger.child({ app: "pm" });
const sys = getSysInfo();
log.info("Starting processmanager", {
  logLevel: log.level,
  runtime: sys.runtime,
  os: sys.os,
  arch: sys.arch,
  pid: sys.pid,
  cwd: sys.cwd,
});
const ffi = isFfiAvailable();
log.info("corelib FFI", { available: ffi, version: ffi ? getVersion() : "n/a" });

const cfg = daemonConfig();
const configPath = resolve(process.cwd(), process.env.PM_CONFIG ?? "services.json5");
const defs = loadServices(configPath);

const sink = new RotatingSink({
  dir: cfg.logDir,
  file: cfg.logFile,
  maxBytes: cfg.maxBytes,
  maxBackups: cfg.maxBackups,
});
// PM's own lifecycle events also go to the sink, tagged service:"pm".
const pmRecord = (level: string, msg: string, extra: Record<string, unknown> = {}): void => {
  const rec: LogRecord = {
    time: new Date().toISOString(),
    service: "pm",
    level,
    fields: { msg, ...extra },
  };
  sink.write(rec);
};

const sup = new Supervisor(defs, {
  procFactory: (def) => new Proc(def, sink, cfg.flushGraceMs),
});

await sup.startAll();
pmRecord("info", "autostart complete", { services: defs.map((d) => d.name) });
log.info("Supervisor autostart complete", { services: defs.map((d) => d.name) });

const app = createServer(sup);
const server = Bun.serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
log.info("PM control API listening", { url: `http://${cfg.host}:${cfg.port}` });

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Daemon shutting down", { signal });
  pmRecord("info", "daemon shutting down", { signal });
  await sup.shutdownAll();
  server.stop(true);
  sink.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
