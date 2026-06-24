import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { log } from "./lib/logger";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount point not found");

log.info("shell booted");

const app = mount(App, { target });

export default app;
