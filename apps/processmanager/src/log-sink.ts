import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { LogRecord } from "./types.ts";

export interface SinkOptions {
  dir: string;
  file: string;
  maxBytes: number;
  maxBackups: number;
}

/** Synchronous append-with-rotation NDJSON writer. Synchronous keeps the tail loss-proof on hard-kill. */
export class RotatingSink {
  private fd: number;
  private bytes: number;
  private readonly path: string;

  constructor(private readonly opts: SinkOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.path = join(opts.dir, opts.file);
    this.bytes = existsSync(this.path) ? statSync(this.path).size : 0;
    this.fd = openSync(this.path, "a");
  }

  write(record: LogRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);
    if (this.bytes + size > this.opts.maxBytes && this.bytes > 0) {
      this.rotate();
    }
    writeSync(this.fd, line);
    this.bytes += size;
  }

  private rotate(): void {
    closeSync(this.fd);
    // shift backups: drop oldest, then .N-1 -> .N ... .1 stays, active -> .1
    const oldest = join(this.opts.dir, `${this.opts.file}.${this.opts.maxBackups}`);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = this.opts.maxBackups - 1; i >= 1; i--) {
      const from = join(this.opts.dir, `${this.opts.file}.${i}`);
      const to = join(this.opts.dir, `${this.opts.file}.${i + 1}`);
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(this.path, join(this.opts.dir, `${this.opts.file}.1`));
    this.fd = openSync(this.path, "a");
    this.bytes = 0;
  }

  close(): void {
    closeSync(this.fd);
  }
}
