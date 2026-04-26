import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server: 5173 (matches the CORS allow-list in mcp/control-plane.js).
// We do NOT proxy /api to the control plane because the SPA reads the
// dynamically-bound port from /control-port.json (served by `npm run dashboard:dev`
// — see public/control-port.json plumbing in App.tsx).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
});
