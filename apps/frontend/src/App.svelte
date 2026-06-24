<script lang="ts">
import Router from "svelte-spa-router";
import Sidebar from "./components/Sidebar.svelte";
import { routes } from "./lib/routes";
</script>

<div class="flex h-full">
  <Sidebar />
  <main class="flex-1 overflow-auto p-6">
    <Router {routes} />
  </main>
</div>
