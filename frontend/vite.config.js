import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Bind explicitly so `npm run dev` works the same in PowerShell, cmd and bash
  // (PowerShell strips the `--` needed to pass flags through npm).
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts";
          if (id.includes("leaflet")) return "maps";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("@fontsource")) return undefined;
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    css: false,
    restoreMocks: true,
    // App-level tests open several lazy views; each first import is a cold transform that can take
    // seconds when every test file renders the app in parallel. Tests wait on conditions, not timers.
    testTimeout: 15000,
  },
});
