/** Build the OS tree-kill command, or null on posix where process.kill(SIGKILL) suffices. */
export function buildKillCommand(pid: number, platform: NodeJS.Platform): string[] | null {
  if (platform === "win32") return ["taskkill", "/PID", String(pid), "/T", "/F"];
  return null;
}

/** Force-kill a process tree. Best-effort: never throws. */
export async function treeKill(pid: number): Promise<void> {
  const cmd = buildKillCommand(pid, process.platform);
  try {
    if (cmd) {
      const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
      await proc.exited;
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // process may already be gone; ignore
  }
}
