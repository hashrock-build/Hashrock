import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Running from a Windows-mounted path under WSL (/mnt/c/...) breaks inotify, so Vite's
// file watcher never sees edits and HMR goes stale. Polling fixes hot reload there.
// nodePolyfills supplies Buffer/process so @solana/web3.js works in the browser.
export default defineConfig({
  plugins: [nodePolyfills({ include: ["buffer"], globals: { Buffer: true } })],
  server: {
    watch: { usePolling: true, interval: 200 },
  },
});
