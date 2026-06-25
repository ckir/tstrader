import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Specs that call Bun.spawn (via Proc) are unavailable in Node/vitest.
    // They are covered by test:unit:bun (bun test). Exclude them here.
    exclude: ["**/node_modules/**", "**/proc.test.ts", "**/daemon.smoke.test.ts"],
  },
});
