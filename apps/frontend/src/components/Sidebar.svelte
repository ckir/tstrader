<script lang="ts">
import { location } from "svelte-spa-router";

const nav = [
  { href: "#/", path: "/", label: "Overview" },
  { href: "#/positions", path: "/positions", label: "Positions" },
  { href: "#/orders", path: "/orders", label: "Orders" },
  { href: "#/strategies", path: "/strategies", label: "Strategies" },
  { href: "#/processes", path: "/processes", label: "Processes" },
  { href: "#/logs", path: "/logs", label: "Logs" },
];
</script>

<aside class="flex w-56 shrink-0 flex-col border-r border-border bg-surface p-4">
  <h1 class="mb-6 text-lg font-semibold text-text">tstrader</h1>
  <nav class="flex flex-col gap-1">
    {#each nav as item (item.path)}
      <a
        href={item.href}
        class="rounded px-3 py-2 text-sm text-muted hover:bg-border hover:text-text"
        class:bg-border={$location === item.path}
        class:text-text={$location === item.path}
      >
        {item.label}
      </a>
    {/each}
  </nav>
</aside>
