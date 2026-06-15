import type { AvatarSignal } from "./types.js";
import { normalizeAvatarSignal } from "./types.js";

export type AvatarSignalListener = (signal: AvatarSignal) => void;

const listeners = new Set<AvatarSignalListener>();
let currentSignal: AvatarSignal = normalizeAvatarSignal({
  mood: "neutral",
  intensity: 3,
  action: "idle",
  source: "system"
});

export function getCurrentAvatarSignal(): AvatarSignal {
  return currentSignal;
}

export function emitAvatarSignal(signal: Partial<AvatarSignal> | null | undefined): AvatarSignal {
  currentSignal = normalizeAvatarSignal(signal);
  for (const listener of listeners) {
    try {
      listener(currentSignal);
    } catch (error) {
      console.warn("avatar_signal_listener_failed", error instanceof Error ? error.message : error);
    }
  }
  return currentSignal;
}

export function subscribeAvatarSignals(listener: AvatarSignalListener): () => void {
  listeners.add(listener);
  try {
    listener(currentSignal);
  } catch (error) {
    console.warn("avatar_signal_listener_failed", error instanceof Error ? error.message : error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function emitAvatarIdleSignal(source: AvatarSignal["source"] = "system"): AvatarSignal {
  return emitAvatarSignal({
    mood: "neutral",
    intensity: 3,
    action: "idle",
    source
  });
}
