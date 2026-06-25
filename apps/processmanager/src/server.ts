import { Hono } from "hono";
import type { Supervisor } from "./supervisor.ts";

export function createServer(sup: Supervisor): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/status", (c) => c.json({ services: sup.statuses() }));

  app.post("/services/:name/:action", async (c) => {
    const name = c.req.param("name");
    const action = c.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      return c.json({ ok: false, error: `unknown action: ${action}` }, 400);
    }
    if (name === "all") {
      if (action === "start") await sup.startAll();
      else if (action === "stop") await sup.shutdownAll();
      else {
        await sup.shutdownAll();
        await sup.startAll();
      }
      return c.json({ ok: true, services: sup.statuses() });
    }
    if (!sup.status(name)) return c.json({ ok: false, error: `unknown service: ${name}` }, 404);
    if (action === "start") await sup.start(name);
    else if (action === "stop") await sup.stop(name);
    else await sup.restart(name);
    return c.json({ ok: true, status: sup.status(name) });
  });

  return app;
}
