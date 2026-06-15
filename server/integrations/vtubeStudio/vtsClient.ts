import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { configDir } from "../../config.js";

// Cliente de la API publica de VTube Studio (WebSocket en localhost:8001).
// Yuko se conecta como "plugin": pide un token una vez (VTS muestra un popup de
// permiso al usuario), guarda el token y autentica cada sesion. Luego puede
// disparar hotkeys/expresiones del modelo Live2D segun la emocion de Yuko.
//
// Doc: https://github.com/DenchiSoft/VTubeStudio

const PLUGIN_NAME = "MiVtuberIA";
const PLUGIN_DEVELOPER = "MiVtuberIA";
const DEFAULT_URL = "ws://127.0.0.1:8001";
const vtsConfigPath = path.join(configDir, "vts.json");

const API_HEADER = { apiName: "VTubeStudioPublicAPI", apiVersion: "1.0" } as const;

export interface VtsHotkey {
  name: string;
  hotkeyID: string;
  type: string;
}

export interface VtsStatus {
  enabled: boolean;
  connected: boolean;
  authenticated: boolean;
  hasToken: boolean;
  modelName: string | null;
  url: string;
  lastError: string | null;
  emotionMap: Record<string, string>;
}

interface VtsConfig {
  enabled?: boolean;
  url?: string;
  authToken?: string;
  // emocion de Yuko -> hotkeyID de VTS
  emotionMap?: Record<string, string>;
}

interface PendingRequest {
  resolve: (data: Record<string, any>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

let socket: WebSocket | null = null;
let authenticated = false;
let modelName: string | null = null;
let lastError: string | null = null;
let connecting: Promise<void> | null = null;
const pending = new Map<string, PendingRequest>();

function readVtsConfig(): VtsConfig {
  try {
    if (!fs.existsSync(vtsConfigPath)) return {};
    return JSON.parse(fs.readFileSync(vtsConfigPath, "utf8")) as VtsConfig;
  } catch {
    return {};
  }
}

function writeVtsConfig(next: VtsConfig) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(vtsConfigPath, JSON.stringify(next, null, 2), "utf8");
}

function vtsUrl() {
  return process.env.VTS_URL || readVtsConfig().url || DEFAULT_URL;
}

function isOpen() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

// Envia un request y resuelve cuando llega la respuesta con el mismo requestID.
function sendRequest(messageType: string, data: Record<string, unknown> = {}, timeoutMs = 8000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    if (!isOpen()) {
      reject(new Error("VTube Studio no esta conectado."));
      return;
    }
    const requestID = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestID);
      reject(new Error(`VTS request "${messageType}" expiro.`));
    }, timeoutMs);
    pending.set(requestID, { resolve, reject, timer });
    socket!.send(JSON.stringify({ ...API_HEADER, requestID, messageType, data }));
  });
}

function handleMessage(raw: WebSocket.RawData) {
  let msg: Record<string, any>;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  const requestID = String(msg.requestID || "");
  const waiter = pending.get(requestID);
  if (!waiter) return;
  pending.delete(requestID);
  clearTimeout(waiter.timer);
  if (msg.messageType === "APIError") {
    waiter.reject(new Error(`VTS APIError ${msg.data?.errorID}: ${msg.data?.message || "error"}`));
    return;
  }
  waiter.resolve(msg.data || {});
}

function openSocket(): Promise<void> {
  if (connecting) return connecting;
  connecting = new Promise<void>((resolve, reject) => {
    try {
      const url = vtsUrl();
      const ws = new WebSocket(url);
      const failTimer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`No pude conectar a VTube Studio en ${url} (¿esta abierto con la API activa?).`));
      }, 6000);
      ws.on("open", () => {
        clearTimeout(failTimer);
        socket = ws;
        lastError = null;
        resolve();
      });
      ws.on("message", handleMessage);
      ws.on("error", (error) => {
        lastError = error instanceof Error ? error.message : String(error);
      });
      ws.on("close", () => {
        socket = null;
        authenticated = false;
        for (const [id, waiter] of pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error("Conexion VTS cerrada."));
          pending.delete(id);
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Fallo al abrir WebSocket VTS."));
    }
  }).finally(() => {
    connecting = null;
  });
  return connecting;
}

// Pide un token nuevo. ESTO DISPARA EL POPUP de permiso en VTube Studio; el
// usuario debe pulsar "Allow". Por eso el timeout es largo.
async function requestNewToken(): Promise<string> {
  const data = await sendRequest("AuthenticationTokenRequest", {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER
  }, 60000);
  const token = String(data.authenticationToken || "");
  if (!token) throw new Error("VTS no devolvio token de autenticacion.");
  const config = readVtsConfig();
  writeVtsConfig({ ...config, authToken: token });
  return token;
}

