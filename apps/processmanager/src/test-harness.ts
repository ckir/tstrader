// Cross-runtime test primitives: bun:test under `bun test`, vitest otherwise.
// Literal specifiers in each branch (NOT a variable) — vitest's module evaluator
// only resolves the branch it executes; @vite-ignore stops vite from analysing the
// bun:test specifier at transform time.
interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Record<string, (...args: unknown[]) => unknown>;
  beforeEach: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const mod = (isBun
  ? await import(/* @vite-ignore */ "bun:test")
  : await import("vitest")) as unknown as TestApi;

export const describe = mod.describe;
export const it = mod.it;
export const expect = mod.expect;
export const beforeEach = mod.beforeEach;
export const afterEach = mod.afterEach;
