# processmanager Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the loss-proof core of the processmanager: a roll-your-own `Bun.spawn` supervisor that captures child stdout into a rotating NDJSON sink, restarts children by exit-code policy with backoff + crash-loop guard, shuts down gracefully (flush grace → tree-kill), exposes a localhost Hono REST control API, and ships a `tstrader` CLI client — plus a minimal contract-compliant Hono server in `backend`.

**Architecture:** One long-running **daemon** (`apps/processmanager/src/index.ts`) owns all child processes. A `Supervisor` holds one `Proc` per configured service; each `Proc` wraps `Bun.spawn` (stdout/stderr piped and continuously drained) and feeds parsed records to a single `RotatingSink`. Restart/backoff/crash-loop policy lives in the `Supervisor` with injectable spawn + clock so it is unit-testable without real processes. A Hono server (`server.ts`) exposes status/start/stop/restart on `127.0.0.1`. A thin **CLI** (`cli.ts`, bin `tstrader`, built on citty) is a pure REST client. The supervised `backend` gets a minimal Hono `/health` server and honours the child contract (NDJSON stdout via `LOG_PRETTY=false`, `SIGTERM`→flush→exit 3). `frontend` (vite) is supervised **best-effort** (same spawn/drain/restart, no exit-3/health expectation, raw-text log fallback).

**Tech Stack:** Bun 1.3.8, TypeScript 6, `@ckirg/corelib` logger, **Hono** (server), **citty** (CLI), **confbox** (`parseJSON5` for config), vitest + `bun test` (cross-runtime via a runtime-shim harness).

---

## Design references (read before starting)

- `docs/architecture/processmanager.md` — locked decisions (§3), child contract (§4), MM hard-rules (§5).
- `ROADMAP.md` Track A Phase 1 — the exact P1 checklist this plan implements.
- Child-contract oracle (verified): corelib `ts-core/src/loggers/implementations/bun.ts` —
  `isPretty = LOG_PRETTY==="true" || (NODE_ENV!=="production" && LOG_PRETTY!=="false")`, `level = LOG_LEVEL || "info"`.
  ⇒ injecting `LOG_PRETTY=false` forces raw pino **NDJSON** to stdout.

## Resolved forks (from brainstorm + user decisions 2026-06-25)

- **Scope:** full P1 — daemon + sink + CLI + minimal compliant backend server; vite best-effort. (agy req-djhn9qkrc1jo AGREED.)
- **CLI lib:** **citty** (UnJS, lazy subcommands).
- **Config:** **JSON5** file parsed by **confbox** `parseJSON5` + a hand-rolled shape guard (no Zod/ArkType yet — validation lib still deferred, ARCHITECTURE §5.2). No layering yet (ROADMAP defers it).

## Known platform caveat (state honestly, do not pretend otherwise)

On **Windows**, `SIGTERM` is not catchable by a child — `proc.kill()` maps to `TerminateProcess` (immediate, uncatchable). So the `SIGTERM`→flush→exit-3 graceful path is **effective on linux/macOS only**; on Windows the flush-grace expires and the tree-kill fallback (`taskkill /PID <pid> /T /F`) does the cleanup. This is acceptable: deploy target is **linux-x64**; Windows is dev-only. Tests for the graceful-exit-3 path are guarded to non-Windows; the spawn/drain/sink/restart-policy tests are cross-platform.

