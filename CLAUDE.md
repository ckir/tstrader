# CLAUDE.md — tstrader

Complements the user's global `~/.claude` rules; repo-specific notes below.

**Personas:** routine/mechanical work → respond normally and terse. For **architecture / design /
review** tasks (or when asked to adopt a persona), read
`docs/architecture/AI_Personas_Routing.md` and adopt the matching persona (default: **Principal
Systems Architect**); full catalog in `docs/architecture/AI_Personas_Framework.md`. Do **not**
role-play for routine edits.

**Coding mandates:** when writing code, follow [`.agents/coding-mandates.md`](.agents/coding-mandates.md)
(MUST).

**Conventions:** see `MONOREPOARCHITECTURE.md` §7 (Bun only — no npm/pnpm/yarn; pinned root devDeps;
Bun-shell scripts; never touch `.env.keys`, never gitignore `.env`). **Project specifics:**
`ARCHITECTURE.md`.
