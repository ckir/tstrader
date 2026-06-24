# frontend — Design Record

**Status:** design (spec-level; the app is a one-line stub today). Sequencing lives in [`/ROADMAP.md`](../../ROADMAP.md) Track B.
**Scope:** the **main, day-to-day** entry to tstrader — an internal, authenticated trading UI. This record fixes
the structural decisions (framework, transport, logging, styling) and the **v1 cut**; it does **not** freeze
data contracts, which co-develop with `backend`.
**Principle:** *build upon, don't port.* Same as the rest of the repo (Bun + `@ckirg/corelib`).

---

## 1. Role & positioning

- **frontend = the main entry** (normal operation); [`processmanager`](processmanager.md) = the out-of-band
  **emergency** entry. The two are complementary surfaces over the same system.
- The trading UI is **internal and authenticated** — no public pages, no SEO. All data is fetched
  **client-side**; there is no server-render need.
- **End-state** = a full interactive **cockpit** (observation **+** manual order entry/cancel **+** strategy
  start/stop). **v1** is a strict subset (see §2) so the UI never touches the money-path before the trading
  domain ([`ARCHITECTURE.md §5`](../../ARCHITECTURE.md), Track C) designs it.

## 2. Scope — incremental

| Increment | Contents | Depends on |
| --- | --- | --- |
| **v1 — Observation Deck (read-only)** | The Svelte app **shell** (left sidebar nav + main content, dark theme) + read-only views: positions, P&L, market data, strategy state, **process health** (from the PM). **No order entry.** | Nothing from Track C. Proves the whole foundation. |
| **v1.x — live + charts** | WS live updates wired through; charting added with the first data panel that needs it. | Charting lib (parked, §7). |
| **v2 — interactive cockpit** | Order entry/cancel, strategy start/stop — money-path panels layered onto the proven shell. | **Track C** contracts (money/decimal, validation, idempotency, order state machine). |

**First concrete deliverable:** the **shell** — a Svelte dashboard with a **left sidebar for navigation** and a
main content region. Sidebar sections start as placeholders and fill in as `backend` co-develops (candidate
IA: Overview · Positions · Orders · Strategies · Processes · Logs).

## 3. Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Framework | **Svelte + Vite SPA** (not SvelteKit) | Internal client-data tool: no SSR/SEO need. Identical stack to the PM ops-GUI (one Svelte baseline). Static-asset deploy, no server adapter. |
| Routing | **A tested client router** (e.g. `tinro` / `svelte-spa-router`) — **never hand-rolled** | agy's regret-risk for the SPA choice: hand-rolling routing/guards/data-loading reinvents SvelteKit's router badly. A real router library closes that gap. |
| Styling | **Tailwind CSS + a design-token layer** | Fast for dense, dark "Checkmate-style" ops UIs; themeable; no component lock-in; Svelte-5/runes agnostic. Shared baseline across **both** Svelte UIs. |
| Complex widgets | **Headless primitives** (Melt UI / Bits UI) **only when needed** | agy's regret-risk for Tailwind: data grids / comboboxes / date pickers are a time-sink in raw Tailwind. Adopt headless primitives at that point — don't hand-build them. |
| Logging | **Import `logger` from `@ckirg/corelib`** — rely on corelib's **`browser` export condition** | corelib already ships a zero-Node, addon-free console `StrictLogger` at its `browser` entry (see §5). No `@repo/logger` wrapper — that would reinvent the seam corelib already provides. Identical call-shape to backend/PM. |
| Charting | **Parked** (§7) | Arrives with the first panel that needs it, not in the shell. |

## 4. Data flow

Client-side only — **two upstreams**:

1. **REST** against **`backend`** (trading data: positions, P&L, market data, strategy state) **and**
   **`processmanager`** (process health/status). The deck shows both planes.
2. **WS** for **live incoming data** (push updates).

Contracts are **co-developed with `backend`** — not frozen by this record.

**Reaching two origins.** The SPA is static and has no backend-for-frontend, yet it must reach **two**
processes on different ports. Resolution:
- **Dev:** Vite's built-in **`server.proxy`** maps path prefixes (e.g. `/api/backend/*`, `/api/pm/*`,
  and the WS upgrade paths) to the two local processes — so the browser sees one origin and there are **no
  CORS concerns** in dev.
