import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RotatingSink } from "./log-sink.ts";
import { afterEach, beforeEach, describe, expect, it } from "./test-harness.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-sink-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RotatingSink", () => {
  it("appends one JSON line per record", () => {
    const sink = new RotatingSink({ dir, file: "pm.ndjson", maxBytes: 1_000_000, maxBackups: 3 });
    sink.write({ time: "t1", service: "pm", level: "info", fields: { msg: "a" } });
    sink.write({ time: "t2", service: "backend", level: "warn", fields: { msg: "b" } });
    sink.close();
    const lines = readFileSync(join(dir, "pm.ndjson"), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).service).toBe("pm");
    expect(JSON.parse(lines[1]!).fields.msg).toBe("b");
  });

  it("rotates when the active file exceeds maxBytes", () => {
    const sink = new RotatingSink({ dir, file: "pm.ndjson", maxBytes: 200, maxBackups: 3 });
    for (let i = 0; i < 20; i++) {
      sink.write({
        time: `t${i}`,
        service: "pm",
        level: "info",
        fields: { i, pad: "x".repeat(40) },
      });
    }
    sink.close();
    expect(existsSync(join(dir, "pm.ndjson"))).toBe(true);
    expect(existsSync(join(dir, "pm.ndjson.1"))).toBe(true);
  });

  it("keeps at most maxBackups backups", () => {
    const sink = new RotatingSink({ dir, file: "pm.ndjson", maxBytes: 100, maxBackups: 2 });
    for (let i = 0; i < 50; i++) {
      sink.write({ time: `t${i}`, service: "pm", level: "info", fields: { pad: "y".repeat(50) } });
    }
    sink.close();
    const backups = readdirSync(dir).filter((f) => /^pm\.ndjson\.\d+$/.test(f));
    expect(backups.length).toBeLessThanOrEqual(2);
  });
});
