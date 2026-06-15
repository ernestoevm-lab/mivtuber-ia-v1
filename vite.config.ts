import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Version real de la app leida de package.json en build-time, expuesta como __APP_VERSION__
// para que la UI (p. ej. el sidebar) no quede desincronizada en futuros bumps de version.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// Puerto del backend configurable: Windows a veces reserva 8787 (rangos excluidos de
// WinNAT/Hyper-V cambian por reinicio) y el backend necesita arrancar en otro puerto.
const backendPort = process.env.MIVTUBERIA_BACKEND_PORT || "8787";
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("three") || id.includes("@pixiv/three-vrm")) return "avatar-vendor";
          if (id.includes("node_modules")) return "vendor";
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": backendHttp,
      "/backgrounds": backendHttp,
      "/reference-images": backendHttp,
      "/avatar": backendHttp,
      "/events": {
        target: backendWs,
        ws: true
      }
    }
  }
});
