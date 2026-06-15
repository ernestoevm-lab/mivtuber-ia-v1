import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { attachEvents, broadcast } from "./events.js";
import { avatarDir, backgroundsDir, defaultPersona, ensureBaseFiles, frontendDistDir, isSecretEnvKey, readAvatarConfig, readPersona, readSafety, readScene, readSecretsStatus, referenceImagesDir, rootDir, runtime, SecretEnvKey, updateRuntimeModelConfig, updateSecretEnv, writeAvatarConfig, writePersona, writeSafety, writeScene } from "./config.js";
import { db, initDb } from "./db.js";
import { listLocalModels, selectLmStudioModel, unloadAllLocalModels, useActiveLmStudioModel } from "./localModels.js";
import { ModerationResult, moderateMessage, normalizeForModeration } from "./moderation.js";
// Legacy name: this routes to the configured local LLM provider, usually LM Studio.
import { askLocalLlm, clearLmStudioEndpointCache, detectLmStudioApi, detectLmStudioInferenceEndpoint, getLmStudioEffectiveSettings, getLlmDiagnostics, isSmallLocalModel, listGeminiModels } from "./ollama.js";
import type { LlmResponse } from "./ollama.js";
import { maybeCompactConversationContext } from "./contextCompactor.js";
import { maybeExtractMemory, searchRelevantMemories } from "./memory.js";
import { inferEmotionState, sanitizeOutput } from "./safety.js";
import { parseYukoResponse } from "./llm/structuredResponse.js";
import { ingestLegacyChatPayload } from "./stream/ingest.js";
import { ingestNormalizedChatMessage, StreamGuardEvent, StreamQueuedChat } from "./stream/ingestService.js";
import { readTwitchConfigFromEnv, TwitchChatAdapter } from "./integrations/twitch/twitchAdapter.js";
import { configureVoice, getTtsStatus, stopTtsWorker, synthesize, warmTts } from "./tts.js";
import type { TtsSynthesisResult } from "./tts.js";
import { BackgroundItem, ChatImageAttachment, ChatRequest, ChatResponse, Persona, SafetyMode, SceneSettings } from "./types.js";
import type { NormalizedChatMessage } from "../shared/streamTypes.js";
import { TikfinityClient } from "./integrations/tikfinity/tikfinityClient.js";
import { applyEmotionToVts, connectVts, disconnectVts, getVtsStatus, listVtsHotkeys, prepareLipSync, setVtsEmotionMap, setVtsEnabled, startPreparedLipSync, stopMouthLipSync, triggerVtsHotkey } from "./integrations/vtubeStudio/vtsClient.js";
import { autonomyEventFromLiveEvent } from "./liveEvents.js";
import { AutonomyDirector } from "./autonomy/director.js";
import type { AutonomyDecision, AutonomyEvent } from "./autonomy/types.js";

ensureBaseFiles();
await initDb().catch((error) => {
  console.warn("SQLite helper could not initialize:", error.message);
});
if (fs.existsSync(path.join(rootDir, "data", "run"))) {
  console.log("runtime_folder_ignored", JSON.stringify({ path: "data/run", reason: "runtime temporal local" }));
}
// Hermes retirado por completo del proyecto (cerebro, endpoints y archivo).

const app = express();
const server = http.createServer(app);
attachEvents(server);

// Windows (WinNAT/Hyper-V) a veces RESERVA el puerto configurado (en esta máquina el rango
// 8746-8845 captura el 8787 por defecto) y el listen muere con EACCES, dejando la app sin
// backend: sin detección de LM Studio, sin modelos Gemini, sin chat. Estos candidatos viven
// fuera de los rangos efímeros típicos; el puerto REAL elegido se expone en /api/status
// (runtime.port) y la UI/OBS ya lo consumen de ahí.
const portCandidates = Array.from(new Set([runtime.port, 17787, 27787, 37787, 47787]));
let portCandidateIndex = 0;
let activeServerPort = portCandidates[0];

// App local-first: solo se permite el panel/viewer/speaker locales. Las requests sin Origin
// (OBS Browser Source, same-origin, herramientas locales) se permiten; los origenes remotos
// se bloquean. Esto endurece el CORS abierto sin romper el flujo local ni OBS.
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      const host = new URL(origin).hostname;
      if (host === "127.0.0.1" || host === "localhost" || host === "::1") return callback(null, true);
    } catch {
      // origin malformado: rechazar abajo
    }
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "80mb" }));

const claimedSpeech = new Map<string, { tabId: string; expiresAt: number }>();
const moderationCooldownMs = 8000;
const userCooldownMs = 30000;
const queueTtlMs = 60000;
const maxQueueSize = 50;
const chatQueue: StreamQueuedChat[] = [];
const recentNormalizedMessages: string[] = [];
const userLastSelected = new Map<string, number>();
let lastGlobalSelectionAt = 0;
let queueTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;
let lastSelectedModeration: StreamGuardEvent | null = null;
let runtimeShutdownStarted = false;
let avatarMissingLogged = false;
let activeLlmRequests = 0;
let activeAutonomySpeech = 0;
let lastUserMessageAt: number | null = null;
let lastAssistantSpeechAt: number | null = null;
let lastLatencyMs: number | undefined;
const recentUserMessagesForAutonomy: string[] = [];
const recentAssistantMessagesForAutonomy: string[] = [];
const twitchAdapter = new TwitchChatAdapter(readTwitchConfigFromEnv(process.env));
const tikfinityClient = new TikfinityClient();
const autonomyDirector = new AutonomyDirector({
  getRuntime: () => ({
    assistantIsSpeaking: activeAutonomySpeech > 0,
    llmBusy: activeLlmRequests > 0,
    ttsQueueLength: activeAutonomySpeech,
    lastUserMessageAt,
    lastAssistantSpeechAt,
    recentUserMessages: recentUserMessagesForAutonomy,
    recentAssistantMessages: recentAssistantMessagesForAutonomy,
    currentTopic: recentUserMessagesForAutonomy.at(-1),
    lastLatencyMs
  }),
  speak: speakAutonomy,
  generateText: generateAutonomyText,
  onDecision: (decision) => broadcast("autonomy_decision", decision)
});

twitchAdapter.onMessage(async (normalized) => {
  const result = await ingestStreamMessage(normalized);
  if (result) {
    broadcast("stream_message", {
      ...normalized,
      moderation: result.moderation,
      guard: result.guard
    });
  }
  broadcast("twitch", twitchAdapter.getStatus());
});

tikfinityClient.onEvent(async (event) => {
  autonomyDirector.rememberLiveEvent(event);
  const state = tikfinityClient.getState();
  const autonomyEvent = autonomyEventFromLiveEvent(event, state.config);
  broadcast("tikfinity_event", event);
  broadcast("tikfinity", state);
  if (event.type === "chat" && !state.config.respondToChat) return;
  if (event.type === "chat" && state.config.respondToMentionsOnly && !autonomyEvent.payload?.mentioned) return;
  const decision = await autonomyDirector.handleEvent(autonomyEvent);
  broadcast("autonomy", autonomyDirector.getState());
  broadcast("autonomy_decision", decision);
});

autonomyDirector.start();

app.get("/api/status", async (_req, res) => {
  const safety = readSafety();
  const tts = getTtsStatus();
  const llm = getLlmDiagnostics();
  const effective = getLmStudioEffectiveSettings("admin");
  const lmStudio = await detectLmStudioApi().catch((error) => ({
    ok: false,
    apiMode: runtime.lmStudioApiMode,
    baseUrl: runtime.lmStudioBaseUrl,
    modelsUrl: "",
    chatUrl: "",
    models: [],
    error: error instanceof Error ? error.message : "LM Studio detection failed"
  }));
  res.json({
    ok: true,
    safety,
    persona: readPersona(),
    runtime: {
      port: activeServerPort,
      llmProvider: runtime.llmProvider,
      lmStudioBaseUrl: runtime.lmStudioBaseUrl,
      lmStudioApiMode: runtime.lmStudioApiMode,
      lmStudioModel: runtime.lmStudioModel,
      geminiModel: runtime.geminiModel,
      geminiBaseUrl: runtime.geminiBaseUrl,
      lmStudioContextLength: runtime.lmStudioContextLength,
      lmStudioGpuOffload: runtime.lmStudioGpuOffload,
      lmStudioTtl: runtime.lmStudioTtl,
      llmMaxTokens: runtime.llmMaxTokens,
      llmLiveMaxTokens: runtime.llmLiveMaxTokens,
      llmAdminMaxTokens: runtime.llmAdminMaxTokens,
      llmContextBudgetChars: runtime.llmContextBudgetChars,
      llmCompactionMessageThreshold: runtime.llmCompactionMessageThreshold,
      llmCompactionKeepMessages: runtime.llmCompactionKeepMessages,
      llmThinkingMode: runtime.llmThinkingMode,
      llmEndpointCacheMs: runtime.llmEndpointCacheMs,
      llmEffectiveMaxTokens: effective.maxTokens,
      llmEffectiveReasoning: effective.reasoningEnabled,
      llmStoreReasoning: runtime.llmStoreReasoning,
      llmReasoningMaxChars: runtime.llmReasoningMaxChars,
      llmReasoningRepairEnabled: runtime.llmReasoningRepairEnabled,
      llmReasoningRepairMaxTokens: runtime.llmReasoningRepairMaxTokens,
      llmReasoningRepairTemperature: runtime.llmReasoningRepairTemperature,
      lmStudioReasoningEffort: runtime.lmStudioReasoningEffort,
      llmSmallModelCompactPrompt: runtime.llmSmallModelCompactPrompt,
      llmSmallModelHistoryLimit: runtime.llmSmallModelHistoryLimit,
      llmSmallModelMemoryLimit: runtime.llmSmallModelMemoryLimit,
      llmSmallModelExampleLimit: runtime.llmSmallModelExampleLimit,
      llmSmallModelMaxTokens: runtime.llmSmallModelMaxTokens,
      llmSmallModelTemperature: runtime.llmSmallModelTemperature,
      lmStudioDetected: lmStudio,
      lastLlmError: llm.lastLlmError,
      lastLlmSuccess: llm.lastLlmSuccess,
      ollamaHost: runtime.ollamaHost,
      ollamaModel: runtime.ollamaModel,
      ollamaFallbackModel: runtime.ollamaFallbackModel,
      kokoroConfigured: tts.localAvailable,
      ttsBackend: runtime.ttsBackend,
      ttsExperimentalLocal: runtime.ttsExperimentalLocal
    }
  });
});

