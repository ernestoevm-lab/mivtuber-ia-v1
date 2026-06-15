export type AvatarMood =
  | "neutral"
  | "happy"
  | "focused"
  | "surprised"
  | "annoyed"
  | "sad";

export type AvatarAction =
  | "idle"
  | "listening"
  | "thinking"
  | "watching"
  | "speaking"
  | "laughing"
  | "reacting";

export type AvatarSignalSource = "llm" | "speech" | "ui" | "system";

export type AvatarSignal = {
  responseId?: string;
  mood: AvatarMood;
  intensity: number;
  action: AvatarAction;
  text?: string;
  startedAt?: number;
  estimatedDurationMs?: number;
  audioKind?: string;
  source?: AvatarSignalSource;
};

const avatarMoods: readonly AvatarMood[] = ["neutral", "happy", "focused", "surprised", "annoyed", "sad"];
const avatarActions: readonly AvatarAction[] = ["idle", "listening", "thinking", "watching", "speaking", "laughing", "reacting"];

export function clampAvatarIntensity(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

export function normalizeAvatarMood(value: unknown): AvatarMood {
  const normalized = String(value || "").trim().toLowerCase();
  if (avatarMoods.includes(normalized as AvatarMood)) return normalized as AvatarMood;
  if (["feliz", "joy", "joyful", "excited", "safe"].includes(normalized)) return "happy";
  if (["thinking", "pensando", "focus", "focused", "concentrada"].includes(normalized)) return "focused";
  if (["molesta", "angry", "mad", "irritated"].includes(normalized)) return "annoyed";
  if (["triste", "sad"].includes(normalized)) return "sad";
  if (["surprise", "surprised", "sorprendida"].includes(normalized)) return "surprised";
  return "neutral";
}

export function normalizeAvatarAction(value: unknown): AvatarAction {
  const normalized = String(value || "").trim().toLowerCase();
  if (avatarActions.includes(normalized as AvatarAction)) return normalized as AvatarAction;
  if (["speak", "hablar", "talk", "talking", "audio"].includes(normalized)) return "speaking";
  if (["think", "thinking", "pensando"].includes(normalized)) return "thinking";
  if (["watch", "watching", "mirar", "viendo", "vision", "visual"].includes(normalized)) return "watching";
  if (["listen", "listening", "escuchando"].includes(normalized)) return "listening";
  if (["laugh", "laughing", "risa"].includes(normalized)) return "laughing";
  if (["react", "reaction", "reacting"].includes(normalized)) return "reacting";
  return "idle";
}

export function normalizeAvatarSignal(signal: Partial<AvatarSignal> | null | undefined): AvatarSignal {
  return {
    responseId: cleanOptionalString(signal?.responseId),
    mood: normalizeAvatarMood(signal?.mood),
    intensity: clampAvatarIntensity(signal?.intensity),
    action: normalizeAvatarAction(signal?.action),
    text: cleanOptionalString(signal?.text),
    startedAt: cleanOptionalNumber(signal?.startedAt),
    estimatedDurationMs: cleanOptionalNumber(signal?.estimatedDurationMs),
    audioKind: cleanOptionalString(signal?.audioKind),
    source: normalizeAvatarSignalSource(signal?.source)
  };
}

function normalizeAvatarSignalSource(value: unknown): AvatarSignalSource | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "llm" || normalized === "speech" || normalized === "ui" || normalized === "system") return normalized;
  return undefined;
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function cleanOptionalNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
