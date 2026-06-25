import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // proc.test.ts calls Bun.spawn which is unavailable in Node/vitest.
    // It is covered by test:unit:bun (bun test). Exclude it here.
    exclude: ["**/node_modules/**", "**/proc.test.ts"],
  },
});