app.get("/api/tikfinity/state", (_req, res) => {
  res.json({ ok: true, ...tikfinityClient.getState() });
});

app.post("/api/tikfinity/config", (req, res) => {
  const state = tikfinityClient.updateConfig(req.body || {});
  broadcast("tikfinity", state);
  res.json({ ok: true, ...state });
});

app.post("/api/tikfinity/connect", async (_req, res) => {
  const state = await tikfinityClient.connect();
  broadcast("tikfinity", state);
  res.json({ ok: true, ...state });
});

app.post("/api/tikfinity/disconnect", async (_req, res) => {
  const state = await tikfinityClient.disconnect();
  broadcast("tikfinity", state);
  res.json({ ok: true, ...state });
});

app.post("/api/tikfinity/test-event", async (req, res) => {
  const event = tikfinityClient.injectTestEvent(req.body && Object.keys(req.body).length ? req.body : {
    type: "chat",
    username: "tester",
    displayName: "Tester",
    text: "Hola Yuko, ¿me lees?"
  });
  const state = tikfinityClient.getState();
  broadcast("tikfinity_event", event);
  broadcast("tikfinity", state);
  res.json({ ok: true, event, state: { ok: true, ...state } });
});

app.get("/api/autonomy/state", (_req, res) => {
  res.json(autonomyDirector.getState());
});

app.post("/api/autonomy/config", (req, res) => {
  const state = autonomyDirector.updateConfig(req.body || {});
  broadcast("autonomy", state);
  res.json(state);
});

app.post("/api/autonomy/trigger", async (req, res) => {
  const decision = await autonomyDirector.trigger(req.body || {});
  const state = autonomyDirector.getState();
  broadcast("autonomy", state);
  broadcast("autonomy_decision", decision);
  res.json({ ok: true, decision, state });
});

app.get("/api/autonomy/decisions", (_req, res) => {
  res.json(autonomyDirector.getDecisions());
});

app.get("/api/models", async (_req, res) => {
  const models = await listLocalModels().catch((error) => ({
    serverRunning: false,
    active: [],
    models: [],
    error: error instanceof Error ? error.message : "Unknown model error"
  }));
  res.json({
    ok: true,
    runtime,
    ...models
  });
});

app.get("/api/llm/gemini-models", async (_req, res) => {
  const result = await listGeminiModels();
  res.json(result);
});

app.get("/api/vts/status", (_req, res) => {
  res.json({ ok: true, vts: getVtsStatus() });
});

app.post("/api/vts/connect", async (_req, res) => {
  try {
    const vts = await connectVts();
    res.json({ ok: true, vts });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "No pude conectar a VTube Studio.", vts: getVtsStatus() });
  }
});

app.post("/api/vts/disconnect", (_req, res) => {
  disconnectVts();
  res.json({ ok: true, vts: getVtsStatus() });
});

app.get("/api/vts/hotkeys", async (_req, res) => {
  try {
    const hotkeys = await listVtsHotkeys();
    res.json({ ok: true, hotkeys });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "No pude leer hotkeys de VTube Studio." });
  }
});

app.post("/api/vts/trigger", async (req, res) => {
  const hotkeyID = String(req.body?.hotkeyID || "").trim();
  if (!hotkeyID) {
    res.status(400).json({ ok: false, error: "hotkeyID es obligatorio." });
    return;
  }
  try {
    await triggerVtsHotkey(hotkeyID);
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "No pude disparar el hotkey." });
  }
});

app.post("/api/vts/preview-emotion", async (req, res) => {
  const emotion = String(req.body?.emotion || "").trim();
  if (!emotion) {
    res.status(400).json({ ok: false, error: "emotion es obligatorio." });
    return;
  }
  // Usa la misma lógica de "poner" que el flujo real (no togglea).
  await applyEmotionToVts(emotion);
  res.json({ ok: true });
});

app.post("/api/vts/emotion-map", (req, res) => {
  const map = req.body?.map && typeof req.body.map === "object" ? req.body.map as Record<string, string> : {};
  const vts = setVtsEmotionMap(map);
  res.json({ ok: true, vts });
});

// El navegador avisa que el audio EMPEZÓ a sonar -> arranca la boca sincronizada.
app.post("/api/vts/lipsync-start", (req, res) => {
  const responseId = String(req.body?.responseId || "").trim();
  const started = responseId ? startPreparedLipSync(responseId) : false;
  res.json({ ok: true, started });
});

// El navegador avisa que el audio terminó/se cortó -> cierra la boca.
app.post("/api/vts/lipsync-stop", (_req, res) => {
  stopMouthLipSync();
  res.json({ ok: true });
});

app.post("/api/vts/enabled", (req, res) => {
  const enabled = req.body?.enabled !== false;
  const vts = setVtsEnabled(enabled);
  res.json({ ok: true, vts });
});

app.get("/api/llm/diagnostics", async (_req, res) => {
  const [models, openAiModels, nativeModels, preferred] = await Promise.all([
    listLocalModels().catch((error) => ({
      serverRunning: false,
      active: [] as string[],
      models: [],
      error: error instanceof Error ? error.message : "Unknown model error"
    })),
    fetchLmStudioModels("openai").catch((error) => ({ ok: false, models: [], error: error instanceof Error ? error.message : "OpenAI endpoint failed" })),
    fetchLmStudioModels("lmstudio").catch((error) => ({ ok: false, models: [], error: error instanceof Error ? error.message : "Native endpoint failed" })),
    detectLmStudioInferenceEndpoint().catch((error) => ({
      ok: false,
      apiMode: runtime.lmStudioApiMode,
      baseUrl: runtime.lmStudioBaseUrl,
      modelsUrl: "",
      chatUrl: "",
      models: [] as string[],
      error: error instanceof Error ? error.message : "Inference detection failed"
    }))
  ]);
  const llm = getLlmDiagnostics();
  const loaded = models.active || [];
  const configuredModel = runtime.lmStudioModel;
  const modelMatchesLoaded = loaded.includes(configuredModel);
  res.json({
    ok: true,
    providerConfigured: runtime.llmProvider,
    lmStudioBaseUrl: runtime.lmStudioBaseUrl,
    lmStudioApiMode: runtime.lmStudioApiMode,
    configuredModel,
    loadedModelsFromLmsPs: loaded,
    modelsFromOpenAIEndpoint: openAiModels,
    modelsFromNativeEndpoint: nativeModels,
    preferredChatEndpoint: preferred,
    lastLlmSuccess: llm.lastLlmSuccess,
    lastLlmError: llm.lastLlmError,
    fallbackActive: llm.lastLlmSuccess?.provider === "fallback" || Boolean(llm.lastLlmError && llm.lastLlmError.provider === runtime.llmProvider),
    modelMatchesLoaded,
    recommendation: buildLlmRecommendation({
      configuredModel,
      loaded,
      preferredOk: Boolean(preferred.ok),
      preferredError: preferred.error || ("inferenceError" in preferred ? preferred.inferenceError || "" : ""),
      modelMatchesLoaded
    })
  });
});

app.post("/api/models/select", async (req, res) => {
  const modelId = String(req.body?.modelId || "").trim();
  if (!modelId) {
    res.status(400).json({ ok: false, error: "modelId is required" });
    return;
  }
  try {
    const result = await selectLmStudioModel(modelId);
    broadcast("runtime", result.runtime);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Could not load model" });
  }
});

app.post("/api/models/use-active", async (_req, res) => {
  try {
    const result = await useActiveLmStudioModel();
    broadcast("runtime", result.runtime);
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Could not use active LM Studio model" });
  }
});

app.post("/api/runtime", (req, res) => {
  const prevProvider = String(runtime.llmProvider || "").toLowerCase();
  const body = req.body as Partial<{
    llmProvider: string;
    lmStudioBaseUrl: string;
    lmStudioApiMode: "openai" | "lmstudio" | "auto";
    lmStudioModel: string;
    lmStudioContextLength: number;
    lmStudioGpuOffload: string;
    lmStudioTtl: string;
    geminiModel: string;
    geminiBaseUrl: string;
    llmMaxTokens: number;
    llmLiveMaxTokens: number;
    llmAdminMaxTokens: number;
    llmContextBudgetChars: number;
    llmCompactionMessageThreshold: number;
    llmCompactionKeepMessages: number;
    llmThinkingMode: "off" | "auto" | "always";
    llmEndpointCacheMs: number;
    llmStoreReasoning: boolean;
    llmReasoningMaxChars: number;
    llmReasoningRepairEnabled: boolean;
    llmReasoningRepairMaxTokens: number;
    llmReasoningRepairTemperature: number;
    lmStudioReasoningEffort: string;
    llmSmallModelMaxTokens: number;
    llmSmallModelTemperature: number;
    ollamaHost: string;
    ollamaModel: string;
    ollamaFallbackModel: string;
  }>;
  const next = updateRuntimeModelConfig({
    llmProvider: body.llmProvider,
    lmStudioBaseUrl: body.lmStudioBaseUrl,
    lmStudioApiMode: body.lmStudioApiMode,
    lmStudioModel: body.lmStudioModel,
    lmStudioContextLength: body.lmStudioContextLength,
    lmStudioGpuOffload: body.lmStudioGpuOffload,
    lmStudioTtl: body.lmStudioTtl,
    geminiModel: body.geminiModel,
    geminiBaseUrl: body.geminiBaseUrl,
    llmMaxTokens: body.llmMaxTokens,
    llmLiveMaxTokens: body.llmLiveMaxTokens,
    llmAdminMaxTokens: body.llmAdminMaxTokens,
    llmContextBudgetChars: body.llmContextBudgetChars,
    llmCompactionMessageThreshold: body.llmCompactionMessageThreshold,
    llmCompactionKeepMessages: body.llmCompactionKeepMessages,
    llmThinkingMode: body.llmThinkingMode,
    llmEndpointCacheMs: body.llmEndpointCacheMs,
    llmStoreReasoning: body.llmStoreReasoning,
    llmReasoningMaxChars: body.llmReasoningMaxChars,
    llmReasoningRepairEnabled: body.llmReasoningRepairEnabled,
    llmReasoningRepairMaxTokens: body.llmReasoningRepairMaxTokens,
    llmReasoningRepairTemperature: body.llmReasoningRepairTemperature,
    lmStudioReasoningEffort: body.lmStudioReasoningEffort,
    llmSmallModelMaxTokens: body.llmSmallModelMaxTokens,
    llmSmallModelTemperature: body.llmSmallModelTemperature
  });
  clearLmStudioEndpointCache();
  // Si se cambia a un cerebro en la nube (Gemini), descargar el modelo local para
  // liberar la VRAM: ese es el punto de usar la nube. Best-effort, no bloquea.
  const newProvider = String(next.llmProvider || "").toLowerCase();
  if (newProvider === "gemini" && prevProvider !== "gemini") {
    void unloadAllLocalModels().then((result) => {
      console.log("vram_freed_on_cloud_switch", JSON.stringify({ ok: result.ok }));
    });
  }
  broadcast("runtime", next);
  res.json({ ok: true, runtime: next });
});

