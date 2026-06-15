import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import type { AvatarPerformanceState } from "./avatarPerformanceState.js";
import { applyAdditiveEuler, captureUpperBodyPose, collectUpperBodyBones, type CapturedUpperBodyPose, type UpperBodyBones } from "./bonePoseUtils.js";
import { applyPerformanceExpressions } from "./expressionDirector.js";
import { createGestureRuntime, updateGestureScheduler, type GestureRuntime, type ScheduledGesture } from "./gestureScheduler.js";
import {
  breatheWave,
  createMicroGaze,
  createPostureDrift,
  createSpeechNod,
  organicNoise,
  updateMicroGaze,
  updatePostureDrift,
  updateSpeechNod,
  type MicroGazeState,
  type PostureDriftState,
  type SpeechNodState
} from "./humanMotion.js";
import { avatarPerformanceConfig } from "./performanceConfig.js";

export type AvatarPerformanceRuntime = {
  vrm: VRM | null;
  bones: UpperBodyBones;
  basePose: CapturedUpperBodyPose;
  gesture: GestureRuntime;
  microGaze: MicroGazeState;
  posture: PostureDriftState;
  speechNod: SpeechNodState;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  torsoYaw: number;
  energy: number;
  seed: number;
};

export type AvatarPerformanceFrame = {
  rootYaw: number;
  rootRoll: number;
  rootY: number;
  emphasis: number;
  side: number;
  phase: number;
};

export function createAvatarPerformanceRuntime(): AvatarPerformanceRuntime {
  return {
    vrm: null,
    bones: {},
    basePose: {},
    gesture: createGestureRuntime(),
    microGaze: createMicroGaze(),
    posture: createPostureDrift(),
    speechNod: createSpeechNod(),
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    torsoYaw: 0,
    energy: 0,
    seed: Math.random()
  };
}

export function bindAvatarPerformanceVrm(runtime: AvatarPerformanceRuntime, vrm: VRM | null) {
  runtime.vrm = vrm;
  runtime.bones = vrm ? collectUpperBodyBones(vrm) : {};
  runtime.basePose = captureUpperBodyPose(runtime.bones);
  runtime.gesture = createGestureRuntime();
  runtime.microGaze = createMicroGaze();
  runtime.posture = createPostureDrift();
  runtime.speechNod = createSpeechNod();
  runtime.headYaw = 0;
  runtime.headPitch = 0;
  runtime.headRoll = 0;
  runtime.torsoYaw = 0;
  runtime.energy = 0;
  runtime.seed = Math.random();
}

export function updateAvatarPerformance(
  runtime: AvatarPerformanceRuntime,
  input: {
    vrm: VRM | null;
    state: AvatarPerformanceState;
    speakingWeight: number;
    blinkAmount: number;
    t: number;
    delta: number;
  }
): AvatarPerformanceFrame {
  if (runtime.vrm !== input.vrm) bindAvatarPerformanceVrm(runtime, input.vrm);

  const smoothing = 1 - Math.exp(-avatarPerformanceConfig.smoothing * input.delta);
  const energyTarget = Math.max(input.state.energy, input.speakingWeight * 0.92);
  runtime.energy += (energyTarget - runtime.energy) * smoothing;
  // Capas "humanas": micro-sacadas de mirada, reacomodo postural y cabeceo de énfasis
  // ligado a la envolvente real de la voz. Ver humanMotion.ts.
  updateMicroGaze(runtime.microGaze, input.t, input.delta, runtime.energy);
  updatePostureDrift(runtime.posture, input.t, input.delta);
  const nodPulse = updateSpeechNod(runtime.speechNod, input.speakingWeight, input.delta);
  const gesture = updateGestureScheduler(runtime.gesture, input.state, input.t);
  const frame = buildPerformanceFrame(input.state, runtime, gesture, input.speakingWeight, input.t);

  if (input.vrm) {
    applyBodyPerformance(runtime, input.state, frame, gesture, input.t, input.delta, nodPulse);
    applyPerformanceExpressions(input.vrm, {
      state: input.state,
      blinkAmount: input.blinkAmount,
      speakingWeight: input.speakingWeight,
      t: input.t
    });
  }

  return frame;
}

