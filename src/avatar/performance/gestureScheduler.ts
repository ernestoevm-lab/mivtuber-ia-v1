import type { AvatarGestureName, AvatarPerformanceState } from "./avatarPerformanceState.js";
import { avatarPerformanceConfig } from "./performanceConfig.js";

export type GestureRuntime = {
  activeGesture: AvatarGestureName;
  startedAt: number;
  duration: number;
  nextGestureAt: number;
  lastGesture: AvatarGestureName | null;
  side: -1 | 1;
  seed: number;
};

export type ScheduledGesture = {
  name: AvatarGestureName;
  weight: number;
  side: -1 | 1;
  seed: number;
  phase: number;
};

const idleGestures: AvatarGestureName[] = ["small_nod", "head_tilt", "soft_lean"];
const speakingGestures: AvatarGestureName[] = ["hand_explain_small", "hand_explain_medium", "small_nod", "head_tilt"];
const amusedGestures: AvatarGestureName[] = ["amused_shoulder", "head_tilt", "hand_explain_small"];
const surprisedGestures: AvatarGestureName[] = ["surprised_recoil_small", "small_nod"];
const excitedGestures: AvatarGestureName[] = ["excited_bounce_small", "hand_explain_medium", "small_nod"];

export function createGestureRuntime(): GestureRuntime {
  return {
    activeGesture: "small_nod",
    startedAt: -10,
    duration: 0.9,
    nextGestureAt: 0.8,
    lastGesture: null,
    side: 1,
    seed: 0.37
  };
}

export function updateGestureScheduler(runtime: GestureRuntime, state: AvatarPerformanceState, t: number): ScheduledGesture {
  const forcedGesture = state.gesture && state.gesture !== runtime.activeGesture ? state.gesture : null;
  if (forcedGesture || t >= runtime.nextGestureAt) {
    const next = forcedGesture || chooseGesture(state, runtime.lastGesture);
    runtime.activeGesture = next;
    runtime.lastGesture = next;
    runtime.startedAt = t;
    runtime.duration = gestureDuration(next, state.energy);
    runtime.nextGestureAt = t + runtime.duration + cooldownSeconds(state);
    runtime.side = runtime.side > 0 ? -1 : 1;
    runtime.seed = (runtime.seed * 1.91 + 0.37 + Math.random() * 0.31) % 1;
  }

  const progress = (t - runtime.startedAt) / Math.max(0.1, runtime.duration);
  const weight = progress >= 0 && progress <= 1
    ? Math.pow(Math.sin(progress * Math.PI), 1.28) * avatarPerformanceConfig.gestureIntensity
    : 0;

  return {
    name: runtime.activeGesture,
    weight,
    side: runtime.side,
    seed: runtime.seed,
    phase: progress
  };
}

function chooseGesture(state: AvatarPerformanceState, lastGesture: AvatarGestureName | null): AvatarGestureName {
  const pool =
    state.mode === "speaking" ? speakingGestures
      : state.mode === "amused" ? amusedGestures
        : state.mode === "surprised" ? surprisedGestures
          : state.mode === "excited" ? excitedGestures
            : state.emotion === "surprised" ? surprisedGestures
              : state.emotion === "amused" || state.emotion === "happy" ? amusedGestures
                : idleGestures;
  const candidates = pool.filter((gesture) => gesture !== lastGesture);
  const safePool = candidates.length ? candidates : pool;
  return safePool[Math.floor(Math.random() * safePool.length)] || "small_nod";
}

function gestureDuration(gesture: AvatarGestureName, energy: number) {
  const base = gesture === "hand_explain_medium" || gesture === "excited_bounce_small" ? 1.05 : 0.82;
  return base + Math.max(0, 1 - energy) * 0.24 + Math.random() * 0.24;
}

function cooldownSeconds(state: AvatarPerformanceState) {
  const { gestureMinCooldownSeconds, gestureMaxCooldownSeconds } = avatarPerformanceConfig;
  const span = gestureMaxCooldownSeconds - gestureMinCooldownSeconds;
  const energyFactor = 1 - Math.max(0, Math.min(1, state.energy));
  return gestureMinCooldownSeconds + span * (0.25 + energyFactor * 0.75) + Math.random() * 0.55;
}
