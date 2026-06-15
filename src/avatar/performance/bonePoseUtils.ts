import * as THREE from "three";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export type UpperBodyBoneName =
  | "hips"
  | "spine"
  | "chest"
  | "upperChest"
  | "neck"
  | "head"
  | "leftShoulder"
  | "rightShoulder"
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand";

export type UpperBodyBones = Partial<Record<UpperBodyBoneName, THREE.Object3D>>;

export type CapturedUpperBodyPose = Partial<Record<UpperBodyBoneName, THREE.Euler>>;

const upperBodyBoneMap: Record<UpperBodyBoneName, VRMHumanBoneName> = {
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  chest: VRMHumanBoneName.Chest,
  upperChest: VRMHumanBoneName.UpperChest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,
  leftShoulder: VRMHumanBoneName.LeftShoulder,
  rightShoulder: VRMHumanBoneName.RightShoulder,
  leftUpperArm: VRMHumanBoneName.LeftUpperArm,
  rightUpperArm: VRMHumanBoneName.RightUpperArm,
  leftLowerArm: VRMHumanBoneName.LeftLowerArm,
  rightLowerArm: VRMHumanBoneName.RightLowerArm,
  leftHand: VRMHumanBoneName.LeftHand,
  rightHand: VRMHumanBoneName.RightHand
};

export function collectUpperBodyBones(vrm: VRM): UpperBodyBones {
  const bones: UpperBodyBones = {};
  for (const [key, boneName] of Object.entries(upperBodyBoneMap) as Array<[UpperBodyBoneName, VRMHumanBoneName]>) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName) || undefined;
    if (bone) bones[key] = bone;
  }
  return bones;
}

export function captureUpperBodyPose(bones: UpperBodyBones): CapturedUpperBodyPose {
  const pose: CapturedUpperBodyPose = {};
  for (const [key, bone] of Object.entries(bones) as Array<[UpperBodyBoneName, THREE.Object3D | undefined]>) {
    if (bone) pose[key] = bone.rotation.clone();
  }
  return pose;
}

export function applyAdditiveEuler(
  bones: UpperBodyBones,
  basePose: CapturedUpperBodyPose,
  key: UpperBodyBoneName,
  x = 0,
  y = 0,
  z = 0
) {
  const bone = bones[key];
  const base = basePose[key];
  if (!bone || !base) return;
  bone.rotation.set(base.x + x, base.y + y, base.z + z, base.order);
}

export function resetUpperBodyPose(bones: UpperBodyBones, basePose: CapturedUpperBodyPose) {
  for (const key of Object.keys(bones) as UpperBodyBoneName[]) {
    applyAdditiveEuler(bones, basePose, key);
  }
}
