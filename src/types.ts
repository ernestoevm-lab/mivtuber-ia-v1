import type { NormalizedChatMessage, StreamPlatform, StreamRawEvent } from "../shared/streamTypes.js";

export type {
  NormalizedChatMessage,
  NormalizedChatUser,
  StreamIngestResult,
  StreamPlatform,
  StreamRawEvent,
  StreamSource
} from "../shared/streamTypes.js";

export type Emotion = "neutral" | "happy" | "annoyed" | "sad" | "surprised" | "thinking" | "safe";
export type EmotionIntensity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type SafetyMode = "normal" | "strict" | "approval" | "silence";
export type ModerationDecision = "allow" | "queued" | "ignored" | "blocked";
export type AvatarCameraPreset = "bust" | "half" | "full" | "obs";

export interface Persona {
  name: string;
  language: "es" | "en" | "mixed";
  tone: string;
  lore: string;
  boundaries: string;
  likes: string;
  dislikes: string;
  humorStyle: string;
  relationshipToUser: string;
  streamingStyle: string;
  catchphrases: string[];
}

export interface MemoryItem {
  id: number;
  content: string;
  importance: number;
  kind?: string;
  scope?: string;
  source?: string | null;
  username?: string | null;
  confidence?: number;
  last_seen_at?: string | null;
  evidence_json?: string | null;
  updated_at?: string | null;
  pinned?: number;
  archived?: number;
  created_at: string;
}

export interface ChatResponseTimings {
  receivedToStartMs?: number;
  personaReadMs?: number;
  historyReadMs?: number;
  contextCompactMs?: number;
  memoryReadMs?: number;
  promptBuildMs?: number;
  llmMs: number;
  llmHttpMs?: number;
  reasoningRepairMs?: number;
  lengthRepairMs?: number;
  responseExtractMs?: number;
  llmTraceSaveMs?: number;
  ttsMs: number;
  ttsBackend?: "browser" | "kokoro";
  ttsEngine?: "browser" | "kokoro-python" | "kokoro-onnx";
  firstAudioMs?: number;
  totalTtsMs?: number;
  ttsFallbackUsed?: boolean;
  messagePersistMs?: number;
  broadcastMs?: number;
  totalMs: number;
  speechStartDelayMs?: number;
  speechPlaybackMs?: number;
  audioDurationMs?: number;
  audioKind?: "audio" | "speechSynthesis" | "none";
}

export interface ChatResponse {
  id: string;
  createdAt: string;
  text: string;
  emotion: Emotion;
  emotionIntensity: EmotionIntensity;
  action: "speak" | "blocked" | "draft" | "silent" | "ignored";
  approved: boolean;
  provider: "lmstudio" | "ollama" | "gemini" | "openrouter" | "deepseek" | "minimax" | "fallback";
  model: string;
  timings: ChatResponseTimings;
  ttsPending?: boolean;
  audio: {
    mimeType: "audio/wav";
    base64: string;
  } | null;
  notices: string[];
  moderation: {
    decision: ModerationDecision;
    reason: string;
    score: number;
    source: string;
  };
}

export interface ChatIngestPayload {
  ok: boolean;
  queued: boolean;
  message?: NormalizedChatMessage;
  rawEvent?: StreamRawEvent;
  moderation: {
    decision: ModerationDecision;
    reason: string;
    score: number;
    source: string;
  };
  guard: GuardStatus;
}

export interface ModerationEvent {
  decision: ModerationDecision;
  reason: string;
  score: number;
  source: string;
  user?: string;
  content: string;
  created_at?: string;
}

export interface GuardStatus {
  ok: boolean;
  queueLength: number;
  nextResponseInMs: number;
  cooldownMs: number;
  userCooldownMs: number;
  lastSelected: ModerationEvent | null;
  recent: ModerationEvent[];
}

export interface StatusPayload {
  ok: boolean;
  safety: {
    mode: SafetyMode;
    autoSpeak: boolean;
  };
  persona: Persona;
  runtime: {
    port: number;
    ollamaHost: string;
    ollamaModel: string;
    ollamaFallbackModel: string;
    lmStudioBaseUrl: string;
    lmStudioApiMode: "openai" | "lmstudio" | "auto";
    lmStudioModel: string;
    lmStudioContextLength: number;
    lmStudioGpuOffload: string;
    lmStudioTtl: string;
    geminiModel: string;
    geminiBaseUrl: string;
    openrouterModel: string;
    openrouterBaseUrl: string;
    deepseekModel: string;
    deepseekBaseUrl: string;
    minimaxModel: string;
    minimaxBaseUrl: string;
    llmMaxTokens: number;
    llmLiveMaxTokens: number;
    llmAdminMaxTokens: number;
    llmContextBudgetChars: number;
    llmCompactionMessageThreshold: number;
    llmCompactionKeepMessages: number;
    llmThinkingMode: "off" | "auto" | "always";
    llmEndpointCacheMs: number;
    llmEffectiveMaxTokens: number;
    llmEffectiveReasoning: boolean;
    llmStoreReasoning: boolean;
    llmReasoningMaxChars: number;
    llmReasoningRepairEnabled: boolean;
    llmReasoningRepairMaxTokens: number;
    llmReasoningRepairTemperature: number;
    lmStudioReasoningEffort: string;
    llmSmallModelCompactPrompt: boolean;
    llmSmallModelHistoryLimit: number;
    llmSmallModelMemoryLimit: number;
    llmSmallModelExampleLimit: number;
    llmSmallModelMaxTokens: number;
    llmSmallModelTemperature: number;
    lmStudioDetected?: {
      ok: boolean;
      apiMode: string;
      baseUrl: string;
      modelsUrl: string;
      chatUrl: string;
      models: string[];
      error?: string;
    };
    lastLlmError?: {
      provider: string;
      model: string;
      endpoint: string;
      apiMode: string;
      error: string;
      at: string;
    } | null;
    lastLlmSuccess?: {
      provider: string;
      model: string;
      endpoint: string;
      apiMode: string;
      at: string;
    } | null;
    llmProvider: string;
    kokoroConfigured: boolean;
    ttsBackend: "browser" | "kokoro";
    ttsExperimentalLocal: boolean;
  };
}

