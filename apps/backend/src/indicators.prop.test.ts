import { strict as assert } from "node:assert";
import fc from "fast-check";
import { sma } from "./indicators.ts";
import { describe, test } from "./test-harness.ts";

describe("sma properties", () => {
  test("a constant series yields that same constant", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 100 }),
        (value, period, extra) => {
          const series = Array.from({ length: period + extra }, () => value);
          const out = sma(series, period);
          assert.equal(out.length, series.length - period + 1);
          for (const v of out) {
            assert.ok(Math.abs(v - value) <= 1e-6 + Math.abs(value) * 1e-9);
          }
        },
      ),
    );
  });
});
