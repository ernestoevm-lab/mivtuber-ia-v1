import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { derivePerformanceState, getExternalAvatarPerformanceState } from "./avatar/performance/avatarPerformanceState.js";
import { applyPerformanceExpressions, getExpressionNames as getVrmExpressionNames, hasAnyExpression as vrmHasAnyExpression } from "./avatar/performance/expressionDirector.js";
import { bindAvatarPerformanceVrm, createAvatarPerformanceRuntime, updateAvatarPerformance } from "./avatar/performance/proceduralPerformance.js";
import type { AvatarSignal } from "./avatar/types.js";
import { AvatarCameraPreset, Emotion, EmotionIntensity, SceneSettings } from "./types.js";

export type { AvatarCameraPreset };

export interface AvatarRuntimeStatus {
  hasVrm: boolean;
  source: "fallback" | "manual" | "default";
  expressions: string[];
  supportsLipSync: boolean;
  notice: string;
}

interface Props {
  emotion: Emotion;
  emotionIntensity?: EmotionIntensity;
  signal?: AvatarSignal | null;
  compact?: boolean;
  speaking?: boolean;
  cameraPreset?: AvatarCameraPreset;
  vrmFile?: File | null;
  defaultAvatarPath?: string;
  scene?: SceneSettings | null;
  onStatusChange?: (status: AvatarRuntimeStatus) => void;
}

const defaultStatus: AvatarRuntimeStatus = {
  hasVrm: false,
  source: "fallback",
  expressions: [],
  supportsLipSync: false,
  notice: "Sin VRM definitivo; usando avatar temporal."
};

const defaultSceneSettings: SceneSettings = {
  activeBackground: "",
  referenceImage: null,
  cameraPreset: "obs",
  cameraDistance: 0,
  cameraHeight: 0,
  cameraX: 0,
  cameraY: 0,
  avatarScale: 1,
  captionVisible: true,
  mode: "scene16x9"
};

const cameraPresets: Record<AvatarCameraPreset, { position: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
  bust: {
    position: new THREE.Vector3(0, 1.18, 4.35),
    target: new THREE.Vector3(0, 0.58, 0),
    fov: 26
  },
  half: {
    position: new THREE.Vector3(0, 1.08, 5.35),
    target: new THREE.Vector3(0, 0.28, 0),
    fov: 30
  },
  full: {
    position: new THREE.Vector3(0, 1.02, 6.9),
    target: new THREE.Vector3(0, 0.02, 0),
    fov: 34
  },
  obs: {
    position: new THREE.Vector3(0, 1.08, 5.25),
    target: new THREE.Vector3(0, 0.38, 0),
    fov: 29
  }
};

