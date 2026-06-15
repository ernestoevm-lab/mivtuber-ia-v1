import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Puerto del backend configurable: Windows a veces reserva 8787 (rangos excluidos de
// WinNAT/Hyper-V cambian por reinicio) y el backend necesita arrancar en otro puerto.
const backendPort = process.env.MIVTUBERIA_BACKEND_PORT || "8787";
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [react()],
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
