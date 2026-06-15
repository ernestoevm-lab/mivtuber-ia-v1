import type { AutonomyConfig } from "../config.js";
import type { AutonomyRuntimeState } from "./types.js";

export function cooldownFor(config: Pick<AutonomyConfig, "mode" | "intensity" | "minCooldownMs">) {
  return config.minCooldownMs;
}

export function canSpeakNow(state: AutonomyRuntimeState): { ok: boolean; reason?: string } {
  if (!state.enabled) return { ok: false, reason: "autonomy_disabled" };
  if (state.mode === "off") return { ok: false, reason: "mode_off" };
  if (state.userIsSpeaking) return { ok: false, reason: "user_is_speaking" };
  if (state.assistantIsSpeaking) return { ok: false, reason: "assistant_is_speaking" };
  if (state.llmBusy) return { ok: false, reason: "llm_busy" };
  if (state.ttsQueueLength > 0) return { ok: false, reason: "tts_queue_busy" };
  if (state.doNotDisturbUntil && Date.now() < state.doNotDisturbUntil) return { ok: false, reason: "do_not_disturb" };
  if (state.lastAutonomySpeechAt && Date.now() - state.lastAutonomySpeechAt < state.cooldownMs) return { ok: false, reason: "cooldown" };
  return { ok: true };
}
