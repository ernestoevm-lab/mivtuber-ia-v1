export type {
  NormalizedChatMessage,
  NormalizedChatUser,
  StreamIngestResult,
  StreamPlatform,
  StreamRawEvent,
  StreamSource
} from "../shared/streamTypes.js";

export type Emotion = "neutral" | "happy" | "annoyed" | "sad" | "surprised" | "thinking" | "safe";
export type YukoMode = "comfy" | "chaos" | "spicy" | "firm" | "narrator" | "neutral";
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

export interface ChatRequest {
  message: string;
  source?: string;
  user?: string;
  requireApproval?: boolean;
  images?: ChatImageAttachment[];
  suppressNoChanges?: boolean;
  visualAuto?: boolean;
  personaDisabled?: boolean;
}

export interface ChatImageAttachment {
  name?: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  aspectRatio?: number;
}

export interface ChatResponse {
  id: string;
  createdAt: string;
  text: string;
  emotion: Emotion;
  emotionIntensity: EmotionIntensity;
  mode?: YukoMode;
  gesture?: string | null;
  structuredSource?: "structured" | "legacy_text_fallback";
  action: "speak" | "blocked" | "draft" | "silent" | "ignored";
  approved: boolean;
  provider: "lmstudio" | "ollama" | "hermes" | "gemini" | "fallback";
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
