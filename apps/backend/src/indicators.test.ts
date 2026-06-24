import { strict as assert } from "node:assert";
import { closes, sma } from "./indicators.ts";
import { describe, test } from "./test-harness.ts";

describe("sma", () => {
  test("computes a simple moving average", () => {
    assert.deepEqual(sma([1, 2, 3, 4], 2), [1.5, 2.5, 3.5]);
  });

  test("rejects a non-positive period", () => {
    assert.throws(() => sma([1, 2], 0), RangeError);
  });
});

describe("closes", () => {
  test("extracts close prices from candles", () => {
    assert.deepEqual(
      closes([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]),
      [1.5],
    );
  });
});
