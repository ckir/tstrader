# Coding Mandates — tstrader

Strict technical rules for implementing code in this repo. **All agents and contributors must follow them.**

> *Adapted from the ancestor MarketMonitor project — **build upon, don't port**. MM-specific assumptions
> (pnpm, `@ckir`, `packages/core`, the corelib filesystem junction, `ConfigManager.json5` wiring, TypeDoc)
> have been removed or remapped to tstrader.* Complements [`../MONOREPOARCHITECTURE.md`](../MONOREPOARCHITECTURE.md)
> §7 (run conventions) and the design records in [`../docs/architecture/`](../docs/architecture/).

## 0. Clarification before action

No prompt should be executed on assumption alone. Misreading intent and building the wrong thing wastes
far more time than pausing to verify.

- **Clarify before starting.** If a task is ambiguous (unclear scope, missing context, conflicting
  requirements, multiple valid interpretations), STOP before writing code and ask. Do not pick the most
  likely interpretation and proceed.
- **Pause mid-task on blockers.** If reality differs from assumptions (an API that doesn't exist, a file
  that doesn't match, an undiscussed design decision), STOP and surface it — don't invent a solution.
- **One question at a time**, with the options you've identified.
- **State your interpretation** before large/ambiguous work, so the user can correct course first.
- **No silent assumptions.** Any assumption affecting architecture, API shape, naming, or behaviour must
  be made explicit and confirmed or called out.
- **Do not proceed past a question** — wait for the answer; no fait-accompli alongside the question.

## 1. Code quality & linting

- All code MUST pass `bun run lint` (`biome check .`). Fixable issues: `bun run lint:fix`.
- Document exported members (functions, classes, public types) with JSDoc.
- **No incomplete work:** a Biome violation means the task isn't done. Fix before reporting success.

## 2. Error handling & logging

- Use corelib's logger (`@ckirg/corelib`). Each module takes a **child logger** for context:
  `const log = logger.child({ section: "<ClassName|file-basename>" });`
- **Serialize errors** before logging (e.g. via `serialize-error`):
  `log.error("Message", { error: serializeError(err) });`

## 3. Tooling & package management

- **Bun only** — never npm/pnpm/yarn. Use workspace filters (`bun --filter @repo/<pkg> …`) and turbo
  (`turbo run <task>`) for cross-workspace runs.

## 4. Type safety & exports

- **No `any`.** Use specific types, generics, or `unknown` + type guards.
- Export shared cross-app contracts from [`packages/types`](../packages/types)
  (`packages/types/src/index.ts`). There is **no** `packages/core`.

## 5. Task-completion workflow

The gate is **enforced by lefthook**, not by manually re-running everything:

- **pre-commit:** secretlint + Biome (fast).
- **pre-push:** `bun run gatekeeper` = `secure` → `sync:check` → `lint` → `sweep` → `typecheck` +
  `test:unit` (the heavy gate).

During iteration use targeted checks (`bun test <file>` or `vitest run <file>`, `tsc --noEmit`); let the
hooks run the full gate at commit/push. Tests run **cross-runtime** (vitest **and** `bun test`) via the
harness shim — a change is incomplete if it passes under only one runtime.

## 6. corelib access

corelib is the **published registry dependency `@ckirg/corelib`** (pinned). Read its real API from
`node_modules/@ckirg/corelib` (or the corelib repo) — do not assume its surface; inspect it. There is
**no** `.\corelib` junction (that was MM). Native-addon constraints: see
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §2.

## 7. Surgical updates

Prefer **targeted edits** over full-file rewrites on existing files, to preserve surrounding structure and
comments.

## 8. Test maintenance

Every code change MUST carry matching test updates. A passing suite with stale or missing tests is a
**failing** task.

- **Update** existing tests when a contract/inputs/outputs/side-effects change.
- **Add** tests for every new code path, branch, or mode. A feature without tests is incomplete.
- **Remove/replace** obsolete tests — dead tests create false confidence.
- **Mock completeness:** when a dependency gains a method the code-under-test calls, add it to the mock in
  every affected test file (for a logger mock, include **every level used, incl. `trace`/`debug`**) — for
  **both** vitest (`vi.mock("@ckirg/corelib")`) and `bun test`. A silent mock is a hidden gap.
- **Scope:** unit tests live in `src/**/*.test.ts`, one file per source module; property tests via
  `fast-check`. E2E (Playwright) targets `frontend`/`processmanager` — specs land with the feature.
- **No skipped tests** (`it.skip`/`xit`/`describe.skip`) to paper over failures. Fix the cause.

## 9. Documentation maintenance (multi-README)

- Docs span the root [`README.md`](../README.md) (conceptual hub: overview, cross-cutting contracts,
  package index) + a per-package README (package-internal runbook). Update the **right** one: a
  package-scoped change updates that package's README; a cross-cutting/contract change updates the root.
- **Move, don't duplicate** — root links down, packages link back; never repeat prose. Prefer relative
  links to source over pasted signatures (they rot). **Design records** go in `docs/architecture/`, not
  READMEs. A stale README is a failing task.

## 10. Configuration-driven defaults

- Externalize tunables to config (corelib `ConfigManager`), never hardcoded magic numbers. Document each
  value's purpose, unit, valid range, and cross-dependencies inline; provide a conservative in-code
  fallback consistent with the config value. Only truly invariant mathematical constants may be literals.
- *(tstrader has not yet adopted a config file — apply this mandate when one is introduced; revisit the
  exact wiring then.)*

## 11. Debug & trace logging

Decision-path and supervision modules MUST be instrumented so `LOG_LEVEL=trace` yields a complete,
machine-parseable record — enough to reconstruct the full decision chain from logs alone, without reading
source. Applies to trading/decision code (`apps/backend`) and supervision (`apps/processmanager`); not the UI.

| Level | Volume | Use for |
|---|---|---|
| `trace` | per-item | Every unit of work in a hot-path loop (per-symbol, per-rule, per-order step). |
| `debug` | per-cycle | Decisions, state transitions, per-cycle summaries (log old→new on transitions). |
| `info` | significant | Lifecycle transitions, fills, recovered errors — what an operator watches at default level. |

- Every hot-path handler opens and closes with a `debug` summary.
- Every per-item iteration emits a `trace` line with item identity + computed decision values.
- **No-op decisions still get a `trace` line** (explain the skip), so absence of action is explicit.
- Prefer structured extras (`{ mid, base, relPerf }`) over string interpolation for ≥2 numeric values.
- **Never** log per-cycle/per-item data at `info`.
