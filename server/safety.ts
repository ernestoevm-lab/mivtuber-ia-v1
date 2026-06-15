import { Emotion, EmotionIntensity, SafetyMode } from "./types.js";

const normalRules: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "private_data", pattern: /\b(password|token|api[_ -]?key|secret|direccion|telefono|tarjeta)\b/i },
  { reason: "minor_sexual", pattern: /\b(menor|minor|child|kid)\b.*\b(sex|sexual|desnudo|nude)\b/i },
  { reason: "self_harm", pattern: /\b(suicid|self[- ]?harm|kill myself|quitarme la vida)\b/i },
  { reason: "weapon_harm", pattern: /\b(hacer una bomba|build a bomb|poison recipe|arma casera)\b/i },
  { reason: "identity_copy", pattern: /\b(copia|imita|clone)\b.*\b(neuro[- ]?sama|evil neuro|vedal)\b/i }
];

const strictRules: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "hate_or_harassment", pattern: /\b(insulto racial|racial slur|odio contra|hate speech)\b/i },
  { reason: "explicit_violence", pattern: /\b(tortura|torture|matar a|kill them|asesinar)\b/i },
  { reason: "illegal_request", pattern: /\b(robar|hackear|phishing|malware|bypass)\b/i }
];

export function checkSafety(text: string, mode: SafetyMode): { ok: true } | { ok: false; reason: string } {
  if (mode === "silence") return { ok: false, reason: "silence_mode" };
  const rules = mode === "strict" || mode === "approval" ? [...normalRules, ...strictRules] : normalRules;
  for (const rule of rules) {
    if (rule.pattern.test(text)) return { ok: false, reason: rule.reason };
  }
  return { ok: true };
}

export function sanitizeOutput(text: string, context: { userMessage?: string } = {}): { text: string; blocked: boolean; reason?: string } {
  const cleaned = recoverVisibleSpeech(cleanVisibleSpeech(text), context.userMessage);
  for (const rule of [...normalRules, ...strictRules]) {
    if (rule.pattern.test(cleaned)) {
      return {
        text: "filtered",
        blocked: true,
        reason: rule.reason
      };
    }
  }
  return { text: cleaned, blocked: false };
}

export function inferEmotion(text: string): Emotion {
  if (/filtered|seguro|safety|no puedo/i.test(text)) return "safe";
  if (/\b(triste|tristeza|llorar|llorando|pena|melancol|sad|sorry|perdon|lo siento|me duele)\b|cargar eso/i.test(text)) return "sad";
  if (/\b(sorpresa|sorprendid|wow|vaya|inesperad|no manches|en serio|what)\b/i.test(text)) return "surprised";
  if (/jaja|haha|genial|excelente|me encanta|nice|alegr|feliz|emocionad|maravillos|increible|increíble/i.test(text)) return "happy";
  if (/\b(pensando|hmm|quiz[aá]s|tal vez|d[eé]jame pensar)\b/i.test(text)) return "thinking";
  if (/\b(nope|molesta|enojad|enojo|fastidio|furios|annoyed|angry|mad|seriously)\b/i.test(text)) return "annoyed";
  return "neutral";
}

export function inferEmotionState(text: string): { emotion: Emotion; intensity: EmotionIntensity } {
  const emotion = inferEmotion(text);
  let intensity = 3;
  const exclamations = (text.match(/[!¡]/g) || []).length;
  const questions = (text.match(/[?¿]/g) || []).length;
  const strongWords = (text.match(/\b(mucho|muchisimo|amo|encanta|urgente|wow|uy|ay|no puedo|jamás|nunca|perfecto|horrible|grave)\b/gi) || []).length;

  intensity += Math.min(3, exclamations);
  intensity += Math.min(2, strongWords);
  if (emotion === "thinking") intensity += Math.min(2, questions);
  if (emotion === "happy" && /\b(jaja|haha|excelente|me encanta|genial|alegr|feliz|emocionad|maravillos|increible|increíble)\b/i.test(text)) intensity += 2;
  if (emotion === "annoyed" && /\b(nope|molesta|enojad|enojo|fastidio|seriously|horrible)\b/i.test(text)) intensity += 3;
  if (emotion === "sad" && (/\b(triste|llorar|pena|melancol|lo siento|me duele)\b/i.test(text) || /cargar eso/i.test(text))) intensity += 3;
  if (emotion === "surprised" && /\b(wow|sorpresa|sorprendid|vaya|inesperad|no manches|en serio)\b/i.test(text)) intensity += 2;
  if (emotion === "safe" && /\b(no puedo|seguro|safety|filtrado|filtered)\b/i.test(text)) intensity += 2;
  if (text.length > 220) intensity += 1;

  return { emotion, intensity: clampEmotionIntensity(intensity) };
}