export interface LocalVoice {
  id: string;
  name: string;
  lang: string;
  configured: boolean;
  backend?: "browser" | "kokoro";
  voiceURI?: string;
}

export interface ChatImageAttachment {
  name?: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  aspectRatio?: number;
}

export interface SceneReferenceImage {
  id: string;
  name: string;
  url: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  aspectRatio: number;
  opacity: number;
  borderVisible: boolean;
  borderColor: string;
}

export interface TtsPayload {
  ok: boolean;
  provider: "browser" | "kokoro";
  experimentalLocal: boolean;
  streamingEnabled: boolean;
  ready: boolean;
  localAvailable?: boolean;
  activeBackend?: "browser" | "kokoro";
  fallbackReason?: string | null;
  engine: "browser" | "kokoro-python" | "kokoro-onnx";
  kokoroPython: string;
  kokoroModelPath: string;
  kokoroVoicesPath: string;
  kokoroVoice: string;
  kokoroLang: string;
  kokoroSpeed: number;
  kokoroHfHome: string;
  selectedVoiceId: string;
  availableVoices?: LocalVoice[];
  voices: LocalVoice[];
  kokoro?: {
    configured: boolean;
    workerReady: boolean;
    modelPathExists: boolean;
    voicesPathExists: boolean;
    pythonExists: boolean;
    voice: string;
    language: string;
    speed: number;
  };
  notice: string;
}

export interface TtsTestPayload {
  ok: boolean;
  audio: {
    mimeType: "audio/wav";
    base64: string;
  } | null;
  timings: {
    ttsMs: number;
    firstAudioMs?: number;
    totalTtsMs?: number;
    audioDurationMs?: number;
    rtf?: number;
  };
  backend?: "browser" | "kokoro";
  engine?: "browser" | "kokoro-python" | "kokoro-onnx";
  voice?: string | null;
  fallbackUsed?: boolean;
  notice: string | null;
  status: TtsPayload;
}

export interface LocalModel {
  id: string;
  displayName: string;
  params?: string;
  sizeBytes?: number;
  loaded: boolean;
}

export interface ModelsPayload {
  ok: boolean;
  serverRunning: boolean;
  active: string[];
  models: LocalModel[];
  unloaded?: string[];
  unloadWarnings?: string[];
  activeChatModels?: string[];
  apiMode?: string;
  detectedBaseUrl?: string;
  runtime: StatusPayload["runtime"];
}

export interface SceneSettings {
  activeBackground: string;
  referenceImage: SceneReferenceImage | null;
  cameraPreset: AvatarCameraPreset;
  cameraDistance: number;
  cameraHeight: number;
  cameraX: number;
  cameraY: number;
  avatarScale: number;
  captionVisible: boolean;
  mode: "scene16x9";
}

