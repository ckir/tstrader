# TSTRADER | SYSTEM ARCHITECTURE & DEVELOPMENT SPECIFICATION
**Document Version:** 1.4.0
**Classification:** Public Open-Source Algorithmic Trading Monorepo
**Primary Host Target:** Windows 11 (`pwsh`) [Uncluttered Host Policy]
**Execution Targets:** Bun (Primary), Node.js (E2E + cross-runtime packages)
**Deployment OS:** Linux (Ubuntu), macOS, Windows
**Source of Truth:** This file (`MONOREPOARCHITECTURE.md`)

> **Changelog 1.0.0 → 1.1.0** — Resolved secret-commit contradiction (§2/§6), made the
> local gatekeeper self-installing under Bun's security model (§3/§10), replaced the
> impossible "single Vitest config across 3 runtimes" claim with native per-runtime
> runners over a shared suite (§3/§4/§9), pinned the toolchain to satisfy SVP (§3/§5),
> closed the Turbo↔dotenvx cache-poisoning hole (§9), taught Knip about process-spawn
> boundaries (§9), reconciled the Windows host vs. Linux-only workspaces (§4/§8),
> fixed `bun --filter` typos and gatekeeper fail-fast ordering (§8). Post-review
> hardening: mandated `node:assert/strict` + a `@repo/test-harness` shim for true
> cross-runtime tests (§4), replaced the non-existent `bun ... exec` subcommand with
> `bun --filter run` + an `apps/e2e` script (§9), and removed the double-`dotenvx`
> wrap by making the root `test:e2e` script the single wrap point (§6/§9/§10).

> **Changelog 1.1.0 → 1.2.0** — Integrated the external **corelib** library as the
> database/runtime foundation (new §11). Dropped Deno from the matrix (now Bun×Node, 6
> permutations). Switched E2E from `cache:false` to deterministic-input caching (§10).
> Deleted `packages/db` — the database now comes directly from `@ckirg/corelib`
> (§2/§4/§8/§11). corelib is consumed via `bun link` locally and from
> `github.com/ckir/corelib` in CI; its native Rust addon and `MODE`/CI postinstall
> behavior drive new constraints (§11). Open forks marked **[DECISION]**.

> **Changelog 1.2.0 → 1.3.0** — Added a supply-chain & dependency-automation layer
> (new §12): **Renovate** (SVP/catalog-aware grouped update PRs), **Dependabot alerts**
> (passive CVE advisories; both version- and security-updates stay OFF so they don't collide with Renovate),
> **CodeQL** (SAST), and **Socket.dev** (malicious-package detection). Added **fast-check**
> property testing for `@repo/core` indicators (§3/§4/§5). Added a **Serena / LSP MCP**
> agent-navigation directive (§7). **Deferred** the runtime-validation library choice
> (Zod / ArkType / Valibot — Appendix A). Topology updated with `renovate.json`,
> `.github/dependabot.yml`, and `.github/workflows/codeql.yml` (§2).

> **Changelog 1.3.0 → 1.4.0** — Reconciled topology to the implemented walking skeleton:
> workspaces are now **apps/{backend,frontend,processmanager} + packages/types** — no
> `packages/core` (indicator logic lives in `apps/backend`) and no standalone `engine`/`dashboard`/`e2e`
> apps. All three apps consume **`@ckirg/corelib`** (scope renamed from `@ckir`; now published to npm
> `@0.1.22`) and use its `logger` as the **common logger** (§2/§4/§9/§11). §11.2 simplified to a plain
> **registry install** now that corelib is published — dropped the `file:`/tarball sibling-checkout +
> CI Job 0 machinery. §8 relaxed: all three apps **run locally on Windows** (corelib ships a win32-x64
> binary); CI still runs the full Linux/macOS matrix; deploy target stays **linux-x64**. Playwright now
> targets **frontend + processmanager** (§3/§4); detailed trading-loop / worker / e2e design is
> deferred to a dedicated brainstorming. CI action versions mirror corelib's pipeline (checkout@v6,
> setup-node@v6, oven-sh/setup-bun@v2, etc. — §10).

---

## 1. Architectural Axioms

