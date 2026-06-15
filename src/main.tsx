import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { initBackendOrigin } from "./api.js";
import "./styles.css";
import "./cockpit.css";
import "./design/cockpit-redesign.css";
import "./design/tokens.css";
import "./design/ui.css";
import "./design/harmonize.css";

// En la app Tauri empaquetada, descubrir el puerto real del backend ANTES de montar React
// (Windows puede reservar el 8787 y el backend cae a un puerto alterno). En dev es no-op.
void initBackendOrigin().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