async function authenticateSession(token: string): Promise<boolean> {
  const data = await sendRequest("AuthenticationRequest", {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
    authenticationToken: token
  }, 15000);
  return Boolean(data.authenticated);
}

// Flujo completo: conectar -> token (pedir si falta, dispara popup) -> autenticar.
export async function connectVts(): Promise<VtsStatus> {
  const config = readVtsConfig();
  if (config.enabled === false) {
    return getVtsStatus();
  }
  await openSocket();
  let token = config.authToken;
  if (!token) {
    token = await requestNewToken();
  }
  authenticated = await authenticateSession(token);
  if (!authenticated) {
    // Token guardado invalido (revocado): pedir uno nuevo (popup) y reintentar.
    token = await requestNewToken();
    authenticated = await authenticateSession(token);
  }
  if (authenticated) {
    try {
      const stats = await sendRequest("APIStateRequest").catch(() => null);
      void stats;
      const model = await sendRequest("CurrentModelRequest").catch(() => null);
      modelName = model && typeof model.modelName === "string" ? model.modelName : null;
    } catch {
      // no critico
    }
  }
  return getVtsStatus();
}

export async function listVtsHotkeys(): Promise<VtsHotkey[]> {
  if (!authenticated) await connectVts();
  const data = await sendRequest("HotkeysInCurrentModelRequest", {});
  const hotkeys = Array.isArray(data.availableHotkeys) ? data.availableHotkeys : [];
  return hotkeys.map((item: Record<string, any>) => ({
    name: String(item.name || ""),
    hotkeyID: String(item.hotkeyID || ""),
    type: String(item.type || "")
  }));
}

export async function triggerVtsHotkey(hotkeyID: string): Promise<boolean> {
  if (!hotkeyID) return false;
  if (!authenticated) await connectVts();
  await sendRequest("HotkeyTriggerRequest", { hotkeyID });
  return true;
}

// Recuerda la expresion (toggle) actualmente activa para poder apagarla antes de
// poner otra. Las expresiones de VTS son interruptores: re-disparar la misma la
// apaga. Por eso "ponemos" una emocion = apagar la anterior + prender la nueva.
let activeEmotionHotkey: string | null = null;

function isRemoveHotkey(hotkeyID: string) {
  return /remove|clear|reset/i.test(hotkeyID);
}