1. **Zero Global Host Pollution:** The local Windows 11 environment is an ephemeral compute host. No global Node modules, Deno binaries, or OS-level injected environment variables are permitted. All tooling executes via local workspace binaries (resolved through the lockfile) — never globally installed.
2. **Single Version Policy (SVP):** A third-party dependency must resolve to the exact same semantic version across the entire DAG (Directed Acyclic Graph). Divergence is treated as a build failure. **SVP also covers the toolchain itself** (§5): every build/test tool is a pinned root `devDependency`.
3. **POSIX / Windows Shell Agnosticism:** Human contributors and autonomous agents are forbidden from writing platform-dependent shell logic (e.g., `export VAR=1` or `$env:VAR=1`). All package scripts must resolve natively via the embedded **Bun Shell**. Scripts run through Turborepo must contain **only program invocations** (no shell builtins, redirects, or `&&` chaining) — see §3 note on the Turbo executor.
4. **Compute Offloading:** Local execution is reserved for high-speed logic verification of runtime-agnostic code. Heavy browser compute, the multi-runtime matrix, Linux-only workspace execution, and release compilation happen inside the GitHub Actions cloud boundary (or local WSL2 — see §8).

---

## 2. Repository Topology

```text
tstrader/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # Matrix verification & Playwright E2E
│   │   ├── codeql.yml             # CodeQL SAST (public-repo code scanning)
│   │   └── release.yml            # Changesets versioning bot
│   └── dependabot.yml             # Dependabot ALERTS only (version- AND security-updates OFF — Renovate owns CVE remediation)
├── apps/
│   ├── backend/                   # API + trading/strategy logic + indicators [Target: Bun | Deploy: linux-x64]
│   ├── frontend/                  # UI (Playwright-tested) [Target: Bun/Node | OS: Any]
│   └── processmanager/            # Long-running workers/schedulers (corelib streaming/croner), Playwright-tested [Target: Bun | Deploy: linux-x64]
├── packages/
│   └── types/                     # Shared cross-app contracts (Candle, OrderIntent, …) [Target: Agnostic]
│                                  # NOTE: no packages/core — indicator logic lives in apps/backend
│                                  # NOTE: no packages/db — database comes from @ckirg/corelib (§11)
├── .env                           # Secrets, ENCRYPTED via dotenvx — COMMITTED to git
├── .env.keys                      # dotenvx private decryption keys — GITIGNORED (never committed)
├── .env.example                   # Public secret structural manifest
├── .secretlintignore              # Excludes node_modules / encrypted .env / fixtures from secret scan
├── .lefthook.yml                  # Local Git gatekeeper definitions
├── CLAUDE.md                      # Autonomous Agent behavioral rules
├── biome.json                     # Linter, formatter, and import sorter config
├── knip.json                      # Dead-code config (declares spawn-boundary entrypoints)
├── package.json                   # Root monorepo manifest, script router, pinned toolchain
├── renovate.json                  # Renovate config (SVP/catalog-aware, grouped update PRs)
├── syncpack.config.js             # Monorepo version synchronization rules
├── turbo.json                     # Task graph + cache input declarations (incl. env)
└── vitest.workspace.ts            # Node-runtime test configuration (see §4 for Bun)

# External dependency (NOT vendored here): @ckirg/corelib — separate pnpm+nx repo at
# github.com/ckir/corelib. Provides DB clients (libSQL + postgres) and a native Rust addon. See §11.
```

> **Secret-handling invariant (was a v1.0.0 contradiction):** `.env` is **committed** because
> dotenvx stores it as ciphertext (`encrypted:...`). `.env.keys` is the only secret artifact that
> is **gitignored**. CI decrypts the committed ciphertext using the `DOTENV_PRIVATE_KEY` GitHub
> Secret. If `.env` were gitignored, CI would have nothing to decrypt — that bug is now fixed.

## 3. The Toolchain Matrix

All tools below are **pinned root `devDependencies`** (§5) and invoked via `bun run <bin>` /
package scripts, which resolve the lockfile-pinned binary. `bunx` is **not** used in committed
scripts (it can fetch a floating "latest" and would violate SVP); it is permitted only for genuine
one-off, throwaway invocations that never enter `package.json` or CI.

