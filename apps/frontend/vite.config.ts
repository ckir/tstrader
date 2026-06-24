import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Dual-origin proxy (frontend.md §4): the SPA sees one origin in dev; path
// prefixes route to backend + processmanager. Ports are provisional until those
// services expose servers — the path-prefix convention is the stable contract.
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    proxy: {
      "/api/backend": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/backend/, ""),
      },
      "/api/pm": {
        target: "http://127.0.0.1:3002",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/pm/, ""),
      },
      "/ws/backend": {
        target: "ws://127.0.0.1:3001",
        ws: true,
        rewrite: (p) => p.replace(/^\/ws\/backend/, ""),
      },
      "/ws/pm": {
        target: "ws://127.0.0.1:3002",
        ws: true,
        rewrite: (p) => p.replace(/^\/ws\/pm/, ""),
      },
    },
  },
});
