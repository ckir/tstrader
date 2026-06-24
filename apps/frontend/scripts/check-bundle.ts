// Build guard (frontend.md §5): assert corelib's native/server surface never
// reaches the client bundle — proof Vite resolved corelib's `browser` export
// condition. Run by `bun scripts/check-bundle.ts` after `vite build`.
import { Glob } from "bun";

const FORBIDDEN = ["corelib-rust", "@libsql"];
const glob = new Glob("dist/**/*.js");
const offenders: string[] = [];

for await (const file of glob.scan(".")) {
  const text = await Bun.file(file).text();
  for (const token of FORBIDDEN) {
    if (text.includes(token)) offenders.push(`${file}: contains "${token}"`);
  }
}

if (offenders.length > 0) {
  console.error("[check:bundle] FAIL — native/server surface leaked into client bundle:");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("[check:bundle] OK — no native addon / server surface in client bundle");
