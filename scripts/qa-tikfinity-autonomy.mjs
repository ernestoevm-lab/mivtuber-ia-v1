const { normalizeTikfinityEvent } = await import("../server/integrations/tikfinity/normalizeTikfinityEvent.ts");
const { canSpeakNow } = await import("../server/autonomy/state.ts");
const { scoreAutonomyEvent } = await import("../server/autonomy/scoring.ts");

function assert(condition, message, detail = {}) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
}

const baseRaw = {
  user: { uniqueId: "tester", nickname: "Tester" },
  timestamp: Date.now()
};

const cases = [
  [{ type: "chat", data: { ...baseRaw, comment: "Hola Yuko, ¿me lees?" } }, "chat"],
  [{ type: "gift", data: { ...baseRaw, giftName: "Rose", repeatCount: 3 } }, "gift"],
  [{ type: "like", data: { ...baseRaw, likeCount: 10 } }, "like"],
  [{ type: "follow", data: baseRaw }, "follow"],
  [{ type: "share", data: baseRaw }, "share"],
  [{ type: "member", data: baseRaw }, "member"],
  [{ type: "join", data: baseRaw }, "join"],
  [{ type: "subscribe", data: baseRaw }, "subscribe"],
  [{ type: "viewer_count", data: { viewerCount: 123 } }, "viewer_count"],
  [{ type: "something-new", data: { value: true } }, "unknown"]
];

for (const [raw, expected] of cases) {
  const event = normalizeTikfinityEvent(raw);
  assert(event.type === expected, `expected ${expected}`, event);
  assert(event.source === "tikfinity", "source should be tikfinity", event);
  assert(event.raw === raw, "raw payload should be preserved", event);
}

const missing = normalizeTikfinityEvent(null);
assert(missing.type === "unknown", "missing payload should normalize as unknown", missing);

const runtime = {
  mode: "companion",
  intensity: "low",
  enabled: true,
  userIsSpeaking: false,
  assistantIsSpeaking: false,
  llmBusy: false,
  ttsQueueLength: 0,
  lastUserMessageAt: Date.now() - 300000,
  lastAssistantSpeechAt: Date.now() - 300000,
  lastAutonomySpeechAt: null,
  lastDecisionAt: null,
  cooldownMs: 180000,
  doNotDisturbUntil: null,
  recentUserMessages: [],
  recentAssistantMessages: [],
  recentLiveEvents: [],
  recentAutonomyDecisions: []
};

assert(canSpeakNow(runtime).ok, "base runtime should allow speech");
assert(canSpeakNow({ ...runtime, enabled: false }).reason === "autonomy_disabled", "disabled should block");
assert(canSpeakNow({ ...runtime, mode: "off" }).reason === "mode_off", "off should block");
assert(canSpeakNow({ ...runtime, assistantIsSpeaking: true }).reason === "assistant_is_speaking", "assistant speaking should block");
assert(canSpeakNow({ ...runtime, ttsQueueLength: 1 }).reason === "tts_queue_busy", "tts queue should block");
assert(canSpeakNow({ ...runtime, lastAutonomySpeechAt: Date.now() - 1000 }).reason === "cooldown", "cooldown should block");

const companionConfig = {
  enabled: true,
  mode: "companion",
  intensity: "low",
  minCooldownMs: 180000,
  silenceThresholdMs: 120000,
  maxAutonomousMessagesPer10Min: 2,
  allowQuestions: true,
  allowNarration: true,
  allowLatencyComments: true,
  allowLiveChatResponses: true,
  liveChatRespondToMentionsFirst: true,
  debug: true
};
const vtuberConfig = { ...companionConfig, mode: "vtuber", intensity: "high", minCooldownMs: 20000, maxAutonomousMessagesPer10Min: 12 };
const mentionEvent = {
  id: "a",
  type: "live_chat_message",
  timestamp: Date.now(),
  priority: 85,
  confidence: 1,
  payload: { text: "Yuko, ¿me lees?", mentionKeywords: ["yuko"], mentioned: true }
};
const genericEvent = {
  ...mentionEvent,
  id: "b",
  priority: 55,
  payload: { text: "hola", mentionKeywords: ["yuko"], mentioned: false }
};

const mentionDecision = scoreAutonomyEvent(mentionEvent, runtime, companionConfig);
const genericDecision = scoreAutonomyEvent(genericEvent, runtime, companionConfig);
assert(mentionDecision.score > genericDecision.score, "mention should score higher than generic chat", { mentionDecision, genericDecision });
assert(mentionDecision.threshold > scoreAutonomyEvent(mentionEvent, { ...runtime, mode: "vtuber", intensity: "high", cooldownMs: 20000 }, vtuberConfig).threshold, "companion threshold should be higher than vtuber");
assert(scoreAutonomyEvent(mentionEvent, runtime, { ...companionConfig, enabled: false, mode: "off" }).shouldSpeak === false, "off mode should not speak");

const spamRuntime = { ...runtime, recentLiveEvents: [{ text: "Yuko, ¿me lees?" }] };
const spamDecision = scoreAutonomyEvent(mentionEvent, spamRuntime, companionConfig);
assert(spamDecision.score < mentionDecision.score, "repeated spam should lower score", { spamDecision, mentionDecision });

console.log("qa-tikfinity-autonomy ok");
