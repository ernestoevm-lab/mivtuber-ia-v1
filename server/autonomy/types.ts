import type { AutonomyConfig, AutonomyIntensity, AutonomyMode } from "../config.js";
import type { NormalizedLiveEvent } from "../integrations/tikfinity/types.js";

export type { AutonomyConfig, AutonomyIntensity, AutonomyMode };

export type AutonomyEventType =
  | "user_message_received"
  | "assistant_speech_started"
  | "assistant_speech_finished"
  | "user_silence"
  | "app_idle"
  | "latency_changed"
  | "manual_trigger"
  | "system_notice"
  | "live_chat_message"
  | "live_gift"
  | "live_like"
  | "live_follow"
  | "live_share"
  | "live_member"
  | "live_subscribe"
  | "live_viewer_count";

export type AutonomyAction = "speak" | "ask" | "narrate" | "wait" | "emote";

export interface AutonomyEvent {
  id: string;
  type: AutonomyEventType;
  timestamp: number;
  priority: number;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface AutonomyDecision {
  action: AutonomyAction;
  shouldSpeak: boolean;
  score: number;
  threshold: number;
  reason: string;
  prompt?: string;
  text?: string;
  eventType?: AutonomyEventType;
  createdAt: number;
  blockedBy?: string;
}

export interface AutonomyRuntimeState {
  mode: AutonomyMode;
  intensity: AutonomyIntensity;
  enabled: boolean;
  userIsSpeaking: boolean;
  assistantIsSpeaking: boolean;
  llmBusy: boolean;
  ttsQueueLength: number;
  lastUserMessageAt: number | null;
  lastAssistantSpeechAt: number | null;
  lastAutonomySpeechAt: number | null;
  lastDecisionAt: number | null;
  cooldownMs: number;
  doNotDisturbUntil: number | null;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
  recentLiveEvents: NormalizedLiveEvent[];
  recentAutonomyDecisions: AutonomyDecision[];
  currentTopic?: string;
  lastLatencyMs?: number;
}

export interface AutonomyStatePayload {
  ok: boolean;
  config: AutonomyConfig;
  runtime: AutonomyRuntimeState;
  canSpeak: { ok: boolean; reason?: string };
  lastDecision: AutonomyDecision | null;
}