function buildPerformanceFrame(
  state: AvatarPerformanceState,
  runtime: AvatarPerformanceRuntime,
  gesture: ScheduledGesture,
  speakingWeight: number,
  t: number
): AvatarPerformanceFrame {
  const seed = runtime.seed * Math.PI * 2;
  const energy = runtime.energy;
  const idle = 0.28 + energy * 0.72;
  // Respiración asimétrica + sway no periódico + bias postural: el cuerpo deriva y se
  // recoloca como una persona sentada frente a la cámara, no orbita en seno perfecto.
  const breathing = breatheWave(t, 1.18, seed * 0.3) * avatarPerformanceConfig.breathingIntensity;
  const sway = organicNoise(t * 0.42, seed) * avatarPerformanceConfig.idleSwayIntensity * idle + runtime.posture.swayBias;
  const talk = speakingWeight * (0.4 + energy * 0.85);
  const gestureBoost = gesture.weight * (0.35 + energy * 0.75);
  const excited = state.mode === "excited" || state.emotion === "excited" ? 1 : 0;

  return {
    rootYaw: sway * 0.65 + organicNoise(t * 1.1, gesture.seed) * 0.02 * talk + gestureBoost * 0.035 * gesture.side,
    rootRoll: organicNoise(t * 0.33, seed * 1.7) * 0.008 * idle + runtime.posture.rollBias + gestureBoost * 0.012 * gesture.side,
    rootY: breathing * 0.42 + organicNoise(t * 1.9, seed + 9) * 0.005 * idle + gestureBoost * 0.012 + excited * Math.sin(t * 3.2) * 0.006,
    emphasis: gestureBoost,
    side: gesture.side,
    phase: gesture.phase
  };
}