**Known limitation — POSIX descendant orphans (deferred to Phase 2).** On Windows, `taskkill /T` kills the whole tree. On POSIX, Phase 1 uses a **direct** `process.kill(pid, "SIGKILL")`, which kills only the immediate child — a child that spawns its own workers (e.g. `vite` → esbuild/Rollup) can leave orphaned descendants on linux dev. Proper POSIX tree-kill needs the child spawned as a **process-group leader** (detached) so the group can be signalled with `process.kill(-pgid, …)`; doing `kill(-pid)` *without* a confirmed detached spawn is unsafe (it could signal the daemon's own group). This is a **Phase-2 hardening** — not implemented blindly here. Phase-1 deploy targets (`backend`, `processmanager`) are single-process and unaffected; `frontend`/vite is dev-only and best-effort.

---

## File structure

**`apps/processmanager/`**
- `src/types.ts` — `ServiceDef`, `ServiceContract`, `RestartReason`, `ServiceState`, `ServiceStatus`, `IProc`, `LogRecord`.
- `src/config.ts` — `loadServices(path)` (confbox `parseJSON5` + shape guard) + `daemonConfig()` (env/defaults).
- `src/log-line.ts` — `toRecord(line, service)` (JSON.parse → tagged record; raw fallback).
- `src/log-sink.ts` — `RotatingSink` class (append NDJSON, size-based rotation, backups).
- `src/kill.ts` — `treeKill(pid)` (Windows `taskkill /T /F`; posix `process.kill`).
- `src/proc.ts` — `Proc` class implementing `IProc` (real `Bun.spawn`, drain → sink, graceful stop).
- `src/supervisor.ts` — `Supervisor` class (DI: `procFactory`, `now`, `wait`); restart policy, backoff, crash-loop guard, `startAll`/`shutdownAll`/per-service control, `statuses()`.
- `src/server.ts` — `createServer(supervisor)` → Hono app (status/start/stop/restart/health).
- `src/index.ts` — daemon entry (logger banner → load config → Supervisor → autostart → serve 127.0.0.1 → signal handlers). **Replaces the current stub.**
- `src/cli.ts` — citty CLI, bin `tstrader`; REST client for status/start/stop/restart.
- `src/test-harness.ts` — cross-runtime re-export of `describe/it/expect/beforeEach/afterEach`.
- `test/fixtures/fake-child.ts` — controllable test child (emits NDJSON + a raw line; exits with a chosen code; can hang/handle SIGTERM).
- `services.json5` — the service list (backend full, frontend best-effort).
- `package.json` — add deps + `bin` + test scripts.

**`apps/backend/`**
- `src/server.ts` — `createHealthServer()` → Hono app with `/health`.
- `src/index.ts` — **modify**: after the banner, start the server on `CONTROL_PORT`; register `SIGTERM`/`SIGINT` → flush → exit 3.
- `src/test-harness.ts` — cross-runtime harness (copy of the PM one).
- `package.json` — add `hono` dep.

**Root**
- `.gitignore` — add `.logs/` and `*.ndjson`.

---

## Task 0: Dependencies, config file, gitignore, test scripts

**Files:**
- Modify: `apps/processmanager/package.json`
- Modify: `apps/backend/package.json`
- Create: `apps/processmanager/services.json5`
- Modify: `.gitignore`

- [ ] **Step 0 (STATE-VERIFICATION):** Open `apps/processmanager/package.json` and `apps/backend/package.json`. Confirm PM has only `@ckirg/corelib` dep + scripts `start`/`typecheck`, and backend has `@ckirg/corelib` + `start`/`typecheck`/`test:unit`/`test:unit:bun`. If different, STOP and report `STATE_MISMATCH: <what>`.

- [ ] **Step 1: Add deps (pin exact; Hono version MUST match across backend + PM for syncpack).**

Run from repo root:
```bash
bun add --exact --cwd apps/processmanager hono citty confbox
bun add --exact --cwd apps/backend hono
```
After install, open both package.json files and confirm the `hono` version string is **identical** in both. If not, edit one to match the other and re-run `bun install`.

- [ ] **Step 2: Add PM `bin` + test scripts.** Edit `apps/processmanager/package.json` so `scripts` and a new `bin` read:

```jsonc
{
  "scripts": {
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run --passWithNoTests",
    "test:unit:bun": "bun test --pass-with-no-tests"
  },
  "bin": { "tstrader": "./src/cli.ts" }
}
```
(Keep `name`/`version`/`private`/`type`/`main`/`dependencies` as they are.)

- [ ] **Step 3: Create `apps/processmanager/services.json5`:**

```json5
// Services supervised by the processmanager daemon.
// contract: "full"        — honours the child contract (NDJSON, SIGTERM->flush->exit 3, /health)
// contract: "best-effort" — supervised, but no exit-3/health expectation (e.g. vite)
[
  {
    name: "backend",
    cmd: ["bun", "run", "start"],
    cwd: "apps/backend",
    contract: "full",
    autostart: true,
  },
  {
    name: "frontend",
    cmd: ["bun", "run", "dev"],
    cwd: "apps/frontend",
    contract: "best-effort",
    autostart: true,
  },
]
```

- [ ] **Step 4: Ignore log output.** Add to `.gitignore` (the existing `*.log` does not cover `.ndjson` or the dir):

```gitignore
# processmanager log sink
.logs/
*.ndjson
```

- [ ] **Step 5: Verify install + gates.**

Run: `bun install && bun run sync:check`
Expected: install completes; `syncpack lint` → `✓ No issues found` (Hono versions match).

- [ ] **Step 6: Commit.**

```bash
git add apps/processmanager/package.json apps/backend/package.json apps/processmanager/services.json5 .gitignore bun.lock package.json
git commit -m "chore(pm): phase 1 deps (hono/citty/confbox) + services.json5 + ignore .logs"
```

---

## Task 1: Cross-runtime test harness

**Files:**
- Create: `apps/processmanager/src/test-harness.ts`

The repo runs every suite under **both** vitest and `bun test` (CI matrix). A test file importing `vitest` breaks under `bun test` and vice-versa. This shim re-exports from the active runtime. (Re-introduces the proven skeleton pattern; the `@vite-ignore` keeps vitest from statically resolving `bun:test`.)

- [ ] **Step 1: Create the harness.**

```ts
// Cross-runtime test primitives: bun:test under `bun test`, vitest otherwise.
const RUNNER = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun:test" : "vitest";
// @vite-ignore — variable specifier; neither runner statically resolves the other.
const mod = (await import(/* @vite-ignore */ RUNNER)) as {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Record<string, (...args: unknown[]) => unknown>;
  beforeEach: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
};

export const describe = mod.describe;
export const it = mod.it;
export const expect = mod.expect;
export const beforeEach = mod.beforeEach;
export const afterEach = mod.afterEach;
```

- [ ] **Step 2: Verify it loads under both runtimes** (a trivial smoke test, deleted in Step 3):

Create `apps/processmanager/src/harness.smoke.test.ts`:
```ts
import { describe, it, expect } from "./test-harness.ts";
describe("harness", () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});
```
Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: both report 1 passing test.

- [ ] **Step 3: Delete the smoke test** (it was only to prove the harness), then commit.

```bash
rm apps/processmanager/src/harness.smoke.test.ts
git add apps/processmanager/src/test-harness.ts
git commit -m "test(pm): cross-runtime test harness shim"
```

---

## Task 2: Core types

**Files:**
- Create: `apps/processmanager/src/types.ts`

No tests (pure type declarations; consumed/compiled by later tasks).

- [ ] **Step 1: Create `types.ts`:**

```ts
export type ServiceContract = "full" | "best-effort";

export interface ServiceDef {
  name: string;
  cmd: string[];
  cwd: string;
  contract: ServiceContract;
  autostart: boolean;
  /** extra env merged over the inherited environment for this child */
  env?: Record<string, string>;
}

export type ServiceState =
  | "stopped" // not running; no restart pending
  | "starting" // spawn issued, not yet confirmed
  | "running" // alive
  | "restarting" // exited unexpectedly, backoff timer pending
  | "crashlooped"; // restart guard tripped; will not auto-restart

export type RestartReason = "housekeeping" | "crash" | "intentional" | "handled-signal";

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  pid: number | null;
  restarts: number;
  lastExitCode: number | null;
  contract: ServiceContract;
}

export interface LogRecord {
  /** ISO-8601; from the child line if present, else sink receive time */
  time: string;
  service: string;
  level: string;
  /** the structured fields if the line parsed as JSON, else { raw } */
  fields: Record<string, unknown>;
}

/** A single supervised process. The Supervisor depends on this interface (not Proc) so policy is testable. */
export interface IProc {
  readonly name: string;
  readonly pid: number | null;
  /** spawn the process; resolves once spawned */
  start(): Promise<void>;
  /** graceful stop: SIGTERM -> flush grace -> tree-kill; resolves once exited */
  stop(): Promise<void>;
  /** register the exit callback (code = process exit code, intentional = stop() was called) */
  onExit(cb: (code: number, intentional: boolean) => void): void;
}
```

- [ ] **Step 2: Typecheck + commit.**

Run: `bun run --filter @repo/processmanager typecheck`
Expected: 0 errors.
```bash
git add apps/processmanager/src/types.ts
git commit -m "feat(pm): core types"
```

---

## Task 3: Log-line parsing

**Files:**
- Create: `apps/processmanager/src/log-line.ts`
- Test: `apps/processmanager/src/log-line.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { toRecord } from "./log-line.ts";

describe("toRecord", () => {
  it("parses a pino NDJSON line and tags the service", () => {
    const line = JSON.stringify({ level: 30, time: "2026-06-25T00:00:00.000Z", msg: "hi", app: "backend" });
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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./log-line.ts`.

- [ ] **Step 3: Implement `log-line.ts`.**

```ts
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
      const level = typeof lvl === "number" ? (LEVELS[lvl] ?? "info") : typeof lvl === "string" ? lvl : "info";
      const time = typeof obj.time === "string" ? obj.time : new Date().toISOString();
      return { time, service, level, fields: obj };
    }
  } catch {
    // fall through to raw
  }
  return { time: new Date().toISOString(), service, level: "info", fields: { raw: line } };
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 3 tests PASS under both.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/log-line.ts apps/processmanager/src/log-line.test.ts
git commit -m "feat(pm): NDJSON log-line parser with raw fallback"
```

---

## Task 4: Rotating NDJSON sink

**Files:**
- Create: `apps/processmanager/src/log-sink.ts`
- Test: `apps/processmanager/src/log-sink.test.ts`

The sink is the single durable writer. Append one JSON line per record; when the active file exceeds `maxBytes`, rotate (`pm.ndjson` → `pm.ndjson.1` → … up to `maxBackups`, dropping the oldest).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "./test-harness.ts";
import { RotatingSink } from "./log-sink.ts";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      sink.write({ time: `t${i}`, service: "pm", level: "info", fields: { i, pad: "x".repeat(40) } });
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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./log-sink.ts`.

- [ ] **Step 3: Implement `log-sink.ts`.**

```ts
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { LogRecord } from "./types.ts";

export interface SinkOptions {
  dir: string;
  file: string;
  maxBytes: number;
  maxBackups: number;
}

/** Synchronous append-with-rotation NDJSON writer. Synchronous keeps the tail loss-proof on hard-kill. */
export class RotatingSink {
  private fd: number;
  private bytes: number;
  private readonly path: string;

  constructor(private readonly opts: SinkOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.path = join(opts.dir, opts.file);
    this.bytes = existsSync(this.path) ? statSync(this.path).size : 0;
    this.fd = openSync(this.path, "a");
  }

  write(record: LogRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);
    if (this.bytes + size > this.opts.maxBytes && this.bytes > 0) {
      this.rotate();
    }
    writeSync(this.fd, line);
    this.bytes += size;
  }

  private rotate(): void {
    closeSync(this.fd);
    // shift backups: drop oldest, then .N-1 -> .N ... .1 stays, active -> .1
    const oldest = join(this.opts.dir, `${this.opts.file}.${this.opts.maxBackups}`);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = this.opts.maxBackups - 1; i >= 1; i--) {
      const from = join(this.opts.dir, `${this.opts.file}.${i}`);
      const to = join(this.opts.dir, `${this.opts.file}.${i + 1}`);
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(this.path, join(this.opts.dir, `${this.opts.file}.1`));
    this.fd = openSync(this.path, "a");
    this.bytes = 0;
  }

  close(): void {
    closeSync(this.fd);
  }
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 3 tests PASS under both.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/log-sink.ts apps/processmanager/src/log-sink.test.ts
git commit -m "feat(pm): rotating NDJSON log sink"
```

---

## Task 5: Cross-platform tree-kill

**Files:**
- Create: `apps/processmanager/src/kill.ts`
- Test: `apps/processmanager/src/kill.test.ts`

`treeKill` must kill the whole tree (MM rule §5). On Windows use `taskkill /PID <pid> /T /F`; on posix `process.kill(pid, "SIGKILL")`. The command **construction** is unit-tested via an injectable platform so the test is deterministic and side-effect-free.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { buildKillCommand } from "./kill.ts";

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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./kill.ts`.

- [ ] **Step 3: Implement `kill.ts`.**

```ts
/** Build the OS tree-kill command, or null on posix where process.kill(SIGKILL) suffices. */
export function buildKillCommand(pid: number, platform: NodeJS.Platform): string[] | null {
  if (platform === "win32") return ["taskkill", "/PID", String(pid), "/T", "/F"];
  return null;
}

/** Force-kill a process tree. Best-effort: never throws. */
export async function treeKill(pid: number): Promise<void> {
  const cmd = buildKillCommand(pid, process.platform);
  try {
    if (cmd) {
      const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
      await proc.exited;
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // process may already be gone; ignore
  }
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: both PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/kill.ts apps/processmanager/src/kill.test.ts
git commit -m "feat(pm): cross-platform tree-kill"
```

---

## Task 6: Config loader

**Files:**
- Create: `apps/processmanager/src/config.ts`
- Test: `apps/processmanager/src/config.test.ts`

`parseServices(text)` parses JSON5 via confbox and shape-guards into `ServiceDef[]` (throws a clear error on bad shape — no Zod). `daemonConfig()` reads daemon settings from env with defaults.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { parseServices, daemonConfig } from "./config.ts";

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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./config.ts`.

- [ ] **Step 3: Implement `config.ts`.**

```ts
import { parseJSON5 } from "confbox";
import { readFileSync } from "node:fs";
import type { ServiceContract, ServiceDef } from "./types.ts";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function toServiceDef(raw: unknown, i: number): ServiceDef {
  if (typeof raw !== "object" || raw === null) throw new Error(`services[${i}] is not an object`);
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) throw new Error(`services[${i}].name must be a non-empty string`);
  if (!isStringArray(o.cmd) || o.cmd.length === 0) throw new Error(`services[${i}].cmd must be a non-empty string[]`);
  if (typeof o.cwd !== "string" || o.cwd.length === 0) throw new Error(`services[${i}].cwd must be a non-empty string`);
  const contract: ServiceContract = o.contract === "full" ? "full" : "best-effort";
  const autostart = o.autostart === undefined ? true : o.autostart === true;
  let env: Record<string, string> | undefined;
  if (o.env !== undefined) {
    if (typeof o.env !== "object" || o.env === null) throw new Error(`services[${i}].env must be an object`);
    env = {};
    for (const [k, val] of Object.entries(o.env as Record<string, unknown>)) {
      if (typeof val !== "string") throw new Error(`services[${i}].env.${k} must be a string`);
      env[k] = val;
    }
  }
  return { name: o.name, cmd: o.cmd, cwd: o.cwd, contract, autostart, ...(env ? { env } : {}) };
}

