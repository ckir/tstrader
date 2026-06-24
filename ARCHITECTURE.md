# TSTRADER — ARCHITECTURE DECISIONS

**Classification:** Public, Source-Available (Noncommercial — PolyForm NC 1.0.0) **Algorithmic Trading** Monorepo
**Base conventions:** see [`MONOREPOARCHITECTURE.md`](./MONOREPOARCHITECTURE.md) — the generic, reusable
modern-TypeScript-monorepo base (how this repo is *run*). **This file records only what is specific to
tstrader**: its workspaces, its external `corelib` foundation, and the open trading-domain design forks.
**Source of truth:** this file for *what tstrader is*; the base file for *how the monorepo operates*.

---

## 1. Workspaces & Roles

| Workspace | Internal name | Role | Primary runtime | Local on Windows | Deploy |
| --- | --- | --- | --- | --- | --- |
| `apps/backend` | `@repo/backend` | API + trading/strategy logic; indicator math (`sma`/`closes`) **currently** lives here (see fork §5) | Bun | Yes | **linux-x64** |
| `apps/frontend` | `@repo/frontend` | UI (Playwright-tested) | Bun/Node | Yes | Any |
| `apps/processmanager` | `@repo/processmanager` | Long-running workers/schedulers (corelib streaming/croner); intended host of the supervisor / kill-switch (fork §5) | Bun | Yes | **linux-x64** |
| `packages/types` | `@repo/types` | Shared cross-app contracts (`Candle`, `OrderIntent`, …) | n/a (types) | Yes | n/a |

All three apps run **locally on Windows** (corelib ships a `win32-x64` native binary); CI runs the full
Linux/macOS × Bun/Node matrix (base §10). Deploy target is **linux-x64** for `backend`/`processmanager`.

## 2. External Foundation: `@ckirg/corelib`

tstrader is **powered by corelib** — a *separate* repo at `github.com/ckir/corelib` (its own pnpm@11 + nx
monorepo) published to **public npm** under the `@ckirg` scope. Three packages, version-locked together:

| Package | Role in tstrader |
| --- | --- |
| `@ckirg/corelib` (ts-core) | **Database layer** (libSQL/Turso via `@libsql/client`, Postgres via `postgres`), logging (pino), scheduling (croner), plus a **native Rust N-API addon** `corelib-rust.node`. |
| `@ckirg/corelib-markets` (ts-markets) | Market data (yahoo-finance2 via jsr, protobuf, websockets). *(not yet consumed)* |
| `@ckirg/corelib-cloud` (ts-cloud) | Cloud deploy adapters (Cloudflare Workers / AWS Lambda / Cloud Run). *(not yet consumed)* |

**Consumption (registry install):** corelib is on npm, so tstrader consumes it as an ordinary pinned
registry dependency (`"@ckirg/corelib": "0.1.22"`). No `file:`/tarball, no sibling checkout. A strict
`bun install --frozen-lockfile` resolves it from npm. *(History: the `@ckir` scope was owned by another
account; the rename to `@ckirg` is what unblocked publishing.)*

**Native addon constraints (hard rules):**
1. **Bun blocks postinstall** → `@ckirg/corelib` MUST be in root `trustedDependencies`, or the binary is
   never placed and apps throw "module not found" at runtime.
2. **postinstall self-skips** under `GITHUB_ACTIONS` and `MODE=development`. CI provisions the binary during
   install (base §10). ⚠ FORK §5: the current `GITHUB_ACTIONS="" MODE=production` env-trick falsifies the
   CI flag for *all* tooling — prefer an explicit corelib opt-in (`CORELIB_FORCE_NATIVE`).
3. **No `linux-arm64` binary.** Supported: `win32-x64`, `linux-x64`, `darwin-x64`, `darwin-arm64`. So
   `backend`/`processmanager` deploy **linux-x64 only**; Apple-Silicon **Docker** dev and Graviton/Ampere
   prod are blocked until corelib cross-compiles arm64 (fix lives upstream in corelib's CI).
4. **`MODE=development` foot-gun:** never set it in tstrader's `.env`/`.env.example` (it silently skips the
   binary download). Apps should **fail fast** with a clear error if `corelib-rust.node` is absent.
