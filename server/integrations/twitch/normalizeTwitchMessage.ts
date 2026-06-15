import { randomUUID } from "node:crypto";
import type { NormalizedChatMessage, NormalizedChatUser } from "../../../shared/streamTypes.js";
import type { ParsedTwitchPrivmsg } from "./types.js";

export function normalizeTwitchMessage(input: ParsedTwitchPrivmsg): NormalizedChatMessage {
  const username = normalizeUsername(input.username || input.tags.login || "viewer");
  const displayName = input.tags["display-name"] || username;
  const badges = parseBadges(input.tags.badges);
  const platformUserId = input.tags["user-id"] || undefined;
  const channelName = input.channel.replace(/^#/, "");
  const isOwner = username.toLowerCase() === channelName.toLowerCase() || badges.includes("broadcaster");

  const user: NormalizedChatUser = {
    id: platformUserId ? `twitch:${platformUserId}` : `twitch:username:${username}`,
    platform: "twitch",
    platformUserId,
    username,
    displayName,
    isModerator: badges.includes("moderator") || isOwner,
    isSubscriber: badges.some((badge) => badge === "subscriber" || badge === "founder"),
    isOwner,
    badges,
    raw: input.tags
  };

  return {
    id: input.tags.id || randomUUID(),
    platform: "twitch",
    source: "twitch",
    channelId: input.tags["room-id"] || undefined,
    channelName,
    user,
    message: input.message.replace(/\s+/g, " ").trim(),
    timestamp: input.receivedAt,
    raw: input.raw
  };
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "") || "viewer";
}

function parseBadges(value = "") {
  return value
    .split(",")
    .map((item) => item.split("/")[0]?.trim())
    .filter(Boolean);
}
