import type { Candle } from "@repo/types";

/** Simple moving average over a numeric series (window length `period`). */
export function sma(values: readonly number[], period: number): number[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError("period must be a positive integer");
  }
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
}

/** Extract closing prices from a candle series. */
export function closes(candles: readonly Candle[]): number[] {
  return candles.map((c) => c.close);
}