app.get("/api/scene", (_req, res) => {
  res.json({ ok: true, scene: readScene() });
});

app.post("/api/scene", (req, res) => {
  const body = req.body as Partial<SceneSettings>;
  const scene = writeScene(body);
  broadcast("scene", scene);
  res.json({ ok: true, scene });
});

app.get("/api/backgrounds", (_req, res) => {
  res.json({ ok: true, items: listBackgrounds() });
});

app.post("/api/backgrounds", (req, res) => {
  const name = String(req.body?.name || "fondo").trim();
  const mimeType = String(req.body?.mimeType || "").trim().toLowerCase();
  const base64 = String(req.body?.base64 || "").trim();
  const extension = mimeToExtension(mimeType);
  if (!extension || !base64) {
    res.status(400).json({ ok: false, error: "Sube una imagen PNG, JPG o WebP." });
    return;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!looksLikeImage(buffer, mimeType)) {
    res.status(400).json({ ok: false, error: "El archivo no parece una imagen valida." });
    return;
  }
  if (buffer.length > 12 * 1024 * 1024) {
    res.status(413).json({ ok: false, error: "El fondo debe pesar menos de 12 MB." });
    return;
  }
  const id = `${Date.now()}-${safeFileBase(name)}.${extension}`;
  const filePath = path.join(backgroundsDir, id);
  fs.mkdirSync(backgroundsDir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  const items = listBackgrounds();
  const scene = writeScene({ activeBackground: id });
  broadcast("backgrounds", { items });
  broadcast("scene", scene);
  res.json({ ok: true, item: backgroundItem(id), items, scene });
});

app.post("/api/reference-image", (req, res) => {
  const body = req.body || {};
  const mimeType = String(body.mimeType || "");
  const base64 = String(body.base64 || "").replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "").trim();
  const ext = mimeToExtension(mimeType);
  if (!ext || !base64) {
    res.status(400).json({ ok: false, error: "Sube una imagen PNG, JPG o WebP." });
    return;
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 8 * 1024 * 1024 || !looksLikeImage(buffer, mimeType)) {
    res.status(400).json({ ok: false, error: "El archivo no parece una imagen valida o supera 8 MB." });
    return;
  }
  const originalName = String(body.name || "imagen").replace(/[^\w.\- ]+/g, "").slice(0, 80) || "imagen";
  const id = `ref-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  fs.mkdirSync(referenceImagesDir, { recursive: true });
  fs.writeFileSync(path.join(referenceImagesDir, id), buffer);
  const previous = readScene().referenceImage;
  const scene = writeScene({
    referenceImage: {
      id,
      name: originalName,
      url: `/api/reference-image-file/${encodeURIComponent(id)}`,
      visible: true,
      x: previous?.x ?? 68,
      y: previous?.y ?? 54,
      width: previous?.width ?? 24,
      aspectRatio: normalizeReferenceAspectRatio(body.aspectRatio),
      opacity: previous?.opacity ?? 100,
      borderVisible: previous?.borderVisible ?? true,
      borderColor: previous?.borderColor ?? "#ff3636"
    }
  });
  broadcast("scene", scene);
  res.json({ ok: true, scene, image: scene.referenceImage });
});

app.get("/api/reference-image-file/:id", (req, res) => {
  const safeId = path.basename(String(req.params.id || ""));
  const filePath = path.join(referenceImagesDir, safeId);
  if (!safeId || !filePath.startsWith(referenceImagesDir) || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

app.delete("/api/reference-image/:id", (req, res) => {
  const safeId = path.basename(String(req.params.id || ""));
  const filePath = path.join(referenceImagesDir, safeId);
  const scene = readScene();
  if (!safeId || !filePath.startsWith(referenceImagesDir)) {
    res.status(400).json({ ok: false, error: "Imagen de referencia invalida." });
    return;
  }
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  } else {
    console.warn("reference_image_missing", JSON.stringify({ id: safeId }));
  }
  const nextScene = writeScene({
    referenceImage: scene.referenceImage?.id === safeId ? null : scene.referenceImage
  });
  broadcast("scene", nextScene);
  res.json({ ok: true, scene: nextScene });
});

app.get("/api/avatar", (_req, res) => {
  const avatar = readAvatarConfig();
  const health = getAvatarHealth(avatar);
  res.json({
    ok: true,
    avatar: health.exists ? avatar : { ...avatar, activeAvatarUrl: "" },
    health
  });
});

app.get("/api/avatar/health", (_req, res) => {
  res.json({ ok: true, health: getAvatarHealth() });
});

app.post("/api/avatar", (req, res) => {
  const name = String(req.body?.name || "luma.vrm").trim();
  const mimeType = String(req.body?.mimeType || "").trim().toLowerCase();
  const base64 = String(req.body?.base64 || "").trim();
  if (!/\.vrm$/i.test(name) || (!mimeType.includes("vrm") && mimeType !== "application/octet-stream" && mimeType !== "")) {
    res.status(400).json({ ok: false, error: "Sube un archivo .vrm valido." });
    return;
  }
  if (!base64) {
    res.status(400).json({ ok: false, error: "El archivo VRM esta vacio." });
    return;
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 50 * 1024 * 1024) {
    res.status(413).json({ ok: false, error: "El VRM debe pesar menos de 50 MB." });
    return;
  }
  fs.mkdirSync(avatarDir, { recursive: true });
  const filePath = path.join(avatarDir, "current.vrm");
  fs.writeFileSync(filePath, buffer);
  const avatar = writeAvatarConfig({
    activeAvatarUrl: `/avatar/current.vrm?v=${Date.now()}`,
    fileName: path.basename(name),
    updatedAt: new Date().toISOString()
  });
  const health = getAvatarHealth();
  broadcast("avatar", { ...avatar, health });
  res.json({ ok: true, avatar, health });
});

app.get("/api/tts", (_req, res) => {
  res.json(getTtsStatus());
});

app.get("/api/tts/status", (_req, res) => {
  res.json(getTtsStatus());
});

app.post("/api/tts/config", (req, res) => {
  const voiceId = String(req.body?.voiceId || "").trim();
  const backend = String(req.body?.backend || "").trim() as "browser" | "kokoro" | "";
  const experimentalLocal = typeof req.body?.experimentalLocal === "boolean" ? req.body.experimentalLocal : undefined;
  const speed = Number(req.body?.speed);
  try {
    const result = configureVoice({
      voiceId: voiceId || undefined,
      backend: backend === "browser" || backend === "kokoro" ? backend : undefined,
      experimentalLocal,
      speed: Number.isFinite(speed) ? speed : undefined
    });
    broadcast("runtime", result.runtime);
    broadcast("tts", result.status);
    if (result.status.activeBackend === "kokoro") {
      void warmTts().then(() => {
        broadcast("tts", getTtsStatus());
      }).catch((error) => {
        console.warn("Kokoro warmup after voice config skipped:", error instanceof Error ? error.message : error);
      });
    }
    res.json(result.status);
  } catch (error) {
    res.status(404).json({ ok: false, error: error instanceof Error ? error.message : "Could not configure voice" });
  }
});

app.post("/api/tts/test", async (req, res) => {
  const text = String(req.body?.text || `Hola, soy ${readPersona().name || "Yuko"}. Esta es mi voz local.`).trim();
  const voiceId = String(req.body?.voiceId || "").trim();
  const backend = String(req.body?.backend || "").trim() as "browser" | "kokoro" | "";
  const effectiveBackend = backend === "browser" || backend === "kokoro" ? backend : undefined;
  const status = getTtsStatus();
  const voice = voiceId ? [...(status.availableVoices || []), ...(status.voices || [])].find((item) => item.id === voiceId) : null;
  const started = Date.now();
  const result: TtsSynthesisResult = await synthesize(text, voice ? {
    voice: voice.id,
    lang: voice.lang,
    speed: runtime.kokoroSpeed,
    backend: effectiveBackend,
    experimentalLocal: effectiveBackend === "kokoro" ? true : undefined
  } : {
    backend: effectiveBackend,
    experimentalLocal: effectiveBackend === "kokoro" ? true : undefined
  }).catch((error) => ({
    audio: null,
    notice: error instanceof Error ? error.message : "Could not synthesize test audio",
    backend: "browser" as const,
    engine: "browser" as const,
    fallbackUsed: true,
    timings: { totalTtsMs: Date.now() - started }
  }));
  res.json({
    ok: true,
    audio: result.audio,
    timings: {
      ttsMs: result.timings.totalTtsMs || Date.now() - started,
      firstAudioMs: result.timings.firstAudioMs,
      totalTtsMs: result.timings.totalTtsMs,
      audioDurationMs: result.timings.audioDurationMs,
      rtf: result.timings.rtf
    },
    notice: result.notice || null,
    backend: result.backend,
    engine: result.engine,
    voice: result.voice || null,
    fallbackUsed: result.fallbackUsed,
    status: getTtsStatus()
  });
});

app.get("/api/persona", (_req, res) => {
  res.json(readPersona());
});

app.post("/api/persona", (req, res) => {
  try {
    const body = req.body as Partial<Persona>;
    const current = readPersona();
    const persona: Persona = {
      ...defaultPersona,
      ...current,
      ...body,
      name: String(body.name || current.name || defaultPersona.name).trim() || defaultPersona.name,
      catchphrases: Array.isArray(body.catchphrases) ? body.catchphrases : current.catchphrases
    };
    writePersona(persona);
    broadcast("persona", persona);
    res.json(persona);
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "No pude guardar la persona." });
  }
});

app.get("/api/memories", async (_req, res) => {
  const result = await db("memories", { limit: 100 }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not read memories",
    items: []
  }));
  res.json(result);
});

app.post("/api/memories", async (req, res) => {
  const content = String(req.body?.content || "").trim();
  const importance = clampImportance(req.body?.importance);
  if (!content) {
    res.status(400).json({ ok: false, error: "Memory content is required" });
    return;
  }
  const result = await db("add_memory", { content, importance }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not create memory"
  }));
  broadcast("memories", result);
  res.json(result);
});

app.patch("/api/memories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const content = String(req.body?.content || "").trim();
  const importance = clampImportance(req.body?.importance);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "Invalid memory id" });
    return;
  }
  if (!content) {
    res.status(400).json({ ok: false, error: "Memory content is required" });
    return;
  }
  const result = await db("update_memory", { id, content, importance }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not update memory"
  }));
  broadcast("memories", result);
  res.json(result);
});

app.post("/api/memories/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "Invalid memory id" });
    return;
  }
  const result = await db("archive_memory", { id }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not archive memory"
  }));
  broadcast("memories", result);
  res.json(result);
});

app.delete("/api/memories/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "Invalid memory id" });
    return;
  }
  const result = await db("delete_memory", { id }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not delete memory"
  }));
  broadcast("memories", result);
  res.json(result);
});

app.post("/api/safety/mode", (req, res) => {
  const mode = String(req.body?.mode || "normal") as SafetyMode;
  if (!["normal", "strict", "approval", "silence"].includes(mode)) {
    res.status(400).json({ ok: false, error: "Invalid safety mode" });
    return;
  }
  const config = { ...readSafety(), mode };
  writeSafety(config);
  broadcast("safety", config);
  res.json({ ok: true, safety: config });
});

app.post("/api/chat", async (req, res) => {
  const started = Date.now();
  const receivedAt = new Date(started).toISOString();
  const input = req.body as ChatRequest;
  const message = String(input.message || "").trim();
  const images = sanitizeChatImages(input.images);
  const source = input.source || "local";
  const safety = readSafety();

  if (!message) {
    res.status(400).json({ ok: false, error: "Message is required" });
    return;
  }

  const moderation = moderateMessage(message, safety.mode, source, recentNormalizedMessages);
  if (moderation.decision !== "allow") {
    await recordModeration(moderation, message, input.user, safety.mode);
    res.json(moderatedResponse(message, moderation, started));
    return;
  }

  rememberMessage(message);
  await recordModeration(moderation, message, input.user, safety.mode);
  const response = await generateChatResponse({
    message,
    images,
    source,
    user: input.user,
    moderation,
    started,
    receivedAt,
    requireApproval: input.requireApproval,
    suppressNoChanges: input.suppressNoChanges,
    visualAuto: input.visualAuto,
    personaDisabled: input.personaDisabled
  });
  res.json(response);
});

app.post("/api/chat/admin", async (req, res) => {
  const started = Date.now();
  const receivedAt = new Date(started).toISOString();
  const input = req.body as ChatRequest;
  const message = String(input.message || "").trim();
  const images = sanitizeChatImages(input.images);
  if (!message) {
    res.status(400).json({ ok: false, error: "El mensaje es obligatorio." });
    return;
  }

  const moderation: ModerationResult = {
    decision: "allow",
    reason: "admin_direct",
    score: 100,
    source: "admin"
  };
  rememberMessage(message);
  await recordModeration(moderation, message, "admin", readSafety().mode);
  const response = await generateChatResponse({
    message,
    images,
    source: "admin",
    user: "admin",
    moderation,
    started,
    receivedAt,
    ignoreSafetyMode: true,
    suppressNoChanges: input.suppressNoChanges,
    visualAuto: input.visualAuto,
    personaDisabled: input.personaDisabled
  });
  res.json(response);
});

app.post("/api/chat/ingest", async (req, res) => {
  const streamInput = ingestLegacyChatPayload(req.body || {});
  const normalized = streamInput.message;
  const message = normalized.message;
  const safety = readSafety();

  if (!message) {
    res.status(400).json({ ok: false, error: "Message is required" });
    return;
  }

  const result = await ingestStreamMessage(normalized);
  res.json(result);
});

async function generateChatResponse(input: {
  message: string;
  images?: ChatImageAttachment[];
  source: string;
  user?: string;
  moderation: ModerationResult;
  started: number;
  receivedAt?: string;
  requireApproval?: boolean;
  ignoreSafetyMode?: boolean;
  streamMessage?: NormalizedChatMessage;
  suppressNoChanges?: boolean;
  visualAuto?: boolean;
  personaDisabled?: boolean;
}) {
  const timings: Partial<ChatResponse["timings"]> = {
    receivedToStartMs: input.receivedAt ? Math.max(0, Date.now() - Date.parse(input.receivedAt)) : undefined
  };
  const personaStarted = Date.now();
  const safety = readSafety();
  const persona = readPersona();
  timings.personaReadMs = Date.now() - personaStarted;
  const notices: string[] = [];
  if (input.personaDisabled) notices.push("persona_disabled");
  const smallModel = runtime.llmSmallModelCompactPrompt && isSmallLocalModel(runtime.lmStudioModel);
  rememberAutonomyUserMessage(input.message);

  broadcast("thinking", { message: input.message, source: input.source });

  const historyStarted = Date.now();
  const historyResult = await db<{ ok: boolean; items: Array<{ role: string; content: string }> }>("recent_messages", {
    limit: smallModel ? runtime.llmSmallModelHistoryLimit : 12
  }).catch(() => ({ ok: false, items: [] }));
  timings.historyReadMs = Date.now() - historyStarted;

  const memoryStarted = Date.now();
  const memories = await searchRelevantMemories({
    query: input.message,
    limit: smallModel ? runtime.llmSmallModelMemoryLimit : 8,
    source: input.source,
    username: input.user
  });
  timings.memoryReadMs = Date.now() - memoryStarted;

  const llmStart = Date.now();
  if (input.visualAuto && input.images?.length) {
    console.log("visual_frame_sent", JSON.stringify({ source: input.source, imageCount: input.images.length }));
  }
  activeLlmRequests += 1;
  const llm = await askLocalLlm(persona, input.message, cleanHistoryForPrompt(historyResult.items, input.message), memories, {
    safetyMode: safety.mode,
    source: input.source,
    username: input.streamMessage?.user.username || input.user,
    userDisplayName: input.streamMessage?.user.displayName || input.user,
    platform: input.streamMessage?.platform || input.source,
    isOwner: input.streamMessage?.user.isOwner,
    isModerator: input.streamMessage?.user.isModerator,
    isSubscriber: input.streamMessage?.user.isSubscriber,
    autoSpeak: safety.autoSpeak,
    images: input.images,
    personaDisabled: input.personaDisabled
  }).finally(() => {
    activeLlmRequests = Math.max(0, activeLlmRequests - 1);
  });
  timings.llmMs = Date.now() - llmStart;
  lastLatencyMs = timings.llmMs;
  Object.assign(timings, extractLlmTimings(llm));

  const extractStarted = Date.now();
  // Contrato estructurado: si el modelo devolvio JSON valido, spoken_text es lo que
  // se dice en voz alta; si devolvio texto plano, spoken_text == el texto crudo
  // (comportamiento legacy intacto). La emocion estructurada se aplica mas abajo.
  const structured = parseYukoResponse(llm.text);
  const sanitized = sanitizeOutput(structured.spoken_text, { userMessage: input.message });
  if (sanitized.text !== structured.spoken_text) {
    console.log("llm_output_sanitized", JSON.stringify({
      provider: llm.provider,
      model: llm.model,
      source: input.source,
      rawPreview: safeLogPreview(llm.text),
      cleanPreview: safeLogPreview(sanitized.text),
      blocked: sanitized.blocked,
      reason: sanitized.reason || null
    }));
  }
  if (sanitized.blocked) {
    await db("add_blocked", { reason: sanitized.reason, content: llm.text, mode: safety.mode }).catch(() => undefined);
    await recordModeration({ ...input.moderation, decision: "blocked", reason: sanitized.reason || "output_filtered", score: 0 }, llm.text, input.user, safety.mode);
    notices.push(`Output filtered: ${sanitized.reason}`);
  }
  timings.responseExtractMs = Math.max(timings.responseExtractMs || 0, Date.now() - extractStarted);

  const text = sanitized.text;
  timings.llmTraceSaveMs = await persistLlmTrace({
    llm,
    finalContent: text,
    userMessageText: input.message,
    source: input.source,
    latencyMs: timings.llmMs || 0,
    user: input.user,
    streamMessage: input.streamMessage,
    error: sanitized.blocked ? sanitized.reason : null
  });
  if (input.suppressNoChanges && (isNoChangesResponse(text) || isAutoVisualEmptyNarration(text) || isVisualFallbackResponse(llm))) {
    const responseCreatedAt = new Date().toISOString();
    const response: ChatResponse = {
      id: randomUUID(),
      createdAt: responseCreatedAt,
      text: "SIN_CAMBIOS",
      emotion: "neutral",
      emotionIntensity: 2,
      action: "silent",
      approved: false,
      provider: llm.provider,
      model: llm.model,
      timings: {
        receivedToStartMs: timings.receivedToStartMs,
        personaReadMs: timings.personaReadMs,
        historyReadMs: timings.historyReadMs,
        contextCompactMs: timings.contextCompactMs,
        memoryReadMs: timings.memoryReadMs,
        promptBuildMs: timings.promptBuildMs,
        llmMs: timings.llmMs || 0,
        llmHttpMs: timings.llmHttpMs,
        reasoningRepairMs: timings.reasoningRepairMs,
        lengthRepairMs: timings.lengthRepairMs,
        responseExtractMs: timings.responseExtractMs,
        llmTraceSaveMs: timings.llmTraceSaveMs,
        ttsMs: 0,
        ttsBackend: "browser",
        ttsEngine: "browser",
        ttsFallbackUsed: true,
        totalMs: Date.now() - input.started
      },
      ttsPending: false,
      audio: null,
      notices: [isNoChangesResponse(text) || isAutoVisualEmptyNarration(text) ? "visual_no_changes" : "visual_model_unavailable"],
      moderation: input.moderation
    };
    console.log(isNoChangesResponse(text) || isAutoVisualEmptyNarration(text) ? "visual_no_changes" : "visual_model_unavailable", JSON.stringify({
      model: response.model,
      provider: response.provider,
      source: input.source,
      llmMs: response.timings.llmMs,
      totalMs: response.timings.totalMs
    }));
    return response;
  }
  const emotionState = inferEmotionState(text);
  // La emocion declarada por el modelo (cuando hubo JSON valido) manda sobre la
  // inferida por regex; la intensidad sigue saliendo de la heuristica del texto.
  const effectiveEmotion = structured.meta.source === "structured" ? structured.emotion : emotionState.emotion;
  if (structured.meta.source === "structured") {
    console.log("structured_response", JSON.stringify({
      provider: llm.provider,
      model: llm.model,
      source: input.source,
      mode: structured.mode,
      emotion: structured.emotion,
      gesture: structured.gesture,
      rawWasJson: structured.meta.raw_was_json
    }));
  }
  const effectiveMode = input.ignoreSafetyMode ? "normal" : safety.mode;
  const needsApproval = effectiveMode === "approval" || Boolean(input.requireApproval);
  const shouldSpeak = effectiveMode !== "silence" && (safety.autoSpeak || input.ignoreSafetyMode) && !needsApproval && !sanitized.blocked;

  const responseCreatedAt = new Date().toISOString();
  const response: ChatResponse = {
    id: randomUUID(),
    createdAt: responseCreatedAt,
    text,
    emotion: effectiveEmotion,
    emotionIntensity: emotionState.intensity,
    mode: structured.meta.source === "structured" ? structured.mode : undefined,
    gesture: structured.meta.source === "structured" ? structured.gesture : undefined,
    structuredSource: structured.meta.source,
    action: effectiveMode === "silence" ? "silent" : needsApproval ? "draft" : sanitized.blocked ? "blocked" : "speak",
    approved: !needsApproval && !sanitized.blocked && effectiveMode !== "silence",
    provider: llm.provider,
    model: llm.model,
    timings: {
      receivedToStartMs: timings.receivedToStartMs,
      personaReadMs: timings.personaReadMs,
      historyReadMs: timings.historyReadMs,
      contextCompactMs: timings.contextCompactMs,
      memoryReadMs: timings.memoryReadMs,
      promptBuildMs: timings.promptBuildMs,
      llmMs: timings.llmMs || 0,
      llmHttpMs: timings.llmHttpMs,
      reasoningRepairMs: timings.reasoningRepairMs,
      lengthRepairMs: timings.lengthRepairMs,
      responseExtractMs: timings.responseExtractMs,
      llmTraceSaveMs: timings.llmTraceSaveMs,
      ttsMs: 0,
      ttsBackend: shouldSpeak ? undefined : "browser",
      ttsEngine: shouldSpeak ? undefined : "browser",
      ttsFallbackUsed: shouldSpeak ? undefined : true,
      totalMs: Date.now() - input.started
    },
    ttsPending: shouldSpeak,
    audio: null,
    notices,
    moderation: sanitized.blocked
      ? { ...input.moderation, decision: "blocked", reason: sanitized.reason || "output_filtered", score: 0 }
      : input.moderation
  };

  if (!sanitized.blocked) {
    rememberAutonomyAssistantMessage(text);
    const persistStarted = Date.now();
    await db("add_message", {
      role: "user",
      content: input.images?.length ? `${input.message}\n[Imagen adjunta: ${input.images[0]?.name || input.images[0]?.mimeType || "imagen"}]` : input.message,
      source: input.source,
      created_at: input.streamMessage?.timestamp || input.receivedAt || responseCreatedAt
    }).catch(() => undefined);
    await db("add_message", {
      role: "assistant",
      content: text,
      emotion: `${response.emotion}:${response.emotionIntensity}`,
      source: response.provider,
      created_at: response.createdAt,
      response_id: response.id,
      provider: response.provider,
      model: response.model,
      action: response.action,
      emotion_intensity: response.emotionIntensity,
      timings: response.timings,
      audio_kind: response.audio ? "audio" : null
    }).catch(() => undefined);
    if (input.streamMessage) {
      await persistStreamResponse(input.streamMessage, response).catch(() => undefined);
    }
    response.timings.messagePersistMs = Date.now() - persistStarted;
    const broadcastStarted = Date.now();
    broadcast("response", response);
    // Reflejar la emocion en VTube Studio (best-effort, no bloquea el chat).
    void applyEmotionToVts(response.emotion);
    response.timings.broadcastMs = Date.now() - broadcastStarted;
    if (shouldSpeak) {
      void synthesizeResponseAudio(response, input.started, notices);
    }
    void maybeExtractMemory({
      userMessage: input.message,
      assistantResponse: response.text,
      source: input.source,
      username: input.user
    }).then((saved) => {
      if (saved > 0) {
        console.log("memory_extracted", JSON.stringify({ saved, source: input.source, username: input.user || null }));
        broadcast("memories", { ok: true, saved });
      }
    }).catch((error) => {
      console.warn("memory_extract_failed", error instanceof Error ? error.message : error);
    });
    void maybeCompactConversationContext().catch((error) => {
      console.warn("context_compaction_failed", error instanceof Error ? error.message : error);
    });
  } else {
    broadcast("moderation", response.moderation);
  }
  response.timings.totalMs = Date.now() - input.started;
  console.log("latency_breakdown", JSON.stringify({
    model: response.model,
    provider: response.provider,
    source: input.source,
    promptBuildMs: response.timings.promptBuildMs,
    historyReadMs: response.timings.historyReadMs,
    contextCompactMs: response.timings.contextCompactMs,
    memoryReadMs: response.timings.memoryReadMs,
    llmMs: response.timings.llmMs,
    llmHttpMs: response.timings.llmHttpMs,
    lengthRepairMs: response.timings.lengthRepairMs,
    ttsMs: response.timings.ttsMs,
    ttsBackend: response.timings.ttsBackend,
    ttsEngine: response.timings.ttsEngine,
    firstAudioMs: response.timings.firstAudioMs,
    ttsFallbackUsed: response.timings.ttsFallbackUsed,
    totalMs: response.timings.totalMs
  }));
  return response;
}

async function synthesizeResponseAudio(response: ChatResponse, requestStarted: number, notices: string[]) {
  const ttsStart = Date.now();
  activeAutonomySpeech += 1;
  const tts: TtsSynthesisResult = await synthesize(response.text).catch((error) => ({
    audio: null,
    notice: error instanceof Error ? error.message : "Could not synthesize TTS",
    backend: "browser" as const,
    engine: "browser" as const,
    fallbackUsed: true,
    timings: { totalTtsMs: Date.now() - ttsStart }
  })).finally(() => {
    activeAutonomySpeech = Math.max(0, activeAutonomySpeech - 1);
    lastAssistantSpeechAt = Date.now();
  });
  const nextNotices = [...notices];
  if (tts.notice) nextNotices.push(tts.notice);
  const payload: ChatResponse = {
    ...response,
    ttsPending: false,
    audio: tts.audio,
    notices: nextNotices,
    timings: {
      ...response.timings,
      ttsMs: tts.timings.totalTtsMs ?? Date.now() - ttsStart,
      ttsBackend: tts.backend,
      ttsEngine: tts.engine,
      firstAudioMs: tts.timings.firstAudioMs,
      totalTtsMs: tts.timings.totalTtsMs,
      audioDurationMs: tts.timings.audioDurationMs,
      ttsFallbackUsed: tts.fallbackUsed,
      totalMs: Date.now() - requestStarted
    }
  };
  await db("update_message_timings", {
    response_id: response.id,
    timings: payload.timings,
    audio_kind: payload.audio ? "audio" : "speechSynthesis"
  }).catch(() => undefined);
  broadcast("response_audio", payload);
  // Lipsync VTS: precalculamos la envolvente y la dejamos lista. La boca arranca
  // cuando el NAVEGADOR avisa que el audio empezó a sonar (POST /api/vts/lipsync-start),
  // para sincronizar con la reproducción real y no con el fin del TTS.
  const audioBase64 = payload.audio && typeof payload.audio === "object" ? (payload.audio as { base64?: string }).base64 : undefined;
  if (audioBase64) {
    prepareLipSync(response.id, audioBase64);
  }
  console.log("tts_ready", JSON.stringify({
    responseId: response.id,
    backend: payload.timings.ttsBackend,
    engine: payload.timings.ttsEngine,
    firstAudioMs: payload.timings.firstAudioMs,
    totalTtsMs: payload.timings.totalTtsMs,
    fallbackUsed: payload.timings.ttsFallbackUsed
  }));
}

app.get("/api/logs", async (_req, res) => {
  const messages = await db("recent_messages", { limit: 40 }).catch((error) => ({ ok: false, error: error.message, items: [] }));
  const blocked = await db("blocked_recent", { limit: 20 }).catch((error) => ({ ok: false, error: error.message, items: [] }));
  const moderation = await db("moderation_recent", { limit: 40 }).catch((error) => ({ ok: false, error: error.message, items: [] }));
  res.json({ messages, blocked, moderation });
});

app.get("/api/chat/history", async (req, res) => {
  const limit = clampLimit(req.query.limit, 40, 100);
  const result = await db("recent_messages", { limit }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not read chat history",
    items: []
  }));
  res.json(result);
});

app.post("/api/chat/response-timing", async (req, res) => {
  const responseId = String(req.body?.responseId || "").trim();
  if (!responseId) {
    res.status(400).json({ ok: false, error: "responseId is required" });
    return;
  }
  const timings = req.body?.timings && typeof req.body.timings === "object" ? req.body.timings : {};
  const result = await db("update_message_timings", {
    response_id: responseId,
    timings,
    audio_kind: req.body?.audioKind
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not update response timing"
  }));
  res.json(result);
});

app.get("/api/guard", (_req, res) => {
  purgeQueue();
  res.json(guardStatus());
});

app.get("/api/stream/twitch/status", (_req, res) => {
  res.json({ ok: true, ...twitchAdapter.getStatus() });
});

app.get("/api/stream/users", async (req, res) => {
  const query = String(req.query.query || "").trim();
  const limit = clampLimit(req.query.limit, 20, 100);
  const result = await db("chat_users_search", { query, limit }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not search stream users",
    items: []
  }));
  res.json(result);
});

app.get("/api/stream/users/:id/messages", async (req, res) => {
  const limit = clampLimit(req.query.limit, 50, 200);
  const result = await db("chat_user_messages", { id: req.params.id, limit }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not read stream user messages",
    items: []
  }));
  res.json(result);
});

app.get("/api/stream/messages/recent", async (req, res) => {
  const limit = clampLimit(req.query.limit, 50, 200);
  const result = await db("recent_chat_messages", { limit }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Could not read recent stream messages",
    items: []
  }));
  res.json(result);
});

app.post("/api/stream/twitch/connect", async (_req, res) => {
  try {
    await twitchAdapter.connect();
    const status = twitchAdapter.getStatus();
    broadcast("twitch", status);
    res.json({ ok: true, ...status });
  } catch (error) {
    const status = twitchAdapter.getStatus();
    broadcast("twitch", status);
    res.status(400).json({
      ok: false,
      ...status,
      error: error instanceof Error ? error.message : "No pude conectar Twitch."
    });
  }
});

app.post("/api/stream/twitch/disconnect", async (_req, res) => {
  await twitchAdapter.disconnect();
  const status = twitchAdapter.getStatus();
  broadcast("twitch", status);
  res.json({ ok: true, ...status });
});

// Secrets configurables desde la UI (Etapa B1). GET solo expone "configurada sí/no";
// los valores nunca salen del backend ni se escriben en logs.
app.get("/api/settings/secrets", (_req, res) => {
  res.json({ ok: true, secrets: readSecretsStatus() });
});

app.post("/api/settings/secrets", async (req, res) => {
  const raw = req.body?.secrets;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ ok: false, error: "Falta el objeto secrets.", secrets: readSecretsStatus() });
    return;
  }
  const updates: Partial<Record<SecretEnvKey, string>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSecretEnvKey(key)) {
      res.status(400).json({ ok: false, error: `Clave no permitida: ${key}`, secrets: readSecretsStatus() });
      return;
    }
    if (typeof value !== "string") {
      res.status(400).json({ ok: false, error: `El valor de ${key} debe ser texto.`, secrets: readSecretsStatus() });
      return;
    }
    updates[key] = value;
  }

  // Persistimos SIEMPRE (nunca bloqueamos guardar una key por un ping flojo: el usuario
  // conoce su key). Luego intentamos verificar/activar Gemini y devolvemos aviso si algo
  // no cuadró, pero la key ya quedó guardada.
  updateSecretEnv(updates);
  twitchAdapter.updateConfig(readTwitchConfigFromEnv(process.env));

  let warning: string | undefined;
  let activated: string | undefined;
  const newGeminiKey = updates.GEMINI_API_KEY?.trim();
  if (newGeminiKey) {
    // process.env.GEMINI_API_KEY ya quedó actualizado por updateSecretEnv.
    const check = await listGeminiModels();
    if (check.ok) {
      // Verificada: activamos Gemini con un modelo que EXISTE de verdad en la lista
      // (evita dejar el provider en un modelo fantasma que haría fallar el chat).
      const chosen = pickGeminiModel(check.models, runtime.geminiModel);
      updateRuntimeModelConfig({ llmProvider: "gemini", geminiModel: chosen });
      activated = chosen;
    } else if (check.status === 400 || check.status === 401 || check.status === 403) {
      warning = `Guardé tu API key, pero Google la rechazó (HTTP ${check.status}). Revisa que esté completa y sin espacios; si no, Yuko no podrá usar Gemini.`;
    } else {
      warning = `Guardé tu API key, pero no pude verificarla ahora (${check.error || "sin conexión a Google"}). Inténtalo de nuevo o revisa tu internet.`;
    }
  }

  res.json({ ok: true, secrets: readSecretsStatus(), warning, activated });
});

// Elige un modelo de Gemini que EXISTA en la lista en vivo. Conserva el actual si sigue
// disponible; si no, prefiere un flash estable y barato; último recurso, el primero.
function pickGeminiModel(available: string[], current: string): string {
  if (current && available.includes(current)) return current;
  const preferred = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-2.0-flash"];
  for (const candidate of preferred) {
    if (available.includes(candidate)) return candidate;
  }
  const firstFlash = available.find((model) => model.includes("flash"));
  return firstFlash || available[0] || current;
}

app.post("/api/control/silence", (_req, res) => {
  const config = { ...readSafety(), mode: "silence" as const };
  writeSafety(config);
  broadcast("control", { command: "silence" });
  broadcast("safety", config);
  res.json({ ok: true, safety: config });
});

app.post("/api/control/shutdown", (_req, res) => {
  broadcast("control", { command: "shutdown" });
  if (process.env.MIVTUBERIA_TAURI_MANAGED === "1") {
    res.json({ ok: true, message: "Apagando backend administrado por Tauri." });
    setTimeout(() => {
      shutdownRuntime();
      process.exit(0);
    }, 350);
    return;
  }

  res.json({ ok: true, message: "Apagando MiVtuberIA desde Stop-Luma.ps1." });

  setTimeout(() => {
    const scriptPath = path.join(rootDir, "Stop-Luma.ps1");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Quiet",
      // Apagado total desde el dashboard: ademas de backend, frontend, Kokoro y
      // el servidor de LM Studio, tambien cierra la app grafica de LM Studio para
      // que no quede nada corriendo.
      "-CloseLmStudioGui"
    ], {
      cwd: rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  }, 350);
});

app.post("/api/control/claim-speech", (req, res) => {
  const responseId = String(req.body?.responseId || "").trim();
  const tabId = String(req.body?.tabId || "").trim();
  if (!responseId || !tabId) {
    res.status(400).json({ ok: false, claimed: false, error: "responseId and tabId are required" });
    return;
  }

  const now = Date.now();
  for (const [id, claim] of claimedSpeech) {
    if (claim.expiresAt <= now) claimedSpeech.delete(id);
  }

  const existing = claimedSpeech.get(responseId);
  if (existing && existing.expiresAt > now) {
    res.json({ ok: true, claimed: existing.tabId === tabId });
    return;
  }

  claimedSpeech.set(responseId, { tabId, expiresAt: now + 120000 });
  res.json({ ok: true, claimed: true });
});

const distPath = frontendDistDir;
app.use("/backgrounds", express.static(backgroundsDir, {
  fallthrough: false,
  maxAge: "1h"
}));
app.use("/reference-images", express.static(referenceImagesDir, {
  fallthrough: false,
  maxAge: "1h"
}));
app.use("/avatar", express.static(avatarDir, {
  fallthrough: true,
  maxAge: "1h"
}));
app.use("/avatar", (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).end();
    return;
  }
  res.status(404).end();
});
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  const indexPath = path.join(distPath, "index.html");
  res.sendFile(indexPath, (error) => {
    if (error) next();
  });
});

server.on("error", (error: NodeJS.ErrnoException) => {
  const portBlocked = error.code === "EADDRINUSE" || error.code === "EACCES";
  if (portBlocked && portCandidateIndex < portCandidates.length - 1) {
    const reason = error.code === "EACCES"
      ? "reservado por Windows (rango excluido de WinNAT/Hyper-V)"
      : "ya ocupado por otro proceso";
    console.warn(`El puerto ${activeServerPort} esta ${reason}; probando el siguiente candidato...`);
    portCandidateIndex += 1;
    listenOnNextCandidate();
    return;
  }
  if (portBlocked) {
    console.error(`Ningun puerto candidato disponible (${portCandidates.join(", ")}). Ejecuta Stop-Luma.bat, libera un puerto o define PORT en .env.`);
    process.exit(1);
  }
  throw error;
});

server.on("listening", () => {
  console.log(`Local VTuber API running on http://127.0.0.1:${activeServerPort}`);
  if (activeServerPort !== runtime.port) {
    console.warn(`AVISO: el puerto configurado ${runtime.port} no estaba disponible. Usando ${activeServerPort}.`);
    console.warn(`OBS Browser Sources: http://127.0.0.1:${activeServerPort}/viewer y http://127.0.0.1:${activeServerPort}/speaker`);
  }
  warmTts().catch((error) => {
    console.warn("Kokoro warmup skipped:", error instanceof Error ? error.message : error);
  });
  connectTwitchOnStartup();
  connectTikfinityOnStartup();
});

