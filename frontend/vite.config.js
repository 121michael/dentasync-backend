import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { SPA_ROUTES } from "./spaRoutes.js";

function spaHtmlFallback() {
  return {
    name: "spa-html-fallback",
    closeBundle() {
      const outDir = path.resolve("dist");
      const indexFile = path.join(outDir, "index.html");
      if (!fs.existsSync(indexFile)) return;

      fs.copyFileSync(indexFile, path.join(outDir, "404.html"));

      for (const route of SPA_ROUTES) {
        const relative = route.replace(/^\//, "");
        const folder = path.join(outDir, relative);
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(indexFile, path.join(folder, "index.html"));
        fs.copyFileSync(indexFile, path.join(outDir, `${relative}.html`));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), spaHtmlFallback()],
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