// Mapea una emocion de Yuko a un hotkey y lo "pone" (no togglea). Silencioso si no
// hay mapeo o VTS no esta listo (no debe romper el flujo de chat).
export async function applyEmotionToVts(emotion: string): Promise<void> {
  const config = readVtsConfig();
  if (config.enabled === false) return;
  const hotkeyID = config.emotionMap?.[emotion];
  if (!hotkeyID) return;
  // Ya esta mostrando esta emocion: no re-disparar (evita apagarla por toggle).
  if (hotkeyID === activeEmotionHotkey) return;
  try {
    if (!authenticated && !isOpen()) {
      await connectVts(); // reconexion best-effort con token guardado
    }
    // Apagar la expresion toggle anterior (si la habia y no era un "remove").
    if (activeEmotionHotkey && !isRemoveHotkey(activeEmotionHotkey)) {
      await triggerVtsHotkey(activeEmotionHotkey);
    }
    await triggerVtsHotkey(hotkeyID);
    // Un "remove" deja todo limpio; cualquier otra queda como expresion activa.
    activeEmotionHotkey = isRemoveHotkey(hotkeyID) ? null : hotkeyID;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

export function setVtsEmotionMap(map: Record<string, string>): VtsStatus {
  const config = readVtsConfig();
  writeVtsConfig({ ...config, emotionMap: { ...config.emotionMap, ...map } });
  return getVtsStatus();
}

export function setVtsEnabled(enabled: boolean): VtsStatus {
  const config = readVtsConfig();
  writeVtsConfig({ ...config, enabled });
  if (!enabled) disconnectVts();
  return getVtsStatus();
}

// ---------------------------------------------------------------------------
// Lipsync: mover la boca del modelo segun el volumen del audio TTS de Yuko.
// El backend tiene el WAV de Kokoro -> calcula una envolvente de amplitud y
// la "reproduce" inyectando el parametro MouthOpen en VTS en tiempo real.
// ---------------------------------------------------------------------------

let lipSyncTimer: NodeJS.Timeout | null = null;

function injectMouthRaw(value: number) {
  if (!isOpen() || !authenticated) return;
  const clamped = Math.max(0, Math.min(1, value));
  socket!.send(JSON.stringify({
    ...API_HEADER,
    requestID: randomUUID(),
    messageType: "InjectParameterDataRequest",
    data: { faceFound: false, mode: "set", parameterValues: [{ id: "MouthOpen", value: clamped }] }
  }));
}

// Convierte un WAV PCM 16-bit (base64) en una envolvente de "apertura de boca"
// (0..1) por frame. Devuelve [] si no puede parsear (lipsync se omite sin romper).
export function wavToMouthEnvelope(base64: string, frameMs = 55): number[] {
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return [];
    let offset = 12;
    let sampleRate = 24000;
    let bitsPerSample = 16;
    let channels = 1;
    let dataStart = -1;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        channels = buf.readUInt16LE(offset + 10) || 1;
        sampleRate = buf.readUInt32LE(offset + 12) || 24000;
        bitsPerSample = buf.readUInt16LE(offset + 22) || 16;
      } else if (id === "data") {
        dataStart = offset + 8;
        dataSize = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (dataStart < 0 || bitsPerSample !== 16) return [];
    const bytesPerSample = 2 * channels;
    const totalSamples = Math.floor(Math.min(dataSize, buf.length - dataStart) / bytesPerSample);
    const samplesPerFrame = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
    const envelope: number[] = [];
    for (let s = 0; s < totalSamples; s += samplesPerFrame) {
      let sumSq = 0;
      let count = 0;
      for (let i = s; i < Math.min(s + samplesPerFrame, totalSamples); i += 1) {
        const sample = buf.readInt16LE(dataStart + i * bytesPerSample); // canal 0
        const norm = sample / 32768;
        sumSq += norm * norm;
        count += 1;
      }
      const rms = count ? Math.sqrt(sumSq / count) : 0;
      // Ganancia + clamp: el habla tiene RMS bajo, lo amplificamos para que la
      // boca abra de forma visible. Pequeno umbral para silencios.
      const value = rms < 0.012 ? 0 : Math.min(1, rms * 3.2);
      envelope.push(value);
    }
    return envelope;
  } catch {
    return [];
  }
}

// Reproduce la envolvente inyectando MouthOpen cada frameMs. Best-effort.
export function startMouthLipSync(envelope: number[], frameMs = 55) {
  stopMouthLipSync();
  if (!envelope.length || !isOpen() || !authenticated) return;
  let i = 0;
  lipSyncTimer = setInterval(() => {
    if (i >= envelope.length) {
      injectMouthRaw(0);
      stopMouthLipSync();
      return;
    }
    injectMouthRaw(envelope[i]);
    i += 1;
  }, frameMs);
}

export function stopMouthLipSync() {
  if (lipSyncTimer) {
    clearInterval(lipSyncTimer);
    lipSyncTimer = null;
  }
}

// Envolventes precalculadas, listas para arrancar cuando el navegador avise que
// el audio EMPEZÓ a sonar (sincroniza la boca con la reproducción real, no con el
// momento en que el backend terminó el TTS).
const LIPSYNC_FRAME_MS = 55;
const preparedLipSync = new Map<string, { envelope: number[]; at: number }>();

// Calcula y guarda la envolvente del WAV para un responseId (no arranca todavía).
export function prepareLipSync(responseId: string, base64: string): void {
  const config = readVtsConfig();
  if (config.enabled === false || !responseId || !base64) return;
  const envelope = wavToMouthEnvelope(base64, LIPSYNC_FRAME_MS);
  if (!envelope.length) return;
  // Limpieza de entradas viejas (TTL 60s) para no acumular.
  const now = Date.now();
  for (const [id, item] of preparedLipSync) {
    if (now - item.at > 60000) preparedLipSync.delete(id);
  }
  preparedLipSync.set(responseId, { envelope, at: now });
}

// El navegador llama esto al empezar a reproducir: arranca la boca sincronizada.
export function startPreparedLipSync(responseId: string): boolean {
  const config = readVtsConfig();
  if (config.enabled === false) return false;
  const prepared = preparedLipSync.get(responseId);
  if (!prepared) return false;
  preparedLipSync.delete(responseId);
  if (!isOpen() || !authenticated) return false;
  startMouthLipSync(prepared.envelope, LIPSYNC_FRAME_MS);
  return true;
}

export function disconnectVts() {
  stopMouthLipSync();
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
  socket = null;
  authenticated = false;
}

export function getVtsStatus(): VtsStatus {
  const config = readVtsConfig();
  return {
    enabled: config.enabled !== false,
    connected: isOpen(),
    authenticated,
    hasToken: Boolean(config.authToken),
    modelName,
    url: vtsUrl(),
    lastError,
    emotionMap: config.emotionMap || {}
  };
}