function listenOnNextCandidate() {
  activeServerPort = portCandidates[portCandidateIndex];
  server.listen(activeServerPort, "127.0.0.1");
}

listenOnNextCandidate();

process.once("SIGINT", shutdownRuntime);
process.once("SIGTERM", shutdownRuntime);
process.once("exit", shutdownRuntime);

async function ingestStreamMessage(normalized: NormalizedChatMessage) {
  if (!normalized.message.trim()) {
    return null;
  }
  const result = await ingestNormalizedChatMessage({
    normalized,
    safetyMode: readSafety().mode,
    recentNormalizedMessages,
    queue: chatQueue,
    maxQueueSize,
    purgeQueue,
    rememberMessage,
    recordModeration,
    guardStatus,
    scheduleQueue
  });
  await persistStreamInbound(result.message, result.moderation).catch(() => undefined);
  if (!result.queued) broadcast("guard_message", buildGuardMessage(result.message, result.moderation));
  return result;
}

async function speakAutonomy(input: { text: string; event: AutonomyEvent; decision: AutonomyDecision }) {
  const started = Date.now();
  const sanitized = sanitizeOutput(input.text, { userMessage: String(input.event.payload?.text || input.event.type) });
  if (sanitized.blocked || !sanitized.text.trim()) {
    console.warn("autonomy_speech_blocked", JSON.stringify({ reason: sanitized.reason || "empty", eventType: input.event.type }));
    return;
  }
  const emotionState = inferEmotionState(sanitized.text);
  const responseCreatedAt = new Date().toISOString();
  const response: ChatResponse = {
    id: randomUUID(),
    createdAt: responseCreatedAt,
    text: sanitized.text,
    emotion: emotionState.emotion,
    emotionIntensity: emotionState.intensity,
    action: "speak",
    approved: true,
    provider: "fallback",
    model: "autonomy-director",
    timings: {
      llmMs: 0,
      ttsMs: 0,
      totalMs: Date.now() - started
    },
    ttsPending: true,
    audio: null,
    notices: ["autonomous", input.event.type],
    moderation: {
      decision: "allow",
      reason: input.decision.reason,
      score: input.decision.score,
      source: "autonomy"
    }
  };
  rememberAutonomyAssistantMessage(response.text);
  await db("add_message", {
    role: "assistant",
    content: response.text,
    emotion: `${response.emotion}:${response.emotionIntensity}`,
    source: "autonomy",
    created_at: response.createdAt,
    response_id: response.id,
    provider: response.provider,
    model: response.model,
    action: response.action,
    emotion_intensity: response.emotionIntensity,
    timings: response.timings,
    audio_kind: null
  }).catch(() => undefined);
  broadcast("response", response);
  // Reflejar la emocion en VTube Studio (best-effort, no bloquea el chat).
  void applyEmotionToVts(response.emotion);
  void synthesizeResponseAudio(response, started, response.notices || []);
  console.log("autonomy_speech", JSON.stringify({
    eventType: input.event.type,
    score: input.decision.score,
    threshold: input.decision.threshold,
    text: safeLogPreview(response.text)
  }));
}

