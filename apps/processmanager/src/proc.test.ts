import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Proc } from "./proc.ts";
import { afterEach, beforeEach, describe, expect, it } from "./test-harness.ts";
import type { LogRecord } from "./types.ts";

const FIXTURE = resolve(process.cwd(), "test/fixtures/fake-child.ts");

let dir: string;
let records: LogRecord[];
let sink: { write: (r: LogRecord) => void };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-proc-"));
  records = [];
  sink = { write: (r) => records.push(r) };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Proc", () => {
  it("drains stdout into the sink and reports a normal exit", async () => {
    const proc = new Proc(
      {
        name: "fake",
        cmd: ["bun", "run", FIXTURE, "exit0"],
        cwd: process.cwd(),
        contract: "best-effort",
        autostart: true,
      },
      sink,
      5000,
    );
    const exit = new Promise<{ code: number; intentional: boolean }>((res) =>
      proc.onExit((code, intentional) => res({ code, intentional })),
    );
    await proc.start();
    const r = await exit;
    expect(r.code).toBe(0);
    expect(r.intentional).toBe(false);
    expect(records.some((x) => x.fields.msg === "child up")).toBe(true);
    expect(records.some((x) => x.fields.raw === "a raw non-json line")).toBe(true);
  });

  it("reports the exit code for a crash", async () => {
    const proc = new Proc(
      {
        name: "fake",
        cmd: ["bun", "run", FIXTURE, "exit1"],
        cwd: process.cwd(),
        contract: "best-effort",
        autostart: true,
      },
      sink,
      5000,
    );
    const exit = new Promise<number>((res) => proc.onExit((code) => res(code)));
    await proc.start();
    expect(await exit).toBe(1);
  });

  it("stop() force-kills a hung child (intentional=true)", async () => {
    const proc = new Proc(
      {
        name: "fake",
        cmd: ["bun", "run", FIXTURE, "hang"],
        cwd: process.cwd(),
        contract: "best-effort",
        autostart: true,
      },
      sink,
      300, // short grace so the test is fast
    );
    let intentional = false;
    proc.onExit((_code, i) => {
      intentional = i;
    });
    await proc.start();
    await proc.stop();
    expect(intentional).toBe(true);
    expect(proc.pid).toBe(null);
  });
});