export function parseServices(text: string): ServiceDef[] {
  const root = parseJSON5(text);
  if (!Array.isArray(root)) throw new Error("services config root must be an array");
  return root.map(toServiceDef);
}

export function loadServices(path: string): ServiceDef[] {
  return parseServices(readFileSync(path, "utf8"));
}

export interface DaemonConfig {
  host: string;
  port: number;
  logDir: string;
  logFile: string;
  maxBytes: number;
  maxBackups: number;
  flushGraceMs: number;
}

export function daemonConfig(env: Record<string, string | undefined> = process.env): DaemonConfig {
  return {
    host: "127.0.0.1", // INVARIANT until Phase 4 auth (processmanager.md §7)
    port: env.PM_PORT ? Number(env.PM_PORT) : 4600,
    logDir: env.PM_LOG_DIR ?? ".logs",
    logFile: "pm.ndjson",
    maxBytes: env.PM_LOG_MAX_BYTES ? Number(env.PM_LOG_MAX_BYTES) : 5 * 1024 * 1024,
    maxBackups: env.PM_LOG_MAX_BACKUPS ? Number(env.PM_LOG_MAX_BACKUPS) : 5,
    flushGraceMs: env.PM_FLUSH_GRACE_MS ? Number(env.PM_FLUSH_GRACE_MS) : 5000,
  };
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/config.ts apps/processmanager/src/config.test.ts
git commit -m "feat(pm): JSON5 config loader (confbox) + shape guard"
```

---

## Task 7: Proc — single supervised process

**Files:**
- Create: `apps/processmanager/src/proc.ts`
- Create: `apps/processmanager/test/fixtures/fake-child.ts`
- Test: `apps/processmanager/src/proc.test.ts`

`Proc` spawns a real child with `Bun.spawn` (stdout/stderr piped), drains both streams line-by-line into the sink via `toRecord`, and resolves `onExit` with the code + whether `stop()` was called. `stop()` does SIGTERM → flush grace → tree-kill.

- [ ] **Step 1: Create the fixture `test/fixtures/fake-child.ts`.**

```ts
// Controllable test child. Mode comes from argv[2]: "exit0" | "exit1" | "exit3" | "hang" | "sigterm3".
// Emits one NDJSON line and one raw line, then acts per mode.
const mode = process.argv[2] ?? "exit0";
process.stdout.write(`${JSON.stringify({ level: 30, time: new Date().toISOString(), msg: "child up", mode })}\n`);
process.stdout.write("a raw non-json line\n");

if (mode === "hang") {
  // Ignore SIGTERM/SIGINT so stop()'s flush-grace actually expires and treeKill runs (agy finding #4).
  // (On Windows SIGTERM is uncatchable, so the child still dies immediately — graceful path is posix-only.)
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000); // stay alive
} else if (mode === "sigterm3") {
  process.on("SIGTERM", () => {
    process.stdout.write(`${JSON.stringify({ level: 30, msg: "flushed" })}\n`);
    process.exit(3);
  });
  setInterval(() => {}, 1000);
} else {
  const code = Number(mode.replace("exit", "")) || 0;
  process.exit(code);
}
```

- [ ] **Step 2: Write the failing test.** (Real-process integration; the graceful `sigterm3` path is posix-only and not asserted here — covered by `hang`+tree-kill which is cross-platform.)

```ts
import { describe, it, expect, beforeEach, afterEach } from "./test-harness.ts";
import { Proc } from "./proc.ts";
import type { LogRecord } from "./types.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      { name: "fake", cmd: ["bun", "run", FIXTURE, "exit0"], cwd: process.cwd(), contract: "best-effort", autostart: true },
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
      { name: "fake", cmd: ["bun", "run", FIXTURE, "exit1"], cwd: process.cwd(), contract: "best-effort", autostart: true },
      sink,
      5000,
    );
    const exit = new Promise<number>((res) => proc.onExit((code) => res(code)));
    await proc.start();
    expect(await exit).toBe(1);
  });

  it("stop() force-kills a hung child (intentional=true)", async () => {
    const proc = new Proc(
      { name: "fake", cmd: ["bun", "run", FIXTURE, "hang"], cwd: process.cwd(), contract: "best-effort", autostart: true },
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
```

- [ ] **Step 3: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./proc.ts`.

- [ ] **Step 4: Implement `proc.ts`.**

```ts
import type { IProc, LogRecord, ServiceDef } from "./types.ts";
import { toRecord } from "./log-line.ts";
import { treeKill } from "./kill.ts";

type Spawned = ReturnType<typeof Bun.spawn>;

export class Proc implements IProc {
  readonly name: string;
  private child: Spawned | null = null;
  private exitCb: ((code: number, intentional: boolean) => void) | null = null;
  private intentional = false;

  constructor(
    private readonly def: ServiceDef,
    private readonly sink: { write: (r: LogRecord) => void },
    private readonly flushGraceMs: number,
  ) {
    this.name = def.name;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  onExit(cb: (code: number, intentional: boolean) => void): void {
    this.exitCb = cb;
  }

  async start(): Promise<void> {
    this.intentional = false;
    const [exe, ...args] = this.def.cmd;
    const child = Bun.spawn({
      cmd: [exe!, ...args],
      cwd: this.def.cwd,
      env: { ...process.env, LOG_PRETTY: "false", SERVICE_NAME: this.def.name, ...this.def.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.child = child;
    // Drain both streams continuously so the OS pipe never fills (MM hard-rule §5).
    void this.drain(child.stdout);
    void this.drain(child.stderr);
    void child.exited.then((code) => {
      this.child = null;
      this.exitCb?.(code, this.intentional);
    });
  }

  private async drain(stream: ReadableStream<Uint8Array> | number | undefined | null): Promise<void> {
    if (!stream || typeof stream === "number") return;
    const MAX_LINE = 64 * 1024; // flush a runaway newline-less line so a child can't OOM the daemon (agy finding #2)
    const decoder = new TextDecoder();
    let buf = "";
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.length > 0) this.sink.write(toRecord(line, this.def.name));
        }
        if (buf.length > MAX_LINE) {
          this.sink.write(toRecord(buf, this.def.name));
          buf = "";
        }
      }
      if (buf.trim().length > 0) this.sink.write(toRecord(buf, this.def.name));
    } finally {
      reader.releaseLock();
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.intentional = true;
    const pid = child.pid;
    child.kill("SIGTERM"); // posix: child can flush->exit 3; windows: terminates immediately
    const exited = child.exited;
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((res) => setTimeout(() => res(true), this.flushGraceMs)),
    ]);
    if (timedOut) {
      await treeKill(pid);
      await exited;
    }
  }
}
```

- [ ] **Step 5: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 3 PASS under both. (The hung-child test uses a 300 ms grace, so it finishes < 1 s.)

- [ ] **Step 6: Commit.**

```bash
git add apps/processmanager/src/proc.ts apps/processmanager/src/proc.test.ts apps/processmanager/test/fixtures/fake-child.ts
git commit -m "feat(pm): Proc — spawn + stdout drain + graceful stop"
```

---

## Task 8: Supervisor — restart policy, backoff, crash-loop guard

**Files:**
- Create: `apps/processmanager/src/supervisor.ts`
- Test: `apps/processmanager/src/supervisor.test.ts`

The Supervisor holds one `IProc` per service and applies policy on exit:
- `intentional` stop → state `stopped`, no restart.
- exit code `3` → `stopped`, no restart ("handled signal").
- exit code `0`/`1`/other → restart after backoff, unless the crash-loop guard trips (≥`crashLoopThreshold` restarts within `crashLoopWindowMs`) → state `crashlooped`.
- backoff: `min(baseDelayMs * 2^(consecutive-1), maxDelayMs)`; counter resets after the process stays up `stableMs`.

Dependencies are injected (`procFactory`, `now`, `wait`) so policy is unit-tested deterministically with a fake proc + fake clock.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { Supervisor } from "./supervisor.ts";
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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./supervisor.ts`.

- [ ] **Step 3: Implement `supervisor.ts`.**

```ts
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
    const delay = Math.min(this.cfg.baseDelayMs * 2 ** (entry.consecutive - 1), this.cfg.maxDelayMs);
    const gen = entry.generation;
    void this.wait(delay).then(() => {
      // Abort if a stop/restart/shutdown bumped the generation while we were backing off (agy finding #5).
      if (entry.state === "restarting" && entry.generation === gen) void this.launch(entry);
    });
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.entries.values()].filter((e) => e.def.autostart).map((e) => this.launch(e)));
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
```

> **Crash-loop test timing:** with `now()` fixed at 0, all `recentRestarts` stay in-window. The guard trips when `recentRestarts.length >= threshold` at the *next* exit — i.e. after 3 recorded restarts, the 4th exit crashloops. The test fires 4 crashes → `crashlooped`. ✔

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 5 PASS under both.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/supervisor.ts apps/processmanager/src/supervisor.test.ts
git commit -m "feat(pm): Supervisor — restart policy + backoff + crash-loop guard"
```

---

## Task 9: Hono REST control server

**Files:**
- Create: `apps/processmanager/src/server.ts`
- Test: `apps/processmanager/src/server.test.ts`

`createServer(supervisor)` returns a Hono app. Routes:
- `GET /health` → `{ ok: true }` (daemon's own health).
- `GET /status` → `{ services: ServiceStatus[] }`.
- `POST /services/:name/:action` (`start`|`stop`|`restart`) → `{ ok, status }`; `name="all"` fans out; unknown action → 400; unknown name → 404.

Tested via `app.request()` with a stub supervisor (no real processes).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { createServer } from "./server.ts";
import type { ServiceStatus } from "./types.ts";

function stubSup() {
  const calls: string[] = [];
  const statuses: ServiceStatus[] = [
    { name: "backend", state: "running", pid: 101, restarts: 0, lastExitCode: null, contract: "full" },
  ];
  return {
    calls,
    sup: {
      statuses: () => statuses,
      status: (n: string) => statuses.find((s) => s.name === n) ?? null,
      start: async (n: string) => void calls.push(`start:${n}`),
      stop: async (n: string) => void calls.push(`stop:${n}`),
      restart: async (n: string) => void calls.push(`restart:${n}`),
      startAll: async () => void calls.push("startAll"),
      shutdownAll: async () => void calls.push("shutdownAll"),
    },
  };
}

describe("createServer", () => {
  it("GET /health → ok", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /status returns the service list", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/status");
    const body = (await res.json()) as { services: ServiceStatus[] };
    expect(body.services[0]!.name).toBe("backend");
  });

  it("POST /services/backend/restart calls restart", async () => {
    const { sup, calls } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/backend/restart", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toContain("restart:backend");
  });

  it("POST /services/all/stop fans out to shutdownAll", async () => {
    const { sup, calls } = stubSup();
    const app = createServer(sup as never);
    await app.request("/services/all/stop", { method: "POST" });
    expect(calls).toContain("shutdownAll");
  });

  it("unknown service → 404", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/nope/start", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("unknown action → 400", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/backend/frobnicate", { method: "POST" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./server.ts`.

- [ ] **Step 3: Implement `server.ts`.**

```ts
import { Hono } from "hono";
import type { Supervisor } from "./supervisor.ts";

export function createServer(sup: Supervisor): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/status", (c) => c.json({ services: sup.statuses() }));

  app.post("/services/:name/:action", async (c) => {
    const name = c.req.param("name");
    const action = c.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      return c.json({ ok: false, error: `unknown action: ${action}` }, 400);
    }
    if (name === "all") {
      if (action === "start") await sup.startAll();
      else if (action === "stop") await sup.shutdownAll();
      else {
        await sup.shutdownAll();
        await sup.startAll();
      }
      return c.json({ ok: true, services: sup.statuses() });
    }
    if (!sup.status(name)) return c.json({ ok: false, error: `unknown service: ${name}` }, 404);
    if (action === "start") await sup.start(name);
    else if (action === "stop") await sup.stop(name);
    else await sup.restart(name);
    return c.json({ ok: true, status: sup.status(name) });
  });

  return app;
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 6 PASS under both.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/server.ts apps/processmanager/src/server.test.ts
git commit -m "feat(pm): Hono REST control server"
```

---

## Task 10: Daemon entry wiring

**Files:**
- Modify: `apps/processmanager/src/index.ts` (replaces the current stub)

No new unit test (composition only; exercised by the Task 13 smoke test). Wires: logger banner → load config → build sink → Supervisor (real `procFactory` building `Proc`) → autostart → serve on `127.0.0.1` via `Bun.serve` → signal handlers for graceful daemon shutdown.

- [ ] **Step 0 (STATE-VERIFICATION):** Open `apps/processmanager/src/index.ts`. Confirm it is the stub (imports `getVersion`/`isFfiAvailable`/`logger`, logs `[processmanager] up …`). If it already contains daemon wiring, STOP and report `STATE_MISMATCH`.

- [ ] **Step 1: Replace `index.ts`.** (Uses `Bun.serve` — the daemon only ever runs on Bun, so no `@hono/node-server` dependency.)

```ts
// Logger is the first module loaded on startup — emit the banner before any
// other work, with the effective LOG_LEVEL and corelib SysInfo (server-side).
import { getSysInfo, getVersion, isFfiAvailable, logger } from "@ckirg/corelib";
import { resolve } from "node:path";
import { daemonConfig, loadServices } from "./config.ts";
import { Proc } from "./proc.ts";
import { RotatingSink } from "./log-sink.ts";
import { Supervisor } from "./supervisor.ts";
import { createServer } from "./server.ts";
import type { LogRecord } from "./types.ts";

const log = logger.child({ app: "pm" });
const sys = getSysInfo();
log.info("Starting processmanager", {
  logLevel: log.level,
  runtime: sys.runtime,
  os: sys.os,
  arch: sys.arch,
  pid: sys.pid,
  cwd: sys.cwd,
});
const ffi = isFfiAvailable();
log.info("corelib FFI", { available: ffi, version: ffi ? getVersion() : "n/a" });

const cfg = daemonConfig();
const configPath = resolve(process.cwd(), process.env.PM_CONFIG ?? "services.json5");
const defs = loadServices(configPath);

const sink = new RotatingSink({
  dir: cfg.logDir,
  file: cfg.logFile,
  maxBytes: cfg.maxBytes,
  maxBackups: cfg.maxBackups,
});
// PM's own lifecycle events also go to the sink, tagged service:"pm" (§5).
const pmRecord = (level: string, msg: string, extra: Record<string, unknown> = {}): void => {
  const rec: LogRecord = { time: new Date().toISOString(), service: "pm", level, fields: { msg, ...extra } };
  sink.write(rec);
};

const sup = new Supervisor(defs, {
  procFactory: (def) => {
    const proc = new Proc(def, sink, cfg.flushGraceMs);
    proc.onExit((code, intentional) => pmRecord("info", "service exit", { service: def.name, code, intentional }));
    return proc;
  },
});

await sup.startAll();
pmRecord("info", "autostart complete", { services: defs.map((d) => d.name) });
log.info("Supervisor autostart complete", { services: defs.map((d) => d.name) });

const app = createServer(sup);
const server = Bun.serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
log.info("PM control API listening", { url: `http://${cfg.host}:${cfg.port}` });

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Daemon shutting down", { signal });
  pmRecord("info", "daemon shutting down", { signal });
  await sup.shutdownAll();
  server.stop(true);
  sink.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

> **STATE/SHAPE check (do during implementation):** `Proc.onExit` registers a **single** callback (it overwrites). In Task 10 the daemon calls `proc.onExit(...)` for `pmRecord`, but `Supervisor.makeEntry` ALSO calls `proc.onExit(...)` — the Supervisor's registration would overwrite the daemon's. **Resolution:** do NOT register `onExit` from the daemon. Instead, drop the `proc.onExit(...)` line in `procFactory` (the Supervisor owns the exit callback) — PM still logs service exits via the Supervisor path is not present, so emit the per-service exit record from inside the Proc's sink is not it either. Correct fix: have `procFactory` return the `Proc` only; the Supervisor's `handleExit` is the single owner. To still record exits to the sink tagged `pm`, change the plan: the daemon does not need a second callback — exit visibility comes from the child's own NDJSON + the supervisor state via `/status`. **Therefore remove the `proc.onExit(...)` call in `procFactory` entirely.** (This avoids the double-registration bug; `pmRecord` is still used for autostart/shutdown lines.)

- [ ] **Step 2: Apply the fix from the note** — `procFactory` returns `new Proc(def, sink, cfg.flushGraceMs)` with **no** `onExit` registration.

```ts
const sup = new Supervisor(defs, {
  procFactory: (def) => new Proc(def, sink, cfg.flushGraceMs),
});
```

- [ ] **Step 3: Typecheck.**

Run: `bun run --filter @repo/processmanager typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/processmanager/src/index.ts
git commit -m "feat(pm): daemon entry — banner + sink + supervisor + Bun.serve + shutdown"
```

---

## Task 11: CLI client (citty)

**Files:**
- Create: `apps/processmanager/src/cli.ts`
- Test: `apps/processmanager/src/cli.test.ts`

The CLI is a pure REST client. Extract URL/printing logic into testable pure functions; keep the citty wiring thin and run it only when executed directly.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { baseUrl, actionPath, formatStatus } from "./cli.ts";
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
      { name: "backend", state: "running", pid: 101, restarts: 2, lastExitCode: null, contract: "full" },
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
```

- [ ] **Step 2: Run to verify it fails.**

Run: `bun run --filter @repo/processmanager test:unit`
Expected: FAIL — cannot find module `./cli.ts`.

- [ ] **Step 3: Implement `cli.ts`.**

```ts
#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import type { ServiceStatus } from "./types.ts";

export function baseUrl(env: Record<string, string | undefined> = process.env): string {
  return `http://127.0.0.1:${env.PM_PORT ?? "4600"}`;
}

export function actionPath(action: "start" | "stop" | "restart", service: string | undefined): string {
  return `/services/${service ?? "all"}/${action}`;
}

export function formatStatus(statuses: ServiceStatus[]): string {
  if (statuses.length === 0) return "(no services)";
  return statuses
    .map((s) => `${s.name.padEnd(12)} ${s.state.padEnd(12)} pid=${s.pid ?? "-"} restarts=${s.restarts} contract=${s.contract}`)
    .join("\n");
}

async function callAction(action: "start" | "stop" | "restart", service?: string): Promise<void> {
  const res = await fetch(`${baseUrl()}${actionPath(action, service)}`, { method: "POST" });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`${action} ${service ?? "all"}: ok`);
}

const serviceArg = { service: { type: "positional", required: false, description: "service name (default: all)" } } as const;

const status = defineCommand({
  meta: { name: "status", description: "show service status" },
  async run() {
    const res = await fetch(`${baseUrl()}/status`);
    if (!res.ok) {
      console.error(`error: ${res.status}`);
      process.exit(1);
    }
    const body = (await res.json()) as { services: ServiceStatus[] };
    console.log(formatStatus(body.services));
  },
});

const start = defineCommand({
  meta: { name: "start", description: "start a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("start", args.service as string | undefined);
  },
});

const stop = defineCommand({
  meta: { name: "stop", description: "stop a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("stop", args.service as string | undefined);
  },
});

const restart = defineCommand({
  meta: { name: "restart", description: "restart a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("restart", args.service as string | undefined);
  },
});

const main = defineCommand({
  meta: { name: "tstrader", description: "tstrader process control (REST client to the PM daemon)" },
  subCommands: { status, start, stop, restart },
});

// Only run the CLI when executed directly, not when imported by tests.
if (import.meta.main) {
  void runMain(main);
}
```

- [ ] **Step 4: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: all 4 PASS under both.

> **State/shape check during implementation:** confirm citty's installed API matches `defineCommand`/`runMain`/`args: { x: { type: "positional" } }`/`import.meta.main`. If the installed citty differs (e.g. arg shape), STOP and report `[plan API] -> [installed API] because <reason>` before adapting.

- [ ] **Step 5: Commit.**

```bash
git add apps/processmanager/src/cli.ts apps/processmanager/src/cli.test.ts
git commit -m "feat(pm): tstrader CLI (citty REST client)"
```

---

## Task 12: Backend — minimal contract-compliant server

**Files:**
- Create: `apps/backend/src/server.ts`
- Create: `apps/backend/src/test-harness.ts`
- Test: `apps/backend/src/server.test.ts`
- Modify: `apps/backend/src/index.ts`

Backend honours the child contract: `/health` on the daemon-injected `CONTROL_PORT`, NDJSON stdout (corelib + `LOG_PRETTY=false` injected by the daemon), and `SIGTERM`/`SIGINT` → flush → exit 3.

- [ ] **Step 0 (STATE-VERIFICATION):** Open `apps/backend/src/index.ts`. Confirm it is the logger-banner file (imports `getSysInfo`/`getVersion`/`isFfiAvailable`/`logger`, logs `"Starting backend"`, ends at the `corelib FFI` line). If different, STOP and report `STATE_MISMATCH`.

- [ ] **Step 1: Create the backend cross-runtime harness** (backend has none yet) — copy `apps/processmanager/src/test-harness.ts` verbatim to `apps/backend/src/test-harness.ts`.

- [ ] **Step 2: Write the failing test `apps/backend/src/server.test.ts`.**

```ts
import { describe, it, expect } from "./test-harness.ts";
import { createHealthServer } from "./server.ts";

describe("createHealthServer", () => {
  it("GET /health returns ok with the service name", async () => {
    const app = createHealthServer("backend");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("backend");
  });
});
```

- [ ] **Step 3: Run to verify it fails.**

Run: `bun run --filter @repo/backend test:unit`
Expected: FAIL — cannot find module `./server.ts`.

- [ ] **Step 4: Implement `apps/backend/src/server.ts`.**

```ts
import { Hono } from "hono";

export function createHealthServer(service: string): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, service }));
  return app;
}
```

- [ ] **Step 5: Run to verify it passes (both runtimes).**

Run: `bun run --filter @repo/backend test:unit && bun run --filter @repo/backend test:unit:bun`
Expected: PASS under both.

- [ ] **Step 6: Wire the server + signal handler into `apps/backend/src/index.ts`.** Append after the existing `corelib FFI` log line (do not remove the banner):

```ts
import { createHealthServer } from "./server.ts";

