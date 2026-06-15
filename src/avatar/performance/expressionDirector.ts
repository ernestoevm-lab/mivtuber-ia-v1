import { VRM } from "@pixiv/three-vrm";
import type { AvatarPerformanceState } from "./avatarPerformanceState.js";
import { avatarPerformanceConfig } from "./performanceConfig.js";

export type ExpressionFrameInput = {
  state: AvatarPerformanceState;
  blinkAmount: number;
  speakingWeight: number;
  t: number;
};

const lipSyncExpressions = new Set(["aa", "ih", "ou", "ee", "oh", "A", "I", "U", "E", "O"]);

export function applyPerformanceExpressions(vrm: VRM | null, input: ExpressionFrameInput) {
  const manager = vrm?.expressionManager;
  if (!vrm || !manager) return;

  manager.resetValues();
  const energy = input.state.energy;
  const expressionPower = avatarPerformanceConfig.expressionIntensity;
  const microSmile = (input.state.mode === "idle" || input.state.mode === "listening") && input.state.emotion !== "sad" && input.state.emotion !== "angry"
    ? 0.06 + Math.sin(input.t * 0.72) * 0.018
    : 0;

  if (input.state.emotion === "happy") setExpressionIfPresent(vrm, ["happy", "joy", "relaxed"], (0.22 + energy * 0.52) * expressionPower);
  if (input.state.emotion === "amused") setExpressionIfPresent(vrm, ["happy", "joy", "relaxed"], (0.28 + energy * 0.44) * expressionPower);
  if (input.state.emotion === "excited") setExpressionIfPresent(vrm, ["happy", "surprised", "joy"], (0.24 + energy * 0.5) * expressionPower);
  if (input.state.emotion === "sad" || input.state.mode === "sad") setExpressionIfPresent(vrm, ["sad", "relaxed"], (0.2 + energy * 0.36) * expressionPower);
  if (input.state.emotion === "surprised" || input.state.mode === "surprised") setExpressionIfPresent(vrm, ["surprised"], (0.22 + energy * 0.54) * expressionPower);
  if (input.state.emotion === "angry") setExpressionIfPresent(vrm, ["angry"], (0.14 + energy * 0.46) * expressionPower);
  if (input.state.emotion === "soft" || input.state.mode === "soft") setExpressionIfPresent(vrm, ["relaxed", "happy"], (0.12 + energy * 0.24) * expressionPower);
  if (input.state.mode === "thinking") setExpressionIfPresent(vrm, ["surprised", "relaxed"], (0.08 + energy * 0.22) * expressionPower);
  if (microSmile > 0) setExpressionIfPresent(vrm, ["relaxed", "happy", "joy"], microSmile);

  applyLookExpressions(vrm, input.state.attentionTarget, energy);
  setExpressionIfPresent(vrm, ["blink", "blinkLeft", "blinkRight"], input.blinkAmount);
  applyMouthExpressions(vrm, input.speakingWeight, input.t, energy);
}

function applyLookExpressions(vrm: VRM, target: AvatarPerformanceState["attentionTarget"], energy: number) {
  const amount = avatarPerformanceConfig.gazeMotionIntensity * (0.1 + energy * 0.22);
  if (target === "thought") {
    setExpressionIfPresent(vrm, ["lookUp"], amount);
    setExpressionIfPresent(vrm, ["lookLeft"], amount * 0.72);
  }
  if (target === "side") setExpressionIfPresent(vrm, ["lookRight"], amount);
  if (target === "down") setExpressionIfPresent(vrm, ["lookDown"], amount * 0.9);
  if (target === "chat") setExpressionIfPresent(vrm, ["lookLeft"], amount * 0.5);
}

function applyMouthExpressions(vrm: VRM, speakingWeight: number, t: number, energy: number) {
  const mouth = speakingWeight > 0.02
    ? speakingWeight * (0.14 + Math.abs(Math.sin(t * (10.5 + energy * 2.8))) * (0.34 + energy * 0.22))
    : 0;
  setExpressionIfPresent(vrm, ["aa", "A"], mouth);
  setExpressionIfPresent(vrm, ["ih", "I"], mouth * 0.18);
  setExpressionIfPresent(vrm, ["ou", "U"], mouth * 0.12);
}

export function getExpressionNames(vrm: VRM) {
  const manager = vrm.expressionManager;
  if (!manager) return [];
  const names = [
    ...Object.keys(manager.expressionMap),
    ...manager.expressions.map((expression) => expression.expressionName)
  ].filter(Boolean);
  return Array.from(new Set(names)).sort();
}

export function hasAnyExpression(vrm: VRM, names: string[]) {
  const manager = vrm.expressionManager;
  if (!manager) return false;
  return names.some((name) => manager.getExpression(name));
}

function setExpressionIfPresent(vrm: VRM, names: string[], value: number) {
  const manager = vrm.expressionManager;
  if (!manager) return;
  const safeValue = Math.max(0, Math.min(1, value));
  for (const name of names) {
    if (!lipSyncExpressions.has(name) || value > 0) {
      if (manager.getExpression(name)) manager.setValue(name, safeValue);
    }
  }
}