| Domain | Selected Tool | Invocation Pattern | Platform & Runtime Guardrail |
| --- | --- | --- | --- |
| **Package Manager** | Bun Workspaces | `bun install` | Resolves `/` paths to `\` on Windows natively; uses a unified global store. |
| **Task Orchestration** | Turborepo | `turbo <task>` (pinned bin) | Caches DAG step outputs; prunes unchanged workspaces. Executor runs each script via the package manager — **keep package scripts shell-builtin-free** (Axiom 3). |
| **Lint / Format** | Biome | `biome <cmd>` | Single Rust binary; replaces ESLint/Prettier with 0 Node module bloat. |
| **Dep Alignment** | Syncpack | `syncpack <cmd>` | Enforces the Single Version Policy across all `package.json` files, internal and tooling. |
| **Dead Code Sweep** | Knip | `knip` | Reads `knip.json`; app entrypoints + Playwright specs are declared as `entry` so they are not flagged dead. |
| **Secrets Engine** | dotenvx | `dotenvx run -- <cmd>` | Encrypts `.env` for safe public commit; injects decrypted values at process runtime. Single pinned version — never via `bunx`. |
| **Secret Sweeper** | Secretlint | `secretlint` | Honors `.secretlintignore`; blocks commits containing unencrypted private keys or broker tokens. |
| **Versioning / Release** | Changesets | `changeset` / `changeset version` | Drives `release.yml`. Bun-compatible publish flow. |
| **Unit / Integration** | Vitest + MSW (Node/Bun) | `vitest` / `bun test` | See §4. MSW network interception parity across Bun vs. Node is a **matrix-verified** assumption, not assumed equal. |
| **Property Testing** | fast-check | imported in `*.prop.test.ts`; run by Vitest / `bun test` | Runner-neutral (works under both runners). Generates randomized inputs for `@repo/backend` indicators — see §4. |
| **E2E Browser** | Playwright | `node .../cli.js` | Targets **frontend + processmanager** (§4). Force-routed through Node.js to bypass Bun Windows UI-thread timeouts. |
| **Local Gatekeeper** | Lefthook | `lefthook` | Installed automatically (§10): listed in `trustedDependencies` **and** wired to a root `prepare` script so hooks land in `.git/hooks` on a fresh `bun install`. |

## 4. Runtime & Platform Target Matrix

| Workspace | Internal Name | Primary Runtime | Permitted Runtimes | Target OS | Local-on-Windows? |
| --- | --- | --- | --- | --- | --- |
| `apps/backend` | `@repo/backend` | Bun | Bun | Deploy: **linux-x64** | Yes (win32-x64 corelib binary) |
| `apps/frontend` | `@repo/frontend` | Bun | Bun, Node | Windows, Linux, macOS | Yes |
| `apps/processmanager` | `@repo/processmanager` | Bun | Bun | Deploy: **linux-x64** | Yes (win32-x64 corelib binary) |
| `packages/types` | `@repo/types` | n/a (types only) | Agnostic | Agnostic | Yes |
| *(external)* `@ckirg/corelib` | `@ckirg/corelib` | Bun/Node | Bun, Node | **linux-x64**, win32-x64, darwin-x64/arm64 | Yes (win32-x64 binary) |

### Multi-runtime test execution (replaces the v1.0.0 "single unified Vitest" claim)

Bun steers toward `bun test` rather than Vitest, so a single config cannot drive both runtimes.
Two layers differ and are handled separately:

- **Assertions** — use `node:assert/strict` exclusively. It is portable across both runtimes
  (native in Node; provided by Bun). Do **not** import `expect` from `vitest` (breaks under
  `bun test`) or from `bun:test` (breaks under Node).
- **Test declaration** (`test`/`describe`) — each runner supplies its own (`vitest` vs `bun:test`).
  A minimal `test-harness` shim (implemented at `apps/backend/src/test-harness.ts`) detects the runtime
  and re-exports the correct `test`/`describe` so the shared suite imports one neutral module.

The shared suite is then executed by the **native runner per runtime**:

- **Node** → `vitest` (config: `vitest.workspace.ts`)
- **Bun** → `bun test`

> **Property-based testing (`fast-check`, §3):** `@repo/backend` indicators/math are additionally
> exercised with randomized inputs (NaN, zero-tick, extreme spikes, ordering) to prove they never
> emit impossible states (negative balances, silent `NaN`) — unit tests only cover *imagined* cases.
> `fast-check` is runner-neutral, so the same `*.prop.test.ts` files run under both Vitest and
> `bun test` via the `test-harness` shim, and are matrix-verified like the rest of the suite.

> **Deno dropped (decided):** Deno is no longer a permitted runtime for `@repo/backend`. This avoids
> the runner-neutrality cost and sidesteps Deno's weak NAPI support — relevant because the corelib
> database layer ships a native `.node` addon (§11) that Deno cannot reliably load.

## 5. Dependency Lifecycle & Single Version Policy

### Internal Package Resolution

All internal workspace linking must use the explicit workspace wildcard protocol:

```json
"dependencies": {
  "@repo/types": "workspace:*"
}
```

### External Dependency Addition

When adding a third-party package to a workspace, the engineer or agent must explicitly declare the target filter:

```bash
bun --filter @repo/backend add nanoid
```

### Toolchain Pinning (SVP for build tools)

Every tool in §3 is added once, at the repo root, as a pinned `devDependency`:

```bash
bun add -D turbo biome syncpack knip @dotenvx/dotenvx secretlint vitest fast-check @changesets/cli lefthook
```

Syncpack lints these alongside application dependencies. Scripts call the pinned binary
(`turbo`, `biome`, …) — not `bunx <tool>` — so the lockfile is the single source of tool versions.

### Version Reconciliation

Before any PR can be opened, the developer/agent must execute:

```bash
bun run sync:fix && bun install
```

## 6. Cryptographic Secrets Protocol (`dotenvx`)

Because `tstrader` is public, live API keys must be handled via **Secrets-as-Code Encryption**.

1. **Local State:** Engineer edits `.env` locally with real broker credentials (plaintext, on disk only).
2. **Encryption Step:** Engineer/Agent executes (pinned binary, not `bunx`):

   ```bash
   bun run dotenvx -- encrypt
   ```

3. **Commit Manifest:**
   - `.env` (now containing `encrypted:PV7b...` ciphertext) **is committed** to GitHub. It is *not* gitignored.
   - `.env.keys` (containing the local private decryption key) is **gitignored** and rejected if staged.
   - `.env.example` (blank structural manifest) is committed.
4. **CI Ingestion:** The cloud runner holds a single GitHub Secret (`DOTENV_PRIVATE_KEY`). It decrypts the committed `.env` ciphertext and injects values by invoking the **root script**, which already wraps `dotenvx run` exactly once (see §9 — do not double-wrap):

   ```bash
   bun run test:e2e
   ```

> **Why `.env` is safe to commit:** without `.env.keys` (gitignored) or `DOTENV_PRIVATE_KEY`
> (a GitHub Secret), the committed ciphertext is inert. This is the entire point of dotenvx and
> the reason the v1.0.0 "gitignore `.env`" line was a bug.

## 7. Autonomous Agent Directives (`CLAUDE.md`)

When Claude Code attaches to this workspace, it is bound by the following operational overrides:

- **DO NOT** use `npm`, `pnpm`, or `yarn`. Ever.
- **DO NOT** attempt to install global packages via `bun add -g`.
- **DO NOT** write Windows PowerShell or Linux Bash specific wrappers. Use standard Bun shell syntax, and keep Turbo-invoked scripts free of shell builtins (Axiom 3).
- **DO NOT** introduce `bunx <tool>` into committed scripts — add the tool as a pinned root `devDependency` and call its binary (§5).
- **DO NOT** touch `.env.keys`, and **DO NOT** gitignore `.env`. If a new secret is needed: add the blank key to `.env.example`, put a dummy test value in `.env`, then run `bun run dotenvx -- encrypt` and commit the encrypted `.env`.
- When asked to build or test a single package, use Turborepo filters: `turbo run test:unit --filter=@repo/backend`.

> **Agent code-navigation (Serena / LSP MCP):** for any cross-workspace refactor (touching
> `apps/` + `packages/`), agents must prefer the **Serena MCP server** (LSP-backed) for *semantic*
> operations — `find symbol`, `find references`, `rename symbol` — over plain text search. Deterministic
> symbol resolution sharply reduces hallucinated/partial edits during renames and signature changes.
> This mirrors corelib's setup (Serena is already wired there).

## 8. Local Development Boundaries (DECIDED: all apps run locally on Windows)

Because `@ckirg/corelib` ships a **win32-x64** native binary, all three apps — `@repo/backend`,
`@repo/frontend`, `@repo/processmanager` — **run locally on the Windows host** (editing, typecheck,
unit/property tests, and execution). This supersedes the earlier "engine is push-to-CI only" rule;
there is no longer a Linux-only `engine` workspace.

- **Runs natively on the Windows host:** all apps + `@repo/types` + the full unit/property suite. The
  `win32-x64` corelib binary is provisioned during `bun install`.
- **CI still owns the full matrix:** the Linux/macOS × Bun/Node permutations and headless Playwright
  run in GitHub Actions (§10), not on the host.
- **Deploy target is `linux-x64`** for `@repo/backend` and `@repo/processmanager` (corelib ships no
  `linux-arm64` binary — §11.3). Live broker integration needing real services still runs in CI.

## 9. Root Execution Map (`package.json`)

The top-level `package.json` exposes these strict, platform-agnostic automation scripts:

```json
{
  "scripts": {
    "prepare": "lefthook install",
    "dev:backend": "dotenvx run -- bun --filter @repo/backend start",
    "dev:frontend": "dotenvx run -- bun --filter @repo/frontend dev",
    "dev:processmanager": "dotenvx run -- bun --filter @repo/processmanager start",
    "build": "turbo run build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "sync:check": "syncpack lint",
    "sync:fix": "syncpack fix",
    "sweep": "knip",
    "secure": "secretlint \"**/*\"",
    "typecheck": "turbo run typecheck",
    "test:unit": "turbo run test:unit",
    "test:e2e": "dotenvx run -- turbo run test:e2e",
    "test:e2e:ui": "dotenvx run -- turbo run test:e2e:ui",
    "dotenvx": "dotenvx",
    "gatekeeper": "bun run secure && bun run sync:check && bun run lint && bun run sweep && turbo run typecheck test:unit"
  },
  "trustedDependencies": ["lefthook", "@ckirg/corelib"]
}
```

> **`@ckirg/corelib` must be trusted (§11):** Bun blocks dependency `postinstall` scripts by default.
> corelib's postinstall downloads its native Rust binary, so without trusting it the binary is never
> placed and app code throws "module not found" at runtime. Same failure class as lefthook.

> **Fail-fast ordering (was backwards in v1.0.0):** the gatekeeper now runs the cheap, deterministic
> gates first — secrets → version policy → lint → dead-code — before the expensive typecheck/test
> matrix. `sweep` (Knip) is now part of the **local** gatekeeper, not CI-only, so dead-code
> failures surface in seconds locally.

> **E2E invocation (Bun has no `exec` subcommand):** the node-routed Playwright launch lives **inside
> each app's `package.json`** (`apps/frontend`, `apps/processmanager`) as a `test:e2e` script —
> `"test:e2e": "node node_modules/@playwright/test/cli.js test"` — never as a root `bun --filter … exec`
> (Bun would look for a script literally named `exec` and fail). The root `test:e2e` fans out via
> `turbo run test:e2e` wrapped in `dotenvx run` **once**; CI calls `bun run test:e2e` (no second wrap —
> §6/§10). Exact Playwright targets/specs for frontend + processmanager are deferred to a brainstorming.

## 10. Continuous Integration Cloud Pipeline

All jobs use the corelib action pins mirrored from corelib's own pipeline: `actions/checkout@v6`,
`oven-sh/setup-bun@v2`, `actions/setup-node@v6` (node 24), `actions/upload-artifact@v7` /
`download-artifact@v8`, `softprops/action-gh-release@v2`.

### Job 1: Clean-Room Gatekeeper (Ubuntu)

corelib is now a **published npm package** (`@ckirg/corelib` — §11.2), so there is **no Job 0 /
sibling checkout**. The install is a plain registry install; because `@ckirg/corelib` is in
`trustedDependencies` (§9) its postinstall fetches the native binary during install, and the env
override defeats the CI self-skip:

```bash
GITHUB_ACTIONS= MODE=production bun install --frozen-lockfile
```

- `checkout@v6` → `setup-bun@v2` → `setup-node@v6` (node 24).
- Runs `bun run secure` → `sync:check` → `lint` → `sweep` (fail-fast order).

### Job 2: The Multi-Runtime Matrix

- **Trigger:** requires Job 1.
- **Matrix Grid:** `os: [ubuntu-latest, windows-latest, macos-latest]` × `runtime: [bun, node]`.
- **Runner selection:** `bun → bun test`, `node → vitest` (§4) against the shared `@repo/backend`
  suite. Runtimes are installed per-job on the runner (Axiom 1 is a *host* policy, not a CI policy).

### Job 3: Headless Playwright Verification

- **Trigger:** requires Job 1.
- **Environment:** `ubuntu-latest`; provisions the **`linux-x64`** corelib binary during install.
- **Decryption:** pulls `DOTENV_PRIVATE_KEY` to decrypt the **committed** encrypted `.env`.
- **Execution:** runs `bun run test:e2e` (Playwright for **frontend + processmanager**). Exact specs
  are deferred to the e2e brainstorming.

### Cache Correctness (Turbo ↔ dotenvx)

`turbo.json` must declare environment dependencies so runtime-injected secrets/flags participate in
the cache key, preventing stale "pass" results:

```json
{
  "globalDependencies": [".env", ".env.example"],
  "globalEnv": ["DOTENV_PRIVATE_KEY"],
  "tasks": {
    "test:unit": { "env": ["NODE_ENV", "APP_ENV"] },
    "test:e2e": {
      "env": ["NODE_ENV", "APP_ENV"],
      "inputs": [
        "apps/frontend/**",
        "apps/processmanager/**",
        ".env",
        "playwright.config.*"
      ],
      "outputs": ["**/playwright-report/**", "**/test-results/**"],
      "dependsOn": ["^build"]
    }
  }
}
```

> **E2E is cached on deterministic inputs (decided):** rather than `cache: false`, `test:e2e` hashes
> the e2e sources, the **built** frontend/processmanager artifacts, the encrypted `.env`, and the
> Playwright config, and depends on upstream `build`. Determinism is enforced at the test layer:
> Playwright pins browser versions, network is mocked/seeded (no live broker calls in E2E — those
> stay in dedicated live-integration runs), and clocks/seeds are fixed. Any non-determinism that
> surfaces (e.g. a flaky external dependency) must be quarantined or stubbed, not "solved" by
> disabling the cache.

## 11. External Core Library (`corelib`) Integration

`tstrader` is **powered by corelib**, a *separate* repository at `github.com/ckir/corelib`. corelib
is its own **pnpm@11 + nx** monorepo (private root `corelib-monorepo`) that builds with `tsup` and
publishes three packages, all version-locked together:

| Package | Role in tstrader |
| --- | --- |
| `@ckirg/corelib` (ts-core) | **Database layer** (libSQL/Turso via `@libsql/client`, Postgres via `postgres`), logging (pino), scheduling (croner), plus a **native Rust addon** `corelib-rust.node`. |
| `@ckirg/corelib-markets` (ts-markets) | Market data (yahoo-finance2, protobuf, websockets). |
| `@ckirg/corelib-cloud` (ts-cloud) | Cloud deploy adapters (Cloudflare Workers / AWS Lambda / Cloud Run). |

> **Toolchain boundary:** corelib's pnpm/nx is **invisible** to tstrader — tstrader consumes corelib's
> *built output*, never its source workspaces. The package manager used to *produce* a package does
> not leak into the consumer. tstrader's "no pnpm, ever" axiom (§7) governs **tstrader's own
> workspace**; building corelib (a different repo) with its own pnpm is not a violation.

### 11.1 Database access (DECIDED: no `packages/db`)

The former `packages/db` is **deleted**. Workspaces import the database layer **directly** from
`@ckirg/corelib`. *Tradeoff acknowledged:* this couples every DB consumer to corelib's client surface
and offers no internal seam for schema/migrations — if that coupling later bites, the remedy is to
reintroduce a thin `packages/db` adapter (Repository Pattern). For now, per decision, consumers use
corelib directly.

### 11.2 Consumption mechanism

corelib is **published to npm** as three public packages under the `@ckirg` scope (the `@ckir` scope was
owned by a different account; the rename to `@ckirg` is what finally unblocked publishing). tstrader
consumes them as **ordinary registry dependencies** — no sibling checkout, no `file:`/tarball, no Job 0.

**Declared resolution — what `package.json` records and what CI uses:**

- Pin exact registry versions, e.g. `"@ckirg/corelib": "0.1.22"` (add `-markets`/`-cloud` if/when
  consumed). A strict `bun install --frozen-lockfile` resolves them from npm normally.
- `@ckirg/corelib-markets` pulls `@gadicc/yahoo-finance2` via **jsr**, so *only if `-markets` is
  consumed* the root `.npmrc` needs `@jsr:registry=https://npm.jsr.io`.
