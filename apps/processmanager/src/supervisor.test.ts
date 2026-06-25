import { Supervisor } from "./supervisor.ts";
import { describe, expect, it } from "./test-harness.ts";
import type { IProc, ServiceDef } from "./types.ts";

// Fake proc: records start/stop, lets the test fire exit manually.
class FakeProc implements IProc {
  readonly name: string;
  pid: number | null = null;
  starts = 0;
  stops = 0;
  private cb: ((code: number, intentional: boolean) => void) | null = null;
  constructor(def: ServiceDef) {
    this.name = def.name;
  }
  async start() {
    this.starts++;
    this.pid = 100 + this.starts;
  }
  async stop() {
    this.stops++;
    this.pid = null;
    this.cb?.(143, true);
  }
  onExit(cb: (code: number, intentional: boolean) => void) {
    this.cb = cb;
  }
  fireExit(code: number) {
    this.pid = null;
    this.cb?.(code, false);
  }
}

const DEF: ServiceDef = { name: "svc", cmd: ["x"], cwd: ".", contract: "full", autostart: true };
let fakes: Map<string, FakeProc>;
let now: number;
function makeSup(defs: ServiceDef[]) {
  fakes = new Map();
  now = 0;
  return new Supervisor(defs, {
    procFactory: (d) => {
      const p = new FakeProc(d);
      fakes.set(d.name, p);
      return p;
    },
    now: () => now,
    wait: async () => {}, // backoff resolves instantly in tests
    crashLoopThreshold: 3,
    crashLoopWindowMs: 60_000,
    baseDelayMs: 500,
    maxDelayMs: 30_000,
    stableMs: 60_000,
  });
}

// flush microtasks + timers so an async launch() settles before assertions
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Supervisor policy", () => {
  it("restarts on crash exit (code 1)", async () => {
    const sup = makeSup([DEF]);
    await sup.startAll();
    expect(fakes.get("svc")!.starts).toBe(1);
    fakes.get("svc")!.fireExit(1);
    await tick();
    expect(fakes.get("svc")!.starts).toBe(2);
    expect(sup.status("svc")!.state).toBe("running");
  });

  it("does NOT restart on exit code 3 (handled signal)", async () => {
    const sup = makeSup([DEF]);
    await sup.startAll();
    fakes.get("svc")!.fireExit(3);
    await tick();
    expect(fakes.get("svc")!.starts).toBe(1);
    expect(sup.status("svc")!.state).toBe("stopped");
  });

  it("does NOT restart after an intentional stop", async () => {
    const sup = makeSup([DEF]);
    await sup.startAll();
    await sup.stop("svc");
    await tick();
    expect(fakes.get("svc")!.starts).toBe(1);
    expect(sup.status("svc")!.state).toBe("stopped");
  });

  it("trips the crash-loop guard after threshold restarts in the window", async () => {
    const sup = makeSup([DEF]);
    await sup.startAll();
    for (let i = 0; i < 3; i++) {
      fakes.get("svc")!.fireExit(1);
      await tick();
    }
    // 3 restarts within window -> next crash should crashloop
    fakes.get("svc")!.fireExit(1);
    await tick();
    expect(sup.status("svc")!.state).toBe("crashlooped");
  });

  it("restart() revives a crashlooped service and resets the guard", async () => {
    const sup = makeSup([DEF]);
    await sup.startAll();
    for (let i = 0; i < 4; i++) {
      fakes.get("svc")!.fireExit(1);
      await tick();
    }
    expect(sup.status("svc")!.state).toBe("crashlooped");
    await sup.restart("svc");
    expect(sup.status("svc")!.state).toBe("running");
  });
});
