/** Shared cross-app contracts for tstrader. Pure types only — no runtime code. */

export interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type Side = "buy" | "sell";

export interface OrderIntent {
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: number;
}
