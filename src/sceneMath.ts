export const sceneRanges = {
  cameraDistance: { min: -2, max: 4, defaultValue: 0 },
  cameraHeight: { min: -1.6, max: 1.8, defaultValue: 0 },
  cameraX: { min: -2, max: 2, defaultValue: 0 },
  cameraY: { min: -1.8, max: 1.8, defaultValue: 0 },
  avatarScale: { min: 0.55, max: 2.4, defaultValue: 1 }
} as const;

export type SceneNumericKey = keyof typeof sceneRanges;

export function toPercent(key: SceneNumericKey, value: number) {
  const range = sceneRanges[key];
  const clamped = clampNumber(value, range.min, range.max, range.defaultValue);
  return Math.round(((clamped - range.min) / (range.max - range.min)) * 100);
}

export function fromPercent(key: SceneNumericKey, percent: number) {
  const range = sceneRanges[key];
  const clamped = clampNumber(percent, 0, 100, 50);
  const value = range.min + (clamped / 100) * (range.max - range.min);
  return snapNumber(value, key === "cameraDistance" ? 0.1 : 0.05);
}

export function normalizeSceneNumber(key: SceneNumericKey, value: unknown) {
  const range = sceneRanges[key];
  return clampNumber(value, range.min, range.max, range.defaultValue);
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function snapNumber(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(4));
}
