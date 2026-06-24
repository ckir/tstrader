# MODERN TYPESCRIPT MONOREPO — BASE ARCHITECTURE & CONVENTIONS

**Document Version:** Base 1.0.0 *(generalized from tstrader spec v1.4.0)*
**Scope:** A **reusable foundation** for any Bun + Turborepo TypeScript monorepo — *how the repo is run*.
**Project-specific decisions** (the actual apps, external dependencies, domain architecture) live in a
sibling **`ARCHITECTURE.md`**.
**Primary Host Target:** Windows 11 (`pwsh`) [Uncluttered Host Policy] — adapt per project.
**Execution Targets:** Bun (primary), Node.js (E2E + any Node deploy target).
**Source of Truth:** this file for *conventions*; `ARCHITECTURE.md` for *this project's decisions*.

---

## 1. Architectural Axioms

1. **Zero Global Host Pollution:** the local environment is an ephemeral compute host. No global Node
   modules or OS-injected env vars. All tooling executes via local workspace binaries (resolved through the
   lockfile) — never globally installed.
2. **Single Version Policy (SVP):** a third-party dependency resolves to the exact same version across the
   entire DAG; divergence is a build failure. **SVP also covers the toolchain** (§5): every build/test tool
   is a pinned root `devDependency`.
3. **POSIX / Windows Shell Agnosticism:** no platform-dependent shell logic in scripts (`export VAR=1` /
   `$env:VAR=1`). Package scripts resolve natively via the **Bun Shell**. Turbo-invoked scripts contain
   **only program invocations** (no shell builtins, redirects, or `&&` chaining).
4. **Compute Offloading:** local execution is for fast logic verification; the heavy multi-OS/runtime
   matrix, browser E2E, and release compilation happen in CI.

---

## 2. Repository Topology (pattern)

```text
<repo>/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # Gatekeeper + multi-OS/runtime matrix (+ E2E)
│   │   ├── codeql.yml             # CodeQL SAST (free on public repos)
│   │   └── release.yml            # Changesets versioning/publish bot
│   └── (Dependabot alerts are a repo SETTING — no dependabot.yml; Renovate owns updates, §11)
├── apps/                          # deployable applications        ← named in ARCHITECTURE.md
├── packages/                      # shared internal libraries (workspace:*) ← named in ARCHITECTURE.md
├── .env                           # secrets, ENCRYPTED via dotenvx — COMMITTED
├── .env.keys                      # dotenvx private keys — GITIGNORED (never committed)
├── .env.example                   # public structural manifest (keys only)
├── .secretlintrc.json / .secretlintignore
├── biome.json                     # lint + format
├── knip.json                      # dead-code config
├── lefthook.yml                   # local git gatekeeper
├── package.json                   # root manifest, script router, pinned toolchain
├── renovate.json                  # dependency-update automation (§11)
├── syncpack.config.mjs            # single-version-policy enforcement
├── tsconfig.base.json             # shared compiler options (extended by each workspace)
├── turbo.json                     # task graph + cache inputs (incl. env)
└── ARCHITECTURE.md                # ← project-specific decisions, external deps, domain design
```

> **Secret-handling invariant:** `.env` is **committed** because dotenvx stores ciphertext
> (`encrypted:…`). `.env.keys` is the only secret artifact that is **gitignored**. CI decrypts the
> committed ciphertext using the `DOTENV_PRIVATE_KEY` GitHub Secret. Keep **real** high-value secrets out
> of the repo entirely (Actions secrets / a vault) — see §6.

## 3. The Toolchain Matrix

All tools are **pinned root `devDependencies`** (§5), invoked via `bun run <bin>` / package scripts (never
`bunx` in committed scripts — it can fetch a floating "latest" and violate SVP).

| Domain | Tool | Invocation | Notes |
| --- | --- | --- | --- |
| **Package Manager** | Bun Workspaces | `bun install` | Unified store; native Windows path handling. |
| **Task Orchestration** | Turborepo | `turbo <task>` | Caches DAG outputs; keep scripts shell-builtin-free (Axiom 3). |
| **Lint / Format** | Biome | `biome check .` | Single Rust binary; replaces ESLint+Prettier. |
| **Dep Alignment** | Syncpack | `syncpack lint` | Enforces SVP across all `package.json`. |
| **Dead Code** | Knip | `knip` | Reads `knip.json`; auto-detects toolchain plugins. |
| **Secrets Engine** | dotenvx | `dotenvx run -- <cmd>` | Encrypts `.env` for safe commit; injects at runtime. |
| **Secret Sweeper** | Secretlint | `secretlint "**/*"` | Honors `.secretlintignore`. |
| **Versioning / Release** | Changesets | `changeset` | Drives `release.yml`. |
| **Unit / Integration** | Vitest + (optionally) `bun test` | `vitest` / `bun test` | See §4. |
| **Property Testing** | fast-check | `*.prop.test.ts` | Runner-neutral; randomized inputs. |
| **E2E Browser** | Playwright | `node …/cli.js` | Node-routed to avoid Bun Windows UI-thread timeouts. |
| **Local Gatekeeper** | Lefthook | `lefthook` | Auto-installed via the root `prepare` script + `trustedDependencies`. |