- `@ckirg/corelib` is in `trustedDependencies` (§9) so its postinstall fetches the native binary (§11.3).

**Local `bun link` is an optional override, not the source of truth.** Engineers co-developing corelib
may `bun link` for live edits; the committed `package.json` always carries the reproducible registry pin
so fresh clones and CI work without any link.

**Reproducibility:** pin an exact corelib version (e.g. `0.1.22`); its GitHub Release holds the matching
native binary (§11.4), and the lockfile pins the rest.

> **[RESOLVED]** This supersedes the earlier `file:`/tarball + commit-SHA plan, which existed only
> because corelib was unpublished. The walking skeleton consumes **only `@ckirg/corelib`**; add
> `-markets`/`-cloud` (+ the `@jsr` `.npmrc` line) when those features are built.

### 11.3 Native Rust addon (`corelib-rust.node`) — the real constraints

`@ckirg/corelib`'s `postinstall` downloads a prebuilt, **per-OS/arch** `.node` binary from corelib's
GitHub Releases (`v<version>`). This drives several hard rules:

1. **Bun blocks postinstall** → `@ckirg/corelib` is in `trustedDependencies` (§9), or the binary is
   never placed and engine code throws at runtime.
2. **The postinstall self-skips in CI** (`if GITHUB_ACTIONS …`) and when `MODE=development`. Because
   corelib is trusted, the binary is provisioned **during install** — no separate fetch step — by
   running `GITHUB_ACTIONS= MODE=production bun install --frozen-lockfile` (§10, Job 1). Do **not**
   reverse-engineer corelib's internal paths to place the file manually.
