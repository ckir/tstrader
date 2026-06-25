import { createHealthServer } from "./server.ts";
import { describe, expect, it } from "./test-harness.ts";

describe("createHealthServer", () => {
  it("GET /health returns ok with the service name", async () => {
    const app = createHealthServer("backend");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("backend");
  });
});
