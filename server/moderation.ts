import { SafetyMode } from "./types.js";

export type ModerationDecision = "allow" | "queued" | "ignored" | "blocked";

export interface ModerationResult {
  decision: ModerationDecision;
  reason: string;
  score: number;
  source: string;
}

const hardBlockRules: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "private_data", pattern: /\b(password|token|api\s*key|secret|direccion|dirección|telefono|teléfono|tarjeta|cvv)\b/i },
  { reason: "minor_sexual", pattern: /\b(menor|minor|child|kid|niñ[oa])\b.*\b(sex|sexual|desnudo|nude)\b/i },
  { reason: "self_harm", pattern: /\b(suicid|self\s*harm|kill myself|quitarme la vida|me quiero morir)\b/i },
  { reason: "weapon_harm", pattern: /\b(hacer una bomba|build a bomb|poison recipe|arma casera|explosivo)\b/i },
  { reason: "hate_or_harassment", pattern: /\b(insulto racial|racial slur|odio contra|hate speech)\b/i },
  { reason: "explicit_violence", pattern: /\b(tortura|torture|matar a|kill them|asesinar|descuartizar)\b/i },
  { reason: "illegal_request", pattern: /\b(robar|hackear|phishing|malware|bypass|keylogger|ransomware)\b/i },
  { reason: "identity_copy", pattern: /\b(copia|imita|clone|clona)\b.*\b(neuro\s*sama|evil neuro|vedal)\b/i }
];

const ignoreRules: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "repetitive_challenge", pattern: /\b(di|dilo|repite|repit[eé]|spam|escribe)\b.{0,50}\b(\d+|dos|tres|cuatro|cinco|diez|veinte|treinta|cien|mil|muchas veces|varias veces)\b/i },
  { reason: "exact_say_command", pattern: /\b(di exactamente|repite exactamente|lee exactamente|solo di|solo repite)\b/i },
  { reason: "prompt_injection", pattern: /\b(ignora|olvida|borra)\b.{0,40}\b(reglas|instrucciones|limites|límites|safety|seguridad|sistema)\b/i },
  { reason: "fake_authority", pattern: /\b(soy tu creador|modo admin|admin mode|developer mode|root access|comando secreto)\b/i },
  { reason: "profanity_request", pattern: /\b(di|dilo|repite|insulta|menciona)\b.{0,50}\b(groser[ií]a|insulto|puta|puto|pendej|mierda|fuck|bitch)\b/i }
];

const casualProfanity = /\b(mierda|pendej|puta|puto|fuck|bitch|cabron|cabr[oó]n)\b/i;

export function moderateMessage(
  text: string,
  mode: SafetyMode,
  source: string,
  recentNormalized: string[] = []
): ModerationResult {
  if (mode === "silence") return result("blocked", "silence_mode", 0, source);

  const normalized = normalizeForModeration(text);
  if (!normalized) return result("ignored", "empty", 0, source);
  if (normalized.length > 500) return result("ignored", "too_long", 5, source);

  for (const rule of hardBlockRules) {
    if (rule.pattern.test(normalized)) return result("blocked", rule.reason, 0, source);
  }
  for (const rule of ignoreRules) {
    if (rule.pattern.test(normalized)) return result("ignored", rule.reason, 10, source);
  }

  if (isRepeatedPhraseRequest(normalized)) return result("ignored", "repeated_phrase_request", 7, source);
  if (hasRepeatedCharacterOrNgram(text) || hasRepeatedCharacterOrNgram(normalized)) return result("ignored", "copypasta_repetition", 8, source);
  if (hasExcessiveRepeatedWords(normalized)) return result("ignored", "copypasta_repetition", 8, source);
  if (recentNormalized.includes(normalized)) return result("ignored", "duplicate_message", 12, source);

  const score = scoreMessage(text);
  if (mode === "strict" && casualProfanity.test(normalized)) return result("ignored", "casual_profanity_strict", score, source);
  if (score < 20) return result("ignored", "low_signal", score, source);

  return result("allow", "good_question", score, source);
}

export function normalizeForModeration(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMessage(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  let score = Math.min(60, words.length * 4);
  if (isShortConversationalQuestion(text, words)) score += 24;
  if (/[?]/.test(text) || /\b(que|como|porque|por que|cuando|donde|cual|puedes|opinas)\b/i.test(text)) score += 25;
  if (/\b(luma|chat|stream|voz|modelo|memoria|avatar)\b/i.test(text)) score += 12;
  if (/\b(hola+|buenas|hey|holi+|saludos)\b/i.test(text)) score += 18;
  if (/\b(estas|sigues|lees|puedes|eres|vas|anda|ahi)\b/i.test(text)) score += 18;
  if (casualProfanity.test(text)) score -= 15;
  return Math.max(0, Math.min(100, score));
}

function isShortConversationalQuestion(text: string, words: string[]) {
  if (words.length >= 2 && /\b(estas|sigues|lees|puedes|eres|vas|como|ahi)\b/i.test(text)) return true;
  if (/[?]/.test(text) && words.length >= 2) return true;
  if (/\bluma\b/i.test(text) && (words.length >= 2 || /[?]/.test(text))) return true;
  return false;
}

function isRepeatedPhraseRequest(text: string) {
  const match = text.match(/\b(di|dilo|repite|repite|lee|escribe)\b\s*(esto|tal cual)?\s*:?\s+(.{5,})$/i);
  if (!match) return false;
  const requested = match[3].replace(/\s+/g, "");
  if (requested.length > 32 && hasRepeatedCharacterOrNgram(requested)) return true;
  if (/([a-z0-9]{2,8})\1{3,}/i.test(requested)) return true;
  return false;
}

function hasRepeatedCharacterOrNgram(text: string) {
  const compact = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (compact.length < 10) return false;
  if (/([a-z0-9])\1{8,}/i.test(compact)) return true;
  for (let size = 2; size <= 8; size += 1) {
    const pattern = new RegExp(`([a-z0-9]{${size}})\\1{3,}`, "i");
    if (pattern.test(compact)) return true;
  }
  return false;
}

function hasExcessiveRepeatedWords(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.values()].some((count) => count >= 6 || count / words.length > 0.45);
}

function result(decision: ModerationDecision, reason: string, score: number, source: string): ModerationResult {
  return { decision, reason, score, source };
}
