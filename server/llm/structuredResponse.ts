import { Emotion, YukoMode } from "../types.js";
import { inferEmotion } from "../safety.js";

// Frontera entre el texto BRUTO que devuelve el modelo y la respuesta interna
// estructurada de Yuko. Todo paso por aqui: si el modelo devolvio JSON valido se
// usan sus campos; si devolvio texto plano (lo normal hoy) se cae al fallback
// legacy sin cambiar el comportamiento previo.

export interface YukoStructuredResponse {
  mode: YukoMode;
  emotion: Emotion;
  gesture: string | null;
  spoken_text: string;
  meta: {
    source: "structured" | "legacy_text_fallback";
    raw_was_json: boolean;
  };
}

const VALID_EMOTIONS: readonly Emotion[] = ["neutral", "happy", "annoyed", "sad", "surprised", "thinking", "safe"];
const VALID_MODES: readonly YukoMode[] = ["comfy", "chaos", "spicy", "firm", "narrator", "neutral"];

// Sinonimos comunes que un modelo puede emitir (incluye los nombres en espanol de
// los 5 modos y emociones tipo "angry"/"playful" que no existen en nuestro enum).
const EMOTION_ALIASES: Record<string, Emotion> = {
  neutral: "neutral", calm: "neutral", calmada: "neutral", tranquila: "neutral",
  happy: "happy", joy: "happy", joyful: "happy", excited: "happy", playful: "happy",
  alegre: "happy", feliz: "happy", contenta: "happy",
  annoyed: "annoyed", angry: "annoyed", mad: "annoyed", enojada: "annoyed", molesta: "annoyed", irritada: "annoyed",
  sad: "sad", triste: "sad", down: "sad",
  surprised: "surprised", shock: "surprised", shocked: "surprised", sorprendida: "surprised",
  thinking: "thinking", pensando: "thinking", curious: "thinking",
  safe: "safe", segura: "safe"
};

const MODE_ALIASES: Record<string, YukoMode> = {
  comfy: "comfy", comoda: "comfy", calida: "comfy",
  chaos: "chaos", caos: "chaos", "caos vtuber": "chaos", caotica: "chaos",
  spicy: "spicy", picante: "spicy",
  firm: "firm", firme: "firm",
  narrator: "narrator", narradora: "narrator", narration: "narrator",
  neutral: "neutral"
};

export function isLikelyJson(raw: string): boolean {
  const stripped = stripCodeFence(String(raw || "")).trim();
  return stripped.startsWith("{") && stripped.includes("\"") && stripped.includes(":");
}

export function normalizeEmotion(value: unknown): Emotion | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  if ((VALID_EMOTIONS as readonly string[]).includes(key)) return key as Emotion;
  return EMOTION_ALIASES[key] || null;
}

export function normalizeMode(value: unknown): YukoMode | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  if ((VALID_MODES as readonly string[]).includes(key)) return key as YukoMode;
  return MODE_ALIASES[key] || null;
}

function normalizeGesture(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(null|none|na|n\/a)$/i.test(text)) return null;
  return text.slice(0, 64);
}

export function extractSpokenText(parsed: Record<string, unknown>): string {
  const candidates = [parsed.spoken_text, parsed.spokenText, parsed.text, parsed.message, parsed.response];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function parseYukoResponse(raw: string): YukoStructuredResponse {
  const raw0 = String(raw ?? "");

  if (!isLikelyJson(raw0)) {
    return legacyFallback(raw0);
  }

  const parsed = tryParseJsonObject(raw0);
  if (parsed) {
    const spoken = extractSpokenText(parsed);
    if (!spoken) {
      // JSON valido pero sin texto hablable: no rompemos la voz, usamos el bruto.
      return legacyFallback(raw0, true);
    }
    const emotion = normalizeEmotion(parsed.emotion) || inferEmotion(spoken);
    const mode = normalizeMode(parsed.mode) || "neutral";
    return {
      mode,
      emotion,
      gesture: normalizeGesture(parsed.gesture),
      spoken_text: spoken,
      meta: { source: "structured", raw_was_json: true }
    };
  }

  // Parecia JSON pero no parseo (truncado, comillas raras...). Intentamos rescatar
  // spoken_text por regex antes de rendirnos al texto plano.
  const rescuedSpoken = rescueSpokenText(raw0);
  if (rescuedSpoken) {
    return {
      mode: normalizeMode(rescueField(raw0, "mode")) || "neutral",
      emotion: normalizeEmotion(rescueField(raw0, "emotion")) || inferEmotion(rescuedSpoken),
      gesture: normalizeGesture(rescueField(raw0, "gesture")),
      spoken_text: rescuedSpoken,
      meta: { source: "structured", raw_was_json: true }
    };
  }

  return legacyFallback(raw0, true);
}

function legacyFallback(raw0: string, rawWasJson = false): YukoStructuredResponse {
  return {
    mode: "neutral",
    emotion: inferEmotion(raw0),
    gesture: null,
    spoken_text: raw0,
    meta: { source: "legacy_text_fallback", raw_was_json: rawWasJson }
  };
}

function stripCodeFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = stripCodeFence(raw);
  const direct = safeParse(stripped);
  if (direct) return direct;
  // A veces el modelo agrega texto alrededor del objeto; recortamos al primer {..}.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeParse(stripped.slice(start, end + 1));
  }
  return null;
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function rescueSpokenText(raw: string): string {
  const match = raw.match(/"spoken_?text"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`).trim();
  } catch {
    return match[1].replace(/\\"/g, "\"").trim();
  }
}

function rescueField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*)"`, "i"));
  return match ? match[1] : "";
}

// Instruccion minima y reversible que se anade al system prompt SOLO cuando el flag
// structuredResponse esta activo (hoy: provider Gemini). Pide el contrato JSON sin
// tocar el resto del prompt de personalidad.
export function buildStructuredResponseInstruction(): string {
  return [
    "## Formato de salida estructurada (OBLIGATORIO en esta respuesta)",
    "Responde EXCLUSIVAMENTE con un objeto JSON valido. No escribas texto fuera del JSON ni uses bloques de codigo.",
    "Forma exacta:",
    "{\"mode\": \"comfy|chaos|spicy|firm|narrator|neutral\", \"emotion\": \"neutral|happy|annoyed|sad|surprised|thinking|safe\", \"gesture\": \"gesto breve o null\", \"spoken_text\": \"lo que dirias en voz alta\"}",
    "spoken_text es lo unico que se leera en voz alta: aplica ahi TODAS las reglas anteriores (persona, longitud, seguridad; sin <think> ni razonamiento).",
    "mode = el modo de personalidad que elegiste. emotion = la emocion principal. gesture = gesto fisico breve opcional, o null.",
    "No agregues comentarios, explicaciones ni claves adicionales."
  ].join("\n");
}
