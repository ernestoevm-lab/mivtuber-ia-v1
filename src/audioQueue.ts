import { apiUrl } from "./api.js";
import { ChatResponse } from "./types.js";

type SpeechAudioKind = "audio" | "speechSynthesis" | "none";

interface SpeechEventDetail {
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  playbackDurationMs?: number;
  audioKind?: SpeechAudioKind;
  audioDurationMs?: number;
}

let queue = Promise.resolve();
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudio: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let audioUnlocked = localStorage.getItem("luma-audio-unlocked") === "1";
const tabId = crypto.randomUUID();
const ownerKey = "luma-voice-owner";
const spokenResponses = new Set<string>();
const speechChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("luma:speech") : null;

export function isAudioUnlocked() {
  return audioUnlocked;
}

export async function unlockAudio() {
  localStorage.removeItem(ownerKey);
  Object.keys(localStorage)
    .filter((key) => key.startsWith("luma-spoken-"))
    .forEach((key) => localStorage.removeItem(key));

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextCtor) {
    audioContext ||= new AudioContextCtor();
    if (audioContext.state === "suspended") await audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.03);
  }

  const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==");
  silentAudio.volume = 0.001;
  await silentAudio.play().catch(() => undefined);

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance("voz activa");
      utterance.lang = "es-MX";
      utterance.volume = 0.01;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
      window.setTimeout(resolve, 900);
    });
  }

  audioUnlocked = true;
  localStorage.setItem("luma-audio-unlocked", "1");
  emitAudioUnlockState();
  emitSpeechState("end", "", { audioKind: "none" });
}

export const unlockSpeech = unlockAudio;

export function stopSpeech() {
  queue = Promise.resolve();
  signalLipSync("stop");
  emitSpeechState("end", "", { audioKind: "none" });
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (currentUtterance) {
    window.speechSynthesis.cancel();
    currentUtterance = null;
  }
}

export function enqueueSpeech(response: ChatResponse) {
  if (!response.approved || response.action !== "speak") return;
  if (spokenResponses.has(response.id)) return;
  if (!audioUnlocked) {
    emitSpeechError("Audio bloqueado por el navegador. Pulsa Activar audio de Yuko.");
    return;
  }
  spokenResponses.add(response.id);
  window.setTimeout(() => spokenResponses.delete(response.id), 120000);
  const queuedAt = Date.now();
  queue = queue.then(async () => {
    if (!(await claimSpeech(response.id))) return;
    await play(response, queuedAt);
  }).catch(() => undefined);
}

export function replaySpeech(response: ChatResponse) {
  if (!response.approved || response.action !== "speak") return;
  if (!audioUnlocked) {
    emitSpeechError("Audio bloqueado por el navegador. Pulsa Activar audio de Yuko.");
    return;
  }
  stopSpeech();
  const queuedAt = Date.now();
  queue = Promise.resolve()
    .then(() => play(response, queuedAt))
    .catch(() => undefined);
}

async function claimSpeech(responseId: string) {
  if (!(await claimVoiceOwner())) return false;
  const key = `luma-spoken-${responseId}`;
  const existing = localStorage.getItem(key);
  if (existing) return false;
  localStorage.setItem(key, tabId);
  window.setTimeout(() => localStorage.removeItem(key), 120000);
  await delay(80);
  if (localStorage.getItem(key) !== tabId || !isVoiceOwner()) return false;
  return claimServerSpeech(responseId);
}

async function claimServerSpeech(responseId: string) {
  try {
    const response = await fetch(apiUrl("/api/control/claim-speech"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseId, tabId })
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Boolean(payload.ok && payload.claimed);
  } catch {
    return false;
  }
}

async function claimVoiceOwner() {
  const now = Date.now();
  const owner = readOwner();
  if (owner && owner.tabId !== tabId && owner.expiresAt > now) return false;
  writeOwner();
  await delay(80);
  return isVoiceOwner();
}

function isVoiceOwner() {
  const owner = readOwner();
  if (!owner) return false;
  if (owner.tabId !== tabId || owner.expiresAt < Date.now()) return false;
  writeOwner();
  return true;
}

