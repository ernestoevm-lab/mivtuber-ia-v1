import { randomUUID } from "node:crypto";
import type { TikfinityConfig } from "./config.js";
import type { NormalizedLiveEvent } from "./integrations/tikfinity/types.js";
import { mentionsYuko } from "./autonomy/scoring.js";
import type { AutonomyEvent, AutonomyEventType } from "./autonomy/types.js";

export function autonomyEventFromLiveEvent(event: NormalizedLiveEvent, config: TikfinityConfig): AutonomyEvent {
  const mentioned = event.text ? mentionsYuko(event.text, config.mentionKeywords) : false;
  const type = autonomyTypeFromLiveType(event.type);
  return {
    id: randomUUID(),
    type,
    timestamp: event.timestamp,
    priority: priorityFor(type, mentioned),
    confidence: event.type === "unknown" ? 0.35 : 0.9,
    payload: {
      source: event.source,
      liveEventId: event.id,
      username: event.username,
      displayName: event.displayName,
      text: event.text,
      raw: event.raw,
      giftName: event.giftName,
      giftCount: event.giftCount,
      likeCount: event.likeCount,
      viewerCount: event.viewerCount,
      mentioned,
      mentionKeywords: config.mentionKeywords
    }
  };
}

function autonomyTypeFromLiveType(type: NormalizedLiveEvent["type"]): AutonomyEventType {
  if (type === "chat") return "live_chat_message";
  if (type === "gift") return "live_gift";
  if (type === "like") return "live_like";
  if (type === "follow") return "live_follow";
  if (type === "share") return "live_share";
  if (type === "member" || type === "join") return "live_member";
  if (type === "subscribe") return "live_subscribe";
  if (type === "viewer_count") return "live_viewer_count";
  return "system_notice";
}

function priorityFor(type: AutonomyEventType, mentioned: boolean) {
  if (type === "live_chat_message") return mentioned ? 85 : 55;
  if (type === "live_gift") return 90;
  if (type === "live_follow") return 70;
  if (type === "live_share") return 65;
  if (type === "live_member") return 40;
  if (type === "live_like") return 30;
  if (type === "live_viewer_count") return 20;
  if (type === "manual_trigger") return 90;
  return 30;
}
