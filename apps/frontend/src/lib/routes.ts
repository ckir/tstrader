import Logs from "../routes/Logs.svelte";
import Orders from "../routes/Orders.svelte";
import Overview from "../routes/Overview.svelte";
import Positions from "../routes/Positions.svelte";
import Processes from "../routes/Processes.svelte";
import Strategies from "../routes/Strategies.svelte";

// Candidate IA (frontend.md §2) — placeholder views filled in during Phase B2.
export const routes = {
  "/": Overview,
  "/positions": Positions,
  "/orders": Orders,
  "/strategies": Strategies,
  "/processes": Processes,
  "/logs": Logs,
};
