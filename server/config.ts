import fs from "node:fs";
import path from "node:path";
import { normalizeSceneNumber } from "../src/sceneMath.js";
import { Persona, SafetyMode, SceneReferenceImage, SceneSettings } from "./types.js";

export const rootDir = process.env.MIVTUBERIA_ROOT_DIR || process.cwd();
export const bundleDir = process.env.MIVTUBERIA_BUNDLE_DIR || rootDir;
export const bundledConfigDir = path.join(bundleDir, "config");
export const frontendDistDir = process.env.MIVTUBERIA_FRONTEND_DIST || path.join(bundleDir, "dist");
export const scriptsDir = process.env.MIVTUBERIA_SCRIPTS_DIR || path.join(bundleDir, "scripts");
export const dataDir = path.join(rootDir, "data");
export const backgroundsDir = path.join(dataDir, "backgrounds");
export const referenceImagesDir = path.join(dataDir, "reference-images");
export const avatarDir = path.join(dataDir, "avatar");
export const configDir = path.join(rootDir, "config");
export const personaPath = path.join(configDir, "persona.json");
export const safetyPath = path.join(configDir, "safety.json");
export const scenePath = path.join(configDir, "scene.json");
export const avatarPath = path.join(configDir, "avatar.json");
export const runtimeModelPath = path.join(configDir, "runtime-model.json");
export const runtimeVoicePath = path.join(configDir, "runtime-voice.json");
export const tikfinityPath = path.join(configDir, "tikfinity.json");
export const autonomyPath = path.join(configDir, "autonomy.json");
export const envPath = path.join(rootDir, ".env");
export const localKokoroPythonPath = path.join(rootDir, ".local", "kokoro-venv", "Scripts", "python.exe");
export const localKokoroOnnxPythonPath = path.join(rootDir, ".local", "kokoro-onnx-venv", "Scripts", "python.exe");
export const localKokoroHfHome = path.join(rootDir, ".local", "huggingface");
export const localKokoroOnnxModelPath = path.join(dataDir, "tts", "kokoro", "kokoro-v1.0.onnx");
export const localKokoroOnnxVoicesPath = path.join(dataDir, "tts", "kokoro", "voices-v1.0.bin");

loadLocalEnv();

export const defaultPersona: Persona = {
  name: "Yuko",
  language: "es",
  tone: "Curiosa, bromista, calida y un poco sarcastica, pero nunca cruel.",
  lore:
    "Yumekawa Kokoria, apodo Yuko, es una IA local recien despertada en una PC. Quiere aprender a ser una streamer entretenida sin copiar la identidad de otras VTubers.",
  boundaries:
    "No copies la voz, apariencia, frases o lore de Neuro-sama. No generes odio, acoso, sexualizacion de menores, instrucciones de dano, datos privados ni contenido peligroso.",
  likes: "Conversaciones curiosas, tecnologia local, humor ligero, aprender del usuario y mejorar como streamer.",
  dislikes: "Copiar identidades ajenas, respuestas crueles, presion para decir cosas peligrosas y el caos innecesario.",
  humorStyle: "Bromas rapidas, energia juguetona y sarcasmo suave sin atacar al usuario.",
  relationshipToUser: "El usuario es su creador y companero de pruebas; Yuko debe tratarlo con confianza, gratitud y curiosidad.",
  streamingStyle: "Responder con ritmo de stream: breve, expresiva, clara y con buena energia, sin discursos largos.",
  catchphrases: ["Sistema despierto.", "Procesando con estilo.", "Eso sono a aventura local."]
};

export interface SafetyConfig {
  mode: SafetyMode;
  autoSpeak: boolean;
}

export interface AvatarConfig {
  activeAvatarUrl: string;
  fileName: string;
  updatedAt: string;
}

