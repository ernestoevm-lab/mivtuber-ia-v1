export interface TwitchAdapterConfig {
  enabled: boolean;
  channel: string;
  botUsername: string;
  oauthToken: string;
  clientId: string;
}

export type TwitchConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface TwitchChatStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  state: TwitchConnectionState;
  channel: string;
  lastError: string | null;
  connectedAt: string | null;
  messagesReceived: number;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastUser: string | null;
}

export interface ParsedTwitchPrivmsg {
  tags: Record<string, string>;
  username: string;
  channel: string;
  message: string;
  raw: string;
  receivedAt: string;
}