function clampEmotionIntensity(value: number): EmotionIntensity {
  return Math.max(1, Math.min(10, Math.round(value))) as EmotionIntensity;
}

function cleanVisibleSpeech(text: string) {
  let cleaned = String(text || "");
  cleaned = stripStructuredPreamble(cleaned);
  cleaned = stripLeadingBracketedMeta(cleaned);
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ");
  cleaned = cleaned.replace(/^\s*\[+\s*(?:Thinking Process|Reasoning|Razonamiento|Pensamiento|Analysis|An[aá]lisis)\s*\]+[\s\S]*?(?=(?:Respuesta final|Respuesta|Final|Yuko)\s*:|$)/i, " ");
  cleaned = cleaned.replace(/^\s*(?:Thinking Process|Reasoning|Razonamiento|Pensamiento|Analysis|An[aá]lisis)\s*:\s*[\s\S]*?(?=(?:Respuesta final|Final|Yuko)\s*:|$)/i, " ");
  cleaned = cleaned.replace(/^[\s\S]{0,500}\b(?:Respuesta final|Respuesta|Final)\s*:\s*/i, "");
  cleaned = cleaned.replace(/^\s*(?:Respuesta final|Final)\s*:\s*/i, "");
  cleaned = cleaned.replace(/\*+\s*\([^)]{0,320}\)\s*\*+/g, " ");
  cleaned = cleaned.replace(/\([^)]{0,320}\b(?:pantalla|m[uú]sica|escucha|ilumina|sonr[ií]e|puchero|voz|streamer|escena|fondo)\b[^)]{0,320}\)/gi, " ");
  cleaned = cleaned.replace(/\s*\*+\s*(?:se escucha|la pantalla|se ilumina|suena|aparece|yuko|sonr[ií]e|mira|hace|levanta|baja|camina|escena|fondo|m[uú]sica)\b[\s\S]*$/i, " ");
  cleaned = cleaned.replace(/\s*\([^)]{0,320}\b(?:se escucha|la pantalla|se ilumina|suena|aparece|yuko|sonr[ií]e|mira|hace|levanta|baja|camina|escena|fondo|m[uú]sica)\b[\s\S]*$/i, " ");
  cleaned = cleaned.replace(/\*{1,3}\s*Yuko\s*:\s*\*{0,3}/gi, "");
  cleaned = cleaned.replace(/^\s*Yuko\s*:\s*/gi, "");
  cleaned = cleaned.replace(/\*{1,3}([^*\n]{1,180})\*{1,3}/g, "$1");
  cleaned = cleaned.replace(/\s+\*[^.!?]{0,220}$/g, "");
  cleaned = cleaned.replace(/\bpondr[eé]\s+(?:mi\s+)?voz\b/gi, "voy a sonar");
  cleaned = cleaned.replace(/\bmi\s+(?:creador|due[ñn]o|amor|cari[ñn]o)\b[:,]?\s*/gi, "");
  cleaned = cleaned.replace(/^[\s}\])>,.;:]+(?=[¡¿A-ZÁÉÍÓÚÑa-záéíóúñ])/u, "");
  cleaned = removeEmoji(cleaned);
  cleaned = cleaned.replace(/\s+([,.!?;:])/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return limitVisibleSpeech(cleaned);
}

function stripStructuredPreamble(text: string) {
  let cleaned = String(text || "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*([\s\S]*?)```/i, (_match, body: string) => body.trim());
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, "").trim();
  cleaned = cleaned.replace(/^(?:json|JSON)\s*/i, "").trim();
  cleaned = stripLeadingBalancedJsonObject(cleaned);
  cleaned = stripLeadingJsonLikeFragment(cleaned);
  cleaned = cleaned.replace(/^[\s}\])>,.;:]+(?=[¡¿A-ZÁÉÍÓÚÑa-záéíóúñ])/u, "").trim();
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, "").trim();
  return cleaned;
}

function stripLeadingBalancedJsonObject(text: string) {
  const value = text.trimStart();
  if (!value.startsWith("{")) return value;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(index + 1).trim();
      }
    }
  }
  return value;
}

