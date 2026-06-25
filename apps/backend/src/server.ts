import { Hono } from "hono";

export function createHealthServer(service: string): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, service }));
  return app;
}