## 4. Multi-Runtime Test Execution

Bun steers toward `bun test`; Node uses `vitest`. A single config can't drive both, so:

- **Assertions** — use `node:assert/strict` exclusively (portable to both). Do **not** import `expect` from
  `vitest` (breaks under `bun test`) or `bun:test` (breaks under Node).
- **Test declaration** (`test`/`describe`) — provide a tiny **runtime-detecting shim** in a shared test
  module that re-exports the active runner's primitives (`isBun ? import("bun:test") : import("vitest")`),
  so one shared suite runs under both.
- **fast-check** is runner-neutral; `*.prop.test.ts` run under both via the same shim.

> **Right-size the matrix to deploy targets:** the **OS** axis (Linux/macOS/Windows) is broadly valuable
> (per-OS native binaries, Windows path quirks). The **runtime** axis (Bun×Node) is only worth its cost if
> the project actually deploys to **both** runtimes — otherwise test on the production runtime only. The
> project's runtime/OS matrix is declared in `ARCHITECTURE.md`.

> **Deno** is intentionally excluded from the default matrix (runner-neutrality cost + weak NAPI support).

## 5. Dependency Lifecycle & Single Version Policy

Internal linking uses the workspace protocol: `"@repo/<pkg>": "workspace:*"`. Add external deps with an
explicit filter: `bun --filter @repo/<app> add <pkg>`. Every §3 tool is pinned once at the root:

```bash
bun add -D turbo @biomejs/biome syncpack knip @dotenvx/dotenvx secretlint \
  @secretlint/secretlint-rule-preset-recommend vitest fast-check @changesets/cli lefthook
```

Scripts call the pinned binary (not `bunx <tool>`) so the lockfile is the single source of tool versions.
Before opening a PR: `bun run sync:fix && bun install`.

## 6. Cryptographic Secrets Protocol (`dotenvx`)

For public repos, handle config via **Secrets-as-Code Encryption**:

1. Edit `.env` locally with values.
2. `bun run dotenvx -- encrypt` → `.env` becomes ciphertext; `.env.keys` holds the private key.
3. Commit `.env` (ciphertext) + `.env.example` (blank manifest). **Never** commit `.env.keys` (gitignored,
   rejected if staged).
4. CI holds one `DOTENV_PRIVATE_KEY` Secret and decrypts at runtime via the root script (wraps `dotenvx run`
   exactly once — no double-wrap).

> **High-value secrets stay out of the repo.** dotenvx ciphertext in a public repo is permanent; if the
> private key ever leaks, *all historical values* are exposed. Keep genuinely sensitive credentials in a
> secrets manager / Actions secrets, use least-privilege + rotation, and reserve committed `.env` for
> low-sensitivity config.

## 7. Autonomous Agent Directives (`CLAUDE.md`)

- **DO NOT** use `npm`, `pnpm`, or `yarn`; **DO NOT** `bun add -g`.
- **DO NOT** write OS-specific shell wrappers; keep Turbo-invoked scripts shell-builtin-free (Axiom 3).
- **DO NOT** introduce `bunx <tool>` into committed scripts — pin the tool at the root and call its binary.
- **DO NOT** touch `.env.keys` or gitignore `.env`. New secret → add the key to `.env.example`, a dummy to
  `.env`, then `bun run dotenvx -- encrypt`.
- Build/test a single package via Turbo filters: `turbo run test:unit --filter=@repo/<pkg>`.

> **Agent code-navigation (Serena / LSP MCP):** for cross-workspace refactors prefer the Serena MCP server
> (LSP-backed `find references` / `rename symbol`) over text search — deterministic resolution sharply
> reduces hallucinated edits.

## 8. Local Development Boundaries

Run locally whatever the host platform supports; let CI own everything else. A workspace that targets a
platform the host can't satisfy (e.g. a Linux-only native dependency on a non-Linux host) develops *code*
locally (edit/typecheck/unit) but executes in CI. Which workspaces run where, and the deploy targets, are
declared per project in `ARCHITECTURE.md`.

## 9. Root Execution Map (`package.json`)

