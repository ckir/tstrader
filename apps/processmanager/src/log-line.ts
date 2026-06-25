import type { LogRecord } from "./types.ts";

/** pino numeric levels → names */
const LEVELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/**
 * Convert one stdout line into a tagged LogRecord.
 * NDJSON lines (one JSON object per line) are parsed with native JSON.parse;
 * anything else is wrapped raw so a non-compliant child can never crash the sink.
 */
export function toRecord(line: string, service: string): LogRecord {
  const trimmed = line.trim();
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const lvl = obj.level;
      const level =
        typeof lvl === "number" ? (LEVELS[lvl] ?? "info") : typeof lvl === "string" ? lvl : "info";
      const time = typeof obj.time === "string" ? obj.time : new Date().toISOString();
      return { time, service, level, fields: obj };
    }
  } catch {
    // fall through to raw
  }
  return { time: new Date().toISOString(), service, level: "info", fields: { raw: line } };
}
