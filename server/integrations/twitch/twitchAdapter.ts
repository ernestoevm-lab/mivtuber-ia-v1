import { WebSocket } from "ws";
import type { ChatMessageHandler, ChatPlatformAdapter, ChatPlatformAdapterStatus } from "../../stream/adapters.js";
import { normalizeTwitchMessage } from "./normalizeTwitchMessage.js";
import type { ParsedTwitchPrivmsg, TwitchAdapterConfig, TwitchChatStatus, TwitchConnectionState } from "./types.js";

const twitchIrcUrl = "wss://irc-ws.chat.twitch.tv:443";

export class TwitchChatAdapter implements ChatPlatformAdapter {
  readonly platform = "twitch" as const;
  private socket: WebSocket | null = null;
  private handlers = new Set<ChatMessageHandler>();
  private state: TwitchConnectionState = "disconnected";
  private lastError: string | null = null;
  private connectedAt: string | null = null;
  private messagesReceived = 0;
  private lastMessageAt: string | null = null;
  private lastMessage: string | null = null;
  private lastUser: string | null = null;

  constructor(private config: TwitchAdapterConfig) {}

  /** Aplica credenciales nuevas (guardadas desde la UI) sin reiniciar el backend.
   *  Solo afecta conexiones futuras; si hay una sesión activa, sigue hasta desconectar. */
  updateConfig(config: TwitchAdapterConfig) {
    this.config = config;
  }

  async connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.config.enabled) {
      throw new Error("Twitch esta deshabilitado. Guarda tu canal, usuario del bot y token en la pestana Viewers para activarlo.");
    }
    if (!this.isConfigured()) {
      throw new Error("Faltan credenciales de Twitch. Guarda canal, usuario del bot y token OAuth en la pestana Viewers.");
    }

    this.disconnectSocket();
    this.state = "connecting";
    this.lastError = null;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(twitchIrcUrl);
      let settled = false;
      this.socket = socket;

      socket.on("open", () => {
        this.sendRaw("CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.sendRaw(`PASS ${normalizeOauthToken(this.config.oauthToken)}`);
        this.sendRaw(`NICK ${this.config.botUsername}`);
        this.sendRaw(`JOIN #${normalizeChannel(this.config.channel)}`);
      });

      socket.on("message", (data) => {
        const text = data.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          this.handleLine(line);
          if (!settled && (line.includes(" 001 ") || line.includes(" JOIN #"))) {
            settled = true;
            this.state = "connected";
            this.connectedAt = new Date().toISOString();
            resolve();
          }
        }
      });

      socket.on("error", (error) => {
        this.state = "error";
        this.lastError = sanitizeError(error.message);
        if (!settled) {
          settled = true;
          reject(new Error(this.lastError));
        }
      });

      socket.on("close", () => {
        if (this.state !== "error") this.state = "disconnected";
        this.socket = null;
        if (!settled) {
          settled = true;
          reject(new Error(this.lastError || "Twitch cerro la conexion antes de estar listo."));
        }
      });

      windowlessTimeout(() => {
        if (settled) return;
        settled = true;
        this.state = "error";
        this.lastError = "Tiempo de espera agotado conectando a Twitch.";
        this.disconnectSocket();
        reject(new Error(this.lastError));
      }, 12000);
    });
  }

  async disconnect() {
    this.disconnectSocket();
    this.state = "disconnected";
  }

  getStatus(): ChatPlatformAdapterStatus & TwitchChatStatus {
    return {
      platform: this.platform,
      enabled: this.config.enabled,
      configured: this.isConfigured(),
      connected: this.state === "connected",
      state: this.state,
      channel: normalizeChannel(this.config.channel),
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      lastMessage: this.lastMessage,
      lastUser: this.lastUser
    };
  }

  onMessage(callback: ChatMessageHandler) {
    this.handlers.add(callback);
    return () => this.handlers.delete(callback);
  }

  private handleLine(line: string) {
    if (line.startsWith("PING")) {
      this.sendRaw(line.replace(/^PING/, "PONG"));
      return;
    }

    if (line.includes(" NOTICE ") && /Login authentication failed|Improperly formatted auth/i.test(line)) {
      this.state = "error";
      this.lastError = "Twitch rechazo la autenticacion. Revisa el usuario del bot y el token OAuth en la pestana Viewers.";
      this.disconnectSocket();
      return;
    }

    if (!line.includes(" PRIVMSG ")) return;
    const parsed = parsePrivmsg(line);
    if (!parsed?.message) return;

    const normalized = normalizeTwitchMessage(parsed);
    this.messagesReceived += 1;
    this.lastMessageAt = normalized.timestamp;
    this.lastMessage = normalized.message;
    this.lastUser = normalized.user.displayName || normalized.user.username;

    for (const handler of this.handlers) {
      void Promise.resolve(handler(normalized)).catch((error) => {
        this.lastError = sanitizeError(error instanceof Error ? error.message : "Error procesando mensaje de Twitch.");
      });
    }
  }

  private sendRaw(line: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(`${line}\r\n`);
  }

  private disconnectSocket() {
    if (!this.socket) return;
    try {
      if (this.socket.readyState === WebSocket.OPEN) this.sendRaw("QUIT");
      this.socket.close();
    } catch {
      // Best effort shutdown.
    } finally {
      this.socket = null;
    }
  }

  private isConfigured() {
    return Boolean(normalizeChannel(this.config.channel) && this.config.botUsername.trim() && this.config.oauthToken.trim());
  }
}

export function readTwitchConfigFromEnv(env: NodeJS.ProcessEnv): TwitchAdapterConfig {
  return {
    enabled: String(env.TWITCH_ENABLED || "false").toLowerCase() === "true",
    channel: String(env.TWITCH_CHANNEL || "").trim(),
    botUsername: String(env.TWITCH_BOT_USERNAME || "").trim(),
    oauthToken: String(env.TWITCH_OAUTH_TOKEN || "").trim(),
    clientId: String(env.TWITCH_CLIENT_ID || "").trim()
  };
}

function parsePrivmsg(line: string): ParsedTwitchPrivmsg | null {
  const receivedAt = new Date().toISOString();
  const tagMatch = line.match(/^@([^ ]+) /);
  const tags = parseTags(tagMatch?.[1] || "");
  const withoutTags = tagMatch ? line.slice(tagMatch[0].length) : line;
  const match = withoutTags.match(/^:([^! ]+)!.* PRIVMSG (#\S+) :([\s\S]*)$/);
  if (!match) return null;
  return {
    tags,
    username: match[1],
    channel: match[2],
    message: match[3],
    raw: line,
    receivedAt
  };
}

function parseTags(value: string) {
  const tags: Record<string, string> = {};
  if (!value) return tags;
  for (const part of value.split(";")) {
    const [key, rawValue = ""] = part.split("=", 2);
    tags[key] = decodeTagValue(rawValue);
  }
  return tags;
}

function decodeTagValue(value: string) {
  return value
    .replace(/\\s/g, " ")
    .replace(/\\:/g, ";")
    .replace(/\\\\/g, "\\");
}

function normalizeOauthToken(token: string) {
  const trimmed = token.trim();
  return trimmed.startsWith("oauth:") ? trimmed : `oauth:${trimmed}`;
}

function normalizeChannel(channel: string) {
  return channel.trim().replace(/^#/, "").toLowerCase();
}

function sanitizeError(message: string) {
  return message.replace(/oauth:[^\s]+/gi, "oauth:[redacted]");
}

function windowlessTimeout(callback: () => void, ms: number) {
  setTimeout(callback, ms);
}
