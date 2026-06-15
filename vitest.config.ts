import { defineConfig } from "vitest/config";

// Tests unitarios del backend/frontend. Entorno node (no jsdom); usa el mismo resolver
// de Vite que el build (resuelve imports `.js` -> `.ts` como el resto del repo).
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"]
  }
});
