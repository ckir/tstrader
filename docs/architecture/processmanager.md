# processmanager — Design Record

**Status:** **Phase 1 implemented** (Bun.spawn supervisor + rotating NDJSON sink + restart policy/backoff/crash-loop guard + Hono REST on 127.0.0.1 + `tstrader` CLI + contract-compliant backend `/health`). Phases 2–7 remain design-level. Sequencing lives in [`/ROADMAP.md`](../../ROADMAP.md).
**Scope:** runtime/ops **tooling** only. Trading-domain logic (kill-switch behaviour, event-sourcing,
order state) is **out of scope** and belongs to the separate trading brainstorm — this design only leaves
**seams** for it.
**Principle:** *build upon, don't port.* Knowledge is mined from the ancestor project
`MarketMonitor` (MM); code is rewritten clean for tstrader (Bun + `@ckirg/corelib`).

---

## 1. Role & positioning

- **frontend = the main entry** to the system (normal day-to-day UI).
- **processmanager = the alternative / out-of-band entry**, purpose-built for **emergencies**. When the
  frontend crashes the operator must still control the system:
  - **GUI** when *not near the computer* (browser, remote),
  - **CLI** when *at the box*.
- Therefore the PM must be the **most boring, most robust** process in the system and must **survive what
  it supervises** — it serves its own GUI, so the dashboard is reachable precisely when the frontend is dead.
- It grows into the operator's **DevelopersCockpit** (see §6).

## 2. Topology

A **daemon** + two **thin clients**:

| Part | Responsibility |
| --- | --- |
| **Daemon** | The only thing that touches child processes. Supervisor + REST API + static host for the GUI. Single long-running Bun process. |
| **CLI** (`tstrader start\|stop\|pause\|restart\|status\|logs`) | A REST client. No process logic of its own. |
| **GUI** | Svelte + Vite SPA, built to static assets, **served by the daemon**, fed by a WS/poll status stream. |

One control plane; presentation is swappable.

## 3. Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Supervisor impl | **Roll-your-own** `Bun.spawn` | Total control; no black-box in a money-touching path. |
| Log sink | **Capture children's stdout** (PM owns the spawn) | The loss-proof path (see §5). Not network log-shipping. |
| Control transport | **REST into children**, **OS signals as failover** | Every app exposes a REST API anyway; signals (`SIGTERM`→`SIGKILL`) escalate when a child is unresponsive. |
| Pause semantics | **App-level graceful quiesce** (not OS `SIGSTOP`) | Cross-platform safe; lets a trading app flush/cancel before pausing. |
| Server lib | **Hono** | Lightweight, runs on Bun. |
| GUI stack | **Svelte + Vite SPA** (not SvelteKit) | The daemon is already the HTTP server; SSR would duplicate it. Sets the shared Svelte baseline the trading frontend inherits. |
| Config | **JSON5, layered** `common → platform → platform.mode` | Per-platform/mode env overlays via deepmerge. |

## 4. The child-app contract (cross-cutting)

Anything the PM supervises (backend, frontend) **must**:

1. Emit **NDJSON to stdout** (`LOG_PRETTY=false`) so each line is parseable and taggable with `service`.
2. Handle **`SIGTERM` → flush its own buffers → exit with code 3** ("I handled the signal — do **not**
   restart me"). The PM grants a configurable **flush grace period** before `SIGKILL`.
3. Expose **`/health`** + the **REST control surface** (pause/resume/stop) the daemon drives, bound to
   `127.0.0.1` on the **control port the daemon injects at spawn** (env `CONTROL_PORT`). The daemon owns
   the spawn, so it assigns — and therefore already knows — each child's port; no discovery protocol needed.

This contract is the real shared artifact; it lives in a small shared package (see ROADMAP Phase 5).

## 5. MM lessons baked in (hard rules)

Paid for empirically by prior MM sessions — treat as oracles, not preferences:

- **Never `stdout:"ignore"` — always pipe + continuously, non-blockingly drain.** On Bun/Windows the OS
  pipe fills (~64 KB) and the child **deadlocks on its next write** (a trace-level app hit this at boot).
- **stdout is the durable sink.** A hard-killed child left 343 stdout lines but only 8 DB rows — children's
  *own* async transports (WS/DB/file) lose the tail on hard-kill. Hence the flush grace-period in §4.2.
- **Windows kill orphans the child** when spawned through a shell wrapper → kill the **whole tree**
  (`taskkill /PID /T /F`). Bun-on-Windows is clean; Node needs `shell:true` for `.cmd`.
- **Exit-code restart semantics:** `0` housekeeping → restart; `1` crash → restart; `3` / intentional →
  **no** restart.
- **Diagnostics DSL:** `crashLooping` (≥3 restarts in 60 s), `wedgeState` (boot-only: online & <180 s &
  silent 45 s), `hints` (scan output tail for `EADDRINUSE`/`ENOENT`/missing-module/last-error).
- **OutputBuffer** ring per process (~200 lines / 32 KB, best-effort secret redaction); **5 s** status
  sampling for the history strip.
- **PM's own logs** join the same writer, tagged `service:"pm"`.

**Leave behind (MM-specific cruft):** DB backup/restore (domain), trading sentinels/liquidation, the
vestigial pm2 `ecosystem.json`.

## 6. DevelopersCockpit

The operator's personal command center — a tiered launcher fronting routine actions, mined from MM's
`DevelopersCockpit.py` (rewritten in TS). Tiers: **inner feedback loop** (format/lint/typecheck/test) ·
**quality gate & build** · **run & serve** (delegates to the PM) · **health & diagnostics** (`/health`
probe per service) · **housekeeping** (deep-scrub). Open question: TUI vs a GUI tab vs both (ROADMAP
Phase 7).

## 7. Parked forks (decide when the phase arrives)

- **Remote access ⇒ auth becomes required** (promoted from "deferred"): network binding + authentication
  (+ ideally TLS) before the GUI is exposed off-box. An unauthenticated, network-reachable control plane
  over a money-touching system is a non-starter. (ROADMAP Phase 4.) **Invariant until then:** the daemon
  (REST + GUI) **binds strictly to `127.0.0.1`** — no off-box exposure is permitted before auth lands.
- Flush grace-period value · explicit `startOrder` vs config-iteration · optional health-probe **before**
  declaring "online" · WS reconnect-backfill in the SPA · sink depth (rotating files vs also libSQL/
  queryable) · Cockpit surface (TUI/GUI/both) · the **kill-switch** seam (trading brainstorm fills it).

## 8. Knowledge references (MM — read for *knowledge*, not to copy)

`MarketMonitor/packages/process-manager/src/{logWriter,proc-adapter,diagnostics,server,status-page}.ts`,
its `ConfigManager.json5`, `docs/specs/webgui-process-manager-spec.md`,
`.clavity/seams/log-durability.md`, and `DevelopersCockpit.py`.