function applyBodyPerformance(
  runtime: AvatarPerformanceRuntime,
  state: AvatarPerformanceState,
  frame: AvatarPerformanceFrame,
  gesture: ScheduledGesture,
  t: number,
  delta: number,
  nodPulse: number
) {
  const bones = runtime.bones;
  const base = runtime.basePose;
  const seed = runtime.seed * Math.PI * 2;
  const energy = runtime.energy;
  const modePose = poseForState(state);
  const breath = breatheWave(t, 1.18, seed * 0.2);
  const slowNoise = organicNoise(t * 0.37, seed * 2.1);
  const gestureWeight = frame.emphasis;
  const headTarget = gazeHeadTarget(state.attentionTarget);
  const gazeSmooth = 1 - Math.exp(-avatarPerformanceConfig.gazeSmoothing * delta);

  // El objetivo de mirada combina la atención de la escena con las micro-sacadas (la
  // sacada ya viene easada con su propia velocidad rápida desde humanMotion).
  const microYaw = runtime.microGaze.yaw * avatarPerformanceConfig.gazeMotionIntensity;
  const microPitch = runtime.microGaze.pitch * avatarPerformanceConfig.gazeMotionIntensity;
  // Cabeceo de énfasis: impulso al arrancar frase/sílaba fuerte, sincronizado al audio.
  const speechNodPitch = nodPulse * 0.045;

  runtime.headYaw += (headTarget.yaw + microYaw + modePose.headYaw + gestureHeadYaw(gesture) - runtime.headYaw) * gazeSmooth;
  runtime.headPitch += (headTarget.pitch + microPitch + speechNodPitch + modePose.headPitch + gestureHeadPitch(gesture) - runtime.headPitch) * gazeSmooth;
  runtime.headRoll += (headTarget.roll + modePose.headRoll + gestureHeadRoll(gesture) - runtime.headRoll) * gazeSmooth;
  runtime.torsoYaw += (modePose.torsoYaw + frame.rootYaw * 0.68 - runtime.torsoYaw) * (1 - Math.exp(-5.2 * delta));

  const headMotion = avatarPerformanceConfig.headMotionIntensity;
  const torsoTwist = Math.max(-avatarPerformanceConfig.maxTorsoTwist, Math.min(avatarPerformanceConfig.maxTorsoTwist, runtime.torsoYaw));
  const shoulderPulse = avatarPerformanceConfig.shoulderMotionIntensity * (0.012 + gestureWeight * 0.045);
  const armMotion = avatarPerformanceConfig.armMotionIntensity;
  const armLeadL = frame.side < 0 ? 1 : 0.58;
  const armLeadR = frame.side > 0 ? 1 : 0.58;
  const explain = gesture.name === "hand_explain_medium" ? 1 : gesture.name === "hand_explain_small" ? 0.62 : 0;
  const amused = gesture.name === "amused_shoulder" || state.mode === "amused" ? 1 : 0;
  const recoil = gesture.name === "surprised_recoil_small" ? gestureWeight : 0;
  const soft = gesture.name === "soft_lean" || state.mode === "soft" || state.emotion === "soft" ? 1 : 0;
  const bounce = gesture.name === "excited_bounce_small" ? gestureWeight : 0;

  applyAdditiveEuler(bones, base, "hips", modePose.hipsPitch + breath * 0.006, frame.rootYaw * 0.38, frame.rootRoll * -0.55);
  applyAdditiveEuler(bones, base, "spine", modePose.spinePitch + breath * 0.014 + recoil * 0.04 - soft * 0.02, torsoTwist * 0.62, frame.rootRoll * 0.55);
  applyAdditiveEuler(bones, base, "chest", modePose.chestPitch + breath * 0.024 - gestureWeight * 0.035 - bounce * 0.025, torsoTwist + gestureWeight * 0.03 * frame.side, frame.rootRoll + gestureWeight * 0.04 * frame.side);
  applyAdditiveEuler(bones, base, "upperChest", modePose.chestPitch + breath * 0.03 - gestureWeight * 0.045, torsoTwist * 1.1, frame.rootRoll * 1.2 + gestureWeight * 0.052 * frame.side);
  applyAdditiveEuler(bones, base, "neck", runtime.headPitch * 0.32 + breath * 0.006, runtime.headYaw * 0.3, runtime.headRoll * 0.34);
  // El temblor sutil de cabeza NUNCA se apaga del todo (con tracking real la cabeza
  // jamás está quieta, ni hablando); solo baja un poco su amplitud con la energía.
  const headJitter = 0.55 + (1 - energy) * 0.45;
  applyAdditiveEuler(
    bones,
    base,
    "head",
    runtime.headPitch * headMotion + organicNoise(t * 0.74, seed) * 0.011 * headJitter,
    runtime.headYaw * headMotion + organicNoise(t * 0.52, seed + 3.1) * 0.016 * headJitter,
    runtime.headRoll * headMotion + slowNoise * 0.008 * headJitter
  );

  applyAdditiveEuler(bones, base, "leftShoulder", shoulderPulse * (0.4 + amused), 0, -0.065 - gestureWeight * 0.045 * armLeadL);
  applyAdditiveEuler(bones, base, "rightShoulder", shoulderPulse * (0.42 + amused), 0, 0.065 + gestureWeight * 0.045 * armLeadR);

  const restDrop = avatarPerformanceConfig.armRestDrop;
  const forearmFold = avatarPerformanceConfig.forearmRestFold;
  const lift = Math.min(avatarPerformanceConfig.maxArmLift, (0.1 + energy * 0.3 + explain * gestureWeight * 0.44) * armMotion);
  const idleArm = Math.sin(t * 0.92 + seed) * 0.018 * (1 - energy * 0.5);
  const talkPulse = Math.sin(t * 2.6 + gesture.phase + seed) * gestureWeight * 0.07;
  const wristWaveL = Math.sin(t * 1.78 + seed + gesture.phase) * (0.032 + gestureWeight * 0.07);
  const wristWaveR = Math.sin(t * 1.66 + seed + gesture.phase + 0.9) * (0.032 + gestureWeight * 0.07);

  applyAdditiveEuler(bones, base, "leftUpperArm", modePose.leftArmX + idleArm + lift * 0.36 * armLeadL + recoil * -0.08, modePose.leftArmY - gestureWeight * 0.06 * armLeadL, -restDrop + modePose.leftArmZ + lift * 0.72 * armLeadL + talkPulse);
  applyAdditiveEuler(bones, base, "rightUpperArm", modePose.rightArmX - idleArm + lift * 0.36 * armLeadR + recoil * -0.08, modePose.rightArmY + gestureWeight * 0.06 * armLeadR, restDrop + modePose.rightArmZ - lift * 0.72 * armLeadR - talkPulse);
  applyAdditiveEuler(bones, base, "leftLowerArm", modePose.elbowFold + lift * 0.28 * armLeadL, -0.045 - gestureWeight * 0.045, -forearmFold - lift * 0.18 * armLeadL);
  applyAdditiveEuler(bones, base, "rightLowerArm", modePose.elbowFold + lift * 0.28 * armLeadR, 0.045 + gestureWeight * 0.045, forearmFold + lift * 0.18 * armLeadR);
  applyAdditiveEuler(bones, base, "leftHand", wristWaveL + gestureWeight * 0.085 * armLeadL, -0.045, -0.055 - gestureWeight * 0.055);
  applyAdditiveEuler(bones, base, "rightHand", wristWaveR + gestureWeight * 0.085 * armLeadR, 0.045, 0.055 + gestureWeight * 0.055);
}

