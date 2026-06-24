// Logger is the first module loaded on startup — emit the banner before any
// other work, with the effective LOG_LEVEL and corelib SysInfo (server-side).
import { getSysInfo, getVersion, isFfiAvailable, logger } from "@ckirg/corelib";

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
