// Cross-runtime test primitives: bun:test under `bun test`, vitest otherwise.
// Literal specifiers in each branch (NOT a variable) — vitest 4's module evaluator
// resolves a *variable* specifier as a relative path and fails; @vite-ignore stops
// vite from analysing the bun:test specifier at transform time.
//
// `expect` returns a concrete Matchers interface (named methods) rather than an index
// signature: the repo's `noUncheckedIndexedAccess` would make `Record<string, Fn>[key]`
// `Fn | undefined`, so `expect(x).toBe(...)` would be "invoke possibly undefined" (TS2722).
interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toContainEqual(expected: unknown): void;
  toThrow(expected?: unknown): void;
  toMatch(expected: unknown): void;
  toMatchObject(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeInstanceOf(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(key: string, value?: unknown): void;
  toBeCloseTo(expected: number, numDigits?: number): void;
  readonly not: Matchers;
  readonly resolves: Matchers;
  readonly rejects: Matchers;
}

interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Matchers;
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
