// Controllable test child. Mode comes from argv[2]: "exit0" | "exit1" | "exit3" | "hang" | "sigterm3".
// Emits one NDJSON line and one raw line, then acts per mode.
const mode = process.argv[2] ?? "exit0";
process.stdout.write(
  `${JSON.stringify({ level: 30, time: new Date().toISOString(), msg: "child up", mode })}\n`,
);
process.stdout.write("a raw non-json line\n");

if (mode === "hang") {
  // Ignore SIGTERM/SIGINT so stop()'s flush-grace actually expires and treeKill runs.
  // (On Windows SIGTERM is uncatchable, so the child still dies immediately — graceful path is posix-only.)
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000); // stay alive
} else if (mode === "sigterm3") {
  process.on("SIGTERM", () => {
    process.stdout.write(`${JSON.stringify({ level: 30, msg: "flushed" })}\n`);
    process.exit(3);
  });
  setInterval(() => {}, 1000);
} else {
  const code = Number(mode.replace("exit", "")) || 0;
  process.exit(code);
}