5. **`@ckirg/corelib-markets`** pulls `@gadicc/yahoo-finance2` via **jsr** → if/when consumed, the root
   `.npmrc` needs `@jsr:registry=https://npm.jsr.io`.
6. **Version lockstep:** pin one exact corelib version; its GitHub Release holds the matching native binary.

## 3. Common Logger (decision)

All apps use corelib's pino `logger` as the **single common logger**.
⚠ **OPEN FORK (§5):** when `frontend` becomes a real UI (e.g. Next.js), importing `@ckirg/corelib` risks
bundling the native addon into the browser/edge build. Decouple via a browser-safe `@repo/logger` seam —
deferred until the frontend framework is chosen.

## 4. Testing & Runtime Matrix (this repo)

Per base §4, the shared suite runs under **both** Node (vitest) and Bun (`bun test`) via the runtime shim
at `apps/backend/src/test-harness.ts`; `fast-check` property tests guard the indicators. CI = 3 OS ×
{bun,node} (verified green in the cloud).
⚠ **OPEN FORK (§5):** the **bun×node** axis is only justified if a **Node production target** exists; the
**3-OS** axis is always valuable (per-OS native binary + Windows quirks). Revisit with the Bun-vs-Node
production-runtime decision. **Playwright** targets `frontend` + `processmanager` (specs deferred).

## 5. Open Domain-Design Forks (resolve in the trading brainstorm)

Surfaced by a Principal-Systems-Architect review but **intentionally not yet implemented** — they need
domain design, not skeleton code:

1. **Money representation — decimal, never float.** IEEE-754 `number` corrupts prices/qty/PnL. Use scaled
   `BigInt` minor-units (or `decimal.js`); encode in `packages/types` so floats can't reach money paths.
2. **Runtime validation** at broker REST/WS + decrypted-env boundaries (Zod / ArkType / Valibot — choice
   deferred). Broker payloads drift silently.
3. **Event-sourced order state machine + deterministic replay harness** — one execution path; live WS and
   historical CSV are just two data sources (backtest == live, same binary). Shape the event bus for this
   *before* writing the loop.
4. **`processmanager` kill-switch** — IPC heartbeat + error-rate/drawdown monitor → cancel-all via a
   separate **break-glass** API key; halt trading. Add a **paper-trading** mode flag.
5. **Order lifecycle correctness** — client-generated order IDs (idempotency) + a WAL/journal (corelib
   libSQL/redb) so a restart never double-submits.
6. **Time authority** — UTC everywhere, exchange sessions/holidays, DST, clock-skew vs exchange server
   time, monotonic timestamps. Wrap corelib's chrono/croner; no ad-hoc `Date.now()`.
7. **Broker/exchange adapters** — behind a port; MSW-mocked in tests; chaos cases (partial fills, rejects,
   timeouts, WS reconnect with sequence-gap detection, rate-limiting/backpressure).
8. **`packages/core` reconsideration** — move pure indicator math out of `backend` into a fuzzable
   workspace importable by `frontend` for charting *without* the execution engine; add import-boundary
   enforcement (Biome `noRestrictedImports` / dependency-cruiser). *(Reverses the current "no packages/core"
   choice — decision pending.)*
9. **Bun vs Node as the production runtime** for money-touching long-running processes (maturity vs speed).
10. **Frontend UI framework** (+ the logger decoupling in §3).
11. **Audit trail / flight recorder** (corelib Epic-4) — record every *decision*, not just logs.
12. **Secrets posture** — keep **real broker keys out of the repo** (Actions secrets / a vault); use
    dotenvx only for non-sensitive config; separate least-privilege keys (read-only data vs execution vs
    break-glass cancel-all). The committed encrypted `.env` currently holds **dummy** values only.

## 6. Decision Log (tstrader-specific)

- ✅ **Topology** — `apps/{backend,frontend,processmanager}` + `packages/types` (no standalone engine/dashboard/e2e; no `packages/core` *yet* — fork §5.8).
- ✅ **corelib** — consumed as the `@ckirg` published registry dep (`@0.1.22`); common logger across apps.
- ✅ **Local dev** — all three apps run on Windows; deploy linux-x64; CI owns the matrix (green in cloud).
- ✅ **Playwright** — targets frontend + processmanager (specs deferred).
- ⏳ **Trading domain** — all of §5 deferred to a dedicated brainstorming.
