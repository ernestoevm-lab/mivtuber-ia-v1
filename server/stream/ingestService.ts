import type { NormalizedChatMessage } from "../../shared/streamTypes.js";
import type { ModerationResult } from "../moderation.js";
import { moderateMessage } from "../moderation.js";
import type { SafetyMode } from "../types.js";

export interface StreamQueuedChat {
  id: string;
  message: string;
  source: string;
  user?: string;
  normalized?: NormalizedChatMessage;
  createdAt: number;
  moderation: ModerationResult;
}

export interface StreamGuardEvent {
  decision: string;
  reason: string;
  score: number;
  source: string;
  user?: string;
  content: string;
  created_at?: string;
}

export interface StreamGuardStatus {
  ok: boolean;
  queueLength: number;
  nextResponseInMs: number;
  cooldownMs: number;
  userCooldownMs: number;
  lastSelected: StreamGuardEvent | null;
  recent: StreamGuardEvent[];
}

export interface IngestNormalizedChatMessageInput {
  normalized: NormalizedChatMessage;
  safetyMode: SafetyMode;
  recentNormalizedMessages: string[];
  queue: StreamQueuedChat[];
  maxQueueSize: number;
  purgeQueue: () => void;
  rememberMessage: (message: string) => void;
  recordModeration: (
    moderation: ModerationResult,
    content: string,
    user: string | undefined,
    mode: SafetyMode
  ) => Promise<void>;
  guardStatus: () => StreamGuardStatus;
  scheduleQueue: () => void;
  now?: () => number;
}

export interface IngestNormalizedChatMessageResult {
  ok: boolean;
  queued: boolean;
  message: NormalizedChatMessage;
  moderation: ModerationResult;
  guard: StreamGuardStatus;
}

export async function ingestNormalizedChatMessage(input: IngestNormalizedChatMessageInput): Promise<IngestNormalizedChatMessageResult> {
  const { normalized, safetyMode } = input;
  const text = normalized.message;
  const source = normalized.source;
  const user = normalized.user.username || "viewer";

  input.purgeQueue();
  const moderation = moderateMessage(text, safetyMode, source, input.recentNormalizedMessages);
  if (moderation.decision !== "allow") {
    await input.recordModeration(moderation, text, user, safetyMode);
    return {
      ok: true,
      queued: false,
      message: normalized,
      moderation,
      guard: input.guardStatus()
    };
  }

  if (input.queue.length >= input.maxQueueSize) {
    const queueFull = { ...moderation, decision: "ignored" as const, reason: "queue_full", score: moderation.score };
    await input.recordModeration(queueFull, text, user, safetyMode);
    return {
      ok: true,
      queued: false,
      message: normalized,
      moderation: queueFull,
      guard: input.guardStatus()
    };
  }

  const queued = { ...moderation, decision: "queued" as const };
  input.rememberMessage(text);
  input.queue.push({
    id: normalized.id,
    message: text,
    source,
    user,
    normalized,
    createdAt: input.now?.() ?? Date.now(),
    moderation: queued
  });
  await input.recordModeration(queued, text, user, safetyMode);
  input.scheduleQueue();

  return {
    ok: true,
    queued: true,
    message: normalized,
    moderation: queued,
    guard: input.guardStatus()
  };
}