async function generateAutonomyText(prompt: string, event: AutonomyEvent) {
  const persona = readPersona();
  const safety = readSafety();
  activeLlmRequests += 1;
  try {
    const llm = await askLocalLlm(persona, prompt, [], [], {
      safetyMode: safety.mode,
      source: "autonomy",
      username: String(event.payload?.username || "live"),
      userDisplayName: String(event.payload?.displayName || event.payload?.username || "live"),
      platform: String(event.payload?.source || "tikfinity"),
      autoSpeak: true,
      personaDisabled: false
    });
    const timings = llm.metadata?.timings as { llmHttpMs?: number } | undefined;
    lastLatencyMs = timings?.llmHttpMs || lastLatencyMs;
    return sanitizeOutput(llm.text, { userMessage: prompt }).text;
  } finally {
    activeLlmRequests = Math.max(0, activeLlmRequests - 1);
  }
}

function rememberAutonomyUserMessage(message: string) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  lastUserMessageAt = Date.now();
  recentUserMessagesForAutonomy.push(text.slice(0, 260));
  while (recentUserMessagesForAutonomy.length > 12) recentUserMessagesForAutonomy.shift();
}

function rememberAutonomyAssistantMessage(message: string) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  lastAssistantSpeechAt = Date.now();
  recentAssistantMessagesForAutonomy.push(text.slice(0, 260));
  while (recentAssistantMessagesForAutonomy.length > 12) recentAssistantMessagesForAutonomy.shift();
}

