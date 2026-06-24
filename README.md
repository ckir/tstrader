# tstrader

Algorithmic-trading monorepo, powered by [`@ckirg/corelib`](https://www.npmjs.com/package/@ckirg/corelib).
Public and **source-available for non-commercial use** — see [License](#license).

## Workspaces

| Workspace | Role |
| --- | --- |
| [`apps/frontend`](apps/frontend/README.md) | Trading UI — the system's **main entry**. |
| [`apps/backend`](apps/backend/README.md) | API + trading/strategy logic. |
| [`apps/processmanager`](apps/processmanager/README.md) | Ops control plane / out-of-band **emergency entry** (supervisor + log sink + CLI + GUI). |
| [`packages/types`](packages/types/README.md) | Shared cross-app contracts (`Candle`, `OrderIntent`, …). |

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — tstrader-specific decisions + open trading-domain forks
- [MONOREPOARCHITECTURE.md](MONOREPOARCHITECTURE.md) — generic monorepo base (how the repo is *run*)
- [ROADMAP.md](ROADMAP.md) — phased, implement-as-needed
- [docs/architecture/](docs/architecture/) — design records (e.g. [processmanager](docs/architecture/processmanager.md))

## Toolchain

Bun only — no npm/pnpm/yarn (see [MONOREPOARCHITECTURE.md §7](MONOREPOARCHITECTURE.md)).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for any **non-commercial** purpose. Commercial use
requires a separate license from the author. This is **not** an OSI open-source license.
