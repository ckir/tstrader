import { treeKill } from "./kill.ts";
import { toRecord } from "./log-line.ts";
import type { IProc, LogRecord, ServiceDef } from "./types.ts";

type Spawned = ReturnType<typeof Bun.spawn>;

export class Proc implements IProc {
  readonly name: string;
  private child: Spawned | null = null;
  private exitCb: ((code: number, intentional: boolean) => void) | null = null;
  private intentional = false;

  constructor(
    private readonly def: ServiceDef,
    private readonly sink: { write: (r: LogRecord) => void },
    private readonly flushGraceMs: number,
  ) {
    this.name = def.name;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  onExit(cb: (code: number, intentional: boolean) => void): void {
    this.exitCb = cb;
  }

  async start(): Promise<void> {
    this.intentional = false;
    const [exe, ...args] = this.def.cmd;
    if (!exe) throw new Error(`[Proc] cmd is empty for service "${this.def.name}"`);
    const child = Bun.spawn({
      cmd: [exe, ...args],
      cwd: this.def.cwd,
      env: { ...process.env, LOG_PRETTY: "false", SERVICE_NAME: this.def.name, ...this.def.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.child = child;
    // Drain both streams continuously so the OS pipe never fills (MM hard-rule §5).
    void this.drain(child.stdout);
    void this.drain(child.stderr);
    void child.exited.then((code) => {
      this.child = null;
      this.exitCb?.(code, this.intentional);
    });
  }

  private async drain(
    stream: ReadableStream<Uint8Array> | number | undefined | null,
  ): Promise<void> {
    if (!stream || typeof stream === "number") return;
    const MAX_LINE = 64 * 1024; // flush a runaway newline-less line so a child can't OOM the daemon
    const decoder = new TextDecoder();
    let buf = "";
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.length > 0) this.sink.write(toRecord(line, this.def.name));
          nl = buf.indexOf("\n");
        }
        if (buf.length > MAX_LINE) {
          this.sink.write(toRecord(buf, this.def.name));
          buf = "";
        }
      }
      if (buf.trim().length > 0) this.sink.write(toRecord(buf, this.def.name));
    } finally {
      reader.releaseLock();
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.intentional = true;
    const pid = child.pid;
    child.kill("SIGTERM"); // posix: child can flush->exit 3; windows: terminates immediately
    const exited = child.exited;
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((res) => setTimeout(() => res(true), this.flushGraceMs)),
    ]);
    if (timedOut) {
      await treeKill(pid);
      await exited;
    }
  }
}
