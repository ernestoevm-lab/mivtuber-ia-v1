import type { AutonomyConfig } from "../config.js";
import type { AutonomyEvent, AutonomyRuntimeState } from "./types.js";

const companionTemplates = [
  "Sigo aqui contigo; no hace falta llenar cada silencio.",
  "Cuando quieras retomamos, yo te sigo el ritmo.",
  "Te acompano sin meter ruido.",
  "Estoy aqui, no te interrumpo."
];

const vtuberTemplates = [
  "Pausa dramatica detectada; Yuko sigue en directo.",
  "El silencio esta sospechoso, pero yo mantengo la transmision viva.",
  "Estoy lista para comentar el siguiente desastre tecnico.",
  "Chat, si siguen ahi, Yuko tambien sigue viva."
];

export function templateForEvent(event: AutonomyEvent, state: AutonomyRuntimeState, config: AutonomyConfig) {
  const displayName = safeDisplayName(String(event.payload?.displayName || event.payload?.username || "chat"));
  if (event.type === "live_follow") return `Gracias por el follow, ${displayName}.`;
  if (event.type === "live_gift") return `Gracias por el regalo, ${displayName}; Yuko lo registra oficialmente.`;
  if (event.type === "live_chat_message") {
    const text = sanitizeLiveText(String(event.payload?.text || ""));
    if (/[?¿]/.test(text)) return `Buena pregunta, ${displayName}; dejame responder eso.`;
    return `Te leo, ${displayName}. Gracias por pasar.`;
  }
  const templates = config.mode === "vtuber" ? vtuberTemplates : companionTemplates;
  const previous = state.recentAutonomyDecisions[0]?.text || "";
  return templates.find((item) => item !== previous) || templates[0];
}

export function buildAutonomyPrompt(event: AutonomyEvent, state: AutonomyRuntimeState, config: AutonomyConfig) {
  const eventSummary = summarizeEvent(event);
  return [
    "Eres Yuko, Yumekawa Kokoria, una VTuber IA local dentro de MiVtuberIA.",
    `Estas actuando en modo: ${config.mode}.`,
    `Intensidad: ${config.intensity}.`,
    "Contexto reciente:",
    `- Ultimo tema: ${state.currentTopic || "sin tema claro"}`,
    `- Ultimos mensajes del usuario: ${state.recentUserMessages.slice(-4).join(" | ") || "sin mensajes recientes"}`,
    `- Ultimas respuestas tuyas: ${state.recentAssistantMessages.slice(-4).join(" | ") || "sin respuestas recientes"}`,
    `- Ultimos eventos de LIVE: ${state.recentLiveEvents.slice(-5).map((item) => `${item.type}:${item.displayName || item.username || "anon"}:${sanitizeLiveText(item.text || "")}`).join(" | ") || "sin eventos"}`,
    `Situacion actual: ${eventSummary}`,
    "Objetivo: genera una intervencion breve, natural y no invasiva.",
    "Reglas:",
    "- No digas que viste la pantalla.",
    "- No inventes eventos del juego.",
    "- No finjas acceso a Twitch, OBS, camara, captura o vision si no esta disponible.",
    "- Si puedes reaccionar a eventos de TikFinity si llegaron por WebSocket.",
    "- No interrumpas al usuario.",
    "- No repitas comentarios recientes.",
    "- No leas insultos o contenido ofensivo en voz.",
    "- Maximo una frase.",
    "- Maximo 24 palabras.",
    "- Responde solo con la frase final."
  ].join("\n");
}

export function sanitizeLiveText(text: string) {
  return text
    .replace(/https?:\/\/\S+/gi, " enlace ")
    .replace(/[\u{1f300}-\u{1faff}]/gu, "")
    .replace(/\b(?:puta|puto|pendej\w*|mierda|fuck|bitch|cabron\w*|cabr[oó]n\w*)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function summarizeEvent(event: AutonomyEvent) {
  const displayName = String(event.payload?.displayName || event.payload?.username || "viewer");
  const text = sanitizeLiveText(String(event.payload?.text || ""));
  if (event.type === "live_chat_message") return `${displayName} escribio en TikFinity: ${text || "[sin texto util]"}`;
  if (event.type === "live_gift") return `${displayName} envio un regalo de TikFinity.`;
  if (event.type === "live_follow") return `${displayName} siguio el LIVE.`;
  if (event.type === "user_silence") return "Hubo silencio suficiente para una intervencion breve.";
  return `${event.type} recibido.`;
}

function safeDisplayName(value: string) {
  return sanitizeLiveText(value).replace(/\s+/g, " ").trim().slice(0, 40) || "chat";
}
