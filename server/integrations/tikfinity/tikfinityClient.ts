import { WebSocket } from "ws";
import { readTikfinityConfig, writeTikfinityConfig, type TikfinityConfig } from "../../config.js";
import { normalizeTikfinityEvent } from "./normalizeTikfinityEvent.js";
import type { NormalizedLiveEvent, TikfinityEventHandler, TikfinityState } from "./types.js";

export class TikfinityClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private handlers = new Set<TikfinityEventHandler>();
  private config: TikfinityConfig = readTikfinityConfig();
  private status: TikfinityState["status"] = this.config.enabled ? "disconnected" : "disabled";
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private lastError: string | null = null;
  private reconnectAttempt = 0;
  private recentEvents: NormalizedLiveEvent[] = [];
  private manualStop = false;

  async connect() {
    this.config = readTikfinityConfig();
    this.manualStop = false;
    if (!this.config.enabled) {
      this.status = "disabled";
      this.lastError = "TikFinity esta deshabilitado. Activalo antes de conectar.";
      return this.getState();
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return this.getState();
    }
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.status = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    this.lastError = null;
    await this.openSocket();
    return this.getState();
  }

  async disconnect() {
    this.manualStop = true;
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.status = this.config.enabled ? "disconnected" : "disabled";
    this.lastDisconnectedAt = Date.now();
    return this.getState();
  }

  updateConfig(updates: Partial<TikfinityConfig>) {
    this.config = writeTikfinityConfig(updates);
    while (this.recentEvents.length > this.config.maxRecentEvents) this.recentEvents.shift();
    if (!this.config.enabled) {
      void this.disconnect();
      this.status = "disabled";
    }
    return this.getState();
  }

  injectTestEvent(raw: unknown) {
    const event = normalizeTikfinityEvent(raw);
    this.rememberEvent(event);
    void this.emit(event);
    return event;
  }

  getState(): TikfinityState {
    return {
      enabled: this.config.enabled,
      wsUrl: this.config.wsUrl,
      status: this.config.enabled ? this.status : "disabled",
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      reconnectAttempt: this.reconnectAttempt,
      recentEvents: [...this.recentEvents].reverse(),
      config: this.config
    };
  }

  onEvent(callback: TikfinityEventHandler) {
    this.handlers.add(callback);
    return () => this.handlers.delete(callback);
  }

  private openSocket() {
    return new Promise<void>((resolve) => {
      const socket = new WebSocket(this.config.wsUrl);
      let settled = false;
      this.socket = socket;

      socket.on("open", () => {
        this.status = "connected";
        this.lastConnectedAt = Date.now();
        this.lastError = null;
        this.reconnectAttempt = 0;
        if (this.config.debug) console.log("tikfinity_connected", JSON.stringify({ wsUrl: this.config.wsUrl }));
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      socket.on("message", (data) => {
        for (const raw of parseTikfinityPayload(data.toString("utf8"))) {
          const event = normalizeTikfinityEvent(raw);
          this.rememberEvent(event);
          if (this.config.debug) {
            console.log("tikfinity_event", JSON.stringify({
              type: event.type,
              username: event.username || null,
              displayName: event.displayName || null,
              text: event.text ? event.text.slice(0, 120) : null
            }));
          }
          void this.emit(event);
        }
      });

      socket.on("error", (error) => {
        this.status = "error";
        this.lastError = `TikFinity no esta conectado. Abre TikFinity Desktop y verifica el WebSocket local. ${error.message}`;
        if (this.config.debug) console.warn("tikfinity_error", this.lastError);
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        this.lastDisconnectedAt = Date.now();
        if (this.status !== "error") this.status = this.config.enabled ? "disconnected" : "disabled";
        if (!settled) {
          settled = true;
          resolve();
        }
        if (!this.manualStop && this.config.enabled && this.config.reconnect) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    this.status = "reconnecting";
    const delay = Math.min(this.config.reconnectMaxMs, this.config.reconnectMinMs * 2 ** Math.min(8, this.reconnectAttempt - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private disconnectSocket() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // Best effort local socket shutdown.
    } finally {
      this.socket = null;
    }
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private rememberEvent(event: NormalizedLiveEvent) {
    this.recentEvents.push(event);
    while (this.recentEvents.length > this.config.maxRecentEvents) this.recentEvents.shift();
  }

  private async emit(event: NormalizedLiveEvent) {
    for (const handler of this.handlers) {
      await Promise.resolve(handler(event)).catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Error procesando evento TikFinity.";
      });
    }
  }
}

function parseTikfinityPayload(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ type: "unknown", text: trimmed, rawText: trimmed }];
  }
}