export default function AvatarStage({
  emotion,
  emotionIntensity = 3,
  signal = null,
  compact = false,
  speaking = false,
  cameraPreset = compact ? "obs" : "half",
  vrmFile = null,
  defaultAvatarPath = "",
  scene = null,
  onStatusChange
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const fallbackRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const expressionRef = useRef<Emotion>(emotion);
  const emotionIntensityRef = useRef<EmotionIntensity>(emotionIntensity);
  const signalRef = useRef<AvatarSignal | null>(signal);
  const speakingRef = useRef(speaking);
  const cameraPresetRef = useRef<AvatarCameraPreset>(cameraPreset);
  const sceneSettingsRef = useRef<SceneSettings>({ ...defaultSceneSettings, ...(scene || {}), cameraPreset });
  const loadedFileRef = useRef<File | null>(null);
  const loadedDefaultUrlRef = useRef("");
  const setStatusRef = useRef(onStatusChange);
  const loadUrlRef = useRef<((url: string, source: AvatarRuntimeStatus["source"]) => Promise<void>) | null>(null);
  const [status, setStatus] = useState<AvatarRuntimeStatus>(defaultStatus);

  setStatusRef.current = onStatusChange;

  useEffect(() => {
    expressionRef.current = emotion;
    emotionIntensityRef.current = emotionIntensity;
    const live = resolveAvatarMotionState(signalRef.current, emotion, emotionIntensity, speakingRef.current);
    applyPerformanceExpressions(vrmRef.current, {
      state: derivePerformanceState({
        signal: signalRef.current,
        emotion: live.emotion,
        intensity: live.intensity,
        speaking: speakingRef.current,
        speakingWeight: live.speakingWeight,
        external: getExternalAvatarPerformanceState()
      }),
      blinkAmount: 0,
      speakingWeight: live.speakingWeight,
      t: performance.now() / 1000
    });
  }, [emotion, emotionIntensity]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    signalRef.current = signal;
  }, [signal]);

  useEffect(() => {
    cameraPresetRef.current = cameraPreset;
  }, [cameraPreset]);

  useEffect(() => {
    sceneSettingsRef.current = {
      ...defaultSceneSettings,
      ...(scene || {}),
      cameraPreset: scene?.cameraPreset || cameraPreset
    };
  }, [scene, cameraPreset]);

  useEffect(() => {
    setStatusRef.current?.(status);
  }, [status]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(28, mount.clientWidth / mount.clientHeight, 0.1, 100);
    cameraRef.current = camera;
    applyCameraPreset(camera, cameraPresets[cameraPresetRef.current], 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.8, 2.4, 3.5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x65d6cb, 1.2);
    rimLight.position.set(-2.4, 1.4, -1.6);
    scene.add(rimLight);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));

    const fallback = createFallbackAvatar();
    fallbackRef.current = fallback;
    scene.add(fallback);
    const performanceRuntime = createAvatarPerformanceRuntime();

    loadUrlRef.current = async (url: string, source: AvatarRuntimeStatus["source"]) => {
      setStatus({
        ...defaultStatus,
        source: "fallback",
        notice: source === "manual" ? "Cargando VRM..." : "Cargando avatar..."
      });
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(withCacheBuster(url));
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("El archivo no contiene un VRM compatible.");

      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.removeUnnecessaryJoints(vrm.scene);
      VRMUtils.rotateVRM0(vrm);

      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        VRMUtils.deepDispose(vrmRef.current.scene);
      }

      vrm.scene.rotation.y = 0;
      applyAvatarTransform(vrm.scene, sceneSettingsRef.current);
      vrmRef.current = vrm;
      bindAvatarPerformanceVrm(performanceRuntime, vrm);
      scene.remove(fallback);
      scene.add(vrm.scene);

      const expressions = getVrmExpressionNames(vrm);
      const supportsLipSync = vrmHasAnyExpression(vrm, ["aa", "ih", "ou", "ee", "oh", "A", "I", "U", "E", "O"]);
      setStatus({
        hasVrm: true,
        source,
        expressions,
        supportsLipSync,
        notice: supportsLipSync
          ? "VRM cargado con expresiones y lipsync disponible."
          : "VRM cargado; no detecté vocales de lipsync, usaré animación facial suave."
      });
    };

    const clock = new THREE.Clock();
    let frame = 0;
    let speakingWeight = 0;
    let expressionBlend = emotionIntensity / 10;
    const target = new THREE.Vector3();
    const blink = createBlinkController();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const t = clock.elapsedTime;

      const liveScene = sceneSettingsRef.current;
      const preset = buildCameraPreset(liveScene);
      camera.position.lerp(preset.position, 0.08);
      camera.fov += (preset.fov - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
      target.lerp(preset.target, 0.12);
      camera.lookAt(target);

      const liveMotion = resolveAvatarMotionState(signalRef.current, expressionRef.current, emotionIntensityRef.current, speakingRef.current);
      speakingWeight += (liveMotion.speakingWeight - speakingWeight) * 0.16;
      expressionBlend += (liveMotion.intensity / 10 - expressionBlend) * 0.08;
      const blendedIntensity = toEmotionIntensity(expressionBlend * 10);
      const liveEmotion = liveMotion.emotion;
      const liveIntensity = blendedIntensity;
      const performanceState = derivePerformanceState({
        signal: signalRef.current,
        emotion: liveEmotion,
        intensity: liveIntensity,
        speaking: speakingRef.current,
        speakingWeight,
        external: getExternalAvatarPerformanceState()
      });
      const blinkAmount = blink(t);
      const performance = updateAvatarPerformance(performanceRuntime, {
        vrm: vrmRef.current,
        state: performanceState,
        speakingWeight,
        blinkAmount,
        t,
        delta
      });
      if (fallbackRef.current) {
        fallbackRef.current.rotation.y = Math.sin(t * 0.74 + performance.phase) * (0.09 + liveIntensity * 0.01) + speakingWeight * Math.sin(t * 1.55) * 0.035 + performance.rootYaw + performance.emphasis * 0.04 * performance.side;
        fallbackRef.current.rotation.z = Math.sin(t * 0.58 + performance.phase) * 0.022 + performance.rootRoll + performance.emphasis * 0.02 * performance.side;
        fallbackRef.current.position.x = liveScene.cameraX * 0.18;
        fallbackRef.current.position.y = liveScene.cameraY * 0.35 + Math.sin(t * (1.05 + liveIntensity * 0.04)) * (0.02 + liveIntensity * 0.004) + performance.rootY + performance.emphasis * 0.012;
        fallbackRef.current.scale.setScalar(liveScene.avatarScale);
        applyFallbackEmotion(fallbackRef.current, liveEmotion, liveIntensity, speakingWeight, t);
      }

      const vrm = vrmRef.current;
      if (vrm) {
        applyAvatarTransform(vrm.scene, liveScene);
        vrm.scene.position.y += performance.rootY;
        vrm.scene.rotation.y = performance.rootYaw + speakingWeight * Math.sin(t * 1.35) * 0.018;
        vrm.scene.rotation.z = performance.rootRoll;
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      loadUrlRef.current = null;
      if (vrmRef.current) VRMUtils.deepDispose(vrmRef.current.scene);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (!vrmFile || loadedFileRef.current === vrmFile) return;
    loadedFileRef.current = vrmFile;
    const url = URL.createObjectURL(vrmFile);
    loadUrlRef.current?.(url, "manual")
      .catch((error: unknown) => {
        setStatus({
          ...defaultStatus,
          notice: error instanceof Error ? `Usando avatar fallback. ${error.message}` : "Usando avatar fallback. No pude cargar ese VRM."
        });
      })
      .finally(() => URL.revokeObjectURL(url));
  }, [vrmFile]);

  useEffect(() => {
    if (!defaultAvatarPath || vrmFile || loadedDefaultUrlRef.current === defaultAvatarPath) return;
    let cancelled = false;
    let timeoutId = 0;
    let idleId = 0;

    const loadDefaultAvatar = () => {
      if (cancelled) return;
      validateAvatarUrl(defaultAvatarPath)
        .then(() => {
          if (cancelled) return;
          return loadUrlRef.current?.(defaultAvatarPath, "default").then(() => {
            loadedDefaultUrlRef.current = defaultAvatarPath;
          });
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStatus({
              ...defaultStatus,
              notice: error instanceof Error ? `Usando avatar fallback. ${error.message}` : "Usando avatar fallback. No pude revisar el VRM por defecto."
            });
          }
        });
    };

    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(loadDefaultAvatar, { timeout: compact ? 300 : 900 });
    } else {
      timeoutId = window.setTimeout(loadDefaultAvatar, compact ? 120 : 420);
    }

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (idleId && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId);
    };
  }, [compact, defaultAvatarPath, vrmFile]);

  return (
    <div className={compact ? "avatarStage compact" : "avatarStage"} data-avatar-source={status.source}>
      {!compact && <div className="avatarBackdropPortrait" />}
      <div ref={mountRef} className="avatarCanvas" />
      {!status.hasVrm && (
        <div className="avatarLoadStatus">
          <strong>{status.notice.includes("Cargando") ? status.notice : "Usando avatar fallback..."}</strong>
          <span>{status.notice.includes("Cargando") ? "Preparando escena 3D." : status.notice}</span>
        </div>
      )}
      {!compact && (
        <div className="avatarStageBadges">
          <span>{status.hasVrm ? "VRM activo" : "Avatar temporal"}</span>
          <span>{speaking ? "Lipsync" : cameraPreset}</span>
        </div>
      )}
    </div>
  );
}

