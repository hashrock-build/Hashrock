import { defineConfig } from "vite";

// Running from a Windows-mounted path under WSL (/mnt/c/...) breaks inotify, so Vite's
// file watcher never sees edits and HMR goes stale. Polling fixes hot reload there.
export default defineConfig({
  server: {
    watch: { usePolling: true, interval: 200 },
  },
});