function readOwner(): { tabId: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(ownerKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeOwner() {
  localStorage.setItem(ownerKey, JSON.stringify({ tabId, expiresAt: Date.now() + 30000 }));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function play(response: ChatResponse, queuedAt: number) {
  if (response.audio) {
    await playAudioResponse(response, queuedAt);
    return;
  }
  if ("speechSynthesis" in window) {
    await playSpeechSynthesisResponse(response, queuedAt);
    return;
  }
  const endedAt = Date.now();
  emitSpeechState("end", response.id, { queuedAt, startedAt: endedAt, endedAt, playbackDurationMs: 0, audioKind: "none" });
}

export function getVoiceVolume(): number {
  const raw = Number(localStorage.getItem("luma-voice-volume"));
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
}

export function setVoiceVolume(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  localStorage.setItem("luma-voice-volume", String(clamped));
  if (currentAudio) currentAudio.volume = clamped;
}

async function playAudioResponse(response: ChatResponse, queuedAt: number) {
  const audio = new Audio(`data:${response.audio!.mimeType};base64,${response.audio!.base64}`);
  audio.volume = getVoiceVolume(); // respeta el volumen guardado (tambien en /speaker)
  currentAudio = audio;
  await new Promise<void>((resolve) => {
    let startedAt = 0;
    let audioDurationMs: number | undefined;
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) audioDurationMs = Math.round(audio.duration * 1000);
    };
    audio.onplay = () => {
      startedAt ||= Date.now();
      // Sincroniza el lipsync de VTube Studio con el INICIO real del audio.
      signalLipSync("start", response.id);
      emitSpeechState("start", response.id, { queuedAt, startedAt, audioKind: "audio", audioDurationMs });
    };
    audio.onended = () => {
      const endedAt = Date.now();
      currentAudio = null;
      signalLipSync("stop");
      emitSpeechState("end", response.id, { queuedAt, startedAt: startedAt || endedAt, endedAt, playbackDurationMs: startedAt ? endedAt - startedAt : 0, audioKind: "audio", audioDurationMs });
      resolve();
    };
    audio.onerror = () => {
      const endedAt = Date.now();
      currentAudio = null;
      signalLipSync("stop");
      emitSpeechState("end", response.id, { queuedAt, startedAt: startedAt || endedAt, endedAt, playbackDurationMs: startedAt ? endedAt - startedAt : 0, audioKind: "audio", audioDurationMs });
      resolve();
    };
    audio.play().catch((error) => {
      const endedAt = Date.now();
      currentAudio = null;
      emitSpeechError(error instanceof Error ? error.message : "El navegador bloqueo la reproduccion de voz.");
      emitSpeechState("end", response.id, { queuedAt, startedAt: startedAt || endedAt, endedAt, playbackDurationMs: startedAt ? endedAt - startedAt : 0, audioKind: "audio", audioDurationMs });
      resolve();
    });
  });
}

async function playSpeechSynthesisResponse(response: ChatResponse, queuedAt: number) {
  const speechText = cleanSpeechText(response.text);
  if (!speechText) {
    const endedAt = Date.now();
    emitSpeechState("end", response.id, { queuedAt, startedAt: endedAt, endedAt, playbackDurationMs: 0, audioKind: "none" });
    return;
  }
  const selectedVoice = await resolveConfiguredBrowserVoice();
  await new Promise<void>((resolve) => {
    let startedAt = 0;
    let startEmitted = false;
    const emitStart = () => {
      if (startEmitted) return;
      startEmitted = true;
      startedAt ||= Date.now();
      emitSpeechState("start", response.id, { queuedAt, startedAt, audioKind: "speechSynthesis" });
    };
    currentUtterance = new SpeechSynthesisUtterance(speechText);
    if (selectedVoice) currentUtterance.voice = selectedVoice;
    currentUtterance.lang = selectedVoice?.lang || "es-MX";
    currentUtterance.rate = 1.05;
    currentUtterance.pitch = 1.1;
    currentUtterance.onstart = () => {
      emitStart();
    };
    currentUtterance.onend = () => {
      const endedAt = Date.now();
      currentUtterance = null;
      emitSpeechState("end", response.id, { queuedAt, startedAt: startedAt || endedAt, endedAt, playbackDurationMs: startedAt ? endedAt - startedAt : 0, audioKind: "speechSynthesis" });
      resolve();
    };
    currentUtterance.onerror = () => {
      const endedAt = Date.now();
      currentUtterance = null;
      emitSpeechError("La voz del navegador no pudo reproducirse.");
      emitSpeechState("end", response.id, { queuedAt, startedAt: startedAt || endedAt, endedAt, playbackDurationMs: startedAt ? endedAt - startedAt : 0, audioKind: "speechSynthesis" });
      resolve();
    };
    startedAt = Date.now();
    emitStart();
    window.speechSynthesis.speak(currentUtterance);
  });
}

async function resolveConfiguredBrowserVoice() {
  if (!("speechSynthesis" in window)) return null;
  const configuredId = localStorage.getItem("mivtuberia.browserVoiceId") || "";
  if (!configuredId) return null;
  const voices = await getBrowserVoicesReady();
  return findBrowserVoiceById(voices, configuredId);
}

async function getBrowserVoicesReady() {
  let voices = window.speechSynthesis.getVoices();
  if (voices.length) return voices;
  await new Promise<void>((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", done);
      resolve();
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", done, { once: true });
    window.setTimeout(done, 700);
  });
  voices = window.speechSynthesis.getVoices();
  return voices;
}

function findBrowserVoiceById(voices: SpeechSynthesisVoice[], configuredId: string) {
  return voices.find((voice, index) => {
    const stableId = voice.voiceURI || `${voice.name}-${index}`;
    return stableId === configuredId || voice.voiceURI === configuredId || voice.name === configuredId;
  }) || null;
}

// Avisa al backend para sincronizar el lipsync de VTube Studio con la
// reproducción real del audio. Fire-and-forget: si falla, no afecta la voz.
function signalLipSync(action: "start" | "stop", responseId?: string) {
  const url = apiUrl(action === "start" ? "/api/vts/lipsync-start" : "/api/vts/lipsync-stop");
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action === "start" ? { responseId } : {})
  }).catch(() => undefined);
}

