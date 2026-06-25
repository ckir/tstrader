import { createServer } from "./server.ts";
import { describe, expect, it } from "./test-harness.ts";
import type { ServiceStatus } from "./types.ts";

function stubSup() {
  const calls: string[] = [];
  const statuses: ServiceStatus[] = [
    {
      name: "backend",
      state: "running",
      pid: 101,
      restarts: 0,
      lastExitCode: null,
      contract: "full",
    },
  ];
  return {
    calls,
    sup: {
      statuses: () => statuses,
      status: (n: string) => statuses.find((s) => s.name === n) ?? null,
      start: async (n: string) => void calls.push(`start:${n}`),
      stop: async (n: string) => void calls.push(`stop:${n}`),
      restart: async (n: string) => void calls.push(`restart:${n}`),
      startAll: async () => void calls.push("startAll"),
      shutdownAll: async () => void calls.push("shutdownAll"),
    },
  };
}

describe("createServer", () => {
  it("GET /health → ok", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /status returns the service list", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/status");
    const body = (await res.json()) as { services: ServiceStatus[] };
    expect(body.services[0]!.name).toBe("backend");
  });

  it("POST /services/backend/restart calls restart", async () => {
    const { sup, calls } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/backend/restart", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toContain("restart:backend");
  });

  it("POST /services/all/stop fans out to shutdownAll", async () => {
    const { sup, calls } = stubSup();
    const app = createServer(sup as never);
    await app.request("/services/all/stop", { method: "POST" });
    expect(calls).toContain("shutdownAll");
  });

  it("unknown service → 404", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/nope/start", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("unknown action → 400", async () => {
    const { sup } = stubSup();
    const app = createServer(sup as never);
    const res = await app.request("/services/backend/frobnicate", { method: "POST" });
    expect(res.status).toBe(400);
  });
});