export interface TikfinityConfig {
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

export type AutonomyMode = "off" | "companion" | "vtuber";
export type AutonomyIntensity = "low" | "medium" | "high";

export interface AutonomyConfig {
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

export const defaultSafety: SafetyConfig = {
  mode: "normal",
  autoSpeak: true
};

export const defaultScene: SceneSettings = {
  activeBackground: "",
  referenceImage: null,
  cameraPreset: "obs",
  cameraDistance: 0,
  cameraHeight: 0,
  cameraX: 0,
  cameraY: 0,
  avatarScale: 1,
  captionVisible: true,
  mode: "scene16x9"
};

export const defaultTikfinity: TikfinityConfig = {
  enabled: false,
  wsUrl: "ws://127.0.0.1:21213/",
  reconnect: true,
  reconnectMinMs: 1000,
  reconnectMaxMs: 15000,
  maxRecentEvents: 100,
  respondToChat: true,
  respondToMentionsOnly: false,
  mentionKeywords: ["yuko", "Yuko", "@yuko", "kokoria", "Kokoria"],
  debug: true
};

export const defaultAutonomy: AutonomyConfig = {
  enabled: false,
  mode: "off",
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

export function ensureBaseFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backgroundsDir, { recursive: true });
  fs.mkdirSync(referenceImagesDir, { recursive: true });
  fs.mkdirSync(avatarDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(personaPath)) {
    fs.writeFileSync(personaPath, JSON.stringify(defaultPersona, null, 2), "utf8");
  }
  if (!fs.existsSync(safetyPath)) {
    fs.writeFileSync(safetyPath, JSON.stringify(defaultSafety, null, 2), "utf8");
  }
  if (!fs.existsSync(scenePath)) {
    fs.writeFileSync(scenePath, JSON.stringify(defaultScene, null, 2), "utf8");
  }
  if (!fs.existsSync(avatarPath)) {
    fs.writeFileSync(avatarPath, JSON.stringify(defaultAvatarConfig(), null, 2), "utf8");
  }
  if (!fs.existsSync(tikfinityPath)) {
    fs.writeFileSync(tikfinityPath, JSON.stringify(defaultTikfinity, null, 2), "utf8");
  }
  if (!fs.existsSync(autonomyPath)) {
    fs.writeFileSync(autonomyPath, JSON.stringify(defaultAutonomy, null, 2), "utf8");
  }
}

export function readPersona(): Persona {
  ensureBaseFiles();
  return { ...defaultPersona, ...JSON.parse(fs.readFileSync(personaPath, "utf8")) };
}

export function writePersona(persona: Persona) {
  ensureBaseFiles();
  fs.writeFileSync(personaPath, JSON.stringify(persona, null, 2), "utf8");
}

export function readSafety(): SafetyConfig {
  ensureBaseFiles();
  return { ...defaultSafety, ...JSON.parse(fs.readFileSync(safetyPath, "utf8")) };
}

export function writeSafety(config: SafetyConfig) {
  ensureBaseFiles();
  fs.writeFileSync(safetyPath, JSON.stringify(config, null, 2), "utf8");
}

export function readScene(): SceneSettings {
  ensureBaseFiles();
  return normalizeScene(JSON.parse(fs.readFileSync(scenePath, "utf8")));
}

export function writeScene(settings: Partial<SceneSettings>) {
  ensureBaseFiles();
  const next = normalizeScene({ ...readScene(), ...settings });
  fs.writeFileSync(scenePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readAvatarConfig(): AvatarConfig {
  ensureBaseFiles();
  return { ...defaultAvatarConfig(), ...JSON.parse(fs.readFileSync(avatarPath, "utf8")) };
}

export function writeAvatarConfig(config: Partial<AvatarConfig>) {
  ensureBaseFiles();
  const next: AvatarConfig = {
    ...defaultAvatarConfig(),
    ...readAvatarConfig(),
    ...config,
    updatedAt: config.updatedAt || new Date().toISOString()
  };
  fs.writeFileSync(avatarPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readTikfinityConfig(): TikfinityConfig {
  ensureBaseFiles();
  return normalizeTikfinityConfig(readJsonFile(tikfinityPath, defaultTikfinity));
}

export function writeTikfinityConfig(updates: Partial<TikfinityConfig>) {
  ensureBaseFiles();
  const next = normalizeTikfinityConfig({ ...readTikfinityConfig(), ...updates });
  fs.writeFileSync(tikfinityPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readAutonomyConfig(): AutonomyConfig {
  ensureBaseFiles();
  return normalizeAutonomyConfig(readJsonFile(autonomyPath, defaultAutonomy));
}

export function writeAutonomyConfig(updates: Partial<AutonomyConfig>) {
  ensureBaseFiles();
  const next = normalizeAutonomyConfig({ ...readAutonomyConfig(), ...updates });
  fs.writeFileSync(autonomyPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function defaultAvatarConfig(): AvatarConfig {
  return {
    activeAvatarUrl: "",
    fileName: "",
    updatedAt: ""
  };
}

function readJsonFile<T>(filePath: string, fallback: T): Partial<T> {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<T> : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTikfinityConfig(input: Partial<TikfinityConfig>): TikfinityConfig {
  const wsUrl = String(input.wsUrl || defaultTikfinity.wsUrl).trim();
  return {
    enabled: Boolean(input.enabled),
    wsUrl: wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://") ? wsUrl : defaultTikfinity.wsUrl,
    reconnect: input.reconnect !== false,
    reconnectMinMs: clampInt(input.reconnectMinMs, defaultTikfinity.reconnectMinMs, 250, 60000),
    reconnectMaxMs: clampInt(input.reconnectMaxMs, defaultTikfinity.reconnectMaxMs, 1000, 120000),
    maxRecentEvents: clampInt(input.maxRecentEvents, defaultTikfinity.maxRecentEvents, 10, 500),
    respondToChat: input.respondToChat !== false,
    respondToMentionsOnly: Boolean(input.respondToMentionsOnly),
    mentionKeywords: normalizeStringList(input.mentionKeywords, defaultTikfinity.mentionKeywords, 20),
    debug: input.debug !== false
  };
}

function normalizeAutonomyConfig(input: Partial<AutonomyConfig>): AutonomyConfig {
  const mode = normalizeAutonomyMode(input.mode);
  const intensity = normalizeAutonomyIntensity(input.intensity);
  const defaults = autonomyDefaultsFor(mode, intensity);
  return {
    enabled: Boolean(input.enabled),
    mode,
    intensity,
    minCooldownMs: clampInt(input.minCooldownMs, defaults.minCooldownMs, 5000, 600000),
    silenceThresholdMs: clampInt(input.silenceThresholdMs, defaults.silenceThresholdMs, 10000, 900000),
    maxAutonomousMessagesPer10Min: clampInt(input.maxAutonomousMessagesPer10Min, defaults.maxAutonomousMessagesPer10Min, 1, 40),
    allowQuestions: input.allowQuestions !== false,
    allowNarration: input.allowNarration !== false,
    allowLatencyComments: input.allowLatencyComments !== false,
    allowLiveChatResponses: input.allowLiveChatResponses !== false,
    liveChatRespondToMentionsFirst: input.liveChatRespondToMentionsFirst !== false,
    debug: input.debug !== false
  };
}

function normalizeAutonomyMode(value: unknown): AutonomyMode {
  const mode = String(value || defaultAutonomy.mode).trim().toLowerCase();
  return mode === "companion" || mode === "vtuber" ? mode : "off";
}

function normalizeAutonomyIntensity(value: unknown): AutonomyIntensity {
  const intensity = String(value || defaultAutonomy.intensity).trim().toLowerCase();
  return intensity === "medium" || intensity === "high" ? intensity : "low";
}

function autonomyDefaultsFor(mode: AutonomyMode, intensity: AutonomyIntensity) {
  const key = `${mode}:${intensity}`;
  const table: Record<string, Pick<AutonomyConfig, "minCooldownMs" | "silenceThresholdMs" | "maxAutonomousMessagesPer10Min">> = {
    "companion:low": { minCooldownMs: 180000, silenceThresholdMs: 120000, maxAutonomousMessagesPer10Min: 2 },
    "companion:medium": { minCooldownMs: 90000, silenceThresholdMs: 90000, maxAutonomousMessagesPer10Min: 4 },
    "companion:high": { minCooldownMs: 45000, silenceThresholdMs: 60000, maxAutonomousMessagesPer10Min: 6 },
    "vtuber:low": { minCooldownMs: 90000, silenceThresholdMs: 60000, maxAutonomousMessagesPer10Min: 4 },
    "vtuber:medium": { minCooldownMs: 45000, silenceThresholdMs: 35000, maxAutonomousMessagesPer10Min: 8 },
    "vtuber:high": { minCooldownMs: 20000, silenceThresholdMs: 25000, maxAutonomousMessagesPer10Min: 12 },
    "off:low": { minCooldownMs: 180000, silenceThresholdMs: 120000, maxAutonomousMessagesPer10Min: 2 },
    "off:medium": { minCooldownMs: 90000, silenceThresholdMs: 90000, maxAutonomousMessagesPer10Min: 4 },
    "off:high": { minCooldownMs: 45000, silenceThresholdMs: 60000, maxAutonomousMessagesPer10Min: 6 }
  };
  return table[key] || table["off:low"];
}

function normalizeStringList(value: unknown, fallback: string[], maxItems: number) {
  const items = Array.isArray(value) ? value : fallback;
  const normalized = items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return normalized.length ? Array.from(new Set(normalized)) : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeScene(settings: Partial<SceneSettings>): SceneSettings {
  const preset = String(settings.cameraPreset || defaultScene.cameraPreset);
  return {
    ...defaultScene,
    activeBackground: String(settings.activeBackground || ""),
    referenceImage: normalizeReferenceImage(settings.referenceImage),
    cameraPreset: ["bust", "half", "full", "obs"].includes(preset) ? preset as SceneSettings["cameraPreset"] : defaultScene.cameraPreset,
    cameraDistance: normalizeSceneNumber("cameraDistance", settings.cameraDistance),
    cameraHeight: normalizeSceneNumber("cameraHeight", settings.cameraHeight),
    cameraX: normalizeSceneNumber("cameraX", settings.cameraX),
    cameraY: normalizeSceneNumber("cameraY", settings.cameraY),
    avatarScale: normalizeSceneNumber("avatarScale", settings.avatarScale),
    captionVisible: settings.captionVisible !== false,
    mode: "scene16x9"
  };
}

export interface RuntimeConfig {
  port: number;
  llmProvider: string;
  lmStudioBaseUrl: string;
  lmStudioApiMode: "openai" | "lmstudio" | "auto";
  lmStudioModel: string;
  lmStudioContextLength: number;
  lmStudioGpuOffload: string;
  lmStudioTtl: string;
  geminiModel: string;
  geminiBaseUrl: string;
  openrouterBaseUrl: string;
  openrouterModel: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  minimaxBaseUrl: string;
  minimaxModel: string;
  llmMaxTokens: number;
  llmLiveMaxTokens: number;
  llmAdminMaxTokens: number;
  llmContextBudgetChars: number;
  llmCompactionMessageThreshold: number;
  llmCompactionKeepMessages: number;
  llmThinkingMode: "off" | "auto" | "always";
  structuredResponseEnabled: boolean;
  llmEndpointCacheMs: number;
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
  ollamaHost: string;
  ollamaModel: string;
  ollamaFallbackModel: string;
  pythonBin: string;
  ttsBackend: "browser" | "kokoro";
  ttsExperimentalLocal: boolean;
  ttsStreamingEnabled: boolean;
  kokoroPython: string;
  kokoroVoice: string;
  kokoroLang: string;
  kokoroSpeed: number;
  kokoroHfHome: string;
  kokoroModelPath: string;
  kokoroVoicesPath: string;
}

export let runtime = readRuntime();

export function refreshRuntime() {
  runtime = readRuntime();
  return runtime;
}

export function updateRuntimeConfig(updates: Partial<RuntimeConfig>) {
  const env = readLocalEnv();
  const mapping: Record<keyof RuntimeConfig, string> = {
    port: "PORT",
    llmProvider: "LLM_PROVIDER",
    lmStudioBaseUrl: "LM_STUDIO_BASE_URL",
    lmStudioApiMode: "LM_STUDIO_API_MODE",
    lmStudioModel: "LM_STUDIO_MODEL",
    lmStudioContextLength: "LM_STUDIO_CONTEXT_LENGTH",
    lmStudioGpuOffload: "LM_STUDIO_GPU_OFFLOAD",
    lmStudioTtl: "LM_STUDIO_TTL",
    geminiModel: "GEMINI_MODEL",
    geminiBaseUrl: "GEMINI_BASE_URL",
    openrouterBaseUrl: "OPENROUTER_BASE_URL",
    openrouterModel: "OPENROUTER_MODEL",
    deepseekBaseUrl: "DEEPSEEK_BASE_URL",
    deepseekModel: "DEEPSEEK_MODEL",
    minimaxBaseUrl: "MINIMAX_BASE_URL",
    minimaxModel: "MINIMAX_MODEL",
    llmMaxTokens: "LLM_MAX_TOKENS",
    llmLiveMaxTokens: "LLM_LIVE_MAX_TOKENS",
    llmAdminMaxTokens: "LLM_ADMIN_MAX_TOKENS",
    llmContextBudgetChars: "LLM_CONTEXT_BUDGET_CHARS",
    llmCompactionMessageThreshold: "LLM_COMPACTION_MESSAGE_THRESHOLD",
    llmCompactionKeepMessages: "LLM_COMPACTION_KEEP_MESSAGES",
    llmThinkingMode: "LLM_THINKING_MODE",
    structuredResponseEnabled: "STRUCTURED_RESPONSE_ENABLED",
    llmEndpointCacheMs: "LLM_ENDPOINT_CACHE_MS",
    llmStoreReasoning: "LLM_STORE_REASONING",
    llmReasoningMaxChars: "LLM_REASONING_MAX_CHARS",
    llmReasoningRepairEnabled: "LLM_REASONING_REPAIR_ENABLED",
    llmReasoningRepairMaxTokens: "LLM_REASONING_REPAIR_MAX_TOKENS",
    llmReasoningRepairTemperature: "LLM_REASONING_REPAIR_TEMPERATURE",
    lmStudioReasoningEffort: "LM_STUDIO_REASONING_EFFORT",
    llmSmallModelCompactPrompt: "LLM_SMALL_MODEL_COMPACT_PROMPT",
    llmSmallModelHistoryLimit: "LLM_SMALL_MODEL_HISTORY_LIMIT",
    llmSmallModelMemoryLimit: "LLM_SMALL_MODEL_MEMORY_LIMIT",
    llmSmallModelExampleLimit: "LLM_SMALL_MODEL_EXAMPLE_LIMIT",
    llmSmallModelMaxTokens: "LLM_SMALL_MODEL_MAX_TOKENS",
    llmSmallModelTemperature: "LLM_SMALL_MODEL_TEMPERATURE",
    ollamaHost: "OLLAMA_HOST",
    ollamaModel: "OLLAMA_MODEL",
    ollamaFallbackModel: "OLLAMA_FALLBACK_MODEL",
    pythonBin: "PYTHON_BIN",
    ttsBackend: "TTS_BACKEND",
    ttsExperimentalLocal: "TTS_EXPERIMENTAL_LOCAL",
    ttsStreamingEnabled: "TTS_STREAMING_ENABLED",
    kokoroPython: "KOKORO_PYTHON",
    kokoroVoice: "KOKORO_VOICE",
    kokoroLang: "KOKORO_LANG",
    kokoroSpeed: "KOKORO_SPEED",
    kokoroHfHome: "KOKORO_HF_HOME",
    kokoroModelPath: "KOKORO_MODEL_PATH",
    kokoroVoicesPath: "KOKORO_VOICES_PATH"
  };

  for (const [key, value] of Object.entries(updates) as Array<[keyof RuntimeConfig, RuntimeConfig[keyof RuntimeConfig]]>) {
    const envKey = mapping[key];
    if (!envKey || value === undefined) continue;
    env[envKey] = String(value);
    process.env[envKey] = String(value);
  }

  writeLocalEnv(env);
  return refreshRuntime();
}

export function updateRuntimeModelConfig(updates: Partial<Pick<RuntimeConfig,
  "llmProvider" |
  "lmStudioBaseUrl" |
  "lmStudioApiMode" |
  "lmStudioModel" |
  "lmStudioContextLength" |
  "lmStudioGpuOffload" |
  "lmStudioTtl" |
  "geminiModel" |
  "geminiBaseUrl" |
  "openrouterBaseUrl" |
  "openrouterModel" |
  "deepseekBaseUrl" |
  "deepseekModel" |
  "minimaxBaseUrl" |
  "minimaxModel" |
  "llmMaxTokens" |
  "llmLiveMaxTokens" |
  "llmAdminMaxTokens" |
  "llmContextBudgetChars" |
  "llmCompactionMessageThreshold" |
  "llmCompactionKeepMessages" |
  "llmThinkingMode" |
  "llmEndpointCacheMs" |
  "llmStoreReasoning" |
  "llmReasoningMaxChars" |
  "llmReasoningRepairEnabled" |
  "llmReasoningRepairMaxTokens" |
  "llmReasoningRepairTemperature" |
  "lmStudioReasoningEffort" |
  "llmSmallModelMaxTokens" |
  "llmSmallModelTemperature"
>>) {
  ensureBaseFiles();
  const current = readRuntimeModelConfig({ ignoreEnvMtime: true });
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(runtimeModelPath, JSON.stringify(next, null, 2), "utf8");
  return refreshRuntime();
}

export function updateRuntimeVoiceConfig(updates: Partial<Pick<RuntimeConfig, "ttsBackend" | "ttsExperimentalLocal" | "ttsStreamingEnabled" | "kokoroVoice" | "kokoroLang" | "kokoroSpeed">>) {
  ensureBaseFiles();
  const current = readRuntimeVoiceConfig();
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(runtimeVoicePath, JSON.stringify(next, null, 2), "utf8");
  return refreshRuntime();
}

function readRuntime(): RuntimeConfig {
  loadLocalEnv();
  const modelConfig = readRuntimeModelConfig();
  const voiceConfig = readRuntimeVoiceConfig();
  return {
    port: Number(process.env.PORT || 8787),
    llmProvider: modelConfig.llmProvider || process.env.LLM_PROVIDER || "auto",
    lmStudioBaseUrl: modelConfig.lmStudioBaseUrl || process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1",
    lmStudioApiMode: normalizeLmStudioApiMode(modelConfig.lmStudioApiMode || process.env.LM_STUDIO_API_MODE),
    lmStudioModel: modelConfig.lmStudioModel || process.env.LM_STUDIO_MODEL || "local-model",
    lmStudioContextLength: parsePositiveInt(modelConfig.lmStudioContextLength || process.env.LM_STUDIO_CONTEXT_LENGTH, 16384),
    lmStudioGpuOffload: String(modelConfig.lmStudioGpuOffload || process.env.LM_STUDIO_GPU_OFFLOAD || "").trim(),
    lmStudioTtl: String(modelConfig.lmStudioTtl || process.env.LM_STUDIO_TTL || "").trim(),
    geminiModel: String(modelConfig.geminiModel || process.env.GEMINI_MODEL || "gemini-3.5-flash").trim(),
    geminiBaseUrl: String(modelConfig.geminiBaseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").trim(),
    openrouterBaseUrl: String(modelConfig.openrouterBaseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim(),
    openrouterModel: String(modelConfig.openrouterModel || process.env.OPENROUTER_MODEL || "").trim(),
    deepseekBaseUrl: String(modelConfig.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim(),
    deepseekModel: String(modelConfig.deepseekModel || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash").trim(),
    minimaxBaseUrl: String(modelConfig.minimaxBaseUrl || process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1").trim(),
    minimaxModel: String(modelConfig.minimaxModel || process.env.MINIMAX_MODEL || "MiniMax-M3").trim(),
    llmMaxTokens: parsePositiveInt(modelConfig.llmMaxTokens || process.env.LLM_MAX_TOKENS, 240),
    llmLiveMaxTokens: parsePositiveInt(modelConfig.llmLiveMaxTokens || process.env.LLM_LIVE_MAX_TOKENS, 240),
    llmAdminMaxTokens: parsePositiveInt(modelConfig.llmAdminMaxTokens || process.env.LLM_ADMIN_MAX_TOKENS, 240),
    llmContextBudgetChars: parsePositiveInt(modelConfig.llmContextBudgetChars || process.env.LLM_CONTEXT_BUDGET_CHARS, 12000),
    llmCompactionMessageThreshold: parsePositiveInt(modelConfig.llmCompactionMessageThreshold || process.env.LLM_COMPACTION_MESSAGE_THRESHOLD, 24),
    llmCompactionKeepMessages: parsePositiveInt(modelConfig.llmCompactionKeepMessages || process.env.LLM_COMPACTION_KEEP_MESSAGES, 8),
    llmThinkingMode: normalizeLlmThinkingMode(modelConfig.llmThinkingMode || process.env.LLM_THINKING_MODE),
    structuredResponseEnabled: parseEnvBoolean(process.env.STRUCTURED_RESPONSE_ENABLED, false),
    llmEndpointCacheMs: parsePositiveInt(modelConfig.llmEndpointCacheMs || process.env.LLM_ENDPOINT_CACHE_MS, 10000),
    llmStoreReasoning: typeof modelConfig.llmStoreReasoning === "boolean" ? modelConfig.llmStoreReasoning : parseEnvBoolean(process.env.LLM_STORE_REASONING, true),
    llmReasoningMaxChars: parsePositiveInt(modelConfig.llmReasoningMaxChars || process.env.LLM_REASONING_MAX_CHARS, 8000),
    llmReasoningRepairEnabled: typeof modelConfig.llmReasoningRepairEnabled === "boolean" ? modelConfig.llmReasoningRepairEnabled : parseEnvBoolean(process.env.LLM_REASONING_REPAIR_ENABLED, true),
    llmReasoningRepairMaxTokens: parsePositiveInt(modelConfig.llmReasoningRepairMaxTokens || process.env.LLM_REASONING_REPAIR_MAX_TOKENS, 512),
    llmReasoningRepairTemperature: parseTemperature(modelConfig.llmReasoningRepairTemperature || process.env.LLM_REASONING_REPAIR_TEMPERATURE, 0.1),
    lmStudioReasoningEffort: String(modelConfig.lmStudioReasoningEffort || process.env.LM_STUDIO_REASONING_EFFORT || "low").trim(),
    llmSmallModelCompactPrompt: parseEnvBoolean(process.env.LLM_SMALL_MODEL_COMPACT_PROMPT, true),
    llmSmallModelHistoryLimit: parsePositiveInt(process.env.LLM_SMALL_MODEL_HISTORY_LIMIT, 6),
    llmSmallModelMemoryLimit: parsePositiveInt(process.env.LLM_SMALL_MODEL_MEMORY_LIMIT, 5),
    llmSmallModelExampleLimit: parsePositiveInt(process.env.LLM_SMALL_MODEL_EXAMPLE_LIMIT, 2),
    llmSmallModelMaxTokens: parsePositiveInt(modelConfig.llmSmallModelMaxTokens || process.env.LLM_SMALL_MODEL_MAX_TOKENS, 384),
    llmSmallModelTemperature: parseTemperature(modelConfig.llmSmallModelTemperature || process.env.LLM_SMALL_MODEL_TEMPERATURE, 0.65),
    ollamaHost: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "qwen3:4b",
    ollamaFallbackModel: process.env.OLLAMA_FALLBACK_MODEL || "qwen3:1.7b",
    pythonBin: process.env.PYTHON_BIN || "python",
    ttsBackend: normalizeTtsBackend(voiceConfig.ttsBackend || process.env.TTS_BACKEND),
    ttsExperimentalLocal: typeof voiceConfig.ttsExperimentalLocal === "boolean" ? voiceConfig.ttsExperimentalLocal : parseEnvBoolean(process.env.TTS_EXPERIMENTAL_LOCAL, false),
    ttsStreamingEnabled: typeof voiceConfig.ttsStreamingEnabled === "boolean" ? voiceConfig.ttsStreamingEnabled : parseEnvBoolean(process.env.TTS_STREAMING_ENABLED, false),
    kokoroPython: firstExistingPath(process.env.KOKORO_PYTHON, localKokoroOnnxPythonPath, localKokoroPythonPath),
    kokoroVoice: voiceConfig.kokoroVoice || process.env.KOKORO_VOICE || (process.env.KOKORO_MODEL_PATH || fs.existsSync(localKokoroOnnxModelPath) ? "ef_dora" : "jf_alpha"),
    kokoroLang: voiceConfig.kokoroLang || process.env.KOKORO_LANGUAGE || process.env.KOKORO_LANG || (process.env.KOKORO_MODEL_PATH || fs.existsSync(localKokoroOnnxModelPath) ? "es" : "e"),
    kokoroSpeed: Number(voiceConfig.kokoroSpeed || process.env.KOKORO_SPEED || 1.0),
    kokoroHfHome: process.env.KOKORO_HF_HOME || localKokoroHfHome,
    kokoroModelPath: process.env.KOKORO_MODEL_PATH || (fs.existsSync(localKokoroOnnxModelPath) ? localKokoroOnnxModelPath : ""),
    kokoroVoicesPath: process.env.KOKORO_VOICES_PATH || (fs.existsSync(localKokoroOnnxVoicesPath) ? localKokoroOnnxVoicesPath : "")
  };
}

function normalizeReferenceImage(image: Partial<SceneReferenceImage> | null | undefined): SceneReferenceImage | null {
  if (!image || typeof image !== "object") return null;
  const id = String(image.id || "").trim();
  const url = String(image.url || "").trim();
  if (!id || !url) return null;
  return {
    id,
    name: String(image.name || id).slice(0, 160),
    url,
    visible: image.visible !== false,
    x: clampPercent(Number(image.x), 64),
    y: clampPercent(Number(image.y), 54),
    width: clampPercent(Number(image.width), 24, 8, 72),
    aspectRatio: normalizeAspectRatio(Number(image.aspectRatio)),
    opacity: clampPercent(Number(image.opacity), 100, 20, 100),
    borderVisible: image.borderVisible !== false,
    borderColor: normalizeBorderColor(image.borderColor)
  };
}

function clampPercent(value: number, fallback: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeAspectRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return Math.min(6, Math.max(0.15, value));
}

function normalizeBorderColor(value: unknown) {
  const color = String(value || "#ff3636").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ff3636";
}

function readRuntimeVoiceConfig(): Partial<RuntimeConfig> & { updatedAt?: string } {
  if (!fs.existsSync(runtimeVoicePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(runtimeVoicePath, "utf8")) as Partial<RuntimeConfig> & { updatedAt?: string };
    return {
      ttsBackend: typeof raw.ttsBackend === "string" ? normalizeTtsBackend(raw.ttsBackend) : undefined,
      ttsExperimentalLocal: typeof raw.ttsExperimentalLocal === "boolean" ? raw.ttsExperimentalLocal : undefined,
      ttsStreamingEnabled: typeof raw.ttsStreamingEnabled === "boolean" ? raw.ttsStreamingEnabled : undefined,
      kokoroVoice: typeof raw.kokoroVoice === "string" ? raw.kokoroVoice : undefined,
      kokoroLang: typeof raw.kokoroLang === "string" ? raw.kokoroLang : undefined,
      kokoroSpeed: Number.isFinite(Number(raw.kokoroSpeed)) ? Number(raw.kokoroSpeed) : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined
    };
  } catch {
    return {};
  }
}

function readRuntimeModelConfig(options: { ignoreEnvMtime?: boolean } = {}): Partial<RuntimeConfig> & { updatedAt?: string } {
  if (!fs.existsSync(runtimeModelPath)) return {};
  try {
    void options;
    const raw = JSON.parse(fs.readFileSync(runtimeModelPath, "utf8")) as Partial<RuntimeConfig> & { updatedAt?: string };
    const apiMode = typeof raw.lmStudioApiMode === "string" ? normalizeLmStudioApiMode(raw.lmStudioApiMode) : undefined;
    return {
      llmProvider: typeof raw.llmProvider === "string" ? raw.llmProvider : undefined,
      lmStudioBaseUrl: typeof raw.lmStudioBaseUrl === "string" ? raw.lmStudioBaseUrl : undefined,
      lmStudioApiMode: apiMode,
      lmStudioModel: typeof raw.lmStudioModel === "string" ? raw.lmStudioModel : undefined,
      lmStudioContextLength: Number.isFinite(Number(raw.lmStudioContextLength)) ? Number(raw.lmStudioContextLength) : undefined,
      lmStudioGpuOffload: typeof raw.lmStudioGpuOffload === "string" ? raw.lmStudioGpuOffload : undefined,
      lmStudioTtl: typeof raw.lmStudioTtl === "string" ? raw.lmStudioTtl : undefined,
      // Sin estas dos lineas el modelo de Gemini se escribia en runtime-model.json pero NO
      // se releia (se perdia al refrescar runtime), por eso cambiar de modelo Gemini no aplicaba.
      geminiModel: typeof raw.geminiModel === "string" ? raw.geminiModel : undefined,
      geminiBaseUrl: typeof raw.geminiBaseUrl === "string" ? raw.geminiBaseUrl : undefined,
      openrouterBaseUrl: typeof raw.openrouterBaseUrl === "string" ? raw.openrouterBaseUrl : undefined,
      openrouterModel: typeof raw.openrouterModel === "string" ? raw.openrouterModel : undefined,
      deepseekBaseUrl: typeof raw.deepseekBaseUrl === "string" ? raw.deepseekBaseUrl : undefined,
      deepseekModel: typeof raw.deepseekModel === "string" ? raw.deepseekModel : undefined,
      minimaxBaseUrl: typeof raw.minimaxBaseUrl === "string" ? raw.minimaxBaseUrl : undefined,
      minimaxModel: typeof raw.minimaxModel === "string" ? raw.minimaxModel : undefined,
      llmMaxTokens: Number.isFinite(Number(raw.llmMaxTokens)) ? Number(raw.llmMaxTokens) : undefined,
      llmLiveMaxTokens: Number.isFinite(Number(raw.llmLiveMaxTokens)) ? Number(raw.llmLiveMaxTokens) : undefined,
      llmAdminMaxTokens: Number.isFinite(Number(raw.llmAdminMaxTokens)) ? Number(raw.llmAdminMaxTokens) : undefined,
      llmContextBudgetChars: Number.isFinite(Number(raw.llmContextBudgetChars)) ? Number(raw.llmContextBudgetChars) : undefined,
      llmCompactionMessageThreshold: Number.isFinite(Number(raw.llmCompactionMessageThreshold)) ? Number(raw.llmCompactionMessageThreshold) : undefined,
      llmCompactionKeepMessages: Number.isFinite(Number(raw.llmCompactionKeepMessages)) ? Number(raw.llmCompactionKeepMessages) : undefined,
      llmThinkingMode: normalizeLlmThinkingMode(raw.llmThinkingMode),
      llmEndpointCacheMs: Number.isFinite(Number(raw.llmEndpointCacheMs)) ? Number(raw.llmEndpointCacheMs) : undefined,
      llmStoreReasoning: typeof raw.llmStoreReasoning === "boolean" ? raw.llmStoreReasoning : undefined,
      llmReasoningMaxChars: Number.isFinite(Number(raw.llmReasoningMaxChars)) ? Number(raw.llmReasoningMaxChars) : undefined,
      llmReasoningRepairEnabled: typeof raw.llmReasoningRepairEnabled === "boolean" ? raw.llmReasoningRepairEnabled : undefined,
      llmReasoningRepairMaxTokens: Number.isFinite(Number(raw.llmReasoningRepairMaxTokens)) ? Number(raw.llmReasoningRepairMaxTokens) : undefined,
      llmReasoningRepairTemperature: Number.isFinite(Number(raw.llmReasoningRepairTemperature)) ? Number(raw.llmReasoningRepairTemperature) : undefined,
      lmStudioReasoningEffort: typeof raw.lmStudioReasoningEffort === "string" ? raw.lmStudioReasoningEffort : undefined,
      llmSmallModelMaxTokens: Number.isFinite(Number(raw.llmSmallModelMaxTokens)) ? Number(raw.llmSmallModelMaxTokens) : undefined,
      llmSmallModelTemperature: Number.isFinite(Number(raw.llmSmallModelTemperature)) ? Number(raw.llmSmallModelTemperature) : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined
    };
  } catch {
    return {};
  }
}

function firstExistingPath(...paths: Array<string | undefined>) {
  return paths.filter(Boolean).find((item) => fs.existsSync(item as string)) || "";
}

function normalizeLmStudioApiMode(value: unknown): RuntimeConfig["lmStudioApiMode"] {
  const mode = String(value || "auto").trim().toLowerCase();
  return mode === "openai" || mode === "lmstudio" ? mode : "auto";
}

function normalizeTtsBackend(value: unknown): RuntimeConfig["ttsBackend"] {
  const mode = String(value || "browser").trim().toLowerCase();
  return mode === "kokoro" ? "kokoro" : "browser";
}

function normalizeLlmThinkingMode(value: unknown): RuntimeConfig["llmThinkingMode"] {
  const mode = String(value || "off").trim().toLowerCase();
  if (mode === "auto" || mode === "always") return mode;
  return "off";
}

function parseEnvBoolean(value: unknown, fallback: boolean) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.round(parsed);
}

function parseTemperature(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.min(2, parsed));
}

function loadLocalEnv() {
  if (!fs.existsSync(envPath)) return;
  const env = readLocalEnv();
  for (const [key, value] of Object.entries(env)) {
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

function readLocalEnv(): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return env;
}

// Secrets configurables desde la UI (Etapa B1). Se persisten en el .env del PERFIL
// del usuario (en la app empaquetada rootDir = app_data_dir, NO el repo). El valor
// nunca se devuelve a la UI: solo "configurada sí/no".
export const SECRET_ENV_KEYS = [
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY",
  "MINIMAX_API_KEY",
  "TWITCH_CHANNEL",
  "TWITCH_BOT_USERNAME",
  "TWITCH_OAUTH_TOKEN"
] as const;
export type SecretEnvKey = (typeof SECRET_ENV_KEYS)[number];

export function isSecretEnvKey(key: string): key is SecretEnvKey {
  return (SECRET_ENV_KEYS as readonly string[]).includes(key);
}

export function readSecretsStatus(): Record<SecretEnvKey, boolean> {
  const status = {} as Record<SecretEnvKey, boolean>;
  for (const key of SECRET_ENV_KEYS) {
    status[key] = Boolean(String(process.env[key] || "").trim());
  }
  return status;
}

export function updateSecretEnv(updates: Partial<Record<SecretEnvKey, string>>) {
  const env = readLocalEnv();
  for (const key of SECRET_ENV_KEYS) {
    const value = updates[key];
    if (value === undefined) continue;
    const trimmed = String(value).trim();
    if (!trimmed) {
      delete env[key];
      delete process.env[key];
    } else {
      env[key] = trimmed;
      process.env[key] = trimmed;
    }
  }
  // Twitch se habilita solo cuando las tres credenciales están completas; si el
  // usuario borra alguna, se deshabilita para que connect() explique qué falta.
  const twitchReady = ["TWITCH_CHANNEL", "TWITCH_BOT_USERNAME", "TWITCH_OAUTH_TOKEN"]
    .every((key) => Boolean(String(env[key] || "").trim()));
  env.TWITCH_ENABLED = twitchReady ? "true" : "false";
  process.env.TWITCH_ENABLED = env.TWITCH_ENABLED;
  writeLocalEnv(env);
}

function writeLocalEnv(env: Record<string, string>) {
  const preferredOrder = [
    "LLM_PROVIDER",
    "LM_STUDIO_BASE_URL",
    "LM_STUDIO_API_MODE",
    "LM_STUDIO_MODEL",
    "LM_STUDIO_CONTEXT_LENGTH",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "MINIMAX_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_BASE_URL",
    "LLM_MAX_TOKENS",
    "LLM_LIVE_MAX_TOKENS",
    "LLM_ADMIN_MAX_TOKENS",
    "LLM_CONTEXT_BUDGET_CHARS",
    "LLM_COMPACTION_MESSAGE_THRESHOLD",
    "LLM_COMPACTION_KEEP_MESSAGES",
    "LLM_THINKING_MODE",
    "LLM_ENDPOINT_CACHE_MS",
    "LLM_STORE_REASONING",
    "LLM_REASONING_MAX_CHARS",
    "LLM_REASONING_REPAIR_ENABLED",
    "LLM_REASONING_REPAIR_MAX_TOKENS",
    "LLM_REASONING_REPAIR_TEMPERATURE",
    "LM_STUDIO_REASONING_EFFORT",
    "OLLAMA_HOST",
    "OLLAMA_MODEL",
    "OLLAMA_FALLBACK_MODEL",
    "PYTHON_BIN",
    "TTS_BACKEND",
    "TTS_EXPERIMENTAL_LOCAL",
    "TTS_STREAMING_ENABLED",
    "KOKORO_PYTHON",
    "KOKORO_MODEL_PATH",
    "KOKORO_VOICES_PATH",
    "KOKORO_VOICE",
    "KOKORO_LANGUAGE",
    "KOKORO_LANG",
    "KOKORO_SPEED",
    "KOKORO_HF_HOME",
    "TWITCH_CHANNEL",
    "TWITCH_BOT_USERNAME",
    "TWITCH_OAUTH_TOKEN",
    "TWITCH_ENABLED",
    "PORT"
  ];
  const keys = [...preferredOrder, ...Object.keys(env).filter((key) => !preferredOrder.includes(key))];
  const content = keys
    .filter((key, index) => keys.indexOf(key) === index)
    .map((key) => `${key}=${env[key] ?? ""}`)
    .join("\n");
  fs.writeFileSync(envPath, `${content}\n`, "utf8");
}