Generic script router (project-specific `dev:<app>` scripts are added per `ARCHITECTURE.md`):

```json
{
  "scripts": {
    "prepare": "lefthook install",
    "build": "turbo run build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "sync:check": "syncpack lint",
    "sync:fix": "syncpack fix-mismatches",
    "sweep": "knip",
    "secure": "secretlint \"**/*\"",
    "typecheck": "turbo run typecheck",
    "test:unit": "turbo run test:unit",
    "test:unit:bun": "turbo run test:unit:bun",
    "test:e2e": "dotenvx run -- turbo run test:e2e",
    "dotenvx": "dotenvx",
    "gatekeeper": "bun run secure && bun run sync:check && bun run lint && bun run sweep && turbo run typecheck test:unit"
  },
  "trustedDependencies": ["lefthook"]
}
```

> **Gatekeeper fail-fast order:** cheap deterministic gates first (secrets → version policy → lint →
> dead-code) before the expensive typecheck/test matrix. Lefthook runs a fast subset pre-commit and the
> full gatekeeper pre-push.

> **E2E invocation:** the node-routed Playwright launch lives **inside each app's** `package.json` as a
> `test:e2e` script (`node node_modules/@playwright/test/cli.js test`) — never a root `bun --filter … exec`
> (Bun has no `exec` subcommand). The root `test:e2e` fans out via `turbo run test:e2e` wrapped in
> `dotenvx run` once.

## 10. Continuous Integration Pipeline

Action pins (mirror a known-good baseline): `actions/checkout@v6`, `oven-sh/setup-bun@v2`,
`actions/setup-node@v6`, `actions/upload-artifact@v7` / `download-artifact@v8`,
`github/codeql-action@v3`, `softprops/action-gh-release@v2`.

- **Job 1 — Clean-Room Gatekeeper (Ubuntu):** `bun install --frozen-lockfile`, then `secure → sync:check →
  lint → sweep → typecheck`. *(If the project has a trusted native dependency, provisioning it during
  install is a project-specific concern — see `ARCHITECTURE.md`.)*
- **Job 2 — Matrix:** `os: [ubuntu, windows, macos]` × `runtime:` *(per project; default Bun)*; `bun → bun
  test`, `node → vitest`. Runtimes installed per-job (Axiom 1 is a *host* policy, not a CI policy).
- **Job 3 — E2E:** headless Playwright; decrypts the committed `.env` with `DOTENV_PRIVATE_KEY`.

> **Cache correctness:** `turbo.json` declares env/inputs (`globalDependencies: [".env"]`,
> `globalEnv: ["DOTENV_PRIVATE_KEY"]`) so runtime-injected secrets participate in the cache key and never
> yield stale "pass" results. E2E caches on deterministic inputs (built artifacts + specs + encrypted
> `.env`), not `cache:false`.

## 11. Supply-Chain Security & Dependency Automation

Layered, **non-overlapping** automation at the GitHub-platform layer (not `bun run` binaries):

| Layer | Tool | Role | Guardrail |
| --- | --- | --- | --- |
| Update PRs | **Renovate** | Grouped, SVP/catalog-aware update PRs; owns CVE remediation. | — |
| Vuln advisories | **Dependabot alerts** | Passive CVE advisories (repo setting). | **Both** Dependabot PR engines OFF — *version-updates* (`dependabot.yml`) **and** *security-updates* (Settings → Code Security) — or they collide with Renovate. |
| SAST | **CodeQL** | Code scanning; free on public repos (analyzes JS/TS source, no build needed). | — |
| Malicious packages | **Socket.dev** | Flags obfuscated code / risky install scripts / hijacked maintainers. | — |

## Appendix — Base Decisions

- ✅ **Biome** replaces ESLint+Prettier (one Rust binary).
- ✅ **Lefthook** over Husky (faster, Bun-safe postinstall).
- ✅ **Supply-chain:** Renovate (updates) + Dependabot alerts-only + CodeQL + Socket.dev.
- ✅ **fast-check** property testing alongside the unit suite.
- ✅ **Serena / LSP MCP** for agent code-navigation.
- ❌ **NOT added (YAGNI):** `commitlint` (friction > value), `husky`, `eslint`/`prettier`, and
  `publint`/`@arethetypeswrong/cli` (unless the repo publishes packages to npm).
- ⏳ **Runtime validation library** (Zod / ArkType / Valibot) — recommended at trust boundaries; the choice
  is a per-project decision (see `ARCHITECTURE.md`).

> **Project specifics — apps, external dependencies, domain architecture, and runtime/deploy targets — are
> defined in [`ARCHITECTURE.md`](./ARCHITECTURE.md).**
