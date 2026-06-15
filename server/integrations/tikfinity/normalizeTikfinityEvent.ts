import { randomUUID } from "node:crypto";
import type { LiveEventType, NormalizedLiveEvent } from "./types.js";

const chatTypes = new Set(["chat", "comment", "message", "chat_message", "live_chat_message"]);
const giftTypes = new Set(["gift", "gift_event"]);
const likeTypes = new Set(["like", "likes"]);
const followTypes = new Set(["follow", "follower"]);
const shareTypes = new Set(["share"]);
const memberTypes = new Set(["member", "join", "joined", "room_user", "viewer_join"]);
const subscribeTypes = new Set(["subscribe", "subscription", "sub"]);
const viewerTypes = new Set(["viewer_count", "viewercount", "viewer", "room_user_count", "live_viewers"]);

export function normalizeTikfinityEvent(raw: unknown): NormalizedLiveEvent {
  const root = asRecord(raw);
  const data = firstRecord(root, ["data", "payload", "event", "message"]) || root;
  const eventName = firstString(root, ["event", "type", "action", "eventType", "name"])
    || firstString(data, ["event", "type", "action", "eventType", "name"]);
  const type = normalizeType(eventName, root, data);
  const user = firstRecord(data, ["user", "author", "sender", "viewer"]) || firstRecord(root, ["user", "author", "sender", "viewer"]) || {};
  const text = firstString(data, ["comment", "commentText", "message", "text", "content", "msg"])
    || firstString(root, ["comment", "commentText", "message", "text", "content", "msg"]);
  const timestamp = firstNumber(root, ["timestamp", "createdAt", "time", "ts"])
    || firstNumber(data, ["timestamp", "createdAt", "time", "ts"])
    || Date.now();

  return {
    id: firstString(root, ["id", "eventId", "msgId"])
      || firstString(data, ["id", "eventId", "msgId"])
      || randomUUID(),
    source: "tikfinity",
    type,
    timestamp: normalizeTimestamp(timestamp),
    userId: firstString(user, ["id", "userId", "user_id", "uniqueId"]) || firstString(data, ["userId", "user_id"]),
    username: firstString(user, ["uniqueId", "username", "name", "userName", "user_id"]) || firstString(data, ["uniqueId", "username", "name"]),
    displayName: firstString(user, ["nickname", "displayName", "display_name", "name"]) || firstString(data, ["nickname", "displayName", "display_name"]),
    text: text ? cleanText(text, 500) : undefined,
    giftName: firstString(data, ["giftName", "gift_name", "gift", "name"]) || firstString(root, ["giftName", "gift_name"]),
    giftCount: firstNumber(data, ["giftCount", "repeatCount", "count", "amount"]) || firstNumber(root, ["giftCount", "repeatCount", "count"]),
    likeCount: firstNumber(data, ["likeCount", "likes", "count", "totalLikes"]) || firstNumber(root, ["likeCount", "likes"]),
    viewerCount: firstNumber(data, ["viewerCount", "viewers", "count", "roomUserCount"]) || firstNumber(root, ["viewerCount", "viewers"]),
    raw
  };
}

function normalizeType(value: string | undefined, root: Record<string, unknown>, data: Record<string, unknown>): LiveEventType {
  const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (chatTypes.has(text) || hasAnyText(root, data)) return "chat";
  if (giftTypes.has(text) || firstString(data, ["giftName", "gift_name", "gift"])) return "gift";
  if (likeTypes.has(text) || firstNumber(data, ["likeCount", "likes", "totalLikes"])) return "like";
  if (followTypes.has(text)) return "follow";
  if (shareTypes.has(text)) return "share";
  if (subscribeTypes.has(text)) return "subscribe";
  if (viewerTypes.has(text) || firstNumber(data, ["viewerCount", "viewers", "roomUserCount"])) return "viewer_count";
  if (memberTypes.has(text)) return text.includes("join") ? "join" : "member";
  return "unknown";
}

function hasAnyText(...items: Array<Record<string, unknown>>) {
  return items.some((item) => Boolean(firstString(item, ["comment", "commentText", "message", "text", "content", "msg"])));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function normalizeTimestamp(value: number) {
  if (value < 10_000_000_000) return Math.round(value * 1000);
  return Math.round(value);
}

function cleanText(value: string, maxChars: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxChars);
}