// Child-app contract (processmanager.md §4): serve /health on the daemon-injected
// CONTROL_PORT, and on SIGTERM/SIGINT flush then exit 3 ("handled — do not restart").
const controlPort = process.env.CONTROL_PORT ? Number(process.env.CONTROL_PORT) : 3001;
const app = createHealthServer("backend");
const server = Bun.serve({ fetch: app.fetch, hostname: "127.0.0.1", port: controlPort });
log.info("Backend control API listening", { url: `http://127.0.0.1:${controlPort}` });

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Backend received signal — flushing", { signal });
  server.stop(true);
  process.exit(3); // 3 = "I handled the signal — do not restart me"
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

> **Note:** `import` statements hoist to the top in ESM, so placing `import { createHealthServer }` after other code is legal but lint may prefer it grouped with the other imports — put the import line at the top with the others, and keep the runtime code at the bottom.

- [ ] **Step 7: Typecheck + standalone smoke.**

Run: `bun run --filter @repo/backend typecheck`
Expected: 0 errors.
Smoke (PowerShell): `$env:LOG_PRETTY="false"; $env:CONTROL_PORT="3001"; bun run --filter @repo/backend start` — expect NDJSON lines incl. `"Backend control API listening"`; in another shell `curl http://127.0.0.1:3001/health` → `{"ok":true,"service":"backend"}`. Ctrl-C → process exits (code 3 on posix; on Windows Ctrl-C delivers SIGINT so the handler runs).

