# TSTRADER | SYSTEM ARCHITECTURE & DEVELOPMENT SPECIFICATION
**Document Version:** 1.3.0
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
> Deleted `packages/db` — the database now comes directly from `@ckir/corelib`
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
│   ├── engine/                    # Core trading loop [Target: Bun | OS: Linux]
│   ├── dashboard/                 # Next.js / React UI [Target: Bun/Node | OS: Any]
│   └── e2e/                       # Playwright browser sandbox [Target: Node | OS: Linux CI]
├── packages/
│   ├── core/                      # Pure math, indicators [Target: Bun/Node | OS: Any]
│   └── types/                     # Exchange/Broker interfaces [Target: Agnostic]
│                                  # NOTE: no packages/db — database comes from @ckir/corelib (§11)
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

# External dependency (NOT vendored here): @ckir/corelib — separate pnpm+nx repo at
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
| **Dead Code Sweep** | Knip | `knip` | Reads `knip.json`; spawn-only entrypoints (engine/dashboard launched by e2e) are declared as `entry` so they are not flagged dead. |
| **Secrets Engine** | dotenvx | `dotenvx run -- <cmd>` | Encrypts `.env` for safe public commit; injects decrypted values at process runtime. Single pinned version — never via `bunx`. |
| **Secret Sweeper** | Secretlint | `secretlint` | Honors `.secretlintignore`; blocks commits containing unencrypted private keys or broker tokens. |
| **Versioning / Release** | Changesets | `changeset` / `changeset version` | Drives `release.yml`. Bun-compatible publish flow. |
| **Unit / Integration** | Vitest + MSW (Node/Bun) | `vitest` / `bun test` | See §4. MSW network interception parity across Bun vs. Node is a **matrix-verified** assumption, not assumed equal. |
| **Property Testing** | fast-check | imported in `*.prop.test.ts`; run by Vitest / `bun test` | Runner-neutral (works under both runners). Generates randomized inputs for `@repo/core` indicators — see §4. |
| **E2E Browser** | Playwright | `node .../cli.js` | Force-routed through Node.js to bypass Bun Windows UI-thread timeouts. |
| **Local Gatekeeper** | Lefthook | `lefthook` | Installed automatically (§10): listed in `trustedDependencies` **and** wired to a root `prepare` script so hooks land in `.git/hooks` on a fresh `bun install`. |

## 4. Runtime & Platform Target Matrix

| Workspace | Internal Name | Primary Runtime | Permitted Runtimes | Target OS | Local-on-Windows? |
| --- | --- | --- | --- | --- | --- |
| `apps/engine` | `@repo/engine` | Bun | Bun | Linux | No → WSL2 / CI (§8) |
| `apps/dashboard` | `@repo/dashboard` | Bun | Bun, Node | Windows, Linux, macOS | Yes |
| `apps/e2e` | `@repo/e2e` | Node | Node | Linux (CI), Windows (Local) | Yes |
| `packages/core` | `@repo/core` | Bun | Bun, Node | Agnostic | Yes |
| `packages/types` | `@repo/types` | n/a (types only) | Agnostic | Agnostic | Yes |
| *(external)* `@ckir/corelib` | `@ckir/corelib` | Bun/Node | Bun, Node | **linux-x64**, win32-x64, darwin-x64/arm64 | Yes (win32-x64 binary); engine → WSL2/CI (§11) |

### Multi-runtime test execution (replaces the v1.0.0 "single unified Vitest" claim)

Bun steers toward `bun test` rather than Vitest, so a single config cannot drive both runtimes.
Two layers differ and are handled separately:

- **Assertions** — use `node:assert/strict` exclusively. It is portable across both runtimes
  (native in Node; provided by Bun). Do **not** import `expect` from `vitest` (breaks under
  `bun test`) or from `bun:test` (breaks under Node).
