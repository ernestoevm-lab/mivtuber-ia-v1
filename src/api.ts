import { AutonomyDecisionsPayload, AutonomyStatePayload, AvatarConfigPayload, AvatarHealthPayload, BackgroundsPayload, ChatHistoryPayload, ChatImageAttachment, ChatIngestPayload, ChatResponse, GuardStatus, LlmDiagnosticsPayload, MemoryItem, ModelsPayload, Persona, SafetyMode, ScenePayload, SceneSettings, StatusPayload, StreamMessagesPayload, StreamUsersPayload, TikfinityConfigPayload, TikfinityStatePayload, TtsPayload, TtsTestPayload, TwitchStatusPayload, AutonomyConfigPayload } from "./types.js";

const DEFAULT_TAURI_BACKEND_ORIGIN = "http://127.0.0.1:8787";

export async function getStatus(): Promise<StatusPayload> {
  return request("/api/status");
}

export type SendChatOptions = {
  suppressNoChanges?: boolean;
  visualAuto?: boolean;
  personaDisabled?: boolean;
};

export async function sendChat(message: string, mode: "admin" | "local" = "local", images: ChatImageAttachment[] = [], options: SendChatOptions = {}): Promise<ChatResponse> {
  if (mode === "admin") {
    return request("/api/chat/admin", {
      method: "POST",
      body: JSON.stringify({ message, source: "admin", user: "admin", images, ...options })
    });
  }
  return request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, source: "local", images, ...options })
  });
}

export async function ingestChat(message: string, user = "viewer"): Promise<ChatIngestPayload> {
  return request("/api/chat/ingest", {
    method: "POST",
    body: JSON.stringify({ message, source: "chat", user })
  });
}

export async function savePersona(persona: Persona): Promise<Persona> {
  return request("/api/persona", {
    method: "POST",
    body: JSON.stringify(persona)
  });
}

export async function setSafetyMode(mode: SafetyMode) {
  return request("/api/safety/mode", {
    method: "POST",
    body: JSON.stringify({ mode })
  });
}

export async function silenceNow() {
  return request("/api/control/silence", { method: "POST" });
}

export async function shutdownLuma(): Promise<{ ok: boolean; message: string }> {
  return request("/api/control/shutdown", { method: "POST" });
}

export async function getLogs() {
  return request("/api/logs");
}

export type SecretsStatusPayload = { ok: boolean; secrets: Record<string, boolean>; error?: string; warning?: string; activated?: string };

export async function getSecretsStatus(): Promise<SecretsStatusPayload> {
  return request("/api/settings/secrets");
}

export async function saveSecrets(secrets: Record<string, string>): Promise<SecretsStatusPayload> {
  return request("/api/settings/secrets", {
    method: "POST",
    body: JSON.stringify({ secrets })
  });
}

export async function getChatHistory(limit = 40): Promise<ChatHistoryPayload> {
  return request(`/api/chat/history?limit=${limit}`);
}