- [ ] **Step 8: Commit.**

```bash
git add apps/backend/src/server.ts apps/backend/src/server.test.ts apps/backend/src/test-harness.ts apps/backend/src/index.ts
git commit -m "feat(backend): minimal /health server + SIGTERM->flush->exit 3 (child contract)"
```

---

## Task 13: End-to-end smoke + full gatekeeper + docs/memory

**Files:**
- Create: `apps/processmanager/src/daemon.smoke.test.ts`
- Modify: `docs/architecture/processmanager.md`, `ROADMAP.md`
- Modify: durable memory (`project_tstrader_skeleton_execution.md` + `MEMORY.md`)

- [ ] **Step 1: Write an end-to-end smoke test** through the real Supervisor + Proc + sink path (no HTTP): spawn → drain → sink file written → exit-3 ⇒ no restart.

```ts
import { describe, it, expect, beforeEach, afterEach } from "./test-harness.ts";
import { Supervisor } from "./supervisor.ts";
import { Proc } from "./proc.ts";
import { RotatingSink } from "./log-sink.ts";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServiceDef } from "./types.ts";

const FIXTURE = resolve(process.cwd(), "test/fixtures/fake-child.ts");
let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "pm-e2e-"))));
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
    await new Promise((r) => setTimeout(r, 800)); // let the child exit + policy settle
    sink.close();
    const content = readFileSync(join(dir, "pm.ndjson"), "utf8");
    expect(content).toContain("child up");
    expect(sup.status("fake")!.state).toBe("stopped"); // exit 3 -> no restart
    expect(sup.status("fake")!.lastExitCode).toBe(3);
  });
});
```

