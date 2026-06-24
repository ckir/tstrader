# tstrader — ROADMAP

Incremental, **implement-as-needed**. Early phases are detailed; later phases are intentionally light and
get fleshed out when we reach them. Design records live under [`docs/architecture/`](docs/architecture/).

> **Scope discipline:** the processmanager track below is **runtime/ops tooling only**. Trading-domain
> work (money/decimal, validation, event-sourced orders, the kill-switch *behaviour*) is a **separate
> track** — see [`ARCHITECTURE.md §5`](ARCHITECTURE.md). The two only meet at named seams.

---

## Track A — processmanager (ops control plane)

Design: [`docs/architecture/processmanager.md`](docs/architecture/processmanager.md).

### Phase 1 — Supervisor + stdout sink + CLI (the loss-proof core) ← start here, keep light
- Roll-your-own `Bun.spawn` supervisor for `backend` + `frontend`: `start` / `stop` / `restart`.
- **stdout: pipe + non-blocking drain** (never `ignore`); durable **rotating NDJSON** log writer; PM's own
  logs tagged `service:"pm"`.
- Exit-code restart semantics (`0`/`1` → restart, `3`/intentional → no) + backoff + crash-loop guard.
- Autostart; graceful shutdown with a **flush grace-period** before `SIGKILL`; Windows tree-kill.
- Minimal **REST control API** (Hono, localhost) + a thin **CLI** (`tstrader start|stop|restart|status`).
- Light typed config to start (JSON5 layering can come in a later pass).
- **Child-app contract v1** (NDJSON stdout + `SIGTERM`→flush→exit 3) honoured by backend + frontend.

### Phase 2 — Diagnostics & status
- `OutputBuffer` ring per process; 5 s status sampling / history strip.
- Diagnostics DSL: `crashLooping`, `wedgeState`, `hints`, `exitMeaning`. `GET /status` snapshot.

### Phase 3 — Ops GUI (Svelte + Vite)
- Checkmate-style dashboard served by the daemon; WS push (snapshot-on-connect + `ProcessUpdate`) or poll.
- Reachable when the frontend is down (emergency view). Establishes the shared Svelte+Vite baseline.
- **Binds strictly `127.0.0.1`** — no off-box exposure until Phase 4 auth lands.

### Phase 4 — Remote access + auth (gate before off-box exposure)
- Network binding + **authentication** (+ TLS). Decision required here (was parked): auth scheme.
- Rationale: "control it when not near the computer" needs the GUI reachable remotely — safely.
- Only here does the daemon flip from localhost-only to network binding — and only once auth (+TLS) exists.

### Phase 5 — Graceful pause + child control contract
- REST control **into** children (pause/resume/stop) with **signal failover**; app-level quiesce.
- Promote the child-app contract into a small shared package consumed by daemon + apps.

### Phase 6 — Log-sink depth *(as needed)*
- Optional libSQL/queryable sink, retention/archival policy, in-GUI log viewer.

### Phase 7 — DevelopersCockpit *(as needed)*
- Tiered dev launcher (TS) — inner-loop / quality-gate / run&serve / health / housekeeping.
  Surface TBD: TUI, GUI tab, or both.

### Later / cross-track seam
- **Kill-switch**: the PM exposes the break-glass `pause`/`stop` seam; the *behaviour* (drawdown/error-rate
  triggers, cancel-all) is filled by the trading brainstorm — Track B/C.

---

## Track B — frontend (trading UI) *(next spec)*

Own brainstorm → spec → plan. Inherits the **Svelte + Vite** baseline set in Track A Phase 3; decides
whether the trading UI needs more (e.g. SvelteKit), charting, and the browser-safe `@repo/logger` seam
(ARCHITECTURE.md §3).

## Track C — trading domain *(separate brainstorm)*

The 12 forks in [`ARCHITECTURE.md §5`](ARCHITECTURE.md) — money/decimal, validation, event-sourced order
state machine + replay, kill-switch behaviour, idempotency/WAL, time authority, broker adapters, etc.