function connectTwitchOnStartup() {
  const status = twitchAdapter.getStatus();
  if (!status.enabled) return;
  twitchAdapter.connect()
    .then(() => {
      console.log(`Twitch read-only connected to #${twitchAdapter.getStatus().channel}.`);
      broadcast("twitch", twitchAdapter.getStatus());
    })
    .catch((error) => {
      console.warn("Twitch read-only not connected:", error instanceof Error ? error.message : error);
      broadcast("twitch", twitchAdapter.getStatus());
    });
}

function connectTikfinityOnStartup() {
  const status = tikfinityClient.getState();
  if (!status.enabled) return;
  tikfinityClient.connect()
    .then(() => {
      broadcast("tikfinity", tikfinityClient.getState());
    })
    .catch((error) => {
      console.warn("TikFinity not connected:", error instanceof Error ? error.message : error);
      broadcast("tikfinity", tikfinityClient.getState());
    });
}

function shutdownRuntime() {
  if (runtimeShutdownStarted) return;
  runtimeShutdownStarted = true;
  void twitchAdapter.disconnect();
  void tikfinityClient.disconnect();
  autonomyDirector.stop();
  stopTtsWorker();
}

function buildGuardMessage(normalized: NormalizedChatMessage, moderation: ModerationResult) {
  const displayName = normalized.user.displayName || normalized.user.username || "viewer";
  const personaName = readPersona().name || "Yuko";
  return {
    id: `${normalized.id}:${moderation.reason}`,
    user: normalized.user.username,
    displayName,
    platform: normalized.platform,
    message: normalized.message,
    createdAt: normalized.timestamp,
    decision: moderation.decision,
    reason: moderation.reason,
    displayText: `GuardaespaldasBot → ${displayName}: ${personaName} no leerá ese mensaje. Motivo: ${moderation.reason.replace(/_/g, " ")}.`
  };
}