- **Prod:** a **reverse proxy** (Caddy/Nginx) fronts the static assets + both upstreams under one origin (the
  same single-origin model), **or** the two services enable scoped CORS. Tied to the deploy/auth decision
  (§7) — pinned then; the path-prefix convention above is fixed now so client code is proxy-agnostic.

**Insurance against state-sync rewrite (agy's flagged risk):** when WS messages are defined, shape them as
**typed, versioned events in [`packages/types`](../../packages/types)** (append-style vocabulary), and have the
deck **reduce events into view state** rather than swallow ad-hoc partial-state blobs. This keeps both the wire
contract and the UI reducer alive when Track C introduces event-sourced order state — the read-only deck and the
later interactive cockpit consume the same event shapes. (Building a real event *store* is Track C's job; v1 only
fixes the **wire shape**.)

## 5. The logger seam (resolved — no new package)

corelib's `package.json` declares export conditions:

```jsonc
"exports": { ".": { "browser": "./dist/browser.js", "default": "./dist/index.js" } }
```

- **`browser` entry** (`src/browser.ts`) exports **only** `StrictLogger`/`LogMethod` types, a console `logger`
  (zero Node deps, no native addon, no pino), and a flight-recorder helper.
- **`default` entry** (`src/index.ts`) exports the full surface incl. `./core` (the FFI native addon) and
  `./database`.

So a browser bundler (Vite, which applies the `browser` condition by default for client builds) resolves
`@ckirg/corelib` to the console logger automatically; Bun/Node resolve to full pino. **The frontend imports
`@ckirg/corelib` directly** — same as backend/PM.

**Hard rule (agy's pitfall — bundler resolution fragility):** a build-time guard MUST assert the **client bundle
contains no `corelib-rust` / native-addon reference** — i.e. proof Vite applied the `browser` condition. If the
`default` entry ever leaks into the browser build, the addon breaks the UI silently; the guard is the oracle that
catches it.

- corelib's browser logger reads `LOG_LEVEL` behind a `typeof process !== "undefined"` guard → defaults to
  `"info"` in the browser, **no `process` polyfill required** (the guard is the standard isomorphic-safe idiom:
  `process` is undefined at runtime, the branch short-circuits, esbuild/Vite do not error on `typeof process`).
  To **override** the browser log level (no env exists client-side), inject it via Vite **`define`** — that is
  the only knob, and it is optional.
- **Parked:** shipping browser logs to the PM/backend log sink. corelib's browser logger is console-only today;
  that is a later enhancement (frontend-side, or a corelib feature request) — not v1.

## 6. Relationship to the other surfaces

- **processmanager:** the deck reads PM status over REST/WS to show process health when the system is healthy;
  when the **frontend itself** is down, the **PM** ops-GUI is the emergency surface (that's the PM's job, not the
  frontend's). Both Svelte UIs share the Vite + Tailwind + corelib-logger baseline.
- **backend:** the primary data source; contracts co-develop. The money-path stays server-side until Track C.

## 7. Parked forks (decide when reached)

- **Charting library** — chosen with the first chart panel (candidates incl. lightweight-charts for price/series,
  or a general lib). Not in the shell.
- **Auth posture** — the frontend is the *main* entry, so its auth ties to the broader auth decision (PM
  [Phase 4](../../ROADMAP.md) network/auth + Track C secrets posture). Until then, dev runs locally.
- **WS reconnect / backfill** — snapshot-on-connect + replay-on-reconnect semantics (mirrors the PM SPA's parked
  reconnect-backfill fork).
- **Sidebar IA** — the concrete section list firms up as `backend` exposes real data.
- **Browser-log shipping to the sink** (§5).

## 8. Knowledge references

- corelib logger seam: `C:\Users\user\Development\Node\corelib\ts-core\src\browser.ts`,
  `src/loggers/implementations/browser.ts`, `src/loggers/common/index.ts`, and the `exports` map in
  `ts-core/package.json`.
- Shared Svelte+Vite baseline + Checkmate north-star: [`processmanager.md`](processmanager.md) §2–§3.
- Trading-domain dependencies for v2: [`ARCHITECTURE.md §5`](../../ARCHITECTURE.md).