export interface BackgroundItem {
  id: string;
  name: string;
  url: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ScenePayload {
  ok: boolean;
  scene: SceneSettings;
}

export interface BackgroundsPayload {
  ok: boolean;
  items: BackgroundItem[];
}

export interface AvatarConfigPayload {
  ok: boolean;
  avatar: {
    activeAvatarUrl: string;
    fileName: string;
    updatedAt: string;
  };
  health?: AvatarHealthPayload["health"];
}

export interface AvatarHealthPayload {
  ok: boolean;
  health: {
    activeAvatarUrl: string;
    fileName: string;
    exists: boolean;
    avatarLoaded: boolean;
    avatarMissing: boolean;
    sizeBytes: number;
    servedUrl: string;
    error: string;
  };
}

export interface LlmDiagnosticsPayload {
  ok: boolean;
  providerConfigured: string;
  lmStudioBaseUrl: string;
  lmStudioApiMode: string;
  configuredModel: string;
  loadedModelsFromLmsPs: string[];
  modelsFromOpenAIEndpoint: { ok: boolean; url?: string; models: string[]; error?: string };
  modelsFromNativeEndpoint: { ok: boolean; url?: string; models: string[]; error?: string };
  preferredChatEndpoint: StatusPayload["runtime"]["lmStudioDetected"] & {
    inferenceOk?: boolean;
    inferenceError?: string;
  };
  lastLlmSuccess: StatusPayload["runtime"]["lastLlmSuccess"];
  lastLlmError: StatusPayload["runtime"]["lastLlmError"];
  fallbackActive: boolean;
  modelMatchesLoaded: boolean;
  recommendation: string;
}

export type TwitchConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface TwitchStatusPayload {
  ok: boolean;
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

export type TikfinityConnectionStatus = "disabled" | "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export type LiveEventType = "chat" | "gift" | "like" | "follow" | "share" | "member" | "join" | "subscribe" | "viewer_count" | "unknown";

export interface NormalizedLiveEvent {
  id: string;
  source: "tikfinity";
  type: LiveEventType;
  timestamp: number;
  userId?: string;
  username?: string;
  displayName?: string;
  text?: string;
  giftName?: string;
  giftCount?: number;
  likeCount?: number;
  viewerCount?: number;
  raw: unknown;
}

export interface TikfinityConfigPayload {
  enabled: boolean;
  wsUrl: string;
  reconnect: boolean;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  maxRecentEvents: number;
  respondToChat: boolean;
  respondToMentionsOnly: boolean;
  mentionKeywords: string[];
  debug: boolean;
}

export interface TikfinityStatePayload {
  ok: boolean;
  enabled: boolean;
  wsUrl: string;
  status: TikfinityConnectionStatus;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
  reconnectAttempt: number;
  recentEvents: NormalizedLiveEvent[];
  config: TikfinityConfigPayload;
}

export type AutonomyMode = "off" | "companion" | "vtuber";
export type AutonomyIntensity = "low" | "medium" | "high";
export type AutonomyAction = "speak" | "ask" | "narrate" | "wait" | "emote";

export interface AutonomyConfigPayload {
  enabled: boolean;
  mode: AutonomyMode;
  intensity: AutonomyIntensity;
  minCooldownMs: number;
  silenceThresholdMs: number;
  maxAutonomousMessagesPer10Min: number;
  allowQuestions: boolean;
  allowNarration: boolean;
  allowLatencyComments: boolean;
  allowLiveChatResponses: boolean;
  liveChatRespondToMentionsFirst: boolean;
  debug: boolean;
}

export interface AutonomyDecisionPayload {
  action: AutonomyAction;
  shouldSpeak: boolean;
  score: number;
  threshold: number;
  reason: string;
  prompt?: string;
  text?: string;
  eventType?: string;
  createdAt: number;
  blockedBy?: string;
}

export interface AutonomyStatePayload {
  ok: boolean;
  config: AutonomyConfigPayload;
  runtime: {
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
    recentAutonomyDecisions: AutonomyDecisionPayload[];
    currentTopic?: string;
    lastLatencyMs?: number;
  };
  canSpeak: { ok: boolean; reason?: string };
  lastDecision: AutonomyDecisionPayload | null;
}

export interface AutonomyDecisionsPayload {
  ok: boolean;
  items: AutonomyDecisionPayload[];
}

export interface StreamUserHistoryItem {
  id: string;
  platform: StreamPlatform;
  platform_user_id?: string | null;
  username: string;
  display_name?: string | null;
  is_moderator: number;
  is_subscriber: number;
  is_owner: number;
  badges_json?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  message_count: number;
}

export interface StreamHistoryMessageItem {
  id: string;
  platform: StreamPlatform;
  source: string;
  channel_id?: string | null;
  channel_name?: string | null;
  user_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  direction: "inbound" | "outbound";
  content: string;
  moderation_decision?: string | null;
  moderation_reason?: string | null;
  moderation_score?: number | null;
  reply_to_message_id?: string | null;
  response_id?: string | null;
  created_at: string;
}

export interface ChatHistoryMessageItem {
  id: number;
  role: "user" | "assistant";
  content: string;
  emotion?: string | null;
  source?: string | null;
  response_id?: string | null;
  provider?: "lmstudio" | "ollama" | "fallback" | string | null;
  model?: string | null;
  action?: ChatResponse["action"] | string | null;
  emotion_intensity?: number | null;
  timings_json?: string | null;
  audio_kind?: "audio" | "speechSynthesis" | "none" | string | null;
  created_at: string;
}

export interface ChatHistoryPayload {
  ok: boolean;
  items: ChatHistoryMessageItem[];
}

export interface StreamUsersPayload {
  ok: boolean;
  items: StreamUserHistoryItem[];
}

export interface StreamMessagesPayload {
  ok: boolean;
  items: StreamHistoryMessageItem[];
}

/* Visión / narración de pantalla (compartidos entre App.tsx y src/tabs/LiveTab.tsx). */

export type VisualPromptMode = "look" | "narrate" | "auto";

export type VisualNarrationImage = { src: string; name: string; attachment: ChatImageAttachment; kind: "chat" | "reference" | "capture" };

export type VisualVisionState = "off" | "selecting" | "watching" | "analyzing" | "busy" | "no-change" | "error";

