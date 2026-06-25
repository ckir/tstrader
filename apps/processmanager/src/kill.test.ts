import { buildKillCommand } from "./kill.ts";
import { describe, expect, it } from "./test-harness.ts";

describe("buildKillCommand", () => {
  it("uses taskkill tree-kill on win32", () => {
    const cmd = buildKillCommand(1234, "win32");
    expect(cmd).toEqual(["taskkill", "/PID", "1234", "/T", "/F"]);
  });

  it("returns null on posix (caller uses process.kill SIGKILL)", () => {
    expect(buildKillCommand(1234, "linux")).toBe(null);
    expect(buildKillCommand(1234, "darwin")).toBe(null);
  });
});