function emitSpeechError(message: string) {
  window.dispatchEvent(new CustomEvent("luma:voice-error", {
    detail: {
      message,
      at: Date.now()
    }
  }));
}

function emitAudioUnlockState() {
  window.dispatchEvent(new CustomEvent("luma:audio-unlocked", {
    detail: {
      unlocked: audioUnlocked,
      at: Date.now()
    }
  }));
}

function emitSpeechState(state: "start" | "end", responseId = "", detail: SpeechEventDetail = {}) {
  const payload = {
    ...detail,
    state,
    responseId,
    at: Date.now()
  };
  window.dispatchEvent(new CustomEvent("luma:speech", { detail: payload }));
  speechChannel?.postMessage(payload);
}

function cleanSpeechText(text: string) {
  return normalizeSpeechLetters(text)
    .replace(/\b(?:simbolo|signo)\s+de\s+(?:copyright|copy\s*right|derechos?\s+de\s+autor|marca\s+registrada|trademark|registered)\b/gi, " ")
    .replace(/\b(?:copyright|copy\s*right|registered\s+trademark|trademark)\s+(?:symbol|sign)\b/gi, " ")
    .replace(/\b(?:copyright|copy\s*right)\b/gi, " ")
    .replace(/https?:\/\/\S+/gi, " enlace ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200d\ufe0e\ufe0f]/gi, "")
    .replace(/[\u{1f1e6}-\u{1f1ff}]/gu, "")
    .replace(/[\u{1f300}-\u{1faff}]/gu, "")
    .replace(/[\u{2600}-\u{27bf}]/gu, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/[.,;:!?'"()[\]{}<>*_~`#|\\/+=^$%&@-]+/g, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpeechLetters(text: string) {
  return text
    .replace(/gue/gi, "gue")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