function applyCameraPreset(camera: THREE.PerspectiveCamera, preset: { position: THREE.Vector3; target: THREE.Vector3; fov: number }, alpha: number) {
  camera.position.lerp(preset.position, alpha);
  camera.fov += (preset.fov - camera.fov) * alpha;
  camera.updateProjectionMatrix();
  camera.lookAt(preset.target);
}

function buildCameraPreset(scene: SceneSettings) {
  const base = cameraPresets[scene.cameraPreset] || cameraPresets.obs;
  return {
    position: new THREE.Vector3(
      base.position.x + scene.cameraX,
      base.position.y + scene.cameraHeight,
      Math.max(2.4, base.position.z + scene.cameraDistance)
    ),
    target: new THREE.Vector3(
      base.target.x + scene.cameraX * 0.55,
      base.target.y + scene.cameraHeight * 0.45,
      base.target.z
    ),
    fov: base.fov
  };
}

function applyAvatarTransform(object: THREE.Object3D, scene: SceneSettings) {
  object.position.set(scene.cameraX * 0.28, -1.18 + scene.cameraY * 0.45, 0);
  object.scale.setScalar(1.65 * scene.avatarScale);
}

async function validateAvatarUrl(url: string) {
  const response = await fetch(withCacheBuster(url), { method: "HEAD", cache: "no-store" });
  if (!response.ok) throw new Error(`No encontré VRM activo en ${url} (HTTP ${response.status}).`);
  const contentType = response.headers.get("content-type") || "";
  if (/text\/html/i.test(contentType)) {
    throw new Error("La URL del avatar devolvió HTML, no VRM. Revisa proxy /avatar.");
  }
}

