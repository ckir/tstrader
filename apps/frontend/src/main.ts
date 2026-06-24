// Logger is the first module loaded on startup — emit the banner before mounting.
// SysInfo is server-only (node:os/process); the browser logs its own basics.
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { log } from "./lib/logger";

log.info("Starting frontend", {
  logLevel: log.level,
  userAgent: navigator.userAgent,
  language: navigator.language,
  origin: location.origin,
});

const target = document.getElementById("app");
if (!target) throw new Error("#app mount point not found");

const app = mount(App, { target });

export default app;