- [ ] **Step 2: Run the smoke test (both runtimes).**

Run: `bun run --filter @repo/processmanager test:unit && bun run --filter @repo/processmanager test:unit:bun`
Expected: PASS under both.

- [ ] **Step 3: Manual daemon + CLI smoke (one terminal each).**

Terminal A: `bun run dev:processmanager` → NDJSON banner, "autostart complete", "PM control API listening"; `apps/processmanager/.logs/pm.ndjson` created with backend/frontend lines.
Terminal B: `bun apps/processmanager/src/cli.ts status` → table of backend + frontend; `bun apps/processmanager/src/cli.ts restart backend` → `restart backend: ok`. Ctrl-C terminal A → "Daemon shutting down" + children torn down.

- [ ] **Step 4: Full gatekeeper.**

Run: `bun run gatekeeper`
Expected: `secure`, `sync:check` (✓), `lint`, `sweep`, `typecheck` (5 pkgs), `test:unit` — all green.

> **knip note:** every exported symbol IS used (`loadServices`←index; `treeKill`←proc; `formatStatus`/`baseUrl`/`actionPath`←cli + tests; `buildKillCommand`←test). If knip flags the `bin`/entry files (`src/cli.ts`, `src/index.ts`), add them to knip `entry` config — do **not** delete used code. `RestartReason` type is currently unused — either consume it in `handleExit` return typing or remove it from `types.ts` to keep knip green.

