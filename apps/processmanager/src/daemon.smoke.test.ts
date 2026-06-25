import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RotatingSink } from "./log-sink.ts";
import { Proc } from "./proc.ts";
import { Supervisor } from "./supervisor.ts";
import { afterEach, beforeEach, describe, expect, it } from "./test-harness.ts";
import type { ServiceDef } from "./types.ts";

const FIXTURE = resolve(process.cwd(), "test/fixtures/fake-child.ts");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-e2e-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("daemon smoke", () => {
  it("supervises a child, writes the sink, and honours exit-3 (no restart)", async () => {
    const sink = new RotatingSink({ dir, file: "pm.ndjson", maxBytes: 1_000_000, maxBackups: 2 });
    const def: ServiceDef = {
      name: "fake",
      cmd: ["bun", "run", FIXTURE, "exit3"],
      cwd: process.cwd(),
      contract: "full",
      autostart: true,
    };
    const sup = new Supervisor([def], { procFactory: (d) => new Proc(d, sink, 500) });
    await sup.startAll();
    await new Promise((r) => setTimeout(r, 800));
    sink.close();
    const content = readFileSync(join(dir, "pm.ndjson"), "utf8");
    expect(content).toContain("child up");
    expect(sup.status("fake")?.state).toBe("stopped");
    expect(sup.status("fake")?.lastExitCode).toBe(3);
  });
});
