import { randomUUID } from "node:crypto";
import { NormalizedChatMessage, NormalizedChatUser, StreamSource } from "../../shared/streamTypes.js";

export interface LegacyChatIngestPayload {
  message?: unknown;
  source?: unknown;
  user?: unknown;
}

export function normalizeLegacyChatMessage(payload: LegacyChatIngestPayload): NormalizedChatMessage {
  const username = normalizeUsername(payload.user);
  const source = normalizeLegacySource(payload.source);
  const timestamp = new Date().toISOString();
  const user: NormalizedChatUser = {
    id: `local:${username}`,
    platform: "local",
    username,
    displayName: username,
    isModerator: false,
    isSubscriber: false,
    isOwner: false,
    badges: [],
    raw: payload.user ?? null
  };

  return {
    id: randomUUID(),
    platform: "local",
    source,
    channelId: "local",
    channelName: "Simulador local",
    user,
    message: normalizeMessageText(payload.message),
    timestamp,
    raw: payload
  };
}

function normalizeMessageText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUsername(value: unknown) {
  const username = String(value || "viewer").replace(/\s+/g, "_").trim();
  return username || "viewer";
}

function normalizeLegacySource(value: unknown): StreamSource {
  const source = String(value || "simulator").trim().toLowerCase();
  if (source === "admin") return "admin";
  if (source === "twitch") return "twitch";
  if (source === "youtube") return "youtube";
  if (source === "kick") return "kick";
  return "simulator";
}
