import { daemonConfig, parseServices } from "./config.ts";
import { describe, expect, it } from "./test-harness.ts";

describe("parseServices", () => {
  it("parses a JSON5 services array with comments + trailing commas", () => {
    const text = `[
      // backend
      { name: "backend", cmd: ["bun","run","start"], cwd: "apps/backend", contract: "full", autostart: true, },
    ]`;
    const defs = parseServices(text);
    expect(defs.length).toBe(1);
    expect(defs[0]!.name).toBe("backend");
    expect(defs[0]!.cmd).toEqual(["bun", "run", "start"]);
    expect(defs[0]!.contract).toBe("full");
    expect(defs[0]!.autostart).toBe(true);
  });

  it("defaults autostart to true and contract to best-effort when omitted", () => {
    const defs = parseServices(`[{ name: "x", cmd: ["echo"], cwd: "." }]`);
    expect(defs[0]!.autostart).toBe(true);
    expect(defs[0]!.contract).toBe("best-effort");
  });

  it("throws on a non-array root", () => {
    expect(() => parseServices(`{ name: "x" }`)).toThrow();
  });

  it("throws when a required field is missing or mistyped", () => {
    expect(() => parseServices(`[{ cmd: ["echo"], cwd: "." }]`)).toThrow(); // no name
    expect(() => parseServices(`[{ name: "x", cmd: "echo", cwd: "." }]`)).toThrow(); // cmd not array
  });
});

describe("daemonConfig", () => {
  it("uses defaults when env is empty", () => {
    const c = daemonConfig({});
    expect(c.port).toBe(4600);
    expect(c.host).toBe("127.0.0.1");
    expect(c.flushGraceMs).toBeGreaterThan(0);
  });

  it("reads PM_PORT from env", () => {
    expect(daemonConfig({ PM_PORT: "5001" }).port).toBe(5001);
  });
});
