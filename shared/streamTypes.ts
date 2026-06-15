export type StreamPlatform = "local" | "twitch" | "youtube" | "kick";

export type StreamSource = "simulator" | "twitch" | "youtube" | "kick" | "admin";

export interface NormalizedChatUser {
  id: string;
  platform: StreamPlatform;
  platformUserId?: string;
  username: string;
  displayName?: string;
  isModerator: boolean;
  isSubscriber: boolean;
  isOwner: boolean;
  badges: string[];
  raw: unknown;
}

export interface NormalizedChatMessage {
  id: string;
  platform: StreamPlatform;
  source: StreamSource;
  channelId?: string;
  channelName?: string;
  user: NormalizedChatUser;
  message: string;
  timestamp: string;
  raw: unknown;
}

export interface StreamRawEvent {
  id: string;
  platform: StreamPlatform;
  source: StreamSource;
  eventType: string;
  userId?: string;
  receivedAt: string;
  raw: unknown;
}

export interface StreamIngestResult {
  ok: boolean;
  message: NormalizedChatMessage;
  rawEvent?: StreamRawEvent;
}