function poseForState(state: AvatarPerformanceState) {
  const sad = state.mode === "sad" || state.emotion === "sad";
  const surprised = state.mode === "surprised" || state.emotion === "surprised";
  const amused = state.mode === "amused" || state.emotion === "amused" || state.emotion === "happy";
  const thinking = state.mode === "thinking";
  const soft = state.mode === "soft" || state.emotion === "soft";
  return {
    headPitch: sad || soft ? 0.07 : surprised || amused ? -0.035 : thinking ? 0.035 : 0,
    headYaw: thinking ? -0.035 : 0,
    headRoll: amused ? 0.035 : sad ? -0.025 : thinking ? -0.05 : 0,
    torsoYaw: thinking ? -0.025 : amused ? 0.018 : 0,
    hipsPitch: sad ? 0.025 : amused || surprised ? -0.012 : 0,
    spinePitch: sad ? 0.045 : soft ? 0.025 : amused || surprised ? -0.026 : 0,
    chestPitch: sad ? 0.06 : soft ? 0.022 : amused || surprised ? -0.04 : 0,
    leftArmX: sad || soft ? -0.025 : surprised ? 0.09 : 0,
    leftArmY: thinking ? -0.04 : 0,
    leftArmZ: sad || soft ? -0.08 : surprised ? 0.12 : amused ? 0.04 : 0,
    rightArmX: sad || soft ? -0.025 : surprised ? 0.09 : 0,
    rightArmY: thinking ? 0.04 : 0,
    rightArmZ: sad || soft ? 0.08 : surprised ? -0.12 : amused ? -0.04 : 0,
    elbowFold: sad || soft ? -0.03 : surprised ? 0.08 : 0.04
  };
}

function gazeHeadTarget(target: AvatarPerformanceState["attentionTarget"]) {
  if (target === "chat") return { yaw: -0.055, pitch: 0.005, roll: -0.012 };
  if (target === "thought") return { yaw: -0.085, pitch: -0.06, roll: -0.032 };
  if (target === "side") return { yaw: 0.11, pitch: -0.008, roll: 0.02 };
  if (target === "down") return { yaw: -0.025, pitch: 0.07, roll: -0.018 };
  return { yaw: 0, pitch: 0, roll: 0 };
}

function gestureHeadYaw(gesture: ScheduledGesture) {
  if (gesture.name === "head_tilt") return 0.032 * gesture.side * gesture.weight;
  if (gesture.name === "small_nod") return 0;
  if (gesture.name === "surprised_recoil_small") return -0.026 * gesture.side * gesture.weight;
  return 0.018 * gesture.side * gesture.weight;
}

function gestureHeadPitch(gesture: ScheduledGesture) {
  if (gesture.name === "small_nod") return Math.sin(gesture.phase * Math.PI * 2) * 0.055 * gesture.weight;
  if (gesture.name === "surprised_recoil_small") return -0.08 * gesture.weight;
  if (gesture.name === "soft_lean") return 0.04 * gesture.weight;
  if (gesture.name === "excited_bounce_small") return -0.035 * gesture.weight;
  return -0.018 * gesture.weight;
}

function gestureHeadRoll(gesture: ScheduledGesture) {
  if (gesture.name === "head_tilt" || gesture.name === "amused_shoulder") return 0.065 * gesture.side * gesture.weight;
  return 0.026 * gesture.side * gesture.weight;
}
