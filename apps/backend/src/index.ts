import { getVersion, isFfiAvailable, logger } from "@ckirg/corelib";

const ffi = isFfiAvailable();
logger.info(`[backend] up — corelib FFI available=${ffi} version=${ffi ? getVersion() : "n/a"}`);