- **Test declaration** (`test`/`describe`) — each runner supplies its own (`vitest` vs `bun:test`).
  A minimal internal `@repo/test-harness` shim re-exports the correct `test`/`describe` per runtime
  so `@repo/core` test files import one neutral module.

The shared suite is then executed by the **native runner per runtime**:

- **Node** → `vitest` (config: `vitest.workspace.ts`)
- **Bun** → `bun test`

> **Property-based testing (`fast-check`, §3):** `@repo/core` indicators/math are additionally
> exercised with randomized inputs (NaN, zero-tick, extreme spikes, ordering) to prove they never
> emit impossible states (negative balances, silent `NaN`) — unit tests only cover *imagined* cases.
> `fast-check` is runner-neutral, so the same `*.prop.test.ts` files run under both Vitest and
> `bun test` via the `@repo/test-harness` shim, and are matrix-verified like the rest of the suite.

> **Deno dropped (decided):** Deno is no longer a permitted runtime for `@repo/core`. This avoids
> the runner-neutrality cost and sidesteps Deno's weak NAPI support — relevant because the corelib
> database layer ships a native `.node` addon (§11) that Deno cannot reliably load.

## 5. Dependency Lifecycle & Single Version Policy

### Internal Package Resolution

All internal workspace linking must use the explicit workspace wildcard protocol:

```json
"dependencies": {
  "@repo/types": "workspace:*",
  "@repo/core": "workspace:*"
}
```

### External Dependency Addition

When adding a third-party package to a workspace, the engineer or agent must explicitly declare the target filter:

