import type { NormalizedChatMessage, StreamPlatform } from "../../shared/streamTypes.js";

export type ChatPlatformConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ChatPlatformAdapterStatus {
  platform: StreamPlatform;
  state: ChatPlatformConnectionState;
  connected: boolean;
  lastError?: string | null;
  lastEventAt?: string;
}

export type ChatMessageHandler = (message: NormalizedChatMessage) => void | Promise<void>;

export interface ChatPlatformAdapter {
  platform: StreamPlatform;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ChatPlatformAdapterStatus;
  onMessage(callback: ChatMessageHandler): () => void;
}
