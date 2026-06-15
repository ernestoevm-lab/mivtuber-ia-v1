import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";

let wss: WebSocketServer | null = null;

export function attachEvents(server: Server) {
  wss = new WebSocketServer({ server, path: "/events" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "ready", at: new Date().toISOString() }));
  });
  // ws re-emite los errores del http server subyacente en el WSS; sin este listener,
  // un puerto bloqueado (EACCES/EADDRINUSE) tumba el proceso ANTES de que el retry de
  // puertos de index.ts pueda actuar. El http server es quien decide qué hacer.
  wss.on("error", () => {});
}

export function broadcast(type: string, payload: unknown) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