```bash
bun --filter @repo/engine add nanoid
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
- When asked to build or test a single package, use Turborepo filters: `turbo run test:unit --filter=@repo/core`.

> **Agent code-navigation (Serena / LSP MCP):** for any cross-workspace refactor (touching
> `apps/` + `packages/`), agents must prefer the **Serena MCP server** (LSP-backed) for *semantic*
> operations — `find symbol`, `find references`, `rename symbol` — over plain text search. Deterministic
> symbol resolution sharply reduces hallucinated/partial edits during renames and signature changes.
> This mirrors corelib's setup (Serena is already wired there).

## 8. Local Development Boundaries (DECIDED: engine is push-to-CI only)

`@repo/engine` targets Linux and is **not run locally at all** — neither on the Windows host nor in
WSL2. Engineers develop engine *code* locally (editing, typecheck, unit tests of pure logic) but
**execution/integration happens in CI** (§10). This keeps the host clean (Axiom 1) and avoids
maintaining a local Linux runtime.

- **Runs natively on the Windows host:** `@repo/core`, `@repo/types`, `@repo/dashboard`, and unit
  tests. On Windows the `win32-x64` corelib native binary is fetched, which is fine for these.
- **Runs only in CI:** `@repo/engine` (and any engine integration that needs the `linux-x64` corelib
  binary + live services). Push and let CI exercise it.

Implication: the engine inner loop is intentionally slower (CI round-trip). If that becomes painful,
revisit a WSL2 path — but that is **out of scope** by current decision.

## 9. Root Execution Map (`package.json`)

The top-level `package.json` exposes these strict, platform-agnostic automation scripts:

```json
{
  "scripts": {
    "prepare": "lefthook install",
    "dev:engine": "dotenvx run -- bun --filter @repo/engine start",
    "dev:dashboard": "dotenvx run -- bun --filter @repo/dashboard dev",
    "build": "turbo run build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "sync:check": "syncpack lint",
    "sync:fix": "syncpack fix",
    "sweep": "knip",
    "secure": "secretlint \"**/*\"",
    "typecheck": "turbo run typecheck",
    "test:unit": "turbo run test:unit",
    "test:e2e": "dotenvx run -- bun --filter @repo/e2e run test",
    "test:e2e:ui": "dotenvx run -- bun --filter @repo/e2e run test:ui",
    "dotenvx": "dotenvx",
    "gatekeeper": "bun run secure && bun run sync:check && bun run lint && bun run sweep && turbo run typecheck test:unit"
  },
  "trustedDependencies": ["lefthook", "@ckir/corelib"]
}
```

> **`@ckir/corelib` must be trusted (§11):** Bun blocks dependency `postinstall` scripts by default.
> corelib's postinstall downloads its native Rust binary, so without trusting it the binary is never
> placed and engine code throws "module not found" at runtime. Same failure class as lefthook.

> **Fail-fast ordering (was backwards in v1.0.0):** the gatekeeper now runs the cheap, deterministic
> gates first — secrets → version policy → lint → dead-code — before the expensive typecheck/test
> matrix. `sweep` (Knip) is now part of the **local** gatekeeper, not CI-only, so dead-code
> failures surface in seconds locally.

> **E2E invocation (Bun has no `exec` subcommand):** `bun --filter <pkg> run <script>` is the only
> valid form — `bun --filter @repo/e2e exec` would look for a script named `exec` and fail. The
> node-routed Playwright launch therefore lives **inside `apps/e2e/package.json`**, not the root:
> `"test": "node node_modules/@playwright/test/cli.js test"` and
> `"test:ui": "node node_modules/@playwright/test/cli.js test --ui"`. The root `test:e2e` wraps it
> with `dotenvx run` once; CI calls `bun run test:e2e` (no second wrap — see §6/§10).

## 10. Continuous Integration Cloud Pipeline

### Job 0 (shared bootstrap): corelib provisioning

Every job that installs dependencies must first provision corelib from `github.com/ckir/corelib`
(it is **not** on a registry — see §11.2). Steps:

1. Checkout `ckir/corelib` to a **sibling path** (`../corelib`), pinned to the exact **commit SHA**
   matching the version tstrader expects (§11.4).
2. Build it with **its own** toolchain (`pnpm install && pnpm build-all`). This pnpm invocation is
   corelib's, in a separate checkout — it does **not** violate tstrader's host "no pnpm" axiom (§7),
   which governs *tstrader's* workspace only. (For the tarball flow, also `pnpm pack` the needed
   packages here — §11.2.)
3. tstrader's `package.json` already resolves corelib via `file:../corelib/ts-core` (or the packed
   tarball), so the next step's install wires it up with no symlink hacks.

### Job 1: Clean Room Gatekeeper (Ubuntu)

- Provisions corelib (Job 0).
- Runs the install with the native binary provisioned in one shot — `@ckir/corelib` is in
  `trustedDependencies` (§9), so its `postinstall` fires during install; the env override defeats the
  CI self-skip:

  ```bash
  GITHUB_ACTIONS= MODE=production bun install --frozen-lockfile
  ```

- Runs `bun run secure`.
- Runs `bun run sync:check`.
- Runs `bun run lint`.
- Runs `bun run sweep`.

### Job 2: The Multi-Runtime Matrix

- **Trigger:** Requires Job 1 success.
- **Matrix Grid:** `os: [ubuntu-latest, windows-latest, macos-latest]` × `runtime: [bun, node]`.
- **Runner selection:** `bun → bun test`, `node → vitest` (§4) against the shared `@repo/core` suite. Runtimes are installed per-job on the runner (never on the local host — Axiom 1 is a *host* policy, not a CI policy).
- **Execution:** Runs `@repo/core` math/indicator tests across all 6 OS/Runtime permutations.

### Job 3: Headless Playwright Verification

- **Trigger:** Requires Job 1 success.
- **Environment:** `ubuntu-latest` inside standard Node.js runner.
- **corelib:** Provisions corelib (Job 0) with the **`linux-x64`** native binary — the only Linux arch corelib ships (§11).
- **Decryption:** Pulls `DOTENV_PRIVATE_KEY` to decrypt the **committed** encrypted `.env`.
- **Execution:** Spawns `@repo/dashboard` and `@repo/engine` in the background, runs full Chromium/WebKit/Firefox E2E sweeps against the live UI.

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
        "apps/e2e/**",
        "apps/dashboard/dist/**",
        "apps/engine/dist/**",
        ".env",
        "playwright.config.*"
      ],
      "outputs": ["apps/e2e/playwright-report/**", "apps/e2e/test-results/**"],
      "dependsOn": ["^build"]
    }
  }
}
```