function cleanHistoryForPrompt(items: Array<{ role: string; content: string }>, currentMessage = "") {
  const normalizedCurrentMessage = normalizeHistoryText(currentMessage);
  const cleaned = items
    .filter((item) => {
      if (item.role !== "assistant" && normalizeHistoryText(item.content) === normalizedCurrentMessage) return false;
      if (item.role !== "assistant") return true;
      return !shouldDropAssistantHistory(item.content);
    })
    .map((item) => ({
      role: item.role,
      content: compactHistoryContent(item.content, item.role === "assistant" ? 360 : 520)
    }))
    .filter((item) => item.content);
  const budget = Math.max(1200, runtime.llmContextBudgetChars);
  const selected: Array<{ role: string; content: string }> = [];
  let used = 0;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const item = cleaned[index];
    const nextCost = item.content.length + 32;
    if (selected.length && used + nextCost > budget) break;
    selected.push(item);
    used += nextCost;
  }
  return selected.reverse();
}

function shouldDropAssistantHistory(content: string) {
  return /\b(eco|spam|doble saludo|dos veces saludando|repeti)\b/i.test(content)
    || /mi modelo esta pensando raro/i.test(content)
    || /^\s*(?:el usuario|la usuaria|la user|user)\s+(?:me\s+)?(?:pide|esta pidiendo|está pidiendo)\b/i.test(content)
    || /\b(?:Thinking Process|Reasoning|Razonamiento|Pensamiento|Analysis|An[aá]lisis)\s*:/i.test(content)
    || /\b(?:mi respuesta debe ser|tono:|contenido:|formato:|goal:|plan:|objective:)\b/i.test(content)
    || /\brespuesta anterior\b/i.test(content)
    || /<think\b/i.test(content);
}

