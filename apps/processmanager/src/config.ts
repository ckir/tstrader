import { readFileSync } from "node:fs";
import { parseJSON5 } from "confbox";
import type { ServiceContract, ServiceDef } from "./types.ts";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function toServiceDef(raw: unknown, i: number): ServiceDef {
  if (typeof raw !== "object" || raw === null) throw new Error(`services[${i}] is not an object`);
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0)
    throw new Error(`services[${i}].name must be a non-empty string`);
  if (!isStringArray(o.cmd) || o.cmd.length === 0)
    throw new Error(`services[${i}].cmd must be a non-empty string[]`);
  if (typeof o.cwd !== "string" || o.cwd.length === 0)
    throw new Error(`services[${i}].cwd must be a non-empty string`);
  const contract: ServiceContract = o.contract === "full" ? "full" : "best-effort";
  const autostart = o.autostart === undefined ? true : o.autostart === true;
  let env: Record<string, string> | undefined;
  if (o.env !== undefined) {
    if (typeof o.env !== "object" || o.env === null)
      throw new Error(`services[${i}].env must be an object`);
    env = {};
    for (const [k, val] of Object.entries(o.env as Record<string, unknown>)) {
      if (typeof val !== "string") throw new Error(`services[${i}].env.${k} must be a string`);
      env[k] = val;
    }
  }
  return { name: o.name, cmd: o.cmd, cwd: o.cwd, contract, autostart, ...(env ? { env } : {}) };
}

export function parseServices(text: string): ServiceDef[] {
  const root = parseJSON5(text);
  if (!Array.isArray(root)) throw new Error("services config root must be an array");
  return root.map(toServiceDef);
}

export function loadServices(path: string): ServiceDef[] {
  return parseServices(readFileSync(path, "utf8"));
}

export interface DaemonConfig {
  host: string;
  port: number;
  logDir: string;
  logFile: string;
  maxBytes: number;
  maxBackups: number;
  flushGraceMs: number;
}

export function daemonConfig(env: Record<string, string | undefined> = process.env): DaemonConfig {
  return {
    host: "127.0.0.1", // INVARIANT until Phase 4 auth (processmanager.md §7)
    port: env.PM_PORT ? Number(env.PM_PORT) : 4600,
    logDir: env.PM_LOG_DIR ?? ".logs",
    logFile: "pm.ndjson",
    maxBytes: env.PM_LOG_MAX_BYTES ? Number(env.PM_LOG_MAX_BYTES) : 5 * 1024 * 1024,
    maxBackups: env.PM_LOG_MAX_BACKUPS ? Number(env.PM_LOG_MAX_BACKUPS) : 5,
    flushGraceMs: env.PM_FLUSH_GRACE_MS ? Number(env.PM_FLUSH_GRACE_MS) : 5000,
  };
}
