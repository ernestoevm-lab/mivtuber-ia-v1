import { randomUUID } from "node:crypto";
import { readAutonomyConfig, writeAutonomyConfig, type AutonomyConfig } from "../config.js";
import type { NormalizedLiveEvent } from "../integrations/tikfinity/types.js";
import { canSpeakNow, cooldownFor } from "./state.js";
import { buildAutonomyPrompt, sanitizeLiveText, templateForEvent } from "./prompts.js";
import { scoreAutonomyEvent } from "./scoring.js";
import type { AutonomyDecision, AutonomyEvent, AutonomyRuntimeState, AutonomyStatePayload } from "./types.js";

export interface AutonomyRuntimeSnapshot {
  userIsSpeaking?: boolean;
  assistantIsSpeaking?: boolean;
  llmBusy?: boolean;
  ttsQueueLength?: number;
  lastUserMessageAt?: number | null;
  lastAssistantSpeechAt?: number | null;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
  currentTopic?: string;
  lastLatencyMs?: number;
}

export interface AutonomyDirectorOptions {
  getRuntime: () => AutonomyRuntimeSnapshot;
  speak: (input: { text: string; event: AutonomyEvent; decision: AutonomyDecision }) => Promise<void>;
  generateText?: (prompt: string, event: AutonomyEvent) => Promise<string>;
  onDecision?: (decision: AutonomyDecision) => void;
}

export class AutonomyDirector {
  private config: AutonomyConfig = readAutonomyConfig();
  private recentLiveEvents: NormalizedLiveEvent[] = [];
  private decisions: AutonomyDecision[] = [];
  private lastAutonomySpeechAt: number | null = null;
  private lastDecisionAt: number | null = null;
  private doNotDisturbUntil: number | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastSilenceEventAt = 0;

  constructor(private readonly options: AutonomyDirectorOptions) {}

  start() {
    if (this.silenceTimer) return;
    this.silenceTimer = setInterval(() => {
      void this.maybeEmitSilence();
    }, 5000);
  }

  stop() {
    if (!this.silenceTimer) return;
    clearInterval(this.silenceTimer);
    this.silenceTimer = null;
  }

  updateConfig(updates: Partial<AutonomyConfig>) {
    this.config = writeAutonomyConfig(updates);
    return this.getState();
  }

  rememberLiveEvent(event: NormalizedLiveEvent) {
    this.recentLiveEvents.push(event);
    while (this.recentLiveEvents.length > 60) this.recentLiveEvents.shift();
  }

  async handleEvent(event: AutonomyEvent) {
    const state = this.buildRuntimeState();
    const decision = scoreAutonomyEvent(event, state, this.config);
    const speakCheck = canSpeakNow(state);
    if (!speakCheck.ok) {
      decision.shouldSpeak = false;
      decision.blockedBy = speakCheck.reason;
      decision.reason = "blocked_by_runtime";
    }
    if (this.isRateLimited()) {
      decision.shouldSpeak = false;
      decision.blockedBy = "rate_limited";
      decision.reason = "blocked_by_rate_limit";
    }
    if (event.type === "live_chat_message" && !this.config.allowLiveChatResponses) {
      decision.shouldSpeak = false;
      decision.blockedBy = "live_chat_responses_disabled";
      decision.reason = "blocked_by_config";
    }

    this.recordDecision(decision);
    if (!decision.shouldSpeak) return decision;

    const prompt = buildAutonomyPrompt(event, state, this.config);
    decision.prompt = prompt;
    const text = sanitizeAutonomyOutput(await this.resolveText(event, state, prompt));
    if (!text) {
      decision.shouldSpeak = false;
      decision.blockedBy = "empty_text";
      decision.reason = "blocked_empty_text";
      this.recordDecision(decision);
      return decision;
    }
    decision.text = text;
    this.recordDecision(decision);
    await this.options.speak({ text, event, decision });
    this.lastAutonomySpeechAt = Date.now();
    return decision;
  }

