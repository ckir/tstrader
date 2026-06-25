import type { IProc, ServiceDef, ServiceState, ServiceStatus } from "./types.ts";

export interface SupervisorDeps {
  procFactory: (def: ServiceDef) => IProc;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  crashLoopThreshold?: number;
  crashLoopWindowMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  stableMs?: number;
}

interface Entry {
  def: ServiceDef;
  proc: IProc;
  state: ServiceState;
  restarts: number;
  consecutive: number; // for backoff
  lastExitCode: number | null;
  startedAt: number;
  recentRestarts: number[]; // timestamps for crash-loop window
  generation: number; // bumped by stop/restart/shutdownAll to cancel a pending backoff relaunch
}

const defaults = {
  crashLoopThreshold: 3,
  crashLoopWindowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  stableMs: 60_000,
};

export class Supervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly cfg: typeof defaults;

  constructor(
    defs: ServiceDef[],
    private readonly deps: SupervisorDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cfg = {
      crashLoopThreshold: deps.crashLoopThreshold ?? defaults.crashLoopThreshold,
      crashLoopWindowMs: deps.crashLoopWindowMs ?? defaults.crashLoopWindowMs,
      baseDelayMs: deps.baseDelayMs ?? defaults.baseDelayMs,
      maxDelayMs: deps.maxDelayMs ?? defaults.maxDelayMs,
      stableMs: deps.stableMs ?? defaults.stableMs,
    };
    for (const def of defs) {
      this.entries.set(def.name, this.makeEntry(def));
    }
  }

  private makeEntry(def: ServiceDef): Entry {
    const proc = this.deps.procFactory(def);
    const entry: Entry = {
      def,
      proc,
      state: "stopped",
      restarts: 0,
      consecutive: 0,
      lastExitCode: null,
      startedAt: 0,
      recentRestarts: [],
      generation: 0,
    };
    proc.onExit((code, intentional) => this.handleExit(entry, code, intentional));
    return entry;
  }

  private async launch(entry: Entry): Promise<void> {
    entry.state = "starting";
    await entry.proc.start();
    entry.startedAt = this.now();
    entry.state = "running";
  }

  private handleExit(entry: Entry, code: number, intentional: boolean): void {
    entry.lastExitCode = code;
    // Intentional stops (stop/restart/shutdownAll) own the state transition themselves; ignoring
    // them here prevents a stale exit from clobbering a fresh launch (agy finding #1).
    if (intentional) return;
    if (code === 3) {
      entry.state = "stopped"; // handled signal -> do not restart
      return;
    }
    // crash/housekeeping -> consider restart
    const t = this.now();
    if (t - entry.startedAt >= this.cfg.stableMs) entry.consecutive = 0;
    entry.recentRestarts = entry.recentRestarts.filter((ts) => t - ts < this.cfg.crashLoopWindowMs);
    if (entry.recentRestarts.length >= this.cfg.crashLoopThreshold) {
      entry.state = "crashlooped";
      return;
    }
    entry.state = "restarting";
    entry.consecutive++;
    entry.restarts++;
    entry.recentRestarts.push(t);
    const delay = Math.min(
      this.cfg.baseDelayMs * 2 ** (entry.consecutive - 1),
      this.cfg.maxDelayMs,
    );
    const gen = entry.generation;
    void this.wait(delay).then(() => {
      // Abort if a stop/restart/shutdown bumped the generation while we were backing off (agy finding #5).
      if (entry.state === "restarting" && entry.generation === gen) void this.launch(entry);
    });
  }

  async startAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].filter((e) => e.def.autostart).map((e) => this.launch(e)),
    );
  }

  async start(name: string): Promise<void> {
    const e = this.entries.get(name);
    if (!e) throw new Error(`unknown service: ${name}`);
    if (e.state === "running" || e.state === "starting") return;
    await this.launch(e);
  }

  async stop(name: string): Promise<void> {
    const e = this.entries.get(name);
    if (!e) throw new Error(`unknown service: ${name}`);
    e.generation++; // cancel any pending backoff relaunch (agy finding #5)
    await e.proc.stop(); // no-op if there is no live child (e.g. mid-backoff)
    e.state = "stopped";
  }

  async restart(name: string): Promise<void> {
    const e = this.entries.get(name);
    if (!e) throw new Error(`unknown service: ${name}`);
    e.generation++; // cancel any pending backoff relaunch (agy finding #5)
    if (e.state === "running" || e.state === "starting") await e.proc.stop();
    e.consecutive = 0;
    e.recentRestarts = [];
    await this.launch(e);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        // include "restarting" so a service mid-backoff cannot relaunch after shutdown (agy finding #5)
        .filter((e) => e.state === "running" || e.state === "starting" || e.state === "restarting")
        .map(async (e) => {
          e.generation++;
          await e.proc.stop(); // no-op if no live child
          e.state = "stopped";
        }),
    );
  }

  status(name: string): ServiceStatus | null {
    const e = this.entries.get(name);
    return e ? this.toStatus(e) : null;
  }

  statuses(): ServiceStatus[] {
    return [...this.entries.values()].map((e) => this.toStatus(e));
  }

  private toStatus(e: Entry): ServiceStatus {
    return {
      name: e.def.name,
      state: e.state,
      pid: e.proc.pid,
      restarts: e.restarts,
      lastExitCode: e.lastExitCode,
      contract: e.def.contract,
    };
  }
}