> **E2E is cached on deterministic inputs (decided):** rather than `cache: false`, `test:e2e` hashes
> the e2e sources, the **built** dashboard/engine artifacts (`dist`), the encrypted `.env`, and the
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
| `@ckir/corelib` (ts-core) | **Database layer** (libSQL/Turso via `@libsql/client`, Postgres via `postgres`), logging (pino), scheduling (croner), plus a **native Rust addon** `corelib-rust.node`. |
| `@ckir/corelib-markets` (ts-markets) | Market data (yahoo-finance2, protobuf, websockets). |
| `@ckir/corelib-cloud` (ts-cloud) | Cloud deploy adapters (Cloudflare Workers / AWS Lambda / Cloud Run). |

> **Toolchain boundary:** corelib's pnpm/nx is **invisible** to tstrader — tstrader consumes corelib's
> *built output*, never its source workspaces. The package manager used to *produce* a package does
> not leak into the consumer. tstrader's "no pnpm, ever" axiom (§7) governs **tstrader's own
> workspace**; building corelib (a different repo) with its own pnpm is not a violation.

### 11.1 Database access (DECIDED: no `packages/db`)

The former `packages/db` is **deleted**. Workspaces import the database layer **directly** from
`@ckir/corelib`. *Tradeoff acknowledged:* this couples every DB consumer to corelib's client surface
and offers no internal seam for schema/migrations — if that coupling later bites, the remedy is to
reintroduce a thin `packages/db` adapter (Repository Pattern). For now, per decision, consumers use
corelib directly.

### 11.2 Consumption mechanism

corelib is **not published to a registry**. Two non-options to rule out first:

- A plain `github:ckir/corelib` dependency string **fails**: git dependencies resolve the
  *repo-root* `package.json` (the private `corelib-monorepo`), not the `ts-core/` subpackage — and
  Bun would also try to build the fetched repo, choking on corelib's internal `pnpm workspace:*`
  links.
- **`bun link` cannot be the CI mechanism.** If `package.json` pins a registry version, a strict
  `bun install --frozen-lockfile` tries the npm registry, **404s, and fails even if a link exists**
  — frozen installs ignore local symlinks.

**Declared (reproducible) resolution — what `package.json` records and what CI uses:**

- **If only `@ckir/corelib` (ts-core) is consumed:** use the `file:` protocol against a **sibling
  checkout** — `"@ckir/corelib": "file:../corelib/ts-core"`. ts-core has no `workspace:*` deps, so
  this resolves cleanly and is honored by `--frozen-lockfile`.
- **If `@ckir/corelib-markets`/`-cloud` are also consumed:** prefer **tarball pack** — build corelib,
  `pnpm pack` each needed package (pack **rewrites `workspace:*` → real versions**, which `file:` does
  not), then `bun add ./ckir-corelib-<ver>.tgz` (etc.). This is the closest equivalent to a real
  published install and the only mechanism that handles corelib's cross-package `workspace:*` links.

**Local `bun link` is an optional override, not the source of truth.** Engineers actively
co-developing corelib may `bun link` to get live edits without a rebuild/repack; this overlays the
declared `file:`/tarball resolution for their working tree only. The committed `package.json` always
carries the reproducible mechanism so fresh clones and CI work without any link.

**Reproducibility:** pin the corelib checkout to an exact **commit SHA** (matching the version whose
GitHub Release holds the native binary, §11.4) in both the sibling-checkout and tarball flows.

> **[DECISION — needs your confirmation]** This corrects the original "bun link in CI" plan, which
> cannot satisfy `--frozen-lockfile`. Confirm: do you consume **only `@ckir/corelib`** (→ `file:`
> sibling checkout) or **also `-markets`/`-cloud`** (→ tarball pack)?

