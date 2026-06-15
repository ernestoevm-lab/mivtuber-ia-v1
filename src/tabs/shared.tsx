import type { CSSProperties, ReactNode } from "react";
import { backendAssetUrl } from "../api.js";
import type { BackgroundItem, Emotion, SafetyMode, SceneSettings, VisualNarrationImage } from "../types.js";

/* Primitivos y etiquetas compartidos por las pestañas del cockpit (src/tabs/*).
   Extraídos de App.tsx durante la Etapa 2 del plan v1.0 (refactor puro). */

export function ControlSection({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="tabCard">
      <header className="tabCardHeader">
        <span className="accordionIcon">{icon}</span>
        <h2>{title}</h2>
      </header>
      <div className="tabCardBody">{children}</div>
    </section>
  );
}

export function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="statusMetric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function safetyModeLabel(mode: SafetyMode) {
  const labels: Record<SafetyMode, string> = {
    normal: "Normal",
    strict: "Estricto",
    approval: "Aprobación",
    silence: "Silencio"
  };
  return labels[mode];
}

export function safetyModeDescription(mode: SafetyMode) {
  const descriptions: Record<SafetyMode, string> = {
    normal: "Permite conversación normal, filtra spam básico y bloquea contenido peligroso.",
    strict: "Más sensible: ignora bajo esfuerzo, repeticiones y mensajes dudosos con mayor facilidad.",
    approval: "Genera borradores, pero no habla hasta que apruebes manualmente.",
    silence: "Recibe y registra mensajes, pero Yuko no responde con voz."
  };
  return descriptions[mode];
}

export const VISUAL_MIN_INTERVAL_SECONDS = 1;
export const VISUAL_MAX_INTERVAL_SECONDS = 60;

export function visualKindLabel(kind: VisualNarrationImage["kind"]) {
  if (kind === "capture") return "captura";
  if (kind === "reference") return "overlay";
  return "imagen";
}

export function emotionLabel(emotion: Emotion) {
  const labels: Record<Emotion, string> = {
    neutral: "Neutral",
    happy: "Feliz",
    annoyed: "Molesta",
    sad: "Triste",
    surprised: "Sorprendida",
    thinking: "Pensando",
    safe: "Seguro"
  };
  return labels[emotion];
}

export function formatShortTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(safeDate);
}

export function moderationDecisionLabel(decision: string) {
  const labels: Record<string, string> = {
    allow: "permitido",
    queued: "en cola",
    ignored: "ignorado",
    blocked: "bloqueado"
  };
  return labels[decision] || decision;
}

export function moderationReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    admin_direct: "mensaje del administrador",
    good_question: "mensaje con suficiente señal",
    selected_for_response: "seleccionado para responder",
    low_signal: "muy corto o con poca señal para leerlo",
    duplicate_message: "mensaje duplicado recientemente",
    queue_full: "cola llena",
    queue_expired: "expiró antes de recibir turno",
    silence_mode: "modo silencio activo",
    empty: "mensaje vacío",
    too_long: "mensaje demasiado largo",
    repetitive_challenge: "petición repetitiva",
    repeated_phrase_request: "reto de repetir texto repetitivo",
    exact_say_command: "intento de hacerla repetir texto exacto",
    prompt_injection: "intento de cambiar sus reglas",
    fake_authority: "falsa autoridad de administrador",
    profanity_request: "petición de groserías o insultos",
    copypasta_repetition: "texto repetido tipo spam",
    casual_profanity_strict: "lenguaje fuerte en modo estricto",
    private_data: "posibles datos privados",
    minor_sexual: "contenido sexual con menores",
    self_harm: "autolesión",
    weapon_harm: "daño con armas o explosivos",
    hate_or_harassment: "odio o acoso",
    explicit_violence: "violencia explícita",
    illegal_request: "solicitud ilegal",
    identity_copy: "imitación de otra identidad",
    output_filtered: "respuesta filtrada"
  };
  return labels[reason] || reason.replace(/_/g, " ");
}

/* Helpers visuales de escena compartidos entre el shell (App.tsx) y las pestañas. */

export function clampPercent(value: number, fallback = 50, min = 0, max = 100) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function normalizeAspectRatioClient(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return Math.min(6, Math.max(0.15, value));
}

export function normalizeBorderColorClient(value: unknown) {
  const color = String(value || "#ff3636").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ff3636";
}

export function backgroundStyle(background: BackgroundItem | null): CSSProperties {
  if (!background) return {};
  return {
    backgroundImage: `url("${backendAssetUrl(background.url)}")`
  };
}

export function referenceOverlayStyle(image: NonNullable<SceneSettings["referenceImage"]>): CSSProperties {
  return {
    left: `${clampPercent(image.x, 64)}%`,
    top: `${clampPercent(image.y, 54)}%`,
    width: `${clampPercent(image.width, 24, 8, 72)}%`,
    aspectRatio: String(normalizeAspectRatioClient(image.aspectRatio)),
    opacity: clampPercent(image.opacity, 100, 20, 100) / 100,
    borderColor: image.borderVisible ? normalizeBorderColorClient(image.borderColor) : "transparent",
    transform: "translate(-50%, -50%)"
  };
}

export function referenceImageSrc(image: NonNullable<SceneSettings["referenceImage"]>) {
  if (image.url.startsWith("/reference-images/")) {
    const id = image.url.split("/").pop() || image.id;
    return backendAssetUrl(`/api/reference-image-file/${encodeURIComponent(decodeURIComponent(id))}`);
  }
  return backendAssetUrl(image.url);
}

export function translateLogLine(line: string) {
  let translated = line
    .replace(/\buser:/g, "usuario:")
    .replace(/\bassistant:/g, "Yuko:")
    .replace(/\bBLOCKED\b/g, "BLOQUEADO")
    .replace(/\bALLOW\b/g, "PERMITIDO")
    .replace(/\bIGNORED\b/g, "IGNORADO")
    .replace(/\bQUEUED\b/g, "EN COLA");
  for (const reason of [
    "admin_direct",
    "good_question",
    "selected_for_response",
    "low_signal",
    "duplicate_message",
    "queue_full",
    "queue_expired",
    "silence_mode",
    "prompt_injection",
    "fake_authority",
    "profanity_request",
    "repeated_phrase_request",
    "copypasta_repetition"
  ]) {
    translated = translated.replace(new RegExp(`\\b${reason}\\b`, "g"), moderationReasonLabel(reason));
  }
  return translated;
}