3. **No `linux-arm64` binary exists.** Supported: `win32-x64`, `linux-x64`, `darwin-x64`,
   `darwin-arm64`. Therefore **`@repo/backend` and `@repo/processmanager` deploy to `linux-x64` only** —
   Graviton/Ampere (arm64) Linux targets are **unsupported** until corelib ships an arm64 build.
4. **`MODE=development` foot-gun:** if a developer has `MODE=development` in their environment or a
   higher-level `.env`, local `bun install` silently skips the download → "module not found" at
   runtime. **Guardrail:** tstrader's `.env`/`.env.example` must never set `MODE=development`, and the
   apps should **fail fast with a clear error** if `corelib-rust.node` is absent rather than crash
   obscurely on first use.
5. **Deno is excluded** (§4) partly because it cannot reliably load this NAPI addon.
6. **Bun NAPI parity:** loading `corelib-rust.node` under Bun is **verified** (tested upstream); CI
   re-confirms it in the matrix.

### 11.4 Version lockstep

`@ckirg/corelib`, `@ckirg/corelib-markets`, and `@ckirg/corelib-cloud` are released together at one
version, and the native binary's GitHub Release tag tracks that version. Whatever ref CI pins (§11.2)
must be a single consistent point for all three packages **and** the matching `.node` release.

