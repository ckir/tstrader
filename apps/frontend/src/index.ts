import { logger } from "@ckirg/corelib";
import type { OrderIntent } from "@repo/types";

const sample: OrderIntent = { symbol: "AAPL", side: "buy", quantity: 1 };
logger.info(`[frontend] up — sample intent for ${sample.symbol} (${sample.side})`);