function compactHistoryContent(content: string, maxChars: number) {
  const normalized = String(content || "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  const clipped = normalized.slice(0, maxChars).trim();
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  return sentenceEnd > 80 ? clipped.slice(0, sentenceEnd + 1).trim() : `${clipped.replace(/\s+\S*$/, "").trim()}.`;
}

function normalizeHistoryText(content: string) {
  return String(content || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractLlmTimings(llm: LlmResponse): Partial<ChatResponse["timings"]> {
  const timings = llm.metadata?.timings;
  if (!timings || typeof timings !== "object") return {};
  const raw = timings as Record<string, unknown>;
  return {
    promptBuildMs: numberOrUndefined(raw.promptBuildMs),
    llmHttpMs: numberOrUndefined(raw.llmHttpMs),
    reasoningRepairMs: numberOrUndefined(raw.reasoningRepairMs),
    lengthRepairMs: numberOrUndefined(raw.lengthRepairMs),
    responseExtractMs: numberOrUndefined(raw.responseExtractMs)
  };
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

function moderatedResponse(message: string, moderation: ModerationResult, started: number): ChatResponse {
  const personaName = readPersona().name || "Yuko";
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    text: moderation.decision === "blocked"
      ? `${personaName} no leerá este mensaje porque fue bloqueado por seguridad: ${moderation.reason}.`
      : `${personaName} no leerá este mensaje: ${moderation.reason}.`,
    emotion: "safe",
    emotionIntensity: 5,
    action: moderation.decision === "blocked" ? "blocked" : "ignored",
    approved: false,
    provider: "fallback",
    model: "moderation",
    timings: { totalMs: Date.now() - started, llmMs: 0, ttsMs: 0 },
    audio: null,
    notices: [`${moderation.decision}: ${moderation.reason}`],
    moderation
  };
}

async function recordModeration(
  moderation: ModerationResult,
  content: string,
  user: string | undefined,
  mode: SafetyMode
) {
  const event = {
    decision: moderation.decision,
    reason: moderation.reason,
    score: moderation.score,
    content,
    source: moderation.source,
    user
  };
  await db("add_moderation", event).catch(() => undefined);
  if (moderation.decision === "blocked") {
    await db("add_blocked", { reason: moderation.reason, content, mode }).catch(() => undefined);
  }
  broadcast("moderation", event);
}

async function persistLlmTrace(input: {
  llm: LlmResponse;
  finalContent: string | null;
  userMessageText: string;
  source: string;
  latencyMs: number;
  user?: string;
  streamMessage?: NormalizedChatMessage;
  error?: string | null;
}) {
  const started = Date.now();
  if (!runtime.llmStoreReasoning || !input.llm.hadReasoning) return 0;
  await db("add_llm_trace", {
    provider: input.llm.provider,
    model: input.llm.model,
    user_id: input.streamMessage?.user.id || null,
    username: input.streamMessage?.user.username || input.user || null,
    source: input.source,
    user_message_id: input.streamMessage?.id || null,
    user_message_text: input.userMessageText,
    final_content: input.finalContent,
    reasoning_content: input.llm.reasoningContent,
    reasoning_present: input.llm.hadReasoning,
    reasoning_truncated_before_final: input.llm.reasoningTruncatedBeforeFinal,
    repaired_from_reasoning_only: input.llm.repairedFromReasoningOnly,
    finish_reason: input.llm.finishReason,
    latency_ms: input.latencyMs,
    error: input.error || null
  }).then(() => {
    console.log("reasoning_trace_saved", JSON.stringify({
      provider: input.llm.provider,
      model: input.llm.model,
      source: input.source,
      finishReason: input.llm.finishReason,
      reasoningTruncatedBeforeFinal: input.llm.reasoningTruncatedBeforeFinal,
      repairedFromReasoningOnly: input.llm.repairedFromReasoningOnly
    }));
  }).catch((error) => {
    console.warn("reasoning_trace_save_failed", error instanceof Error ? error.message : error);
  });
  return Date.now() - started;
}

async function persistStreamInbound(normalized: NormalizedChatMessage, moderation: ModerationResult) {
  await persistStreamUser(normalized, 1);
  await db("add_chat_message", {
    id: normalized.id,
    platform: normalized.platform,
    source: normalized.source,
    channel_id: normalized.channelId,
    channel_name: normalized.channelName,
    user_id: normalized.user.id,
    username: normalized.user.username,
    display_name: normalized.user.displayName,
    direction: "inbound",
    content: normalized.message,
    moderation_decision: moderation.decision,
    moderation_reason: moderation.reason,
    moderation_score: moderation.score,
    raw: normalized.raw,
    created_at: normalized.timestamp
  });
}

async function persistStreamResponse(sourceMessage: NormalizedChatMessage, response: ChatResponse) {
  await db("add_chat_message", {
    id: `response:${response.id}`,
    platform: sourceMessage.platform,
    source: "luma",
    channel_id: sourceMessage.channelId,
    channel_name: sourceMessage.channelName,
    user_id: sourceMessage.user.id,
    username: sourceMessage.user.username,
    display_name: sourceMessage.user.displayName,
    direction: "outbound",
    content: response.text,
    moderation_decision: response.moderation.decision,
    moderation_reason: response.moderation.reason,
    moderation_score: response.moderation.score,
    reply_to_message_id: sourceMessage.id,
    response_id: response.id,
    raw: {
      provider: response.provider,
      model: response.model,
      emotion: response.emotion,
      emotionIntensity: response.emotionIntensity,
      action: response.action,
      timings: response.timings
    },
    created_at: response.createdAt
  });
}

async function persistStreamUser(normalized: NormalizedChatMessage, messageCount: number) {
  await db("upsert_chat_user", {
    id: normalized.user.id,
    platform: normalized.user.platform,
    platform_user_id: normalized.user.platformUserId,
    username: normalized.user.username,
    display_name: normalized.user.displayName,
    is_moderator: normalized.user.isModerator,
    is_subscriber: normalized.user.isSubscriber,
    is_owner: normalized.user.isOwner,
    badges: normalized.user.badges,
    message_count: messageCount
  });
}

function rememberMessage(message: string) {
  const normalized = normalizeForModeration(message);
  if (!normalized) return;
  recentNormalizedMessages.push(normalized);
  while (recentNormalizedMessages.length > 80) recentNormalizedMessages.shift();
}

function purgeQueue() {
  const now = Date.now();
  for (let index = chatQueue.length - 1; index >= 0; index -= 1) {
    if (now - chatQueue[index].createdAt > queueTtlMs) {
      const [expired] = chatQueue.splice(index, 1);
      const expiredModeration = { ...expired.moderation, decision: "ignored" as const, reason: "queue_expired" };
      void recordModeration(expiredModeration, expired.message, expired.user, readSafety().mode);
      if (expired.normalized) void persistStreamInbound(expired.normalized, expiredModeration);
    }
  }
}

function scheduleQueue(delayMs?: number) {
  if (queueTimer) return;
  const now = Date.now();
  const nextDelay = delayMs ?? Math.max(0, moderationCooldownMs - (now - lastGlobalSelectionAt));
  queueTimer = setTimeout(() => {
    queueTimer = null;
    void processQueue();
  }, nextDelay);
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    purgeQueue();
    if (!chatQueue.length) return;

    if (readSafety().mode === "silence") {
      while (chatQueue.length) {
        const item = chatQueue.shift()!;
        const silenceModeration = { ...item.moderation, decision: "ignored" as const, reason: "silence_mode" };
        await recordModeration(silenceModeration, item.message, item.user, "silence");
        if (item.normalized) await persistStreamInbound(item.normalized, silenceModeration).catch(() => undefined);
      }
      return;
    }

    const now = Date.now();
    const globalWait = moderationCooldownMs - (now - lastGlobalSelectionAt);
    if (globalWait > 0) {
      scheduleQueue(globalWait);
      return;
    }

    const index = chatQueue.findIndex((item) => {
      const userKey = item.user || "viewer";
      const lastUser = userLastSelected.get(userKey) || 0;
      return now - lastUser >= userCooldownMs;
    });

    if (index < 0) {
      scheduleQueue(1000);
      return;
    }

    const [selected] = chatQueue.splice(index, 1);
    const selectedModeration = { ...selected.moderation, decision: "queued" as const, reason: "selected_for_response" };
    lastGlobalSelectionAt = Date.now();
    userLastSelected.set(selected.user || "viewer", lastGlobalSelectionAt);
    lastSelectedModeration = {
      decision: selectedModeration.decision,
      reason: selectedModeration.reason,
      score: selectedModeration.score,
      source: selectedModeration.source,
      user: selected.user,
      content: selected.message,
      created_at: new Date().toISOString()
    };
    await recordModeration(selectedModeration, selected.message, selected.user, readSafety().mode);
    if (selected.normalized) await persistStreamInbound(selected.normalized, selectedModeration).catch(() => undefined);
    await generateChatResponse({
      message: selected.message,
      source: selected.source,
      user: selected.user,
      moderation: selectedModeration,
      started: Date.now(),
      receivedAt: selected.normalized?.timestamp || new Date(selected.createdAt).toISOString(),
      streamMessage: selected.normalized
    });
  } finally {
    queueProcessing = false;
    if (chatQueue.length) scheduleQueue();
  }
}

function guardStatus() {
  return {
    ok: true,
    queueLength: chatQueue.length,
    nextResponseInMs: Math.max(0, moderationCooldownMs - (Date.now() - lastGlobalSelectionAt)),
    cooldownMs: moderationCooldownMs,
    userCooldownMs,
    lastSelected: lastSelectedModeration,
    recent: chatQueue.slice(0, 8).map((item) => ({
      decision: item.moderation.decision,
      reason: item.moderation.reason,
      score: item.moderation.score,
      source: item.source,
      user: item.user,
      content: item.message,
      created_at: new Date(item.createdAt).toISOString()
    }))
  };
}

function clampImportance(value: unknown) {
  const importance = Number(value ?? 1);
  if (!Number.isFinite(importance)) return 1;
  return Math.max(1, Math.min(5, Math.round(importance)));
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.round(limit)));
}

function listBackgrounds(): BackgroundItem[] {
  fs.mkdirSync(backgroundsDir, { recursive: true });
  return fs.readdirSync(backgroundsDir)
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .map((file) => backgroundItem(file))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function fetchLmStudioModels(mode: "openai" | "lmstudio") {
  const host = runtime.lmStudioBaseUrl
    .replace(/\/$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/api\/v1$/i, "");
  const url = mode === "openai" ? `${host}/v1/models` : `${host}/api/v1/models`;
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const raw = await response.text();
  if (!response.ok) return { ok: false, url, models: [], error: `HTTP ${response.status}: ${raw.slice(0, 300)}` };
  const json = JSON.parse(raw) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; model?: string; identifier?: string }> };
  const models = [
    ...(json.data || []).map((item) => item.id).filter(Boolean),
    ...(json.models || []).map((item) => item.id || item.model || item.identifier).filter(Boolean)
  ];
  return { ok: true, url, models };
}

function buildLlmRecommendation(input: { configuredModel: string; loaded: string[]; preferredOk: boolean; preferredError: string; modelMatchesLoaded: boolean }) {
  if (!input.loaded.length) return "LM Studio no reporta modelos READY. Carga un modelo en LM Studio o usa Start-Luma opcion 2/3.";
  if (!input.modelMatchesLoaded) return `El modelo configurado no coincide con READY. Pulsa "Usar modelo cargado" para guardar ${input.loaded[0]}.`;
  if (!input.preferredOk) return `LM Studio responde en /models, pero la inferencia fallo: ${input.preferredError || "sin detalle"}.`;
  return "LM Studio esta listo. Si aun ves local-template, revisa el ultimo error LLM y vuelve a enviar un mensaje admin.";
}

function getAvatarHealth(config = readAvatarConfig()) {
  const avatar = config;
  const urlPath = avatar.activeAvatarUrl.split("?")[0] || "/avatar/current.vrm";
  const fileName = path.basename(urlPath);
  const filePath = path.join(avatarDir, fileName);
  const exists = fs.existsSync(filePath);
  const sizeBytes = exists ? fs.statSync(filePath).size : 0;
  if (!exists && !avatarMissingLogged) {
    avatarMissingLogged = true;
    console.log("avatar_missing", JSON.stringify({
      fileName,
      avatarLoaded: false,
      avatarMissing: true
    }));
  }
  if (exists) avatarMissingLogged = false;
  return {
    activeAvatarUrl: avatar.activeAvatarUrl,
    fileName: avatar.fileName,
    exists,
    avatarLoaded: exists,
    avatarMissing: !exists,
    sizeBytes,
    servedUrl: exists ? `/avatar/${fileName}` : "",
    error: exists ? "" : "No hay avatar local cargado. Sube un VRM cuando quieras activar el personaje."
  };
}

function backgroundItem(file: string): BackgroundItem {
  const safeFile = path.basename(file);
  const filePath = path.join(backgroundsDir, safeFile);
  const stats = fs.statSync(filePath);
  return {
    id: safeFile,
    name: safeFile.replace(/^\d+-/, ""),
    url: `/backgrounds/${encodeURIComponent(safeFile)}`,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString()
  };
}

function mimeToExtension(mimeType: string) {
  const mapping: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp"
  };
  return mapping[mimeType] || "";
}

function looksLikeImage(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return buffer.length > 12 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function sanitizeChatImages(images: unknown): ChatImageAttachment[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image): image is ChatImageAttachment => {
      if (!image || typeof image !== "object") return false;
      const item = image as Partial<ChatImageAttachment>;
      return ["image/png", "image/jpeg", "image/webp"].includes(String(item.mimeType || "")) && typeof item.base64 === "string";
    })
    .map((image) => ({
      name: String(image.name || "imagen").slice(0, 120),
      mimeType: image.mimeType,
      base64: image.base64.replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "").trim()
    }))
    .filter((image) => {
      if (!image.base64) return false;
      const buffer = Buffer.from(image.base64, "base64");
      return buffer.length <= 8 * 1024 * 1024 && looksLikeImage(buffer, image.mimeType);
    })
    .slice(0, 1);
}

function isNoChangesResponse(text: string) {
  return text
    .trim()
    .replace(/[.!¡!¿?]+$/g, "")
    .toUpperCase() === "SIN_CAMBIOS";
}

function isAutoVisualEmptyNarration(text: string) {
  const normalized = text
    .trim()
    .replace(/[.!?]+$/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized === "no veo nada"
    || normalized.includes("no hay nada importante")
    || normalized.includes("no hay nada relevante")
    || normalized.includes("sin cambios importantes")
    || normalized.includes("si puedo verla")
    || normalized.includes("puedo verla")
    || normalized.includes("veo lo que tu me muestras");
}

function isVisualFallbackResponse(llm: { provider?: string; model?: string }) {
  return llm.provider === "fallback" || llm.model === "local-template";
}

function normalizeReferenceAspectRatio(value: unknown) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return 16 / 9;
  return Math.min(6, Math.max(0.15, ratio));
}

function safeFileBase(name: string) {
  return path.basename(name)
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "fondo";
}

function safeLogPreview(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key\s*[:=]\s*['\"]?[^,'\"\s}]+/gi, "api_key=[redacted]")
    .slice(0, 240);
}