  async trigger(input: { type?: string; message?: string; username?: string; text?: string }) {
    const type = input.type === "live_chat_message" ? "live_chat_message" : "manual_trigger";
    const event: AutonomyEvent = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      priority: type === "manual_trigger" ? 95 : 85,
      confidence: 1,
      payload: {
        username: input.username || "tester",
        displayName: input.username || "Tester",
        text: input.message || input.text || "Haz una intervencion breve de prueba",
        mentioned: true
      }
    };
    return this.handleEvent(event);
  }

  getState(): AutonomyStatePayload {
    const runtime = this.buildRuntimeState();
    return {
      ok: true,
      config: this.config,
      runtime,
      canSpeak: canSpeakNow(runtime),
      lastDecision: this.decisions[0] || null
    };
  }

  getDecisions() {
    return { ok: true, items: this.decisions.slice(0, 50) };
  }

  private async resolveText(event: AutonomyEvent, state: AutonomyRuntimeState, prompt: string) {
    if (this.options.generateText && shouldUseLlm(event)) {
      const generated = await this.options.generateText(prompt, event).catch(() => "");
      if (generated.trim()) return generated;
    }
    return templateForEvent(event, state, this.config);
  }

  private buildRuntimeState(): AutonomyRuntimeState {
    const snapshot = this.options.getRuntime();
    return {
      mode: this.config.mode,
      intensity: this.config.intensity,
      enabled: this.config.enabled,
      userIsSpeaking: Boolean(snapshot.userIsSpeaking),
      assistantIsSpeaking: Boolean(snapshot.assistantIsSpeaking),
      llmBusy: Boolean(snapshot.llmBusy),
      ttsQueueLength: Number(snapshot.ttsQueueLength || 0),
      lastUserMessageAt: snapshot.lastUserMessageAt ?? null,
      lastAssistantSpeechAt: snapshot.lastAssistantSpeechAt ?? null,
      lastAutonomySpeechAt: this.lastAutonomySpeechAt,
      lastDecisionAt: this.lastDecisionAt,
      cooldownMs: cooldownFor(this.config),
      doNotDisturbUntil: this.doNotDisturbUntil,
      recentUserMessages: snapshot.recentUserMessages || [],
      recentAssistantMessages: snapshot.recentAssistantMessages || [],
      recentLiveEvents: this.recentLiveEvents.slice(-20),
      recentAutonomyDecisions: this.decisions.slice(0, 20),
      currentTopic: snapshot.currentTopic,
      lastLatencyMs: snapshot.lastLatencyMs
    };
  }

  private recordDecision(decision: AutonomyDecision) {
    this.lastDecisionAt = decision.createdAt;
    this.decisions = [decision, ...this.decisions.filter((item) => item.createdAt !== decision.createdAt)].slice(0, 100);
    this.options.onDecision?.(decision);
    if (this.config.debug) {
      console.log("autonomy_decision", JSON.stringify({
        action: decision.action,
        shouldSpeak: decision.shouldSpeak,
        score: decision.score,
        threshold: decision.threshold,
        reason: decision.reason,
        blockedBy: decision.blockedBy || null,
        eventType: decision.eventType || null
      }));
    }
  }

  private isRateLimited() {
    const since = Date.now() - 10 * 60 * 1000;
    return this.decisions.filter((item) => item.shouldSpeak && item.text && item.createdAt >= since).length >= this.config.maxAutonomousMessagesPer10Min;
  }

  private async maybeEmitSilence() {
    const state = this.buildRuntimeState();
    if (!this.config.enabled || this.config.mode === "off") return;
    if (!canSpeakNow(state).ok) return;
    const lastInteraction = Math.max(state.lastUserMessageAt || 0, state.lastAssistantSpeechAt || 0, state.lastAutonomySpeechAt || 0);
    if (!lastInteraction || Date.now() - lastInteraction < this.config.silenceThresholdMs) return;
    if (Date.now() - this.lastSilenceEventAt < this.config.silenceThresholdMs) return;
    this.lastSilenceEventAt = Date.now();
    await this.handleEvent({
      id: randomUUID(),
      type: "user_silence",
      timestamp: Date.now(),
      priority: 45,
      confidence: 0.8,
      payload: { source: "silence_detector" }
    });
  }
}

// Para que Yuko se sienta una "segunda persona" real interactuando con el live, usa el
// LLM (persona completa) en los eventos con sustancia — chat, regalos, follows, subs,
// silencios y triggers manuales — no solo en preguntas. Los eventos de bajo valor y muy
// frecuentes (likes, conteo de viewers, joins) siguen con plantilla barata. Si el LLM
// devuelve vacio, resolveText cae a la plantilla como respaldo.
function shouldUseLlm(event: AutonomyEvent) {
  return [
    "manual_trigger",
    "live_chat_message",
    "live_gift",
    "live_follow",
    "live_subscribe",
    "live_share",
    "user_silence"
  ].includes(event.type);
}

function sanitizeAutonomyOutput(text: string) {
  return sanitizeLiveText(text)
    .replace(/^Yuko\s*:\s*/i, "")
    .split(/[.!?]\s+/)
    .slice(0, 1)
    .join(" ")
    .trim()
    .slice(0, 180);
}
