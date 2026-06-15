import type { AvatarSignal } from "../types.js";
import type { Emotion, EmotionIntensity } from "../../types.js";

export type AvatarPerformanceMode =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "reacting"
  | "excited"
  | "soft"
  | "sad"
  | "amused"
  | "surprised";

export type AvatarPerformanceEmotion =
  | "neutral"
  | "happy"
  | "amused"
  | "excited"
  | "sad"
  | "surprised"
  | "angry"
  | "soft";

export type AvatarAttentionTarget = "camera" | "chat" | "thought" | "side" | "down";

export type AvatarGestureName =
  | "small_nod"
  | "head_tilt"
  | "hand_explain_small"
  | "hand_explain_medium"
  | "amused_shoulder"
  | "surprised_recoil_small"
  | "soft_lean"
  | "excited_bounce_small";

export type AvatarPerformanceState = {
  mode: AvatarPerformanceMode;
  emotion: AvatarPerformanceEmotion;
  energy: number;
  attentionTarget: AvatarAttentionTarget;
  gesture?: AvatarGestureName;
};

export type AvatarPerformanceStateInput = Partial<AvatarPerformanceState>;
export type AvatarPerformanceStateListener = (state: AvatarPerformanceState) => void;

const defaultPerformanceState: AvatarPerformanceState = {
  mode: "idle",
  emotion: "neutral",
  energy: 0.24,
  attentionTarget: "camera"
};

const performanceModes: readonly AvatarPerformanceMode[] = ["idle", "listening", "thinking", "speaking", "reacting", "excited", "soft", "sad", "amused", "surprised"];
const performanceEmotions: readonly AvatarPerformanceEmotion[] = ["neutral", "happy", "amused", "excited", "sad", "surprised", "angry", "soft"];
const attentionTargets: readonly AvatarAttentionTarget[] = ["camera", "chat", "thought", "side", "down"];
const gestures: readonly AvatarGestureName[] = ["small_nod", "head_tilt", "hand_explain_small", "hand_explain_medium", "amused_shoulder", "surprised_recoil_small", "soft_lean", "excited_bounce_small"];

let currentPerformanceState = defaultPerformanceState;
let hasManualPerformanceState = false;
const listeners = new Set<AvatarPerformanceStateListener>();

export function getAvatarPerformanceState() {
  return currentPerformanceState;
}

export function getExternalAvatarPerformanceState() {
  return hasManualPerformanceState ? currentPerformanceState : null;
}

export function setAvatarPerformanceState(input: AvatarPerformanceStateInput | null | undefined) {
  hasManualPerformanceState = true;
  currentPerformanceState = normalizeAvatarPerformanceState({
    ...currentPerformanceState,
    ...(input || {})
  });
  for (const listener of listeners) {
    try {
      listener(currentPerformanceState);
    } catch (error) {
      console.warn("avatar_performance_listener_failed", error instanceof Error ? error.message : error);
    }
  }
  return currentPerformanceState;
}

export function clearAvatarPerformanceState() {
  hasManualPerformanceState = false;
  currentPerformanceState = defaultPerformanceState;
  for (const listener of listeners) {
    try {
      listener(currentPerformanceState);
    } catch (error) {
      console.warn("avatar_performance_listener_failed", error instanceof Error ? error.message : error);
    }
  }
  return currentPerformanceState;
}

export function subscribeAvatarPerformanceState(listener: AvatarPerformanceStateListener) {
  listeners.add(listener);
  try {
    listener(currentPerformanceState);
  } catch (error) {
    console.warn("avatar_performance_listener_failed", error instanceof Error ? error.message : error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function normalizeAvatarPerformanceState(input: AvatarPerformanceStateInput | null | undefined): AvatarPerformanceState {
  return {
    mode: normalizeChoice(input?.mode, performanceModes, defaultPerformanceState.mode),
    emotion: normalizeChoice(input?.emotion, performanceEmotions, defaultPerformanceState.emotion),
    energy: clamp01(input?.energy ?? defaultPerformanceState.energy),
    attentionTarget: normalizeChoice(input?.attentionTarget, attentionTargets, defaultPerformanceState.attentionTarget),
    gesture: normalizeOptionalChoice(input?.gesture, gestures)
  };
}

export function derivePerformanceState(input: {
  signal?: AvatarSignal | null;
  emotion: Emotion;
  intensity: EmotionIntensity;
  speaking: boolean;
  speakingWeight: number;
  external?: AvatarPerformanceState | null;
}): AvatarPerformanceState {
  const signal = input.signal;
  const mood = signal?.mood;
  const action = signal?.action;
  const baseMode: AvatarPerformanceMode =
    input.speaking || input.speakingWeight > 0.12 || action === "speaking" ? "speaking"
      : action === "thinking" || mood === "focused" || input.emotion === "thinking" ? "thinking"
        : action === "listening" ? "listening"
          : action === "laughing" ? "amused"
            : input.emotion === "surprised" || mood === "surprised" ? "surprised"
              : input.emotion === "sad" || mood === "sad" ? "sad"
                : input.emotion === "happy" || mood === "happy" ? "amused"
                  : "idle";
  const baseEmotion: AvatarPerformanceEmotion =
    input.emotion === "happy" || mood === "happy" ? "happy"
      : input.emotion === "sad" || mood === "sad" ? "sad"
        : input.emotion === "surprised" || mood === "surprised" ? "surprised"
          : input.emotion === "annoyed" || mood === "annoyed" ? "angry"
            : input.emotion === "safe" ? "soft"
              : action === "laughing" ? "amused"
                : "neutral";
  const target: AvatarAttentionTarget =
    baseMode === "thinking" ? "thought"
      : baseMode === "listening" ? "chat"
        : baseMode === "sad" || baseEmotion === "soft" ? "down"
          : baseMode === "surprised" ? "side"
            : "camera";
  const signalEnergy = typeof signal?.intensity === "number" ? signal.intensity / 10 : input.intensity / 10;
  const energy = clamp01((input.speaking || input.speakingWeight > 0.12 ? 0.46 : 0.2) + signalEnergy * 0.48);

  return normalizeAvatarPerformanceState({
    mode: input.external?.mode || baseMode,
    emotion: input.external?.emotion || baseEmotion,
    attentionTarget: input.external?.attentionTarget || target,
    energy: input.external ? Math.max(energy, input.external.energy) : energy,
    gesture: input.external?.gesture
  });
}

function normalizeChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}

function normalizeOptionalChoice<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized as T) ? normalized as T : undefined;
}

export function clamp01(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}
