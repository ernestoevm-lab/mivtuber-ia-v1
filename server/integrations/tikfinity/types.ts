import type { TikfinityConfig } from "../../config.js";

export type TikfinityConnectionStatus =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type LiveEventSource = "tikfinity";

export type LiveEventType =
  | "chat"
  | "gift"
  | "like"
  | "follow"
  | "share"
  | "member"
  | "join"
  | "subscribe"
  | "viewer_count"
  | "unknown";

export interface NormalizedLiveEvent {
  id: string;
  source: LiveEventSource;
  type: LiveEventType;
  timestamp: number;
  userId?: string;
  username?: string;
  displayName?: string;
  text?: string;
  giftName?: string;
  giftCount?: number;
  likeCount?: number;
  viewerCount?: number;
  raw: unknown;
}

export interface TikfinityState {
  enabled: boolean;
  wsUrl: string;
  status: TikfinityConnectionStatus;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
  reconnectAttempt: number;
  recentEvents: NormalizedLiveEvent[];
  config: TikfinityConfig;
}

export type TikfinityEventHandler = (event: NormalizedLiveEvent) => void | Promise<void>;