### 11.3 Native Rust addon (`corelib-rust.node`) — the real constraints

`@ckir/corelib`'s `postinstall` downloads a prebuilt, **per-OS/arch** `.node` binary from corelib's
GitHub Releases (`v<version>`). This drives several hard rules:

1. **Bun blocks postinstall** → `@ckir/corelib` is in `trustedDependencies` (§9), or the binary is
   never placed and engine code throws at runtime.
2. **The postinstall self-skips in CI** (`if GITHUB_ACTIONS …`) and when `MODE=development`. Because
   corelib is trusted, the binary is provisioned **during install** — no separate fetch step — by
   running `GITHUB_ACTIONS= MODE=production bun install --frozen-lockfile` (§10, Job 1). Do **not**
   reverse-engineer corelib's internal paths to place the file manually.
3. **No `linux-arm64` binary exists.** Supported: `win32-x64`, `linux-x64`, `darwin-x64`,
   `darwin-arm64`. Therefore **`@repo/engine` deploys to `linux-x64` only** — Graviton/Ampere
   (arm64) Linux targets are **unsupported** until corelib ships an arm64 build.
4. **`MODE=development` foot-gun:** if a developer has `MODE=development` in their environment or a
   higher-level `.env`, local `bun install` silently skips the download → "module not found" at
   runtime. **Guardrail:** tstrader's `.env`/`.env.example` must never set `MODE=development`, and the
   engine should **fail fast with a clear error** if `corelib-rust.node` is absent rather than crash
   obscurely on first use.
5. **Deno is excluded** (§4) partly because it cannot reliably load this NAPI addon.
6. **Bun NAPI parity is matrix-verified, not assumed:** loading `corelib-rust.node` under Bun must be
   proven in CI, not taken on faith.

### 11.4 Version lockstep

`@ckir/corelib`, `@ckir/corelib-markets`, and `@ckir/corelib-cloud` are released together at one
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
- ✅ **§11 packages/db** — DECIDED: deleted; import `@ckir/corelib` directly (coupling tradeoff noted in §11.1).
- ⚠️ **§11.2 corelib consumption** — CORRECTED: your "bun link in CI" cannot satisfy `--frozen-lockfile` (registry 404). Now: `package.json` declares `file:`/tarball against a sibling checkout (reproducible); `bun link` is an optional **local** override. corelib pinned by commit SHA.
- ⏳ **§11.2 file: vs tarball** — confirm: consume **only `@ckir/corelib`** (→ `file:` sibling) or **also `-markets`/`-cloud`** (→ tarball pack)?
- ⏳ **§8 inner loop** — is WSL2 the sanctioned path for engine local dev, or is "push-to-CI only" acceptable? (open)
- ✅ **§12 supply-chain** — DECIDED (defense-in-depth): **Renovate** (updates, SVP/catalog-aware) + **Dependabot alerts** + **CodeQL** (SAST) + **Socket.dev** (malicious-pkg). Dependabot *version- AND security-updates* stay OFF (passive alerts only).
- ✅ **§3/§4 property testing** — DECIDED: add **fast-check** for `@repo/core` indicators (runner-neutral).
- ✅ **§7 agent navigation** — DECIDED: **Serena / LSP MCP** for semantic cross-workspace navigation.
- ✅ **tooling NOT added (YAGNI)** — `commitlint` (friction > value; note: Changesets changelogs are hand-written, *not* commit-derived, so it isn't strictly redundant — still skipped), `husky` (Lefthook already, Bun-safe), `eslint`/`prettier` (Biome covers both), `publint`/`@arethetypeswrong/cli` (internal `workspace:*` packages aren't npm-published).
- ⏳ **runtime validation lib** — DEFERRED (your call): **Zod** (Claude's lean — agent-familiarity) vs **ArkType** (agy's lean — perf) vs **Valibot** (smallest bundle), for trust-boundary validation. Revisit when boundary code is written.
