import { getVersion, isFfiAvailable, logger } from "@ckirg/corelib";

const ffi = isFfiAvailable();
logger.info(
  `[processmanager] up — corelib FFI available=${ffi} version=${ffi ? getVersion() : "n/a"}`,
);