---

## 12. Supply-Chain Security & Dependency Automation

Because `tstrader` is a **public** repository running **money-touching** logic, dependency hygiene is
a first-class concern handled by a **layered, non-overlapping** toolset. These run at the **CI /
GitHub-platform layer** (GitHub Apps / Actions / repo settings) — *not* as `bun run` binaries — so
they are intentionally exempt from the §3 "pinned root `devDependency`" rule.

| Layer | Tool | Role | Overlap guardrail |
| --- | --- | --- | --- |
| **Dependency update PRs** | **Renovate** | Opens **grouped** update PRs; configured to respect Bun **catalogs** + **Syncpack/SVP** (§2/§5) so a bump lands at one consistent version across the whole DAG. | Dependabot **version-updates** MUST stay **disabled** — running both produces duplicate, SVP-unaware PRs. |
| **Vulnerability advisories** | **Dependabot alerts** | Passive CVE advisories over the dependency graph (free GitHub setting). Renovate consumes these to prioritize security bumps. | **Passive alerts ONLY.** Dependabot has *two* PR engines — *version-updates* (`dependabot.yml`) **and** *security-updates* (repo Settings → Code Security toggle). **Both must be OFF**, or either will open PRs that collide with Renovate's own CVE remediation. |
| **Static analysis (SAST)** | **CodeQL** | GitHub-native code scanning (injection, unsafe patterns); free for public repos. Runs on PRs + a schedule. | — |
| **Malicious-package detection** | **Socket.dev** | GitHub App flagging obfuscated code, risky `install` scripts, and hijacked maintainers on PRs — the class CodeQL/Dependabot miss. Free for OSS. | — |