export async function saveResponseTiming(input: {
  responseId: string;
  timings: Partial<ChatResponse["timings"]>;
  audioKind?: "audio" | "speechSynthesis" | "none";
}): Promise<{ ok: boolean }> {
  return request("/api/chat/response-timing", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getGuard(): Promise<GuardStatus> {
  return request("/api/guard");
}

export async function getMemories(): Promise<{ ok: boolean; items: MemoryItem[] }> {
  return request("/api/memories");
}

export async function createMemory(content: string, importance: number): Promise<{ ok: boolean; item: MemoryItem }> {
  return request("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content, importance })
  });
}

export async function updateMemory(memory: MemoryItem): Promise<{ ok: boolean; item: MemoryItem }> {
  return request(`/api/memories/${memory.id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: memory.content, importance: memory.importance })
  });
}

export async function deleteMemory(id: number): Promise<{ ok: boolean; deleted: number }> {
  return request(`/api/memories/${id}`, { method: "DELETE" });
}

export async function archiveMemory(id: number): Promise<{ ok: boolean; archived: number }> {
  return request(`/api/memories/${id}/archive`, { method: "POST" });
}

export async function getModels(): Promise<ModelsPayload> {
  return request("/api/models");
}

export async function getTwitchStatus(): Promise<TwitchStatusPayload> {
  return request("/api/stream/twitch/status");
}

export async function connectTwitch(): Promise<TwitchStatusPayload> {
  return request("/api/stream/twitch/connect", { method: "POST" });
}

export async function disconnectTwitch(): Promise<TwitchStatusPayload> {
  return request("/api/stream/twitch/disconnect", { method: "POST" });
}

export async function getTikfinityState(): Promise<TikfinityStatePayload> {
  return request("/api/tikfinity/state");
}

export async function updateTikfinityConfig(config: Partial<TikfinityConfigPayload>): Promise<TikfinityStatePayload> {
  return request("/api/tikfinity/config", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

export async function connectTikfinity(): Promise<TikfinityStatePayload> {
  return request("/api/tikfinity/connect", { method: "POST" });
}

export async function disconnectTikfinity(): Promise<TikfinityStatePayload> {
  return request("/api/tikfinity/disconnect", { method: "POST" });
}

export async function sendTikfinityTestEvent(input: Partial<{ type: string; username: string; displayName: string; text: string }> = {}): Promise<{ ok: boolean; event: unknown; state: TikfinityStatePayload }> {
  return request("/api/tikfinity/test-event", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getAutonomyState(): Promise<AutonomyStatePayload> {
  return request("/api/autonomy/state");
}

export async function updateAutonomyConfig(config: Partial<AutonomyConfigPayload>): Promise<AutonomyStatePayload> {
  return request("/api/autonomy/config", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

export async function triggerAutonomy(input: Partial<{ type: string; message: string; username: string; text: string }> = {}): Promise<{ ok: boolean; decision: AutonomyStatePayload["lastDecision"]; state: AutonomyStatePayload }> {
  return request("/api/autonomy/trigger", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getAutonomyDecisions(): Promise<AutonomyDecisionsPayload> {
  return request("/api/autonomy/decisions");
}

export async function searchStreamUsers(query: string): Promise<StreamUsersPayload> {
  return request(`/api/stream/users?query=${encodeURIComponent(query)}`);
}

export async function getStreamUserMessages(id: string, limit = 50): Promise<StreamMessagesPayload> {
  return request(`/api/stream/users/${encodeURIComponent(id)}/messages?limit=${limit}`);
}

export async function getRecentStreamMessages(limit = 50): Promise<StreamMessagesPayload> {
  return request(`/api/stream/messages/recent?limit=${limit}`);
}

export async function selectModel(modelId: string): Promise<ModelsPayload> {
  return request("/api/models/select", {
    method: "POST",
    body: JSON.stringify({ modelId })
  });
}

export async function useActiveModel(): Promise<ModelsPayload & { activeModel: string }> {
  return request("/api/models/use-active", { method: "POST" });
}

export async function saveRuntime(runtime: Partial<StatusPayload["runtime"]>) {
  return request("/api/runtime", {
    method: "POST",
    body: JSON.stringify(runtime)
  });
}

export async function getGeminiModels(): Promise<{ ok: boolean; models: string[]; error?: string }> {
  return request("/api/llm/gemini-models");
}

export interface VtsStatusPayload {
  enabled: boolean;
  connected: boolean;
  authenticated: boolean;
  hasToken: boolean;
  modelName: string | null;
  url: string;
  lastError: string | null;
  emotionMap: Record<string, string>;
}

export interface VtsHotkeyItem {
  name: string;
  hotkeyID: string;
  type: string;
}

export async function getVtsStatus(): Promise<{ ok: boolean; vts: VtsStatusPayload }> {
  return request("/api/vts/status");
}

export async function connectVts(): Promise<{ ok: boolean; vts: VtsStatusPayload; error?: string }> {
  return request("/api/vts/connect", { method: "POST" });
}

export async function disconnectVts(): Promise<{ ok: boolean; vts: VtsStatusPayload }> {
  return request("/api/vts/disconnect", { method: "POST" });
}

export async function getVtsHotkeys(): Promise<{ ok: boolean; hotkeys: VtsHotkeyItem[]; error?: string }> {
  return request("/api/vts/hotkeys");
}

export async function triggerVtsHotkey(hotkeyID: string): Promise<{ ok: boolean; error?: string }> {
  return request("/api/vts/trigger", { method: "POST", body: JSON.stringify({ hotkeyID }) });
}

export async function setVtsEmotionMap(map: Record<string, string>): Promise<{ ok: boolean; vts: VtsStatusPayload }> {
  return request("/api/vts/emotion-map", { method: "POST", body: JSON.stringify({ map }) });
}

export async function previewVtsEmotion(emotion: string): Promise<{ ok: boolean; error?: string }> {
  return request("/api/vts/preview-emotion", { method: "POST", body: JSON.stringify({ emotion }) });
}

export async function setVtsEnabled(enabled: boolean): Promise<{ ok: boolean; vts: VtsStatusPayload }> {
  return request("/api/vts/enabled", { method: "POST", body: JSON.stringify({ enabled }) });
}

export async function getScene(): Promise<ScenePayload> {
  return request("/api/scene");
}

export async function saveScene(scene: Partial<SceneSettings>): Promise<ScenePayload> {
  return request("/api/scene", {
    method: "POST",
    body: JSON.stringify(scene)
  });
}

export async function getBackgrounds(): Promise<BackgroundsPayload> {
  return request("/api/backgrounds");
}

export async function getAvatar(): Promise<AvatarConfigPayload> {
  return request("/api/avatar");
}

export async function getAvatarHealth(): Promise<AvatarHealthPayload> {
  return request("/api/avatar/health");
}

export async function getLlmDiagnostics(): Promise<LlmDiagnosticsPayload> {
  return request("/api/llm/diagnostics");
}

export async function uploadAvatar(file: File): Promise<AvatarConfigPayload> {
  const { base64, mimeType } = await fileToBase64(file);
  return request("/api/avatar", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType,
      base64
    })
  });
}

export async function uploadBackground(file: File): Promise<BackgroundsPayload & ScenePayload> {
  const { base64, mimeType } = await fileToBase64(file);
  return request("/api/backgrounds", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType,
      base64
    })
  });
}

export async function uploadReferenceImage(image: ChatImageAttachment): Promise<ScenePayload & { image: SceneSettings["referenceImage"] }> {
  return request("/api/reference-image", {
    method: "POST",
    body: JSON.stringify(image)
  });
}

export async function deleteReferenceImage(id: string): Promise<ScenePayload> {
  return request(`/api/reference-image/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function getTts(): Promise<TtsPayload> {
  return request("/api/tts");
}

export async function saveTtsVoice(input: string | {
  voiceId?: string;
  backend?: "browser" | "kokoro";
  experimentalLocal?: boolean;
  speed?: number;
}): Promise<TtsPayload> {
  const body = typeof input === "string" ? { voiceId: input } : input;
  return request("/api/tts/config", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function testTts(text: string, voiceId?: string, backend?: "browser" | "kokoro"): Promise<TtsTestPayload> {
  return request("/api/tts/test", {
    method: "POST",
    body: JSON.stringify({ text, voiceId, backend })
  });
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function apiUrl(path: string) {
  return backendUrl(path);
}

export function backendAssetUrl(path: string) {
  return backendUrl(path);
}

export function eventsWebSocketUrl() {
  const backendOrigin = resolveBackendOrigin();
  if (backendOrigin) {
    const url = new URL("/events", backendOrigin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`;
}

function backendUrl(path: string) {
  if (!path || isAbsoluteOrEmbeddedUrl(path)) return path;
  const backendOrigin = resolveBackendOrigin();
  if (!backendOrigin) return path;
  return new URL(path, backendOrigin).toString();
}

function resolveBackendOrigin() {
  const configured = readViteEnv("VITE_MIVTUBERIA_API_BASE_URL").replace(/\/+$/, "");
  if (configured) return configured;
  // Origen inyectado en runtime (app Tauri): el backend puede caer a un puerto alterno
  // cuando Windows reserva el configurado; initBackendOrigin() lo descubre al arrancar.
  const runtimeOrigin = (window as { __MIVTUBERIA_BACKEND_ORIGIN__?: string }).__MIVTUBERIA_BACKEND_ORIGIN__;
  if (typeof runtimeOrigin === "string" && runtimeOrigin) return runtimeOrigin;
  if (isBundledTauriRuntime()) return DEFAULT_TAURI_BACKEND_ORIGIN;
  return "";
}

// En la app de escritorio empaquetada, pregunta al supervisor Rust en qué puerto quedó
// realmente el backend (puede no ser 8787 si Windows lo tenía reservado) y lo deja como
// origen global ANTES de montar React. En dev/navegador no hace nada (proxy de Vite).
export async function initBackendOrigin(): Promise<void> {
  if (!isBundledTauriRuntime()) return;
  try {
    const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } }).__TAURI__;
    const port = await tauri?.core?.invoke?.("get_backend_port");
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536) {
      (window as { __MIVTUBERIA_BACKEND_ORIGIN__?: string }).__MIVTUBERIA_BACKEND_ORIGIN__ = `http://127.0.0.1:${port}`;
    }
  } catch {
    // Sin respuesta del supervisor: se mantiene el origen por defecto (8787).
  }
}

function readViteEnv(name: string) {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return String(env?.[name] || "").trim();
}

function isBundledTauriRuntime() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "tauri.localhost"
    || window.location.protocol === "tauri:"
    || window.location.protocol === "file:";
}

function isAbsoluteOrEmbeddedUrl(path: string) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path)
    || path.startsWith("blob:")
    || path.startsWith("data:");
}

function fileToBase64(file: File) {
  return new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pude leer el archivo."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      resolve({
        base64: separator >= 0 ? result.slice(separator + 1) : result,
        mimeType: file.type || "application/octet-stream"
      });
    };
    reader.readAsDataURL(file);
  });
}
