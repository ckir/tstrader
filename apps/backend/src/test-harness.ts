/**
 * Cross-runtime test primitives. Re-exports `test`/`describe` from whichever
 * runner is active so one shared suite runs under both Node (vitest) and Bun
 * (bun:test). Assertions use `node:assert/strict` directly (portable to both).
 */
type TestFn = (name: string, fn: () => void | Promise<void>) => void;

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const runner = isBun ? await import("bun:test") : await import("vitest");

// The two runners' `test`/`describe` signatures don't unify into a callable
// union, so narrow the shim to the minimal shape both satisfy.
export const test = runner.test as unknown as TestFn;
export const describe = runner.describe as unknown as TestFn;