- [ ] **Step 5: Update design docs** — `docs/architecture/processmanager.md` status line → "Phase 1 implemented"; `ROADMAP.md` Track A → tick Phase 1 bullets.

- [ ] **Step 6: Update durable memory** — record Phase-1 commit SHAs, advance the resume point (Phase 2 diagnostics, or FE B2 now that backend exposes `/health`), note any in-flight state.

- [ ] **Step 7: Final commit + push.**

```bash
git add -A
git commit -m "test(pm): e2e supervision smoke + docs/roadmap Phase 1 done"
git push origin main
```
Expected: gatekeeper pre-push hook green; fast-forward push to origin.

---

## Self-review (completed by author)

- **Spec coverage (ROADMAP P1):** supervisor start/stop/restart → Tasks 8,9,11; stdout pipe+drain → Task 7 (`Proc.drain`); rotating NDJSON + `service:"pm"` tagging → Tasks 4,10; exit-code restart (0/1 restart, 3/intentional no) + backoff + crash-loop → Task 8; autostart → Task 8 (`startAll`); graceful shutdown flush-grace → kill → Tasks 7,10; Windows tree-kill → Task 5; REST API (Hono, localhost) → Task 9; CLI → Task 11; light typed JSON5 config → Task 6; child contract honoured by backend → Task 12; frontend best-effort → `services.json5` + the uniform `Proc` path. ✔ all mapped.
- **Placeholder scan:** no TBD/TODO. Every code step carries complete code.
- **Type consistency:** `ServiceDef`/`ServiceStatus`/`IProc`/`LogRecord` defined in Task 2, used unchanged through Tasks 6–13. `Supervisor` methods (`startAll`/`start`/`stop`/`restart`/`shutdownAll`/`status`/`statuses`) consistent across server/index/tests. `RotatingSink({dir,file,maxBytes,maxBackups})` + `.write/.close` consistent (Tasks 4,7,10,13). `Proc(def, sink, flushGraceMs)` consistent (Tasks 7,10,13).
- **Caught during authoring:** `Proc.onExit` is single-callback; Task 10 originally double-registered it (daemon + Supervisor). Fixed in Task 10 Step 2 (Supervisor owns the exit callback; daemon does not register one). `RestartReason` flagged as possibly-unused for knip (Task 13 note).
- **agy review (req-djho2yaexle4) folded in:** (1) restart/stop race — `handleExit` now ignores intentional exits; `stop`/`restart`/`shutdownAll` own the state transition (Task 8). (2) drain OOM — 64 KB runaway-line flush guard (Task 7). (3) POSIX descendant orphans — documented as a Phase-2 hardening rather than a blind/unsafe `kill(-pid)` (Task 5 + caveat). (4) `hang` fixture now ignores SIGTERM so the force-kill/grace path is genuinely exercised (Task 7). (5) mid-backoff stop — per-entry `generation` token cancels a pending relaunch; `shutdownAll` now includes `restarting` (Task 8). Test flush upgraded to a `setTimeout(0)` tick for the async launch chain.

## Open items deferred (NOT Phase 1 — by design)

- Diagnostics DSL (`wedgeState`/`hints`/`OutputBuffer` ring/5 s sampling) → **Phase 2**.
- REST control *into* children (pause/resume) + shared contract package → **Phase 5**.
- libSQL/queryable sink + retention → **Phase 6**. GUI → **Phase 3**. Auth/off-box bind → **Phase 4**. DevelopersCockpit → **Phase 7**.
- Config layering (`common → platform → mode`) — single flat JSON5 only for now.
