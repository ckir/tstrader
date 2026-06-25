// Cross-runtime test primitives (backend copy): bun:test under `bun test`, vitest otherwise.
// See apps/processmanager/src/test-harness.ts for full rationale (literal import() specifiers;
// concrete Matchers interface so noUncheckedIndexedAccess doesn't make matchers Fn|undefined).
interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toThrow(expected?: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toHaveLength(expected: number): void;
  readonly not: Matchers;
}

interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Matchers;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const mod = (isBun
  ? await import(/* @vite-ignore */ "bun:test")
  : await import("vitest")) as unknown as TestApi;

export const describe = mod.describe;
export const it = mod.it;
export const expect = mod.expect;