> **Why Renovate, not Dependabot, owns updates:** Renovate understands Bun catalogs and can be
> configured to honor the Single Version Policy (§2/§5) and **group** related bumps into one PR;
> Dependabot's version-updates fire one PR per package and are SVP-unaware. Dependabot's **alerts**
> are still used (passive, free). Both of Dependabot's *PR-opening* engines are turned off:
> *version-updates* (`dependabot.yml` carries no `version-updates` config) **and** *security-updates*
> (the repo Settings → Code Security toggle stays off). Both open PRs and would otherwise collide
> with Renovate, which handles CVE remediation itself via its vulnerability-alert config.

> **Deferred — runtime validation library (Appendix A):** validation of external/untrusted data at
> trust boundaries (broker payloads, decrypted `.env`, config) is a known requirement, but the
> library choice (**Zod** vs **ArkType** vs **Valibot**) is postponed to a future decision. Until
> then, boundary code should validate explicitly (narrowing + `node:assert/strict`) rather than
> trusting external shapes.

---

## Appendix A — Decision Log

- ✅ **§4 Deno** — DECIDED: Deno dropped. Matrix is Bun×Node (6 permutations).
- ✅ **§10 E2E caching** — DECIDED: cache enabled on deterministic inputs (built artifacts + e2e sources + encrypted `.env`).
- ✅ **§11 packages/db** — DECIDED: deleted; import `@ckirg/corelib` directly (coupling tradeoff noted in §11.1).
- ✅ **§2/§4 topology** — DECIDED: workspaces are **apps/{backend,frontend,processmanager} + packages/types** (no `packages/core`/`engine`/`dashboard`/`e2e`). Indicator logic lives in backend; all three apps use `@ckirg/corelib`'s `logger` as the common logger. Playwright targets frontend + processmanager.
- ✅ **§11.2 corelib consumption** — RESOLVED: corelib is **published to npm** (`@ckirg/corelib@0.1.22`), consumed as a plain registry dep; the earlier `file:`/tarball + sibling-checkout + commit-SHA + Job-0 plan is dropped. Skeleton consumes **only `@ckirg/corelib`**; add `-markets`/`-cloud` (+ `@jsr` `.npmrc`) when needed.
- ✅ **§8 inner loop** — RESOLVED: all three apps **run locally on Windows** (corelib win32-x64 binary); CI keeps the full Linux/macOS matrix; deploy target linux-x64. (WSL2 no longer needed.)
- ✅ **§12 supply-chain** — DECIDED (defense-in-depth): **Renovate** (updates, SVP/catalog-aware) + **Dependabot alerts** + **CodeQL** (SAST) + **Socket.dev** (malicious-pkg). Dependabot *version- AND security-updates* stay OFF (passive alerts only).
- ✅ **§3/§4 property testing** — DECIDED: add **fast-check** for `@repo/backend` indicators (runner-neutral).
- ✅ **§7 agent navigation** — DECIDED: **Serena / LSP MCP** for semantic cross-workspace navigation.
- ✅ **tooling NOT added (YAGNI)** — `commitlint` (friction > value; note: Changesets changelogs are hand-written, *not* commit-derived, so it isn't strictly redundant — still skipped), `husky` (Lefthook already, Bun-safe), `eslint`/`prettier` (Biome covers both), `publint`/`@arethetypeswrong/cli` (internal `workspace:*` packages aren't npm-published).
- ⏳ **runtime validation lib** — DEFERRED (your call): **Zod** (Claude's lean — agent-familiarity) vs **ArkType** (agy's lean — perf) vs **Valibot** (smallest bundle), for trust-boundary validation. Revisit when boundary code is written.
