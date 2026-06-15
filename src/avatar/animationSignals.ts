import type { ChatResponse } from "../types.js";
import type { AvatarSignal } from "./types.js";
import { clampAvatarIntensity, normalizeAvatarAction, normalizeAvatarMood, normalizeAvatarSignal } from "./types.js";

type SpeechSignalInput = {
  state?: "start" | "end";
  responseId?: string;
  startedAt?: number;
  endedAt?: number;
  playbackDurationMs?: number;
  audioKind?: string;
  audioDurationMs?: number;
  at?: number;
};

type MessageSignalInput = Partial<Pick<ChatResponse, "id" | "text" | "emotion" | "emotionIntensity" | "action" | "audio" | "timings">> & {
  responseId?: string;
};

export function deriveAvatarSignalFromMessage(message: MessageSignalInput | null | undefined): AvatarSignal {
  const action = normalizeResponseAction(message);
  const estimatedDurationMs = estimateSignalDuration(message);
  return normalizeAvatarSignal({
    responseId: message?.responseId || message?.id,
    mood: mapResponseMood(message?.emotion),
    intensity: clampAvatarIntensity(message?.emotionIntensity ?? 3),
    action,
    text: message?.text,
    estimatedDurationMs,
    audioKind: message?.timings?.audioKind || (message?.audio ? "audio" : undefined),
    source: "llm"
  });
}

export function deriveAvatarSignalFromSpeechEvent(
  detail: SpeechSignalInput | null | undefined,
  message?: MessageSignalInput | null
): AvatarSignal {
  const isStart = detail?.state === "start";
  return normalizeAvatarSignal({
    responseId: detail?.responseId || message?.responseId || message?.id,
    mood: isStart ? mapResponseMood(message?.emotion) : normalizeAvatarMood(message?.emotion || "neutral"),
    intensity: isStart ? clampAvatarIntensity(message?.emotionIntensity ?? 4) : Math.min(3, clampAvatarIntensity(message?.emotionIntensity ?? 2)),
    action: isStart ? "speaking" : "idle",
    text: message?.text,
    startedAt: detail?.startedAt || detail?.at,
    estimatedDurationMs: detail?.playbackDurationMs || message?.timings?.speechPlaybackMs || estimateSignalDuration(message),
    audioKind: detail?.audioKind || message?.timings?.audioKind,
    source: "speech"
  });
}

function normalizeResponseAction(message: MessageSignalInput | null | undefined): AvatarSignal["action"] {
  if (!message) return "idle";
  if (message.action === "speak" || message.audio || message.timings?.audioKind) return "reacting";
  if (message.action === "blocked" || message.action === "ignored") return "reacting";
  return normalizeAvatarAction(message.action);
}

function mapResponseMood(emotion: unknown): AvatarSignal["mood"] {
  const normalized = String(emotion || "").trim().toLowerCase();
  if (normalized === "thinking") return "focused";
  if (normalized === "safe") return "happy";
  if (normalized === "sad") return "sad";
  if (normalized === "surprised") return "surprised";
  return normalizeAvatarMood(normalized);
}

function estimateSignalDuration(message: MessageSignalInput | null | undefined): number | undefined {
  if (!message) return undefined;
  const existing = message.timings?.speechPlaybackMs || message.timings?.audioDurationMs;
  if (Number.isFinite(existing) && existing && existing > 0) return existing;
  if (message.text) return Math.max(1200, Math.min(12000, message.text.length * 78));
  return undefined;
}
