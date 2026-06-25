import { actionPath, baseUrl, formatStatus } from "./cli.ts";
import { describe, expect, it } from "./test-harness.ts";
import type { ServiceStatus } from "./types.ts";

describe("cli helpers", () => {
  it("baseUrl uses PM_PORT or default 4600", () => {
    expect(baseUrl({})).toBe("http://127.0.0.1:4600");
    expect(baseUrl({ PM_PORT: "5001" })).toBe("http://127.0.0.1:5001");
  });

  it("actionPath targets a named service or 'all'", () => {
    expect(actionPath("restart", "backend")).toBe("/services/backend/restart");
    expect(actionPath("stop", undefined)).toBe("/services/all/stop");
  });

  it("formatStatus renders one line per service", () => {
    const statuses: ServiceStatus[] = [
      {
        name: "backend",
        state: "running",
        pid: 101,
        restarts: 2,
        lastExitCode: null,
        contract: "full",
      },
    ];
    const out = formatStatus(statuses);
    expect(out).toContain("backend");
    expect(out).toContain("running");
    expect(out).toContain("101");
  });

  it("formatStatus handles an empty list", () => {
    expect(formatStatus([])).toContain("no services");
  });
});
