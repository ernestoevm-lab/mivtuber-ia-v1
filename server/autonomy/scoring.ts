import type { AutonomyConfig } from "../config.js";
import type { AutonomyDecision, AutonomyEvent, AutonomyRuntimeState } from "./types.js";

const thresholds: Record<string, number> = {
  "companion:low": 85,
  "companion:medium": 75,
  "companion:high": 65,
  "vtuber:low": 75,
  "vtuber:medium": 65,
  "vtuber:high": 55,
  "off:low": 999,
  "off:medium": 999,
  "off:high": 999
};

export function thresholdFor(config: Pick<AutonomyConfig, "mode" | "intensity">) {
  return thresholds[`${config.mode}:${config.intensity}`] ?? 85;
}

export function scoreAutonomyEvent(event: AutonomyEvent, state: AutonomyRuntimeState, config: AutonomyConfig): AutonomyDecision {
  const now = Date.now();
  const threshold = thresholdFor(config);
  let score = event.priority * event.confidence;
  const text = String(event.payload?.text || "");
  const mentioned = Boolean(event.payload?.mentioned) || mentionsYuko(text, event.payload?.mentionKeywords);
  const question = /[?¿]|\b(que|qué|como|cómo|puedes|lees|opinas|por que|por qué|cuando|cuándo|donde|dónde)\b/i.test(text);

  if (config.mode === "off" || !config.enabled) score = 0;
  if (config.mode === "vtuber") score += 8;
  if (config.intensity === "medium") score += 6;
  if (config.intensity === "high") score += 12;
  if (event.type === "manual_trigger") score += 60;
  if (event.type === "live_gift") score += 20;
  if (event.type === "live_follow") score += 16;
  if (event.type === "live_share") score += 8;
  if (event.type === "live_chat_message" && mentioned) score += 26;
  if (event.type === "live_chat_message" && question) score += 18;
  if (event.type === "user_silence") score += config.mode === "vtuber" ? 18 : 10;

  if (event.type === "live_chat_message" && config.liveChatRespondToMentionsFirst && !mentioned && !question) score -= 18;
  if (event.type === "live_chat_message" && config.mode === "companion" && !mentioned) score -= 14;
  if (isLowSignalChat(text)) score -= 18;
  if (isSpamLike(text, state.recentLiveEvents.map((item) => item.text || ""))) score -= 35;
  if (state.lastLatencyMs && state.lastLatencyMs > 10000) score -= 10;
  if (state.lastAutonomySpeechAt) {
    const since = now - state.lastAutonomySpeechAt;
    if (since < state.cooldownMs * 1.5) score -= 20;
  }
  if (recentAutonomyQuestion(state)) score -= question ? 10 : 0;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const action = question && config.allowQuestions ? "ask" : event.type === "user_silence" && config.allowNarration ? "narrate" : "speak";
  return {
    action,
    shouldSpeak: score >= threshold && config.enabled && config.mode !== "off",
    score,
    threshold,
    reason: score >= threshold ? "score_met" : "score_below_threshold",
    eventType: event.type,
    createdAt: now
  };
}

export function mentionsYuko(text: string, keywords: unknown) {
  const items = Array.isArray(keywords) ? keywords.map(String) : ["yuko", "@yuko", "kokoria"];
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return items.some((keyword) => {
    const clean = keyword.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return clean && normalized.includes(clean);
  });
}

function isLowSignalChat(text: string) {
  const normalized = text.trim().toLowerCase();
  return !normalized || /^(hola|holi|hey|xd|jaja|ok|si|no|gg)[!. ]*$/i.test(normalized);
}

function isSpamLike(text: string, recent: string[]) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (recent.slice(-12).some((item) => item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim() === normalized)) return true;
  if (/([a-z0-9]{2,8})\1{3,}/i.test(normalized.replace(/\s/g, ""))) return true;
  return false;
}

function recentAutonomyQuestion(state: AutonomyRuntimeState) {
  return state.recentAutonomyDecisions.slice(0, 3).some((decision) => decision.action === "ask" && decision.shouldSpeak);
}
