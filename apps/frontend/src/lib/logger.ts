// Single app-wide logger entry point. In the Vite client build this resolves to
// corelib's `browser` export condition (zero-Node console logger; the native
// addon never enters the bundle). See docs/architecture/frontend.md §5.
import { logger } from "@ckirg/corelib";

export const log = logger.child({ app: "frontend" });
