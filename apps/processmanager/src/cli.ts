#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import type { ServiceStatus } from "./types.ts";

export function baseUrl(env: Record<string, string | undefined> = process.env): string {
  return `http://127.0.0.1:${env.PM_PORT ?? "4600"}`;
}

export function actionPath(
  action: "start" | "stop" | "restart",
  service: string | undefined,
): string {
  return `/services/${service ?? "all"}/${action}`;
}

export function formatStatus(statuses: ServiceStatus[]): string {
  if (statuses.length === 0) return "(no services)";
  return statuses
    .map(
      (s) =>
        `${s.name.padEnd(12)} ${s.state.padEnd(12)} pid=${s.pid ?? "-"} restarts=${s.restarts} contract=${s.contract}`,
    )
    .join("\n");
}

async function callAction(action: "start" | "stop" | "restart", service?: string): Promise<void> {
  const res = await fetch(`${baseUrl()}${actionPath(action, service)}`, { method: "POST" });
  if (!res.ok) {
    console.error(`error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`${action} ${service ?? "all"}: ok`);
}

const serviceArg = {
  service: { type: "positional", required: false, description: "service name (default: all)" },
} as const;

const status = defineCommand({
  meta: { name: "status", description: "show service status" },
  async run() {
    const res = await fetch(`${baseUrl()}/status`);
    if (!res.ok) {
      console.error(`error: ${res.status}`);
      process.exit(1);
    }
    const body = (await res.json()) as { services: ServiceStatus[] };
    console.log(formatStatus(body.services));
  },
});

const start = defineCommand({
  meta: { name: "start", description: "start a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("start", args.service as string | undefined);
  },
});

const stop = defineCommand({
  meta: { name: "stop", description: "stop a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("stop", args.service as string | undefined);
  },
});

const restart = defineCommand({
  meta: { name: "restart", description: "restart a service (or all)" },
  args: serviceArg,
  async run({ args }) {
    await callAction("restart", args.service as string | undefined);
  },
});

const main = defineCommand({
  meta: {
    name: "tstrader",
    description: "tstrader process control (REST client to the PM daemon)",
  },
  subCommands: { status, start, stop, restart },
});

// Only run the CLI when executed directly, not when imported by tests.
if (import.meta.main) {
  void runMain(main);
}
