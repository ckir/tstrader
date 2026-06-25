export type ServiceContract = "full" | "best-effort";

export interface ServiceDef {
  name: string;
  cmd: string[];
  cwd: string;
  contract: ServiceContract;
  autostart: boolean;
  /** extra env merged over the inherited environment for this child */
  env?: Record<string, string>;
}

export type ServiceState =
  | "stopped" // not running; no restart pending
  | "starting" // spawn issued, not yet confirmed
  | "running" // alive
  | "restarting" // exited unexpectedly, backoff timer pending
  | "crashlooped"; // restart guard tripped; will not auto-restart

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  pid: number | null;
  restarts: number;
  lastExitCode: number | null;
  contract: ServiceContract;
}

export interface LogRecord {
  /** ISO-8601; from the child line if present, else sink receive time */
  time: string;
  service: string;
  level: string;
  /** the structured fields if the line parsed as JSON, else { raw } */
  fields: Record<string, unknown>;
}

/** A single supervised process. The Supervisor depends on this interface (not Proc) so policy is testable. */
export interface IProc {
  readonly name: string;
  readonly pid: number | null;
  /** spawn the process; resolves once spawned */
  start(): Promise<void>;
  /** graceful stop: SIGTERM -> flush grace -> tree-kill; resolves once exited */
  stop(): Promise<void>;
  /** register the exit callback (code = process exit code, intentional = stop() was called) */
  onExit(cb: (code: number, intentional: boolean) => void): void;
}
