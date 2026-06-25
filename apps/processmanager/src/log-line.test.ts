import { toRecord } from "./log-line.ts";
import { describe, expect, it } from "./test-harness.ts";

describe("toRecord", () => {
  it("parses a pino NDJSON line and tags the service", () => {
    const line = JSON.stringify({
      level: 30,
      time: "2026-06-25T00:00:00.000Z",
      msg: "hi",
      app: "backend",
    });
    const r = toRecord(line, "backend");
    expect(r.service).toBe("backend");
    expect(r.time).toBe("2026-06-25T00:00:00.000Z");
    expect(r.fields.msg).toBe("hi");
  });

  it("wraps a non-JSON line as raw without throwing", () => {
    const r = toRecord("vite v6 ready in 300 ms", "frontend");
    expect(r.service).toBe("frontend");
    expect(r.level).toBe("info");
    expect(r.fields.raw).toBe("vite v6 ready in 300 ms");
  });

  it("defaults time to now when the line has none", () => {
    const r = toRecord(JSON.stringify({ msg: "x" }), "pm");
    expect(typeof r.time).toBe("string");
    expect(r.time.length).toBeGreaterThan(0);
  });
});