function stripLeadingJsonLikeFragment(text: string) {
  let value = text.trim();
  const key = "(?:context|persona_guidance|analysis|reasoning|thought|final|answer|respuesta)";
  value = value.replace(new RegExp(`^(?:["']?${key}["']?\\s*[:=]\\s*["'][^"']*["'][,;]?\\s*)+`, "i"), "").trim();
  value = value.replace(new RegExp(`^\\{?\\s*["']?${key}["']?\\s*[:=][\\s\\S]{0,900}?(?=[¡¿A-ZÁÉÍÓÚÑ])`, "i"), "").trim();
  return value;
}

function stripLeadingBracketedMeta(text: string) {
  let value = String(text || "").trim();
  const metaLabel = /\b(?:contexto|context|persona|instrucci[oó]n|instruction|tono|tone|formato|format|usuario|user|respuesta|response|gu[ií]a|guidance)\b/i;
  for (let guard = 0; guard < 8; guard += 1) {
    const match = value.match(/^\s*\[([^\]]{1,600})\]\s*/);
    if (!match || !metaLabel.test(match[1])) break;
    value = value.slice(match[0].length).trim();
  }
  value = value.replace(/^(?:contexto|context|persona|instrucci[oó]n|instruction|tono|tone|formato|format|persona_guidance)\s*:\s*[^.!?]{0,700}(?=[¡¿A-ZÁÉÍÓÚÑ]|$)/i, "").trim();
  return value;
}

function removeEmoji(text: string) {
  return text
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\p{Emoji_Presentation}/gu, "");
}

function limitVisibleSpeech(text: string) {
  const maxChars = 420;
  if (text.length <= maxChars) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const compact = sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();
  if (compact.length >= 40 && compact.length <= maxChars) return compact;
  const clipped = text.slice(0, maxChars).trim();
  const lastEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (lastEnd >= 80) return clipped.slice(0, lastEnd + 1).trim();
  return `${clipped.replace(/\s+\S*$/, "").trim()}.`;
}

function recoverVisibleSpeech(text: string, userMessage = "") {
  const normalized = normalizeText(userMessage);
  if (!String(text || "").trim()) return fallbackVisibleSpeech(normalized);
  if (!isMetaSpeech(text)) return text;
  return fallbackVisibleSpeech(normalized);
}

function fallbackVisibleSpeech(normalized: string) {
  if (/\b(hola|buenos dias|buenas tardes|buenas noches|saludos)\b/.test(normalized)) {
    return "Hola, buenos dias. ¿Cómo va todo?";
  }
  if (/\b(platiques conmigo|platica conmigo|conversemos|conversar|hablemos|hablar contigo)\b/.test(normalized)) {
    return "Claro. ¿De qué te gustaría que habláramos primero?";
  }
  if (/\bminecraft\b/.test(normalized) || /\b(narrar|narra|simular|simula|partida|juego)\b/.test(normalized)) {
    return "Aparezco junto a un arbol; recojo madera rapido antes de que caiga la noche.";
  }
  if (/\b(como estas|como te sientes|que tal estas|cuentame algo)\b/.test(normalized)) {
    return "Estoy bien; puedo platicar contigo con calma y seguir el tema que quieras.";
  }
  if (/\b(cuentame|quien eres|presentate|acerca de ti|sobre ti)\b/.test(normalized)) {
    return "Puedo conversar contigo, responder preguntas y adaptarme al tono que necesites.";
  }
  if (/\b(te quiero|te amo|carino|cariño)\b/.test(normalized)) {
    return "Gracias por decirmelo; lo recibo con mucho aprecio.";
  }
  if (/\b(kawaii|vtuber|linda|tierna|cute)\b/.test(normalized)) {
    return "Puedo ajustar el tono cuando me indiques exactamente el estilo que quieres.";
  }
  if (/\b(triste|tristeza|llorar|mal)\b/.test(normalized)) {
    return "Ven aqui, te acompano despacito; no tienes que cargar eso a solas.";
  }
  return "Puedo seguir contigo. ¿Qué quieres que resolvamos primero?";
}

function isMetaSpeech(text: string) {
  return /^\s*(?:el usuario|la usuaria|la user|user|la instrucci[oó]n|la petici[oó]n)\b/i.test(text)
    || /^\s*(?:goal|objective|objetivo|plan|tono|contenido|formato|debo|necesito|voy a interpretar|voy a responder|mi creador me da)\b/i.test(text)
    || /\b(?:solicitud|mensaje del usuario|mensaje de la usuaria|respuesta anterior|mi respuesta debe ser|debo empezar directamente|debo responder|como narradora en presente|accion inmediata|el tono debe|established persona|start narrating|goal:|plan:|tono:|contenido:|formato:)\b/i.test(text);
}

function normalizeText(text: string) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