function withCacheBuster(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}stage=${Date.now()}`;
}

function createBlinkController() {
  let nextBlinkAt = 1.2;
  let blinkStartedAt = -1;
  return (t: number) => {
    if (blinkStartedAt < 0 && t >= nextBlinkAt) {
      blinkStartedAt = t;
      // ~22% de parpadeos dobles (rasgo humano muy visible): el siguiente llega casi
      // inmediato; el resto espacia 2.4-5.6s.
      nextBlinkAt = Math.random() < 0.22 ? t + 0.24 + Math.random() * 0.12 : t + 2.4 + Math.random() * 3.2;
    }
    if (blinkStartedAt >= 0) {
      const elapsed = t - blinkStartedAt;
      if (elapsed < 0.06) return elapsed / 0.06;
      if (elapsed < 0.13) return 1 - (elapsed - 0.06) / 0.07;
      blinkStartedAt = -1;
    }
    return 0;
  };
}

function createFallbackAvatar() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 48, 48),
    new THREE.MeshStandardMaterial({ color: "#57d6c7", roughness: 0.42, metalness: 0.05 })
  );
  body.scale.set(0.9, 1.05, 0.86);
  body.position.y = -0.08;
  group.add(body);

  const hoodie = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 48, 32, 0, Math.PI * 2, 0.1, Math.PI * 0.76),
    new THREE.MeshStandardMaterial({ color: "#f7f8f4", roughness: 0.56, metalness: 0.02 })
  );
  hoodie.scale.set(0.9, 0.62, 0.78);
  hoodie.position.y = -0.42;
  group.add(hoodie);

  const hairMaterial = new THREE.MeshStandardMaterial({ color: "#e9e8f1", roughness: 0.34, metalness: 0.02 });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.76, 48, 32), hairMaterial);
  hair.scale.set(1, 0.82, 0.9);
  hair.position.y = 0.28;
  group.add(hair);

  const leftBun = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 24), hairMaterial);
  const rightBun = leftBun.clone();
  leftBun.position.set(-0.62, 0.52, 0.04);
  rightBun.position.set(0.62, 0.52, 0.04);
  group.add(leftBun, rightBun);

  const mintMaterial = new THREE.MeshStandardMaterial({ color: "#65d6cb", roughness: 0.36, metalness: 0.08 });
  const leftAccent = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.05), mintMaterial);
  const rightAccent = leftAccent.clone();
  leftAccent.position.set(-0.34, 0.04, 0.62);
  rightAccent.position.set(0.34, 0.04, 0.62);
  group.add(leftAccent, rightAccent);

  const face = new THREE.Group();
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: "#0b5b61" });
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 18, 18), eyeMaterial);
  const rightEye = leftEye.clone();
  leftEye.position.set(-0.24, 0.14, 0.72);
  rightEye.position.set(0.24, 0.14, 0.72);
  face.add(leftEye, rightEye);

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.23, 0.035, 0.02),
    new THREE.MeshBasicMaterial({ color: "#101820" })
  );
  mouth.position.set(0, -0.16, 0.74);
  mouth.name = "mouth";
  face.add(mouth);

  const clipA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.045, 0.035), new THREE.MeshBasicMaterial({ color: "#15181d" }));
  const clipB = clipA.clone();
  clipA.rotation.z = Math.PI / 4;
  clipB.rotation.z = -Math.PI / 4;
  clipA.position.set(0.42, 0.42, 0.68);
  clipB.position.copy(clipA.position);
  face.add(clipA, clipB);
  group.add(face);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.93, 0.014, 12, 96),
    new THREE.MeshBasicMaterial({ color: "#65d6cb" })
  );
  halo.rotation.x = Math.PI / 2.2;
  halo.position.y = -0.2;
  group.add(halo);

  return group;
}

function applyFallbackEmotion(group: THREE.Group, emotion: Emotion, intensity: EmotionIntensity, speakingWeight: number, t: number) {
  const body = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const mouth = group.getObjectByName("mouth");
  const power = emotionPower(intensity);
  const colors: Record<Emotion, string> = {
    neutral: "#57d6c7",
    happy: "#70e37a",
    annoyed: "#ff7c70",
    sad: "#7aa2ff",
    surprised: "#ffd166",
    thinking: "#a98bff",
    safe: "#ffd166"
  };
  body.material.color.set(colors[emotion]);
  if (mouth) {
    mouth.scale.y = speakingWeight > 0.02
      ? 1 + speakingWeight * (1.1 + power * 1.2 + Math.sin(t * (11 + intensity)) * (0.18 + power * 0.44))
      : emotion === "happy" || emotion === "surprised" ? 1.1 + power : emotion === "thinking" ? 0.55 + power * 0.25 : emotion === "sad" ? 0.72 : 1;
    mouth.scale.x = emotion === "annoyed" ? 0.82 - power * 0.28 : emotion === "sad" ? 0.86 : 1;
  }
}

function emotionPower(intensity: EmotionIntensity) {
  return Math.max(0.1, Math.min(1, intensity / 10));
}

function resolveAvatarMotionState(signal: AvatarSignal | null, fallbackEmotion: Emotion, fallbackIntensity: EmotionIntensity, fallbackSpeaking: boolean) {
  const signalSpeaking = signal?.action === "speaking" || signal?.action === "laughing";
  const signalWatching = signal?.action === "watching";
  return {
    emotion: signalWatching ? "thinking" : signal ? avatarMoodToEmotion(signal.mood) : fallbackEmotion,
    intensity: toEmotionIntensity(signalWatching ? Math.max(signal?.intensity ?? 0, 5) : signal?.intensity ?? fallbackIntensity),
    speakingWeight: signalSpeaking || fallbackSpeaking ? 1 : 0
  };
}

function avatarMoodToEmotion(mood: AvatarSignal["mood"]): Emotion {
  if (mood === "happy") return "happy";
  if (mood === "surprised") return "surprised";
  if (mood === "focused") return "thinking";
  if (mood === "annoyed") return "annoyed";
  if (mood === "sad") return "sad";
  return "neutral";
}

function toEmotionIntensity(value: number): EmotionIntensity {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(10, Math.round(value))) as EmotionIntensity;
}
