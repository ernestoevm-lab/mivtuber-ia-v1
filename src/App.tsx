import { FormEvent, lazy, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { deriveAvatarSignalFromMessage, deriveAvatarSignalFromSpeechEvent } from "./avatar/animationSignals.js";
import { emitAvatarIdleSignal, emitAvatarSignal, getCurrentAvatarSignal, subscribeAvatarSignals } from "./avatar/avatarRuntime.js";
import type { AvatarSignal } from "./avatar/types.js";
import type { AvatarRuntimeStatus } from "./AvatarStage.js";
import { enqueueSpeech, getVoiceVolume, isAudioUnlocked, replaySpeech, setVoiceVolume, stopSpeech, unlockAudio } from "./audioQueue.js";
import { archiveMemory, backendAssetUrl, connectTikfinity, connectTwitch, createMemory, deleteMemory, deleteReferenceImage, disconnectTikfinity, disconnectTwitch, eventsWebSocketUrl, getAutonomyState, getAvatar, getAvatarHealth, getBackgrounds, getChatHistory, getGeminiModels, getGuard, getLogs, getMemories, getModels, getScene, getSecretsStatus, getStatus, getStreamUserMessages, getTikfinityState, getTts, getTwitchStatus, ingestChat, savePersona, saveResponseTiming, saveRuntime, saveScene, saveSecrets, saveTtsVoice, searchStreamUsers, selectModel, sendChat, sendTikfinityTestEvent, setSafetyMode, shutdownLuma, silenceNow, testTts, triggerAutonomy, updateAutonomyConfig, updateMemory, updateTikfinityConfig, uploadAvatar, uploadBackground, uploadReferenceImage, useActiveModel, getVtsStatus, connectVts, disconnectVts, getVtsHotkeys, triggerVtsHotkey, setVtsEmotionMap, setVtsEnabled, previewVtsEmotion } from "./api.js";
import type { VtsStatusPayload, VtsHotkeyItem } from "./api.js";
import { Sidebar } from "./components/Sidebar.js";
import type { CockpitTab } from "./components/Sidebar.js";
import { LiveTab } from "./tabs/LiveTab.js";
import { LogsTab } from "./tabs/LogsTab.js";
import { MemoryTab } from "./tabs/MemoryTab.js";
import { ModelTab } from "./tabs/ModelTab.js";
import { PersonaTab } from "./tabs/PersonaTab.js";
import { AvatarTab } from "./tabs/AvatarTab.js";
import { SafetyTab } from "./tabs/SafetyTab.js";
import { SceneTab } from "./tabs/SceneTab.js";
import { SettingsTab } from "./tabs/SettingsTab.js";
import { ViewersTab } from "./tabs/ViewersTab.js";
import { VoiceTab } from "./tabs/VoiceTab.js";
import { ControlSection, StatusMetric, VISUAL_MAX_INTERVAL_SECONDS, VISUAL_MIN_INTERVAL_SECONDS, backgroundStyle, clampPercent, emotionLabel, formatShortTime, moderationDecisionLabel, moderationReasonLabel, normalizeAspectRatioClient, normalizeBorderColorClient, referenceImageSrc, referenceOverlayStyle, safetyModeLabel, visualKindLabel } from "./tabs/shared.js";
import { SystemSetupPanel } from "./components/SystemSetupPanel.js";
import { TopBar as CockpitShellTopBar } from "./components/TopBar.js";
import { Icon } from "./components/Icons.js";
import { normalizeSceneNumber } from "./sceneMath.js";
import { AutonomyStatePayload, AvatarCameraPreset, BackgroundItem, ChatHistoryMessageItem, ChatImageAttachment, ChatIngestPayload, ChatResponse, Emotion, EmotionIntensity, GuardStatus, LocalModel, LocalVoice, MemoryItem, NormalizedChatMessage, Persona, SafetyMode, SceneSettings, StatusPayload, StreamHistoryMessageItem, StreamUserHistoryItem, TikfinityStatePayload, TtsPayload, TwitchStatusPayload, VisualNarrationImage, VisualPromptMode, VisualVisionState } from "./types.js";

const loadAvatarStage = () => import("./AvatarStage.js");
const AvatarStage = lazy(loadAvatarStage);
const VISUAL_DEFAULT_INTERVAL_SECONDS = 8;
const VISUAL_MIN_CHANGE_SCORE = 12;
const VISUAL_AUTO_MIN_NARRATION_GAP_MS = 7000;
const SETUP_ACCEPTED_KEY = "mivtuberia.setupAccepted.v1";

const emptyPersona: Persona = {
  name: "Yuko",
  language: "es",
  tone: "",
  lore: "",
  boundaries: "",
  likes: "",
  dislikes: "",
  humorStyle: "",
  relationshipToUser: "",
  streamingStyle: "",
  catchphrases: []
};

type ControlTab = CockpitTab;
type ChatMode = "admin" | "stream";
type ChatMessageImage = { src: string; name: string; attachment?: ChatImageAttachment };
type ChatMessageItem = { id?: string; role: "user" | "assistant"; text: string; createdAt: string; meta?: string; author?: string; avatar?: string; response?: ChatResponse; source?: "admin" | "simulator" | "twitch" | "tikfinity" | "autonomy" | "guard" | "system"; image?: ChatMessageImage };
type PendingChatImage = ChatImageAttachment & { previewUrl: string; fileName: string };
type CapturedVisualFrame = { image: VisualNarrationImage; hash: Uint8ClampedArray };
type VisualNarrationOptions = {
  suppressNoChanges?: boolean;
  visualAuto?: boolean;
  forceUserBubble?: boolean;
  useGlobalBusy?: boolean;
};
type SpeechUiDetail = {
  state: "start" | "end";
  responseId?: string;
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  playbackDurationMs?: number;
  audioKind?: "audio" | "speechSynthesis" | "none";
  audioDurationMs?: number;
};

const defaultScene: SceneSettings = {
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

export default function App() {
  if (window.location.pathname === "/speaker") return <SpeakerPage />;
  const viewerOnly = window.location.pathname === "/viewer" || (window.location.pathname === "/" && isObsBrowserSource());
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [persona, setPersona] = useState<Persona>(emptyPersona);
  const [mode, setMode] = useState<SafetyMode>("normal");
  const [chatMode, setChatMode] = useState<ChatMode>("admin");
  const [liveConsoleMenuOpen, setLiveConsoleMenuOpen] = useState(false);
  const [input, setInput] = useState("");
  const [personaEnabled, setPersonaEnabled] = useState(() => localStorage.getItem("mivtuberia.personaEnabled") !== "false");
  const [setupAccepted, setSetupAccepted] = useState(() => localStorage.getItem(SETUP_ACCEPTED_KEY) === "true");
  const [setupTermsAccepted, setSetupTermsAccepted] = useState(() => localStorage.getItem(SETUP_ACCEPTED_KEY) === "true");
  const [pendingImage, setPendingImage] = useState<PendingChatImage | null>(null);
  const [imageNotice, setImageNotice] = useState("");
  const [streamUser, setStreamUser] = useState("viewer");
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const [emotion, setEmotion] = useState<Emotion>("neutral");
  const [emotionIntensity, setEmotionIntensity] = useState<EmotionIntensity>(3);
  const [avatarPreviewEmotion, setAvatarPreviewEmotion] = useState<Emotion | null>(null);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [avatarSignal, setAvatarSignal] = useState<AvatarSignal>(() => getCurrentAvatarSignal());
  const [avatarCamera, setAvatarCamera] = useState<AvatarCameraPreset>("half");
  const [avatarVrmFile, setAvatarVrmFile] = useState<File | null>(null);
  const [activeAvatarUrl, setActiveAvatarUrl] = useState("");
  const [avatarNotice, setAvatarNotice] = useState("");
  const [guardViewerNotice, setGuardViewerNotice] = useState<{ text: string; id: string } | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<AvatarRuntimeStatus>({
    hasVrm: false,
    source: "fallback",
    expressions: [],
    supportsLipSync: false,
    notice: "Sin VRM definitivo; usando avatar temporal."
  });
  const [scene, setScene] = useState<SceneSettings>(defaultScene);
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([]);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneNotice, setSceneNotice] = useState("");
  const [visualNarrationBusy, setVisualNarrationBusy] = useState(false);
  const [visualCaptureBusy, setVisualCaptureBusy] = useState(false);
  const [visualNarrationNotice, setVisualNarrationNotice] = useState("");
  const [activeVisualImage, setActiveVisualImage] = useState<VisualNarrationImage | null>(null);
  const [referenceImageAvailable, setReferenceImageAvailable] = useState(false);
  const [visualAutoEnabled, setVisualAutoEnabled] = useState(false);
  const [visualAutoNarrationEnabled, setVisualAutoNarrationEnabled] = useState(false);
  const [visualAutoIntervalSeconds, setVisualAutoIntervalSeconds] = useState(() => {
    const saved = Number(localStorage.getItem("mivtuberia.visualAutoIntervalSeconds"));
    return normalizeVisualIntervalSeconds(Number.isFinite(saved) ? saved : VISUAL_DEFAULT_INTERVAL_SECONDS);
  });
  const [visualVisionState, setVisualVisionState] = useState<VisualVisionState>("off");
  const [visualLastFrame, setVisualLastFrame] = useState<VisualNarrationImage | null>(null);
  const [visualLastFrameAt, setVisualLastFrameAt] = useState("");
  const [visualLastAnalysisAt, setVisualLastAnalysisAt] = useState("");
  const [visualLastChangeScore, setVisualLastChangeScore] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [guard, setGuard] = useState<GuardStatus | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [newImportance, setNewImportance] = useState(3);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [modelChoice, setModelChoice] = useState("");
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [geminiModelChoice, setGeminiModelChoice] = useState("");
  const [geminiModelsNotice, setGeminiModelsNotice] = useState("");
  const [vtsStatus, setVtsStatus] = useState<VtsStatusPayload | null>(null);
  const [vtsHotkeys, setVtsHotkeys] = useState<VtsHotkeyItem[]>([]);
  const [secretsStatus, setSecretsStatus] = useState<Record<string, boolean> | null>(null);
  const [secretsBusy, setSecretsBusy] = useState(false);
  const [secretsNotice, setSecretsNotice] = useState("");
  const [vtsBusy, setVtsBusy] = useState(false);
  const [vtsNotice, setVtsNotice] = useState("");
  const [voiceVolume, setVoiceVolumeState] = useState(() => Math.round(getVoiceVolume() * 100));
  const [runtimeDraftProvider, setRuntimeDraftProvider] = useState("");
  const [runtimeDraftBaseUrl, setRuntimeDraftBaseUrl] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const [personaNotice, setPersonaNotice] = useState("");
  const [serverRunning, setServerRunning] = useState(false);
  const [twitchStatus, setTwitchStatus] = useState<TwitchStatusPayload | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [twitchBusy, setTwitchBusy] = useState(false);
  const [twitchNotice, setTwitchNotice] = useState("");
  const [tikfinityState, setTikfinityState] = useState<TikfinityStatePayload | null>(null);
  const [tikfinityBusy, setTikfinityBusy] = useState(false);
  const [tikfinityNotice, setTikfinityNotice] = useState("");
  const [tikfinityWsUrl, setTikfinityWsUrl] = useState("ws://127.0.0.1:21213/");
  const [tikfinityKeywords, setTikfinityKeywords] = useState("yuko, Yuko, @yuko, kokoria, Kokoria");
  const [autonomyState, setAutonomyState] = useState<AutonomyStatePayload | null>(null);
  const [autonomyBusy, setAutonomyBusy] = useState(false);
  const [autonomyNotice, setAutonomyNotice] = useState("");
  const [streamUserQuery, setStreamUserQuery] = useState("");
  const [streamUsers, setStreamUsers] = useState<StreamUserHistoryItem[]>([]);
  const [selectedStreamUser, setSelectedStreamUser] = useState<StreamUserHistoryItem | null>(null);
  const [streamUserMessages, setStreamUserMessages] = useState<StreamHistoryMessageItem[]>([]);
  const [streamHistoryNotice, setStreamHistoryNotice] = useState("");
  const [tts, setTts] = useState<TtsPayload | null>(null);
  const [voiceChoice, setVoiceChoice] = useState("");
  const [voiceBackendChoice, setVoiceBackendChoice] = useState<"browser" | "kokoro">("browser");
  const [browserVoices, setBrowserVoices] = useState<LocalVoice[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [voicePlaybackNotice, setVoicePlaybackNotice] = useState("");
  const [voiceTestNotice, setVoiceTestNotice] = useState("");
  const [systemStatusError, setSystemStatusError] = useState("");
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  const [voiceLatency, setVoiceLatency] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [shutdownBusy, setShutdownBusy] = useState(false);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);
  const [shutdownNotice, setShutdownNotice] = useState("");
  const [activeControlTab, setActiveControlTab] = useState<ControlTab>("live");
  const seenResponses = useRef(new Set<string>());
  const seenStreamMessages = useRef(new Set<string>());
  const responseByIdRef = useRef<Map<string, ChatResponse>>(new Map());
  const activeSpeechResponseIdRef = useRef<string | null>(null);
  const visualSpeechBlockersRef = useRef<Set<string>>(new Set());
  const viewerAudioVisualTimersRef = useRef<Map<string, number>>(new Map());
  const sceneRef = useRef<SceneSettings>(defaultScene);
  const sceneDirtyRef = useRef(false);
  const sceneBusyRef = useRef(false);
  const sceneAutosaveTimerRef = useRef<number | null>(null);
  const scenePendingSaveRef = useRef<SceneSettings | null>(null);
  const sceneSaveVersionRef = useRef(0);
  const dashboardScrollRef = useRef<HTMLDivElement | null>(null);
  const controlScrollRef = useRef<HTMLElement | null>(null);
  const visualStreamRef = useRef<MediaStream | null>(null);
  const visualVideoRef = useRef<HTMLVideoElement | null>(null);
  const visualLoopTimerRef = useRef<number | null>(null);
  const visualLastHashRef = useRef<Uint8ClampedArray | null>(null);
  const visualLastAutoNarrationAtRef = useRef(0);
  const visualAutoIntervalSecondsRef = useRef(VISUAL_DEFAULT_INTERVAL_SECONDS);
  const visualAutoNarrationEnabledRef = useRef(false);
  const visualAnalyzingRef = useRef(false);
  const busyRef = useRef(false);
  const inputRef = useRef("");
  const avatarSpeakingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("mivtuberia.personaEnabled", personaEnabled ? "true" : "false");
  }, [personaEnabled]);

  useEffect(() => {
    dashboardScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeControlTab]);

  useEffect(() => {
    visualAutoIntervalSecondsRef.current = visualAutoIntervalSeconds;
    localStorage.setItem("mivtuberia.visualAutoIntervalSeconds", String(visualAutoIntervalSeconds));
  }, [visualAutoIntervalSeconds]);

  useEffect(() => {
    visualAutoNarrationEnabledRef.current = visualAutoNarrationEnabled;
  }, [visualAutoNarrationEnabled]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    avatarSpeakingRef.current = avatarSpeaking;
  }, [avatarSpeaking]);

  useEffect(() => {
    void refresh();
    window.setTimeout(() => {
      void loadAvatarStage();
    }, 250);
    const ws = new WebSocket(eventsWebSocketUrl());
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "thinking") {
        setEmotion("thinking");
        setEmotionIntensity(4);
        emitAvatarSignal({ mood: "focused", intensity: 4, action: "thinking", source: "llm" });
      }
      if (data.type === "safety") setMode(data.payload.mode);
      if (data.type === "runtime") void refresh();
      if (data.type === "tts") void refreshTts();
      if (data.type === "memories") void refreshMemories();
      if (data.type === "scene") void refreshScene();
      if (data.type === "backgrounds") void refreshBackgrounds();
      if (data.type === "avatar") {
        setActiveAvatarUrl(data.payload?.health?.exists === false ? "" : data.payload?.activeAvatarUrl || "");
        setAvatarVrmFile(null);
        if (data.payload?.health?.exists === false) setAvatarNotice(data.payload.health.error || "El avatar activo no existe en disco.");
      }
      if (data.type === "guard_message") {
        showGuardViewerNotice(data.payload);
        setMessages((current) => [
          ...current,
          {
            id: String(data.payload?.id || Date.now()),
            role: "assistant",
            text: String(data.payload?.displayText || `${persona.name || "Yuko"} no leerá ese mensaje.`),
            createdAt: String(data.payload?.createdAt || new Date().toISOString()),
            meta: `${moderationDecisionLabel(String(data.payload?.decision || "ignored"))} · ${moderationReasonLabel(String(data.payload?.reason || "unknown"))}`,
            author: "GuardaespaldasBot",
            avatar: "G",
            source: "guard"
          }
        ]);
      }
      if (data.type === "twitch") setTwitchStatus(data.payload as TwitchStatusPayload);
      if (data.type === "tikfinity") {
        const payload = data.payload as TikfinityStatePayload;
        setTikfinityState(payload);
        setTikfinityWsUrl(payload.config?.wsUrl || payload.wsUrl || "ws://127.0.0.1:21213/");
        setTikfinityKeywords((payload.config?.mentionKeywords || []).join(", "));
      }
      if (data.type === "tikfinity_event") {
        void refreshTikfinity().catch(() => undefined);
      }
      if (data.type === "autonomy") setAutonomyState(data.payload as AutonomyStatePayload);
      if (data.type === "autonomy_decision") {
        void refreshAutonomy().catch(() => undefined);
      }
      if (data.type === "stream_message") {
        const payload = data.payload as NormalizedChatMessage & { moderation?: ChatIngestPayload["moderation"] };
        if (seenStreamMessages.current.has(payload.id)) return;
        seenStreamMessages.current.add(payload.id);
        window.setTimeout(() => seenStreamMessages.current.delete(payload.id), 120000);
        setMessages((current) => [
          ...current,
          {
            id: payload.id,
            role: "user",
            text: payload.message,
            createdAt: payload.timestamp,
            meta: `${platformLabel(payload.platform)} · ${payload.channelName || "sin canal"} · ${formatShortTime(payload.timestamp)} · ${payload.moderation ? moderationDecisionLabel(payload.moderation.decision) : "recibido"}`,
            author: payload.user.displayName || payload.user.username,
            avatar: (payload.user.displayName || payload.user.username || "T").slice(0, 1).toUpperCase(),
            source: "twitch"
          }
        ]);
        void Promise.allSettled([refreshGuard(), refreshLogs()]);
        if (selectedStreamUser?.id === payload.user.id) void refreshStreamUserMessages(payload.user.id);
      }
      if (data.type === "moderation") {
        void refreshGuard();
        void refreshLogs();
      }
      if (data.type === "control") {
        stopSpeech();
        emitAvatarIdleSignal("system");
      }
      if (data.type === "response") {
        const response = data.payload as ChatResponse;
        if (seenResponses.current.has(response.id)) return;
        seenResponses.current.add(response.id);
        responseByIdRef.current.set(response.id, response);
        window.setTimeout(() => seenResponses.current.delete(response.id), 120000);
        window.setTimeout(() => responseByIdRef.current.delete(response.id), 300000);
        emitAvatarSignal(deriveAvatarSignalFromMessage(response));
        if (response.ttsPending || response.action === "speak") {
          visualSpeechBlockersRef.current.add(response.id);
        }
        setLastResponse(response);
        setEmotion(response.emotion);
        setEmotionIntensity(response.emotionIntensity || 3);
        const assistantAuthor = response.notices?.includes("persona_disabled") ? "Gemma" : persona.name || "Yuko";
        setMessages((current) => [
          ...current,
          {
            id: response.id,
            role: "assistant",
            text: response.text,
            createdAt: response.createdAt,
            meta: responseMeta(response),
            author: assistantAuthor,
            avatar: assistantAuthor.slice(0, 1).toUpperCase(),
            response
          }
        ]);
        if (!viewerOnly && !response.ttsPending) {
          enqueueSpeech(response);
        }
      }
      if (data.type === "response_audio") {
        const response = data.payload as ChatResponse;
        if (response.action === "speak") {
          visualSpeechBlockersRef.current.add(response.id);
        }
        responseByIdRef.current.set(response.id, response);
        setLastResponse(response);
        setMessages((current) => current.map((message) => (
          message.id === response.id
            ? { ...message, response, meta: responseMeta(response) }
            : message
        )));
        if (viewerOnly) scheduleViewerAudioVisual(response);
        if (!viewerOnly) enqueueSpeech(response);
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const loadBrowserVoices = () => {
      if (!("speechSynthesis" in window)) {
        setBrowserVoices([]);
        return;
      }
      const current = window.speechSynthesis.getVoices()
        .filter((voice) => voice.lang)
        .map((voice, index) => ({
          id: voice.voiceURI || `${voice.name}-${index}`,
          voiceURI: voice.voiceURI,
          name: `${voice.name} · ${voice.lang}`,
          lang: voice.lang,
          configured: (localStorage.getItem("mivtuberia.browserVoiceId") || "") === (voice.voiceURI || `${voice.name}-${index}`),
          backend: "browser" as const
        }));
      setBrowserVoices(current);
    };
    loadBrowserVoices();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadBrowserVoices;
    }
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (voiceBackendChoice === "browser" && !voiceChoice && browserVoices.length) {
      const saved = localStorage.getItem("mivtuberia.browserVoiceId");
      setVoiceChoice(saved && browserVoices.some((voice) => voice.id === saved) ? saved : browserVoices[0].id);
    }
  }, [browserVoices, voiceBackendChoice, voiceChoice]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    let cancelled = false;
    const referenceImage = scene.referenceImage;
    setActiveVisualImage((current) => {
      if (!referenceImage) return current?.kind === "reference" ? null : current;
      return current;
    });
    if (!referenceImage) {
      setReferenceImageAvailable(false);
      return () => {
        cancelled = true;
      };
    }
    setReferenceImageAvailable(false);
    referenceImageToChatAttachment(referenceImage)
      .then((attachment) => {
        if (cancelled) return;
        setReferenceImageAvailable(true);
        setActiveVisualImage({
          src: referenceImageSrc(referenceImage),
          name: referenceImage.name,
          attachment,
          kind: "reference"
        });
      })
      .catch(() => {
        if (cancelled) return;
        setReferenceImageAvailable(false);
        setActiveVisualImage((current) => current?.kind === "reference" ? null : current);
        setVisualNarrationNotice("La imagen de referencia guardada ya no está disponible. Limpia la imagen o sube otra.");
      });
    return () => {
      cancelled = true;
    };
  }, [scene.referenceImage?.id, scene.referenceImage?.url]);

  useEffect(() => subscribeAvatarSignals(setAvatarSignal), []);

  useEffect(() => {
    return () => {
      if (sceneAutosaveTimerRef.current) window.clearTimeout(sceneAutosaveTimerRef.current);
      for (const timer of viewerAudioVisualTimersRef.current.values()) window.clearTimeout(timer);
      viewerAudioVisualTimersRef.current.clear();
      stopVisualAuto("Vision detenida.");
    };
  }, []);

  useEffect(() => {
    if (activeControlTab !== "viewers") return;
    const timeoutId = window.setTimeout(() => {
      void handleSearchStreamUsers();
    }, 320);
    return () => window.clearTimeout(timeoutId);
  }, [streamUserQuery, activeControlTab]);

  useEffect(() => {
    const clearViewerAudioVisualTimer = (responseId?: string) => {
      if (!responseId) return;
      const timer = viewerAudioVisualTimersRef.current.get(responseId);
      if (timer) window.clearTimeout(timer);
      viewerAudioVisualTimersRef.current.delete(responseId);
    };
    const applySpeechDetail = (detail: SpeechUiDetail | undefined) => {
      if (!detail) return;
      clearViewerAudioVisualTimer(detail.responseId);
      if (detail.state === "start") {
        if (!detail.responseId) return;
        visualSpeechBlockersRef.current.add(detail.responseId);
        activeSpeechResponseIdRef.current = detail.responseId;
        setAvatarSpeaking(true);
        setVoicePlaybackNotice("");
      } else {
        if (detail.responseId) visualSpeechBlockersRef.current.delete(detail.responseId);
        if (detail.responseId && activeSpeechResponseIdRef.current && detail.responseId !== activeSpeechResponseIdRef.current) {
          updateResponseSpeechTimings(detail);
          return;
        }
        activeSpeechResponseIdRef.current = null;
        setAvatarSpeaking(false);
      }
      const matchingResponse = detail.responseId ? responseByIdRef.current.get(detail.responseId) : undefined;
      emitAvatarSignal(deriveAvatarSignalFromSpeechEvent(detail, matchingResponse));
      updateResponseSpeechTimings(detail);
    };
    const onSpeech = (event: Event) => {
      const detail = (event as CustomEvent<SpeechUiDetail>).detail;
      applySpeechDetail(detail);
    };
    const onVoiceError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setVoicePlaybackNotice(detail?.message || `Audio bloqueado por el navegador. Pulsa Activar audio de ${persona.name || "Yuko"}.`);
    };
    const onAudioUnlocked = (event: Event) => {
      const detail = (event as CustomEvent<{ unlocked?: boolean }>).detail;
      setAudioUnlocked(Boolean(detail?.unlocked));
    };
    window.addEventListener("luma:speech", onSpeech);
    window.addEventListener("luma:voice-error", onVoiceError);
    window.addEventListener("luma:audio-unlocked", onAudioUnlocked);
    const speechChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("luma:speech") : null;
    if (speechChannel) {
      speechChannel.onmessage = (event) => {
        applySpeechDetail(event.data as SpeechUiDetail);
      };
    }
    return () => {
      window.removeEventListener("luma:speech", onSpeech);
      window.removeEventListener("luma:voice-error", onVoiceError);
      window.removeEventListener("luma:audio-unlocked", onAudioUnlocked);
      speechChannel?.close();
    };
  }, []);

  function scheduleViewerAudioVisual(response: ChatResponse) {
    if (!response.id || !response.audio) return;
    const existing = viewerAudioVisualTimersRef.current.get(response.id);
    if (existing) window.clearTimeout(existing);
    const durationMs = normalizeAudioVisualDuration(response);
    const startTimer = window.setTimeout(() => {
      viewerAudioVisualTimersRef.current.delete(response.id);
      const startedAt = Date.now();
      activeSpeechResponseIdRef.current = response.id;
      setAvatarSpeaking(true);
      emitAvatarSignal(deriveAvatarSignalFromSpeechEvent({
        state: "start",
        responseId: response.id,
        startedAt,
        audioKind: "audio",
        audioDurationMs: durationMs
      }, response));
      const endTimer = window.setTimeout(() => {
        viewerAudioVisualTimersRef.current.delete(response.id);
        if (activeSpeechResponseIdRef.current !== response.id) return;
        const endedAt = Date.now();
        activeSpeechResponseIdRef.current = null;
        visualSpeechBlockersRef.current.delete(response.id);
        setAvatarSpeaking(false);
        emitAvatarSignal(deriveAvatarSignalFromSpeechEvent({
          state: "end",
          responseId: response.id,
          startedAt,
          endedAt,
          playbackDurationMs: endedAt - startedAt,
          audioKind: "audio",
          audioDurationMs: durationMs
        }, response));
      }, durationMs);
      viewerAudioVisualTimersRef.current.set(response.id, endTimer);
    }, 180);
    viewerAudioVisualTimersRef.current.set(response.id, startTimer);
  }

  async function refresh() {
    try {
      const next = await getStatus();
      setSystemStatusError("");
      setStatus(next);
      setPersona(next.persona);
      setMode(next.safety.mode);
      setModelChoice(next.runtime.lmStudioModel);
      setGeminiModelChoice((current) => current || next.runtime.geminiModel || "");
      setRuntimeDraftProvider(next.runtime.llmProvider || "lmstudio");
      setRuntimeDraftBaseUrl(next.runtime.lmStudioBaseUrl || "");
    } catch {
      setSystemStatusError("No pude conectar con el backend local de MiVtuberIA.");
      setVoiceNotice("No pude leer el estado local completo.");
    }
    await Promise.allSettled([
      refreshModels(),
      refreshMemories(),
      refreshTts(),
      refreshScene(),
      refreshBackgrounds(),
      refreshAvatar(),
      refreshGuard(),
      refreshLogs(),
      refreshChatHistory(),
      refreshTwitch(),
      refreshTikfinity(),
      refreshAutonomy(),
      refreshVts()
    ]);
  }

  async function refreshModels() {
    const payload = await getModels();
    setModels(payload.models || []);
    setServerRunning(Boolean(payload.serverRunning));
  }

  useEffect(() => {
    getSecretsStatus()
      .then((res) => setSecretsStatus(res.secrets))
      .catch(() => {});
  }, []);

  // Guarda credenciales desde la UI. El backend SIEMPRE persiste la key (no bloquea por
  // un ping flojo); si verifica una key de Gemini, además activa Gemini con un modelo
  // válido y lo informa en `activated`. Los valores nunca regresan, solo configurada sí/no.
  async function saveSecretsFromUi(updates: Record<string, string>, successNotice: string) {
    setSecretsBusy(true);
    setSecretsNotice("");
    try {
      const result = await saveSecrets(updates);
      setSecretsStatus(result.secrets);
      if (updates.GEMINI_API_KEY?.trim()) setGeminiModels([]);
      if (result.activated) {
        setSecretsNotice(`Listo: Yuko ahora usa Gemini (modelo ${result.activated}).`);
        await refresh();
      } else if (result.warning) {
        setSecretsNotice(result.warning);
      } else {
        setSecretsNotice(successNotice);
      }
      return true;
    } catch (error) {
      setSecretsNotice(apiErrorMessage(error, "No pude guardar las credenciales."));
      return false;
    } finally {
      setSecretsBusy(false);
    }
  }

  // Al elegir Gemini como proveedor, traer la lista real de modelos de la nube
  // (sin inventar nombres). Solo se consulta cuando hace falta.
  useEffect(() => {
    const raw = (runtimeDraftProvider || "").toLowerCase();
    if (raw !== "gemini" || geminiModels.length) return;
    let cancelled = false;
    setGeminiModelsNotice("Cargando modelos de Gemini...");
    getGeminiModels()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setGeminiModels(res.models);
          setGeminiModelsNotice(res.models.length ? "" : "Gemini no devolvió modelos.");
        } else {
          setGeminiModelsNotice(res.error || "No pude listar modelos de Gemini.");
        }
      })
      .catch(() => {
        if (!cancelled) setGeminiModelsNotice("No pude listar modelos de Gemini.");
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeDraftProvider, geminiModels.length]);

  async function refreshVts() {
    try {
      const payload = await getVtsStatus();
      setVtsStatus(payload.vts);
      if (payload.vts.connected && payload.vts.authenticated) {
        const hk = await getVtsHotkeys().catch(() => null);
        if (hk?.ok) setVtsHotkeys(hk.hotkeys);
      }
    } catch {
      // VTS opcional: no romper el panel si no responde.
    }
  }

  async function handleVtsConnect() {
    if (vtsBusy) return;
    setVtsBusy(true);
    setVtsNotice("Conectando a VTube Studio... acepta el popup de permiso en VTS si aparece.");
    try {
      const payload = await connectVts();
      setVtsStatus(payload.vts);
      if (payload.ok && payload.vts.authenticated) {
        setVtsNotice(`Conectado a VTube Studio${payload.vts.modelName ? ` · modelo ${payload.vts.modelName}` : ""}.`);
        const hk = await getVtsHotkeys().catch(() => null);
        if (hk?.ok) setVtsHotkeys(hk.hotkeys);
      } else {
        setVtsNotice(payload.error || "No quedó autenticado. ¿Aceptaste el permiso en VTS?");
      }
    } catch (error) {
      setVtsNotice(error instanceof Error ? error.message : "No pude conectar a VTube Studio.");
    } finally {
      setVtsBusy(false);
    }
  }

  async function handleVtsDisconnect() {
    setVtsBusy(true);
    try {
      const payload = await disconnectVts();
      setVtsStatus(payload.vts);
      setVtsNotice("Desconectado de VTube Studio.");
    } finally {
      setVtsBusy(false);
    }
  }

  async function handleVtsMap(emotion: string, hotkeyID: string) {
    try {
      const payload = await setVtsEmotionMap({ [emotion]: hotkeyID });
      setVtsStatus(payload.vts);
    } catch (error) {
      setVtsNotice(error instanceof Error ? error.message : "No pude guardar el mapeo.");
    }
  }

  async function handleVtsTest(emotion: string) {
    if (!emotion) return;
    try {
      // "Poner" la emoción (mismo comportamiento que el flujo real): no togglea.
      await previewVtsEmotion(emotion);
      setVtsNotice(`Vista previa: emoción ${emotion} aplicada en VTS.`);
    } catch (error) {
      setVtsNotice(error instanceof Error ? error.message : "No pude disparar la expresión.");
    }
  }

  async function refreshTts() {
    const payload = await getTts();
    setTts(payload);
    const activeBackend = payload.activeBackend || payload.provider || "browser";
    setVoiceBackendChoice(activeBackend);
    if (activeBackend === "kokoro") {
      setVoiceChoice(payload.selectedVoiceId || payload.availableVoices?.[0]?.id || payload.voices[0]?.id || "");
    } else {
      setVoiceChoice(localStorage.getItem("mivtuberia.browserVoiceId") || "");
    }
    setVoiceNotice(payload.notice);
  }

  async function refreshScene(options: { force?: boolean } = {}) {
    const payload = await getScene();
    if (!options.force && sceneDirtyRef.current && !viewerOnly) return;
    setScene(payload.scene);
    sceneRef.current = payload.scene;
    setAvatarCamera(payload.scene.cameraPreset);
  }

  async function refreshBackgrounds() {
    const payload = await getBackgrounds();
    setBackgrounds(payload.items || []);
  }

  async function refreshAvatar() {
    const [payload, healthPayload] = await Promise.all([getAvatar(), getAvatarHealth().catch(() => null)]);
    setActiveAvatarUrl(healthPayload?.health.exists === false ? "" : payload.avatar.activeAvatarUrl || "");
    if (healthPayload && !healthPayload.health.exists) {
      setAvatarNotice(healthPayload.health.error || "El avatar activo no existe en disco.");
    }
  }

  async function refreshMemories() {
    const payload = await getMemories();
    setMemories(payload.items || []);
  }

  async function refreshGuard() {
    const payload = await getGuard();
    setGuard(payload);
  }

  async function refreshLogs() {
    const currentLogs = await getLogs();
    const logItems = [
      ...(currentLogs.messages?.items || []).map((item: any) => ({ at: String(item.created_at || ""), text: `${item.created_at} ${item.role}: ${item.content}` })),
      ...(currentLogs.blocked?.items || []).map((item: any) => ({ at: String(item.created_at || ""), text: `${item.created_at} BLOCKED ${item.reason}: ${item.content}` })),
      ...(currentLogs.moderation?.items || []).map((item: any) => ({
        at: String(item.created_at || ""),
        text: `${item.created_at} ${String(item.decision).toUpperCase()} ${item.reason} (${item.score}) ${item.user || item.source || "chat"}: ${item.content}`
      }))
    ];
    setLogs(logItems.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40).map((item) => item.text));
  }

  async function refreshChatHistory() {
    const payload = await getChatHistory(40);
    setMessages((current) => current.length ? current : (payload.items || []).map((item) => chatHistoryToMessage(item, persona.name || "Yuko")));
  }

  async function refreshTwitch() {
    const payload = await getTwitchStatus();
    setTwitchStatus(payload);
  }

  async function refreshTikfinity() {
    const payload = await getTikfinityState();
    setTikfinityState(payload);
    setTikfinityWsUrl(payload.config.wsUrl || payload.wsUrl || "ws://127.0.0.1:21213/");
    setTikfinityKeywords((payload.config.mentionKeywords || []).join(", "));
  }

  async function refreshAutonomy() {
    const payload = await getAutonomyState();
    setAutonomyState(payload);
  }

  function updateResponseSpeechTimings(detail?: SpeechUiDetail) {
    if (!detail?.responseId) return;
    const applyTiming = (response: ChatResponse): ChatResponse => {
      if (response.id !== detail.responseId) return response;
      const speechStartDelayMs = detail.startedAt && detail.queuedAt ? Math.max(0, detail.startedAt - detail.queuedAt) : response.timings.speechStartDelayMs;
      const speechPlaybackMs = detail.playbackDurationMs ?? response.timings.speechPlaybackMs;
      const audioDurationMs = detail.audioDurationMs ?? response.timings.audioDurationMs;
      return {
        ...response,
        timings: {
          ...response.timings,
          speechStartDelayMs,
          speechPlaybackMs,
          audioDurationMs,
          audioKind: detail.audioKind || response.timings.audioKind
        }
      };
    };
    setMessages((current) => current.map((message) => {
      if (!message.response || message.response.id !== detail.responseId) return message;
      const nextResponse = applyTiming(message.response);
      return {
        ...message,
        response: nextResponse,
        meta: responseMeta(nextResponse)
      };
    }));
    setLastResponse((current) => current && current.id === detail.responseId ? applyTiming(current) : current);
    if (detail.state === "end" && detail.playbackDurationMs !== undefined) {
      console.debug("speech_timing", JSON.stringify({
        responseId: detail.responseId,
        audioKind: detail.audioKind || "none",
        speechStartDelayMs: detail.startedAt && detail.queuedAt ? Math.max(0, detail.startedAt - detail.queuedAt) : undefined,
        speechPlaybackMs: detail.playbackDurationMs,
        audioDurationMs: detail.audioDurationMs
      }));
    }
    if (detail.state === "end" || detail.state === "start") {
      void saveResponseTiming({
        responseId: detail.responseId,
        audioKind: detail.audioKind,
        timings: {
          speechStartDelayMs: detail.startedAt && detail.queuedAt ? Math.max(0, detail.startedAt - detail.queuedAt) : undefined,
          speechPlaybackMs: detail.playbackDurationMs,
          audioDurationMs: detail.audioDurationMs,
          audioKind: detail.audioKind
        }
      }).catch(() => undefined);
    }
  }

  async function handleConnectTwitch() {
    setTwitchBusy(true);
    setTwitchNotice("");
    try {
      const payload = await connectTwitch();
      setTwitchStatus(payload);
      setTwitchNotice("Twitch conectado en solo lectura.");
    } catch (error) {
      setTwitchNotice(readErrorMessage(error));
      await refreshTwitch().catch(() => undefined);
    } finally {
      setTwitchBusy(false);
    }
  }

  async function handleDisconnectTwitch() {
    setTwitchBusy(true);
    setTwitchNotice("");
    try {
      const payload = await disconnectTwitch();
      setTwitchStatus(payload);
      setTwitchNotice("Twitch desconectado.");
    } catch (error) {
      setTwitchNotice(readErrorMessage(error));
    } finally {
      setTwitchBusy(false);
    }
  }

  async function saveTikfinityConfig(updates: Partial<TikfinityStatePayload["config"]> = {}) {
    setTikfinityBusy(true);
    setTikfinityNotice("");
    try {
      const payload = await updateTikfinityConfig({
        wsUrl: tikfinityWsUrl.trim() || "ws://127.0.0.1:21213/",
        mentionKeywords: tikfinityKeywords.split(",").map((item) => item.trim()).filter(Boolean),
        ...updates
      });
      setTikfinityState(payload);
      setTikfinityNotice("TikFinity configurado.");
    } catch (error) {
      setTikfinityNotice(readErrorMessage(error));
    } finally {
      setTikfinityBusy(false);
    }
  }

  async function handleConnectTikfinity() {
    setTikfinityBusy(true);
    setTikfinityNotice("");
    try {
      await updateTikfinityConfig({
        enabled: true,
        wsUrl: tikfinityWsUrl.trim() || "ws://127.0.0.1:21213/",
        mentionKeywords: tikfinityKeywords.split(",").map((item) => item.trim()).filter(Boolean)
      });
      const payload = await connectTikfinity();
      setTikfinityState(payload);
      setTikfinityNotice(payload.status === "connected" ? "TikFinity conectado." : "TikFinity intentando conectar.");
    } catch (error) {
      setTikfinityNotice(readErrorMessage(error));
      await refreshTikfinity().catch(() => undefined);
    } finally {
      setTikfinityBusy(false);
    }
  }

  async function handleDisconnectTikfinity() {
    setTikfinityBusy(true);
    setTikfinityNotice("");
    try {
      const payload = await disconnectTikfinity();
      setTikfinityState(payload);
      setTikfinityNotice("TikFinity desconectado.");
    } catch (error) {
      setTikfinityNotice(readErrorMessage(error));
    } finally {
      setTikfinityBusy(false);
    }
  }

  async function handleTikfinityTestEvent() {
    setTikfinityBusy(true);
    setTikfinityNotice("");
    try {
      const payload = await sendTikfinityTestEvent({
        type: "chat",
        username: "tester",
        displayName: "Tester",
        text: "Hola Yuko, ¿me lees?"
      });
      setTikfinityState(payload.state);
      await refreshAutonomy().catch(() => undefined);
      setTikfinityNotice("Evento de prueba recibido.");
    } catch (error) {
      setTikfinityNotice(readErrorMessage(error));
    } finally {
      setTikfinityBusy(false);
    }
  }

  async function saveAutonomyConfig(updates: Partial<AutonomyStatePayload["config"]>) {
    setAutonomyBusy(true);
    setAutonomyNotice("");
    try {
      const payload = await updateAutonomyConfig(updates);
      setAutonomyState(payload);
      setAutonomyNotice("Autonomía configurada.");
    } catch (error) {
      setAutonomyNotice(readErrorMessage(error));
    } finally {
      setAutonomyBusy(false);
    }
  }

  async function handleAutonomyTrigger() {
    setAutonomyBusy(true);
    setAutonomyNotice("");
    try {
      const payload = await triggerAutonomy({ type: "manual_trigger", message: "Haz una intervención breve de prueba" });
      setAutonomyState(payload.state);
      setAutonomyNotice(payload.decision?.shouldSpeak ? "Autonomía disparada." : `Bloqueada: ${payload.decision?.blockedBy || payload.decision?.reason || "sin decisión"}`);
    } catch (error) {
      setAutonomyNotice(readErrorMessage(error));
    } finally {
      setAutonomyBusy(false);
    }
  }

  async function handleSearchStreamUsers() {
    setStreamHistoryNotice("");
    try {
      const payload = await searchStreamUsers(streamUserQuery.trim());
      setStreamUsers(payload.items || []);
      if (!(payload.items || []).length) setStreamHistoryNotice("Sin viewers encontrados todavía.");
    } catch (error) {
      setStreamHistoryNotice(readErrorMessage(error));
    }
  }

  async function selectStreamUser(user: StreamUserHistoryItem) {
    setSelectedStreamUser(user);
    await refreshStreamUserMessages(user.id);
  }

  async function refreshStreamUserMessages(userId: string) {
    setStreamHistoryNotice("");
    try {
      const payload = await getStreamUserMessages(userId, 80);
      setStreamUserMessages(payload.items || []);
    } catch (error) {
      setStreamHistoryNotice(readErrorMessage(error));
    }
  }

  function showGuardViewerNotice(payload: any) {
    const displayText = String(payload?.displayText || "");
    if (!displayText) return;
    const id = String(payload?.id || Date.now());
    setGuardViewerNotice({ id, text: displayText });
    window.setTimeout(() => {
      setGuardViewerNotice((current) => current?.id === id ? null : current);
    }, 5500);
  }

  async function persistAvatarFile(file: File) {
    setAvatarNotice("Guardando avatar para panel y OBS...");
    setAvatarVrmFile(file);
    try {
      const payload = await uploadAvatar(file);
      setActiveAvatarUrl(payload.avatar.activeAvatarUrl);
      setAvatarVrmFile(null);
      setAvatarNotice(payload.health?.exists === false ? payload.health.error : "Avatar activo guardado. OBS se actualizará con /viewer.");
    } catch (error) {
      setAvatarNotice(readErrorMessage(error));
    }
  }

  async function attachChatImage(file: File) {
    setImageNotice("Preparando imagen para Yuko y el overlay de OBS...");
    try {
      const image = await fileToChatImage(file);
      setPendingImage(image);
      const payload = await uploadReferenceImage(image);
      setScene(payload.scene);
      sceneRef.current = payload.scene;
      setActiveVisualImage({
        src: image.previewUrl,
        name: image.fileName,
        attachment: { name: image.name, mimeType: image.mimeType, base64: image.base64, aspectRatio: image.aspectRatio },
        kind: "chat"
      });
      setReferenceImageAvailable(true);
      setImageNotice("Imagen adjunta. Se mostrará como overlay movible en OBS, no como fondo.");
    } catch (error) {
      setImageNotice(readErrorMessage(error) || "No pude preparar esa imagen.");
    }
  }

  async function sendVisualNarration(image: VisualNarrationImage, mode: VisualPromptMode, options: VisualNarrationOptions = {}) {
    if (visualNarrationBusy || busy) return;
    const useGlobalBusy = options.useGlobalBusy !== false && !options.visualAuto;
    setVisualNarrationBusy(true);
    if (useGlobalBusy) setBusy(true);
    setActiveVisualImage(image);
    setVisualNarrationNotice(mode === "auto"
      ? "Yuko está analizando cambios visuales..."
      : mode === "narrate"
        ? "Yuko está preparando una narración para el directo..."
        : "Yuko está mirando la imagen para describirla de forma factual...");
    emitAvatarSignal({
      mood: "focused",
      intensity: 5,
      action: "watching",
      text: image.name,
      source: "ui"
    });
    const visualMessageId = `visual-${crypto.randomUUID()}`;
    const shouldAddUserBubble = options.forceUserBubble === true || (!options.visualAuto && options.forceUserBubble !== false);
    try {
      const prompt = visualPrompt(mode);
      const clientSentAt = new Date().toISOString();
      if (shouldAddUserBubble) {
        setMessages((current) => [...current, {
          id: visualMessageId,
          role: "user",
          text: mode === "auto" ? "Yuko vio un cambio visual" : mode === "narrate" ? "Narrar escena visual para el directo" : "Mirar imagen y describirla",
          createdAt: clientSentAt,
          meta: `Administrador · visión ${visualKindLabel(image.kind)} · ${image.name}`,
          author: "Administrador",
          image: { src: image.src, name: image.name, attachment: image.attachment }
        }]);
      }
      const response = await sendChat(prompt, "admin", [image.attachment], {
        suppressNoChanges: options.suppressNoChanges,
        visualAuto: options.visualAuto,
        personaDisabled: !personaEnabled
      });
      if (isVisualNoChanges(response)) {
        setMessages((current) => current.filter((item) => item.id !== visualMessageId));
        setVisualVisionState("no-change");
        setVisualNarrationNotice("Sin cambios importantes en la fuente visual.");
        emitAvatarIdleSignal("ui");
        return;
      }
      setVisualLastAnalysisAt(new Date().toISOString());
      if (options.visualAuto) visualLastAutoNarrationAtRef.current = Date.now();
      setVisualVisionState(visualAutoEnabled ? "watching" : "off");
      setVisualNarrationNotice(mode === "auto"
        ? "Yuko narró un cambio visual."
        : mode === "narrate"
          ? "Yuko narró la escena como línea de directo."
          : "Yuko describió la imagen como inspección factual.");
    } catch (error) {
      setVisualNarrationNotice(readErrorMessage(error) || "No pude enviar la imagen a Yuko.");
      setVisualVisionState("error");
      emitAvatarIdleSignal("ui");
    } finally {
      setVisualNarrationBusy(false);
      if (useGlobalBusy) setBusy(false);
    }
  }

  function scheduleVisualAutoTick(delay = visualAutoIntervalSecondsRef.current * 1000) {
    if (visualLoopTimerRef.current) window.clearTimeout(visualLoopTimerRef.current);
    visualLoopTimerRef.current = window.setTimeout(() => void runVisualAutoTick(false), delay);
  }

  async function startVisualAuto() {
    if (visualAutoEnabled || visualCaptureBusy) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setVisualNarrationNotice("Este navegador no permite visión opt-in de pantalla.");
      setVisualVisionState("error");
      return;
    }
    setVisualCaptureBusy(true);
    setVisualVisionState("selecting");
    setVisualNarrationNotice("Elige pantalla, ventana o pestaña. Yuko mantendrá esa fuente activa hasta Detener visión.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 1, max: 1 },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      const video = await createVideoFromStream(stream);
      visualStreamRef.current = stream;
      visualVideoRef.current = video;
      visualLastHashRef.current = null;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => stopVisualAuto("La visión se detuvo desde el navegador."));
      });
      setVisualAutoEnabled(true);
      setVisualVisionState("watching");
      setVisualNarrationNotice("Visión activa. Solo actualiza preview hasta que actives Auto narrar o pidas Mirar/Narrar.");
      scheduleVisualAutoTick(600);
    } catch (error) {
      setVisualVisionState("error");
      setVisualNarrationNotice(error instanceof Error && error.name === "NotAllowedError"
        ? "Permiso cancelado. Yuko no mira nada sin tu autorización."
        : readErrorMessage(error) || "No pude activar la visión.");
    } finally {
      setVisualCaptureBusy(false);
    }
  }

  function stopVisualAuto(message = "Visión detenida.") {
    if (visualLoopTimerRef.current) {
      window.clearTimeout(visualLoopTimerRef.current);
      visualLoopTimerRef.current = null;
    }
    visualStreamRef.current?.getTracks().forEach((track) => track.stop());
    visualStreamRef.current = null;
    visualVideoRef.current = null;
    visualLastHashRef.current = null;
    visualLastAutoNarrationAtRef.current = 0;
    visualAnalyzingRef.current = false;
    setVisualAutoEnabled(false);
    setVisualAutoNarrationEnabled(false);
    setVisualVisionState("off");
    setVisualNarrationNotice(message);
    emitAvatarIdleSignal("ui");
  }

  async function runVisualAutoTick(force: boolean, mode: VisualPromptMode = "auto") {
    const video = visualVideoRef.current;
    if (!visualStreamRef.current || !video) {
      if (visualAutoEnabled) stopVisualAuto("La fuente visual ya no está disponible.");
      return;
    }
    try {
      const frame = await captureFrameFromVideo(video, "capture", "vision-auto");
      setVisualLastFrame(frame.image);
      setActiveVisualImage(frame.image);
      setVisualLastFrameAt(new Date().toISOString());
      const changeScore = frameChangeScore(visualLastHashRef.current, frame.hash);
      setVisualLastChangeScore(changeScore);
      if (!force && !visualAutoNarrationEnabledRef.current) {
        visualLastHashRef.current = frame.hash;
        setVisualVisionState("watching");
        setVisualNarrationNotice("Visión activa. Preview actualizado; narrar sola cuando cambie está apagado.");
        console.info("visual_frame_skipped", JSON.stringify({ reason: "auto_narration_off", changeScore: Math.round(changeScore) }));
        scheduleVisualAutoTick();
        return;
      }
      if (!force && visualLastHashRef.current && changeScore < VISUAL_MIN_CHANGE_SCORE) {
        setVisualVisionState("no-change");
        setVisualNarrationNotice(`Cambio bajo (${Math.round(changeScore)}). Mantengo el punto de comparación para detectar cambios acumulados.`);
        console.info("visual_frame_skipped", JSON.stringify({ reason: "low_change", changeScore: Math.round(changeScore) }));
        emitAvatarIdleSignal("ui");
        scheduleVisualAutoTick();
        return;
      }
      const speechBusy = avatarSpeakingRef.current || visualSpeechBlockersRef.current.size > 0;
      const composerBusy = inputRef.current.trim().length > 0;
      const recentlyNarrated = Date.now() - visualLastAutoNarrationAtRef.current < VISUAL_AUTO_MIN_NARRATION_GAP_MS;
      if (!force && (visualAnalyzingRef.current || busyRef.current || visualNarrationBusy || speechBusy || composerBusy || recentlyNarrated)) {
        const reason = speechBusy ? "speaking"
          : composerBusy ? "typing"
            : recentlyNarrated ? "cooldown"
              : "busy";
        setVisualVisionState(reason === "cooldown" ? "watching" : "busy");
        setVisualNarrationNotice(reason === "typing"
          ? "Visión activa. Yuko actualiza el frame, pero espera a que termines de escribir."
          : reason === "speaking"
            ? "Visión activa. Yuko espera a terminar de hablar antes de narrar otra imagen."
            : reason === "cooldown"
              ? "Visión activa. Frame actualizado; evitando narrar en bucle."
              : "Visión activa. Modelo ocupado; frame actualizado sin enviar otra narración.");
        console.info("visual_frame_skipped", JSON.stringify({ reason, changeScore: Math.round(changeScore) }));
        scheduleVisualAutoTick();
        return;
      }
      visualLastHashRef.current = frame.hash;
      visualAnalyzingRef.current = true;
      setVisualVisionState("analyzing");
      await sendVisualNarration(frame.image, mode, {
        suppressNoChanges: mode === "auto",
        visualAuto: true,
        forceUserBubble: false,
        useGlobalBusy: false
      });
    } catch (error) {
      setVisualVisionState("error");
      setVisualNarrationNotice(readErrorMessage(error) || "No pude leer la fuente visual activa.");
    } finally {
      visualAnalyzingRef.current = false;
      if (visualStreamRef.current) scheduleVisualAutoTick();
    }
  }

  async function narrateCurrentVisualStream(mode: VisualPromptMode = "narrate") {
    await runVisualAutoTick(true, mode);
  }

  async function narrateCurrentVisualSource(mode: VisualPromptMode) {
    if (visualAutoEnabled) {
      await narrateCurrentVisualStream(mode);
      return;
    }
    const cachedImage = visualLastFrame || activeVisualImage;
    if (cachedImage) {
      await sendVisualNarration(cachedImage, mode);
      return;
    }
    await narrateReferenceImage(mode);
  }

  async function narrateReferenceImage(mode: VisualPromptMode) {
    const referenceImage = sceneRef.current.referenceImage;
    if (!referenceImage) {
      setVisualNarrationNotice("No hay imagen de referencia. Sube una imagen con el botón I del chat o desde el flujo visual.");
      return;
    }
    if (!referenceImageAvailable) {
      setVisualNarrationNotice("La imagen de referencia no está disponible en disco. Limpia la imagen o sube otra.");
      return;
    }
    try {
      const image = await referenceImageToChatAttachment(referenceImage);
      await sendVisualNarration({
        src: referenceImageSrc(referenceImage),
        name: referenceImage.name,
        attachment: image,
        kind: "reference"
      }, mode);
    } catch (error) {
      setReferenceImageAvailable(false);
      setVisualNarrationNotice(readErrorMessage(error) || "La imagen de referencia ya no está disponible.");
    }
  }

  async function narrateChatImage(message: ChatMessageItem, mode: VisualPromptMode) {
    if (!message.image?.attachment) {
      setVisualNarrationNotice("Esa imagen del chat ya no tiene datos disponibles para reenviarse a Yuko.");
      return;
    }
    await sendVisualNarration({
      src: message.image.src,
      name: message.image.name,
      attachment: message.image.attachment,
      kind: "chat"
    }, mode);
  }

  async function useChatImageInScene(message: ChatMessageItem) {
    if (!message.image?.attachment) {
      setVisualNarrationNotice("Esa imagen del chat ya no tiene datos disponibles para enviarse a escena.");
      return;
    }
    setSceneBusy(true);
    setVisualNarrationNotice("Enviando imagen del chat al overlay OBS...");
    try {
      const payload = await uploadReferenceImage(message.image.attachment);
      setScene(payload.scene);
      sceneRef.current = payload.scene;
      sceneDirtyRef.current = false;
      setReferenceImageAvailable(true);
      setActiveVisualImage({
        src: message.image.src,
        name: message.image.name,
        attachment: message.image.attachment,
        kind: "chat"
      });
      setVisualNarrationNotice("Imagen del chat enviada al overlay movible de OBS.");
    } catch (error) {
      setVisualNarrationNotice(readErrorMessage(error) || "No pude enviar esa imagen a escena.");
    } finally {
      setSceneBusy(false);
    }
  }

  function removeChatImage(message: ChatMessageItem) {
    if (!message.id) return;
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, image: undefined } : item));
  }

  async function narrateScreenCapture(mode: VisualPromptMode = "narrate") {
    if (visualCaptureBusy || visualNarrationBusy || busy) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setVisualNarrationNotice("Este navegador no permite captura opt-in de pantalla.");
      return;
    }
    setVisualCaptureBusy(true);
    setVisualNarrationNotice("Elige una pantalla, ventana o pestaña para que Yuko la mire una sola vez.");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const captured = await captureFrameFromStream(stream);
      await sendVisualNarration(captured, mode);
    } catch (error) {
      setVisualNarrationNotice(error instanceof Error && error.name === "NotAllowedError"
        ? "Captura cancelada. Yuko no mira nada sin tu permiso."
        : readErrorMessage(error) || "No pude capturar esa pantalla.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setVisualCaptureBusy(false);
    }
  }

  async function clearReferenceImage(deleteFile = false) {
    const referenceImage = sceneRef.current.referenceImage;
    if (!referenceImage) {
      setActiveVisualImage((current) => current?.kind === "reference" ? null : current);
      setVisualNarrationNotice("No hay imagen de referencia activa.");
      return;
    }
    setSceneBusy(true);
    try {
      let nextScene = normalizeSceneClient({ ...sceneRef.current, referenceImage: null });
      if (deleteFile) {
        const payload = await deleteReferenceImage(referenceImage.id);
        nextScene = payload.scene;
        setVisualNarrationNotice("Archivo borrado: se quitó de la escena y del almacenamiento local.");
      } else {
        const payload = await saveScene(nextScene);
        nextScene = payload.scene;
        setVisualNarrationNotice("Overlay quitado: la imagen deja de mostrarse en OBS, pero el archivo local no se borra.");
      }
      setScene(nextScene);
      sceneRef.current = nextScene;
      sceneDirtyRef.current = false;
      setReferenceImageAvailable(false);
      setActiveVisualImage((current) => current?.kind === "reference" ? null : current);
    } catch (error) {
      setVisualNarrationNotice(readErrorMessage(error) || "No pude actualizar la imagen de referencia.");
    } finally {
      setSceneBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const imageToSend = pendingImage;
    let visualContextImage: VisualNarrationImage | null = null;
    if (!imageToSend && chatMode === "admin" && visualAutoEnabled) {
      visualContextImage = visualLastFrame || activeVisualImage;
      const video = visualVideoRef.current;
      if (video) {
        try {
          visualContextImage = (await captureFrameFromVideo(video, "capture", "vision-chat")).image;
          setVisualLastFrame(visualContextImage);
          setActiveVisualImage(visualContextImage);
          setVisualLastFrameAt(new Date().toISOString());
        } catch (error) {
          setVisualNarrationNotice(readErrorMessage(error) || "No pude adjuntar la visión actual al mensaje.");
        }
      }
    }
    const images = imageToSend
      ? [{ name: imageToSend.name, mimeType: imageToSend.mimeType, base64: imageToSend.base64 }]
      : visualContextImage?.attachment
        ? [visualContextImage.attachment]
        : [];
    const imageName = imageToSend?.fileName || visualContextImage?.name;
    setPendingImage(null);
    setImageNotice("");
    const clientSentAt = new Date().toISOString();
    const userLabel = chatMode === "admin" ? "Administrador" : `Chat del directo · ${streamUser.trim() || "viewer"}`;
    setMessages((current) => [...current, {
      id: `user-${crypto.randomUUID()}`,
      role: "user",
      text,
      createdAt: clientSentAt,
      meta: imageName ? `${userLabel} · ${imageToSend ? "imagen" : "visión activa"} ${imageName}` : userLabel,
      author: userLabel,
      image: imageToSend ? {
        src: imageToSend.previewUrl,
        name: imageToSend.fileName,
        attachment: { name: imageToSend.name, mimeType: imageToSend.mimeType, base64: imageToSend.base64, aspectRatio: imageToSend.aspectRatio }
      } : visualContextImage ? {
        src: visualContextImage.src,
        name: visualContextImage.name,
        attachment: visualContextImage.attachment
      } : undefined
    }]);
    try {
      if (chatMode === "admin") {
        await sendChat(text, "admin", images, { personaDisabled: !personaEnabled });
      } else {
        const result = await ingestChat(text, streamUser.trim() || "viewer");
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: moderationBotMessage(result),
            createdAt: result.message?.timestamp || new Date().toISOString(),
            meta: `${moderationDecisionLabel(result.moderation.decision)} · ${moderationReasonLabel(result.moderation.reason)} · score ${result.moderation.score}`,
            author: "GuardaespaldasBot",
            avatar: "G"
          }
        ]);
      }
      await Promise.allSettled([refreshGuard(), refreshLogs()]);
    } catch (error) {
      if (imageToSend) {
        setPendingImage(imageToSend);
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", text: error instanceof Error ? error.message : "Error desconocido", createdAt: new Date().toISOString(), meta: "error local", author: "Sistema", avatar: "!" }
      ]);
      setEmotion("safe");
    } finally {
      setBusy(false);
    }
  }

  async function updateMode(next: SafetyMode) {
    setMode(next);
    await setSafetyMode(next);
  }

  async function updatePersona() {
    setPersonaNotice("");
    try {
      const saved = await savePersona(persona);
      setPersona(saved);
      setPersonaNotice("Persona guardada correctamente.");
      await refresh();
    } catch (error) {
      setPersonaNotice(readErrorMessage(error) || "No pude guardar la persona.");
    }
  }

  async function addMemory(event: FormEvent) {
    event.preventDefault();
    const content = newMemory.trim();
    if (!content || memoryBusy) return;
    setMemoryBusy(true);
    try {
      await createMemory(content, newImportance);
      setNewMemory("");
      setNewImportance(3);
      await refreshMemories();
    } finally {
      setMemoryBusy(false);
    }
  }

  async function saveMemory(memory: MemoryItem) {
    if (!memory.content.trim() || memoryBusy) return;
    setMemoryBusy(true);
    try {
      await updateMemory({ ...memory, content: memory.content.trim() });
      await refreshMemories();
    } finally {
      setMemoryBusy(false);
    }
  }

  async function removeMemory(id: number) {
    if (memoryBusy) return;
    setMemoryBusy(true);
    try {
      await deleteMemory(id);
      await refreshMemories();
    } finally {
      setMemoryBusy(false);
    }
  }

  async function archiveMemoryItem(id: number) {
    if (memoryBusy) return;
    setMemoryBusy(true);
    try {
      await archiveMemory(id);
      await refreshMemories();
    } finally {
      setMemoryBusy(false);
    }
  }

  async function applyModel() {
    if (!modelChoice || modelBusy) return;
    setModelBusy(true);
    setModelNotice("Cargando en LM Studio el modelo seleccionado y guardándolo como modelo de la app...");
    try {
      const payload = await selectModel(modelChoice);
      setLastResponse(null);
      setModels(payload.models || []);
      setServerRunning(Boolean(payload.serverRunning));
      setStatus((current) => current ? { ...current, runtime: payload.runtime } : current);
      setRuntimeDraftProvider(payload.runtime.llmProvider || "lmstudio");
      setRuntimeDraftBaseUrl(payload.runtime.lmStudioBaseUrl || "");
      await refresh();
      const unloaded = payload.unloaded?.length ? ` Modelos anteriores descargados: ${payload.unloaded.join(", ")}.` : "";
      const warnings = payload.unloadWarnings?.length
        ? ` Advertencia: el modelo fue cambiado, pero LM Studio aun tiene modelos anteriores cargados o no pude descargarlos: ${payload.unloadWarnings.join(" | ")}. La RAM puede seguir alta.`
        : "";
      setModelNotice(`Modelo configurado y cargado: ${payload.runtime.lmStudioModel}.${unloaded}${warnings}`);
    } catch (error) {
      setModelNotice(readErrorMessage(error) || "No pude cargar el modelo en LM Studio.");
    } finally {
      setModelBusy(false);
    }
  }

  async function applyActiveModel() {
    setModelBusy(true);
    setModelNotice("");
    try {
      const payload = await useActiveModel();
      setModels(payload.models || []);
      setServerRunning(Boolean(payload.serverRunning));
      setStatus((current) => current ? { ...current, runtime: payload.runtime } : current);
      setModelChoice(payload.runtime.lmStudioModel);
      setRuntimeDraftProvider(payload.runtime.llmProvider || "lmstudio");
      setRuntimeDraftBaseUrl(payload.runtime.lmStudioBaseUrl || "");
      setLastResponse(null);
      setModelNotice(`Modelo READY detectado en LM Studio y guardado en la app: ${payload.activeModel}`);
      await refresh();
    } catch (error) {
      setModelNotice(readErrorMessage(error));
    } finally {
      setModelBusy(false);
    }
  }

  async function updateRuntimeBase() {
    if (!status || modelBusy) return;
    setModelBusy(true);
    try {
      const payload = await saveRuntime({
        llmProvider: selectedProvider,
        lmStudioBaseUrl: selectedBaseUrl,
        lmStudioApiMode: status.runtime.lmStudioApiMode,
        lmStudioModel: modelChoice || status.runtime.lmStudioModel,
        // Cuando el proveedor es Gemini, tambien se guarda el modelo de nube elegido.
        ...(selectedProvider === "gemini" && geminiModelChoice ? { geminiModel: geminiModelChoice } : {})
      });
      setLastResponse(null);
      if (payload?.runtime) {
        setStatus((current) => current ? { ...current, runtime: payload.runtime } : current);
        setRuntimeDraftProvider(payload.runtime.llmProvider || "lmstudio");
        setRuntimeDraftBaseUrl(payload.runtime.lmStudioBaseUrl || "");
        setModelChoice(payload.runtime.lmStudioModel);
        setGeminiModelChoice(payload.runtime.geminiModel || "");
      }
      await refresh();
      setModelNotice("Proveedor, URL y modelo guardados. No se cargó ningún modelo nuevo.");
    } catch (error) {
      setModelNotice(error instanceof Error ? error.message : "No pude guardar la configuración del modelo.");
    } finally {
      setModelBusy(false);
    }
  }

  async function activateVoice() {
    try {
      await unlockAudio();
      setAudioUnlocked(true);
      setVoicePlaybackNotice(`Audio de ${persona.name || "Yuko"} activado en esta pestaña. Ahora los mensajes aprobados pueden sonar.`);
    } catch (error) {
      setVoicePlaybackNotice(error instanceof Error ? error.message : `No pude activar el audio de ${persona.name || "Yuko"} en esta pestaña.`);
    }
  }

  async function applyVoice() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      if (voiceBackendChoice === "browser") {
        localStorage.setItem("mivtuberia.browserVoiceId", voiceChoice);
        setBrowserVoices((items) => items.map((item) => ({ ...item, configured: item.id === voiceChoice })));
        const payload = await saveTtsVoice({ backend: "browser", voiceId: "" });
        setTts(payload);
        setVoiceNotice("Voz navegador guardada en esta pestaña.");
        return;
      }
      const payload = await saveTtsVoice({
        backend: "kokoro",
        experimentalLocal: true,
        voiceId: voiceChoice,
        speed: tts?.kokoroSpeed || 1
      });
      setTts(payload);
      setVoiceChoice(payload.selectedVoiceId || voiceChoice);
      setVoiceNotice(payload.notice);
      await refresh();
    } finally {
      setVoiceBusy(false);
    }
  }

  async function playVoiceTest() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    setVoiceLatency(null);
    setVoiceTestNotice("");
    const testText = `Hola, soy ${persona.name || "Yuko"}. Estoy probando mi voz en espanol.`;
    try {
      const result = await testTts(testText, voiceChoice, voiceBackendChoice);
      setVoiceLatency(result.timings.ttsMs);
      setTts(result.status);
      if (voiceBackendChoice === "kokoro") setVoiceChoice(result.status.selectedVoiceId || voiceChoice);
      setVoiceNotice(result.fallbackUsed
        ? result.notice || "Kokoro no entregó audio; usando voz del navegador."
        : `Prueba generada con ${ttsEngineLabel(result.engine, false)} · voz ${result.voice || voiceChoice}`);
      const testVoiceLabel = `${result.engine?.startsWith("kokoro") ? "Kokoro" : "navegador"}${result.voice ? ` · ${result.voice}` : ""}`;
      setVoiceTestNotice([
        `voz ${testVoiceLabel}`,
        result.timings.firstAudioMs !== undefined ? `primer audio ${formatDuration(result.timings.firstAudioMs)}` : "",
        result.timings.totalTtsMs !== undefined ? `total ${formatDuration(result.timings.totalTtsMs)}` : "",
        result.timings.audioDurationMs !== undefined ? `audio ${formatDuration(result.timings.audioDurationMs)}` : "",
        result.timings.rtf !== undefined ? `RTF ${result.timings.rtf}` : ""
      ].filter(Boolean).join(" · "));
      if (result.audio) {
        setAvatarSpeaking(true);
        const audio = new Audio(`data:${result.audio.mimeType};base64,${result.audio.base64}`);
        audio.onended = () => setAvatarSpeaking(false);
        audio.onerror = () => setAvatarSpeaking(false);
        await audio.play().catch(() => setAvatarSpeaking(false));
      } else {
        await playBrowserVoice(testText, voiceChoice);
      }
    } catch (error) {
      setVoiceNotice(error instanceof Error ? error.message : "No pude probar la voz.");
    } finally {
      setVoiceBusy(false);
    }
  }

  function playBrowserVoice(text: string, voiceId: string) {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) {
        setVoicePlaybackNotice("Este navegador no expone speechSynthesis.");
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const selected = window.speechSynthesis.getVoices().find((voice, index) => {
        const stableId = voice.voiceURI || `${voice.name}-${index}`;
        return stableId === voiceId || voice.voiceURI === voiceId || voice.name === voiceId;
      });
      if (selected) utterance.voice = selected;
      utterance.lang = selected?.lang || "es-MX";
      utterance.rate = 1.02;
      utterance.pitch = 1.08;
      utterance.onstart = () => setAvatarSpeaking(true);
      utterance.onend = () => {
        setAvatarSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setAvatarSpeaking(false);
        resolve();
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setVoiceTestNotice(`voz navegador${selected?.name ? ` · ${selected.name}` : ""}`);
    });
  }

  const notices = useMemo(() => {
    const items = lastResponse?.notices || [];
    if (status && !status.runtime.kokoroConfigured) {
      items.push("Kokoro no está configurado; usando voz del navegador como fallback gratuito.");
    }
    if (lastResponse?.provider === "fallback") {
      items.push("El modelo local no respondió; se usó fallback local.");
    }
    return Array.from(new Set(items));
  }, [lastResponse, status]);

  function clampImportance(value: string | number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(1, Math.min(5, Math.round(numeric)));
  }

  function previewAvatarEmotion(next: Emotion) {
    setAvatarPreviewEmotion(next);
    window.setTimeout(() => {
      setAvatarPreviewEmotion((current) => current === next ? null : current);
    }, 1800);
  }

  function previewAvatarSpeechMotion() {
    setAvatarSpeaking(true);
    setAvatarPreviewEmotion("happy");
    window.setTimeout(() => setAvatarSpeaking(false), 2200);
    window.setTimeout(() => setAvatarPreviewEmotion(null), 2400);
  }

  async function testAvatarSpeech() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    setVoiceLatency(null);
    setVoiceTestNotice("");
    setVoicePlaybackNotice("");
    const testText = `Hola, soy ${persona.name || "Yuko"}. Esta es mi voz de prueba para el avatar.`;
    setAvatarSpeaking(true);
    setAvatarPreviewEmotion("happy");
    try {
      await unlockAudio();
      setAudioUnlocked(true);
      const result = await testTts(testText, voiceChoice, voiceBackendChoice);
      setVoiceLatency(result.timings.ttsMs);
      setTts(result.status);
      if (voiceBackendChoice === "kokoro") setVoiceChoice(result.status.selectedVoiceId || voiceChoice);
      setVoiceNotice(result.fallbackUsed
        ? result.notice || "Kokoro no entregó audio; usando voz del navegador."
        : `Prueba AV generada con ${ttsEngineLabel(result.engine, false)} · voz ${result.voice || voiceChoice || "actual"}`);
      const testVoiceLabel = `${result.engine?.startsWith("kokoro") ? "Kokoro" : "navegador"}${result.voice ? ` · ${result.voice}` : ""}`;
      setVoiceTestNotice([
        `AV ${testVoiceLabel}`,
        result.timings.totalTtsMs !== undefined ? `total ${formatDuration(result.timings.totalTtsMs)}` : ""
      ].filter(Boolean).join(" · "));
      if (result.audio) {
        const audio = new Audio(`data:${result.audio.mimeType};base64,${result.audio.base64}`);
        audio.onended = () => setAvatarSpeaking(false);
        audio.onerror = () => {
          setAvatarSpeaking(false);
          setVoicePlaybackNotice("No pude reproducir el audio de prueba AV.");
        };
        await audio.play();
      } else {
        await playBrowserVoice(testText, voiceChoice);
      }
    } catch (error) {
      setAvatarSpeaking(false);
      setVoicePlaybackNotice(error instanceof Error ? error.message : "No pude reproducir la prueba AV.");
    } finally {
      setVoiceBusy(false);
      window.setTimeout(() => setAvatarPreviewEmotion(null), 400);
    }
  }

  async function shutdownFromDashboard() {
    if (shutdownBusy) return;
    setShutdownBusy(true);
    setShutdownConfirm(false);
    setShutdownNotice("");
    setVoiceNotice("Apagando MiVtuberIA...");
    stopSpeech();
    setAvatarSpeaking(false);
    try {
      await shutdownLuma();
      setShutdownNotice("Apagando todo...");
    } catch (error) {
      setVoiceNotice(error instanceof Error ? error.message : "No pude ejecutar Stop-Luma.");
      setShutdownNotice(error instanceof Error ? error.message : "No pude ejecutar Stop-Luma.");
      setShutdownBusy(false);
    }
  }

  function acceptSetup(nextTab?: ControlTab) {
    localStorage.setItem(SETUP_ACCEPTED_KEY, "true");
    setSetupTermsAccepted(true);
    setSetupAccepted(true);
    if (nextTab) setActiveControlTab(nextTab);
  }

  async function persistScene(nextScene = sceneRef.current, options: { quiet?: boolean } = {}) {
    const scrollTop = options.quiet ? null : captureControlScroll();
    if (sceneAutosaveTimerRef.current) {
      window.clearTimeout(sceneAutosaveTimerRef.current);
      sceneAutosaveTimerRef.current = null;
    }
    if (sceneBusyRef.current) {
      scenePendingSaveRef.current = nextScene;
      return;
    }
    const saveVersion = sceneSaveVersionRef.current;
    sceneBusyRef.current = true;
    setSceneBusy(true);
    if (!options.quiet) setSceneNotice("");
    try {
      const payload = await saveScene(nextScene);
      if (sceneSaveVersionRef.current === saveVersion) {
        sceneDirtyRef.current = false;
        setScene(payload.scene);
        sceneRef.current = payload.scene;
        setAvatarCamera(payload.scene.cameraPreset);
      }
      setSceneNotice(options.quiet ? "Escena guardada automáticamente." : "Escena guardada para OBS.");
    } catch (error) {
      setSceneNotice(error instanceof Error ? error.message : "No pude guardar la escena.");
    } finally {
      sceneBusyRef.current = false;
      setSceneBusy(false);
      const pending = scenePendingSaveRef.current;
      if (pending && sceneDirtyRef.current) {
        scenePendingSaveRef.current = null;
        scheduleSceneAutosave(pending, 120);
      }
      restoreControlScroll(scrollTop);
    }
  }

  async function uploadSceneBackground(file: File) {
    const scrollTop = captureControlScroll();
    if (sceneBusy) return;
    if (sceneAutosaveTimerRef.current) {
      window.clearTimeout(sceneAutosaveTimerRef.current);
      sceneAutosaveTimerRef.current = null;
    }
    setSceneBusy(true);
    setSceneNotice("");
    try {
      const payload = await uploadBackground(file);
      setBackgrounds(payload.items || []);
      sceneDirtyRef.current = false;
      scenePendingSaveRef.current = null;
      setScene(payload.scene);
      sceneRef.current = payload.scene;
      setSceneNotice("Fondo guardado y aplicado.");
    } catch (error) {
      setSceneNotice(error instanceof Error ? error.message : "No pude subir ese fondo.");
    } finally {
      setSceneBusy(false);
      restoreControlScroll(scrollTop);
    }
  }

  function updateSceneLocal(updates: Partial<SceneSettings>, autosave = true) {
    setScene((current) => {
      const next = normalizeSceneClient({ ...current, ...updates, mode: "scene16x9" as const });
      sceneDirtyRef.current = true;
      sceneSaveVersionRef.current += 1;
      sceneRef.current = next;
      if (updates.cameraPreset) setAvatarCamera(updates.cameraPreset);
      if (autosave) scheduleSceneAutosave(next);
      return next;
    });
  }

  function scheduleSceneAutosave(nextScene: SceneSettings, delayMs = 650) {
    if (sceneAutosaveTimerRef.current) window.clearTimeout(sceneAutosaveTimerRef.current);
    if (delayMs > 200) setSceneNotice("Cambios pendientes de guardado...");
    sceneAutosaveTimerRef.current = window.setTimeout(() => {
      sceneAutosaveTimerRef.current = null;
      void persistScene(nextScene, { quiet: true });
    }, delayMs);
  }

  function captureControlScroll() {
    return controlScrollRef.current?.scrollTop ?? null;
  }

  function restoreControlScroll(scrollTop: number | null) {
    if (scrollTop === null) return;
    window.requestAnimationFrame(() => {
      if (controlScrollRef.current) controlScrollRef.current.scrollTop = scrollTop;
    });
  }

  if (viewerOnly) {
    const background = findBackground(backgrounds, scene.activeBackground);
    return (
      <main className="viewer sceneViewer">
        <div className="viewerBackground" style={backgroundStyle(background)} />
        {scene.referenceImage?.visible && <SceneReferenceOverlay image={scene.referenceImage} />}
        <Suspense fallback={<AvatarLoading compact />}>
          <AvatarStage
            key={activeAvatarUrl}
            emotion={avatarPreviewEmotion || emotion}
            emotionIntensity={avatarPreviewEmotion ? 8 : emotionIntensity}
            signal={avatarSignal}
            compact
            speaking={avatarSpeaking}
            cameraPreset={scene.cameraPreset}
            scene={scene}
            defaultAvatarPath={backendAssetUrl(activeAvatarUrl)}
          />
        </Suspense>
        {guardViewerNotice && <div className="guardOverlay">{guardViewerNotice.text}</div>}
        {scene.captionVisible && (
          <div className="caption">
            <strong>{persona.name}</strong>
            <span>{lastResponse?.text || "Esperando mensaje..."}</span>
          </div>
        )}
      </main>
    );
  }

  if (!setupAccepted) {
    return (
      <SystemSetupPanel
        activeAvatarUrl={activeAvatarUrl}
        avatarStatus={avatarStatus}
        mode="onboarding"
        models={models}
        setupAccepted={setupAccepted}
        status={status}
        statusError={systemStatusError}
        termsAccepted={setupTermsAccepted}
        tts={tts}
        onAcceptTerms={setSetupTermsAccepted}
        onContinue={() => acceptSetup()}
        onRefresh={() => void refresh()}
      />
    );
  }

  const activeProviderRaw = String(status?.runtime.llmProvider || "").toLowerCase();
  const modelName = activeProviderRaw === "gemini"
    ? (status?.runtime.geminiModel || "Gemini (nube)")
    : activeProviderRaw === "ollama"
      ? (status?.runtime.ollamaModel || "...")
      : (status?.runtime.lmStudioModel || status?.runtime.ollamaModel || "...");
  const latency = lastResponse ? formatDuration(lastResponse.timings.totalMs) : voiceLatency !== null ? formatDuration(voiceLatency) : "...";
  const llmLatency = lastResponse ? formatDuration(lastResponse.timings.llmMs) : "...";
  const voiceLatencyLabel = lastResponse?.timings.speechPlaybackMs !== undefined
    ? formatDuration(lastResponse.timings.speechPlaybackMs)
    : lastResponse?.timings.speechStartDelayMs !== undefined
      ? `inicia ${formatDuration(lastResponse.timings.speechStartDelayMs)}`
      : "...";
  const voiceOptions = voiceBackendChoice === "kokoro"
    ? (tts?.availableVoices?.length ? tts.availableVoices : tts?.voices || [])
    : browserVoices;
  const selectedVoice = voiceOptions.find((voice) => voice.id === voiceChoice);
  // Backend de voz realmente guardado/en uso por Yuko (solo uno). Sirve para marcar la
  // ÚNICA voz "en uso" en verde y diferenciarla de la voz que estás seleccionando para probar.
  const savedVoiceBackend = tts?.provider === "kokoro" ? "kokoro" : "browser";
  const liveVoiceSource = voiceBackendChoice === "kokoro" && tts?.activeBackend === "kokoro"
    ? `Kokoro · ${tts.kokoroVoice || selectedVoice?.name || voiceChoice || "voz local"}`
    : `navegador${selectedVoice?.name ? ` · ${selectedVoice.name}` : ""}`;
  const voiceStatusLabel = voiceBackendChoice === "kokoro" && tts?.activeBackend === "kokoro"
    ? `TTS local activo · Kokoro ONNX · voz ${tts.kokoroVoice}`
    : voiceBackendChoice === "kokoro" && tts?.localAvailable
      ? "Kokoro ONNX disponible · guarda una voz para activarlo"
      : voiceBackendChoice === "kokoro" && tts?.fallbackReason
        ? "Kokoro no disponible · usando navegador"
    : tts?.provider === "kokoro" && tts.fallbackReason
      ? `Kokoro no disponible · usando navegador`
      : audioUnlocked
        ? "voz navegador activa"
        : "voz navegador";
  const voiceDetailText = voiceBackendChoice === "kokoro" && tts?.localAvailable
    ? `Worker ${tts.kokoro?.workerReady ? "listo" : "se calienta al primer audio"} · velocidad ${tts.kokoroSpeed}`
    : tts?.fallbackReason || "SpeechSynthesis del navegador. La lista depende de las voces instaladas en Windows/navegador.";
  const latestVisualImage = visualLastFrame || activeVisualImage;
  const currentHost = window.location.host || "127.0.0.1:5173";
  const stageEmotion = avatarPreviewEmotion || emotion;
  const stageEmotionIntensity = avatarPreviewEmotion ? 8 : emotionIntensity;
  const activeBackground = findBackground(backgrounds, scene.activeBackground);
  const assistantName = persona.name || "Yuko";
  const canSubmitChat = Boolean(input.trim()) && !busy;

  // Panel de memoria manual compartido: se monta en la pestaña Memoria y, por ahora,
  // también dentro de Persona (ahí se retira en la Etapa 3 del rediseño).
  const memoryPanel = (
    <MemoryTab
      assistantName={assistantName}
      busy={memoryBusy}
      memories={memories}
      newImportance={newImportance}
      newMemory={newMemory}
      onArchive={(id) => void archiveMemoryItem(id)}
      onEditContent={(id, content) => setMemories((current) => current.map((item) => item.id === id ? { ...item, content } : item))}
      onEditImportance={(id, raw) => setMemories((current) => current.map((item) => item.id === id ? { ...item, importance: clampImportance(raw) } : item))}
      onNewImportanceChange={(raw) => setNewImportance(clampImportance(raw))}
      onNewMemoryChange={setNewMemory}
      onRemove={(id) => void removeMemory(id)}
      onSave={(memory) => void saveMemory(memory)}
      onSubmit={addMemory}
    />
  );
  const activeProvider = status?.runtime.llmProvider || "lmstudio";
  const selectedProviderRaw = runtimeDraftProvider || activeProvider;
  const selectedProvider = ["lmstudio", "gemini", "auto", "ollama"].includes(selectedProviderRaw) ? selectedProviderRaw : "lmstudio";
  const activeBaseUrl = status?.runtime.lmStudioBaseUrl || "";
  const selectedBaseUrl = runtimeDraftBaseUrl || activeBaseUrl;
  const runtimeDraftDirty = Boolean(status && (
    selectedProvider !== activeProvider
    || selectedBaseUrl !== activeBaseUrl
    || (modelChoice && modelChoice !== status.runtime.lmStudioModel)
  ));
  const loadedChatModels = models.filter((model) => model.loaded).map((model) => model.id);
  const lastInferenceModel = status?.runtime.lastLlmSuccess?.model || lastResponse?.model || "";
  // Comparar contra el modelo del PROVEEDOR activo (modelName es provider-aware); comparar
  // siempre contra lmStudioModel daba falsos "pendiente" cuando el proveedor era Gemini.
  const lastInferenceStale = Boolean(modelName && modelName !== "..." && lastInferenceModel && lastInferenceModel !== modelName);
  const modelMismatchWarning = lastInferenceStale
    ? `La ultima inferencia uso ${lastInferenceModel}, pero el modelo configurado ahora es ${modelName}. Envia un mensaje de prueba para verificar el cambio.`
    : "";
  const loadedModelWarning = loadedChatModels.length > 1
    ? `LM Studio tiene varios modelos chat cargados: ${loadedChatModels.join(", ")}. La RAM puede seguir alta si alguno no se pudo descargar.`
    : "";
  const fallbackActive = lastResponse?.provider === "fallback";
  const realLlmReady = Boolean(!lastInferenceStale && (status?.runtime.lastLlmSuccess?.provider === "lmstudio" || status?.runtime.lastLlmSuccess?.provider === "gemini" || status?.runtime.lastLlmSuccess?.provider === "ollama" || (serverRunning && !fallbackActive && status?.runtime.lmStudioModel)));
  const twitchReady = Boolean(twitchStatus?.connected);
  const viewerReady = Boolean(status);
  const speakerReady = audioUnlocked;
  const readyItems = [
    { label: "Backend local respondiendo", ok: Boolean(status), warn: false, note: status ? `${status.runtime.port} online` : "sin estado" },
    { label: "Modelo real", ok: realLlmReady && !fallbackActive, warn: fallbackActive || !realLlmReady, note: fallbackActive ? "fallback" : modelName },
    { label: "Audio activado", ok: audioUnlocked, warn: !audioUnlocked, note: audioUnlocked ? "listo" : "pulsa activar" },
    { label: "Twitch conectado", ok: twitchReady, warn: !twitchReady, note: twitchStatusLabel(twitchStatus) },
    { label: "Viewer OBS", ok: viewerReady, warn: false, note: "/viewer" },
    { label: "Speaker OBS", ok: speakerReady, warn: !speakerReady, note: "/speaker" },
    { label: "Prueba de respuesta", ok: Boolean(lastResponse && !fallbackActive), warn: Boolean(lastResponse && fallbackActive), note: lastResponse ? `${lastResponse.provider}` : "no verificado" }
  ];

  return (
    <main className="cockpitShell">
      <Sidebar
        activeTab={activeControlTab}
        liveActive={Boolean(twitchStatus?.connected || tikfinityState?.status === "connected")}
        mobileOpen={sidebarOpen}
        modelLabel={fallbackActive ? "Fallback activo" : realLlmReady ? modelName : "Modelo pendiente"}
        personaName={assistantName}
        ready={Boolean(status)}
        warning={fallbackActive || !audioUnlocked}
        onMobileClose={() => setSidebarOpen(false)}
        onSelect={setActiveControlTab}
      />
      <div className="cockpitWorkspace">
        <CockpitShellTopBar
          host={currentHost}
          mobileMenuOpen={sidebarOpen}
          serverReady={Boolean(status)}
          modelReady={realLlmReady}
          fallbackActive={fallbackActive}
          modelLabel={fallbackActive ? "Fallback activo" : realLlmReady ? `última ${latency}` : "No verificado"}
          twitchReady={twitchReady}
          audioReady={audioUnlocked}
          viewerReady={viewerReady}
          speakerReady={speakerReady}
          shutdownBusy={shutdownBusy}
          shutdownConfirm={shutdownConfirm}
          notice={shutdownNotice}
          onAskShutdown={() => setShutdownConfirm(true)}
          onCancelShutdown={() => setShutdownConfirm(false)}
          onConfirmShutdown={shutdownFromDashboard}
          onToggleMobileMenu={() => setSidebarOpen((current) => !current)}
        />

      <div ref={dashboardScrollRef} className={`dashboardGrid cockpitGrid section-${activeControlTab}`}>
        <section className="heroPanel livePreviewCard cockpitCard liveStageLeft">
          <div className="livePreviewStage">
            <div className="preview__grid" />
            <div className="preview__scan" />
            <div className="livePreviewChrome livePreviewChrome--top">
              <span className="dot" /> 1080p · 30fps
            </div>
            <div className="avatarFrame liveAvatarFrame">
              <Suspense fallback={<AvatarLoading />}>
                <AvatarStage
                  key={activeAvatarUrl}
                  emotion={stageEmotion}
                  emotionIntensity={stageEmotionIntensity}
                  signal={avatarSignal}
                  speaking={avatarSpeaking}
                  cameraPreset={avatarCamera}
                  scene={scene}
                  vrmFile={avatarVrmFile}
                  defaultAvatarPath={backendAssetUrl(activeAvatarUrl)}
                  onStatusChange={setAvatarStatus}
                />
              </Suspense>
              {scene.referenceImage?.visible && <SceneReferenceOverlay image={scene.referenceImage} compact />}
            </div>
            <div className="livePreviewChrome livePreviewChrome--bottom">
              <span>Cámara {avatarCamera === "bust" ? "Busto" : avatarCamera === "full" ? "Completo" : avatarCamera === "obs" ? "OBS" : "Medio"}</span>
              <span>·</span>
              <span>lip-sync: {avatarStatus.supportsLipSync ? "avatar" : "pendiente"}</span>
            </div>
          </div>

          <div className="liveAvatarCard">
            <header className="liveCardHeader">
              <Icon name="avatar" size={17} />
              <div>
                <strong>Avatar</strong>
                <span>{avatarStatus.hasVrm ? "VRM cargado" : "avatar temporal"}</span>
              </div>
            </header>
            <div className="liveFileReadout">{avatarVrmFile?.name || activeAvatarUrl || "Sin VRM definitivo"}</div>
            <div className="liveAvatarActions">
              <label className="btn btn--ghost liveUploadButton">
                <Icon name="avatar" size={15} />
                Cargar VRM
                <input
                  type="file"
                  accept=".vrm"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void persistAvatarFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button className="btn btn--ghost" type="button" title="Probar voz real del avatar" disabled={voiceBusy} onClick={() => void testAvatarSpeech()}>
                <Icon name="speaker" size={15} />
                {voiceBusy ? "Probando" : "Probar voz"}
              </button>
            </div>
            <div className="liveObsActions">
              <button className="btn btn--ghost" type="button" onClick={() => openPreview("viewer")}>
                <Icon name="monitor" size={15} />
                Viewer
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => openPreview("speaker")}>
                <Icon name="speaker" size={15} />
                Speaker
              </button>
            </div>
            {avatarNotice && <p className="sceneHint">{avatarNotice}</p>}
          </div>

          <ReadyForStreamCard items={readyItems} fallbackActive={fallbackActive} />
          <ModelStatusCard
            model={modelName}
            mode={lastResponse ? chatActionLabel(lastResponse.action) : safetyModeLabel(mode)}
            latency={latency}
            llmLatency={llmLatency}
            voiceLatency={voiceLatencyLabel}
            context={`${guard?.queueLength ?? 0} en cola`}
            emotion={emotionLabel(stageEmotion)}
            intensity={`${stageEmotionIntensity}/10`}
          />
        </section>

        <section className="chatPanel consoleCard cockpitCard liveConsole" data-mode={chatMode}>
          <div className="liveConsoleTabs" role="tablist" aria-label="Modo de consola en vivo">
            <button
              aria-selected={chatMode === "admin"}
              className={`liveConsoleTab liveConsoleTab--admin ${chatMode === "admin" ? "active" : ""}`}
              onClick={() => setChatMode("admin")}
              role="tab"
              type="button"
            >
              <span className="liveConsoleTabIcon">⌘</span>
              <span>
                <strong>Administrador</strong>
                <small>línea directa con Yuko</small>
              </span>
              <em>{messages.filter((message) => message.author === "Administrador" || message.meta?.includes("Administrador")).length || messages.length}</em>
            </button>
            <button
              aria-selected={chatMode === "stream"}
              className={`liveConsoleTab liveConsoleTab--stream ${chatMode === "stream" ? "active" : ""}`}
              onClick={() => setChatMode("stream")}
              role="tab"
              type="button"
            >
              <span className="liveConsoleTabIcon">
                <Icon name="viewers" size={15} />
              </span>
              <span>
                <strong>Chat del directo</strong>
                <small>espectadores · pasa por guardia</small>
              </span>
              <em>{guard?.queueLength ?? 0}</em>
            </button>
            <div className="liveConsoleOverflow">
              <button
                aria-expanded={liveConsoleMenuOpen}
                aria-label="Más acciones de consola"
                className="icon-btn"
                onClick={() => setLiveConsoleMenuOpen((current) => !current)}
                type="button"
              >
                ···
              </button>
              {liveConsoleMenuOpen && (
                <div className="liveConsoleMenu">
                  <button type="button" onClick={() => { setLiveConsoleMenuOpen(false); void activateVoice(); }}>
                    <Icon name="speaker" size={15} />
                    {audioUnlocked ? "Audio ya activo" : `Activar audio de ${persona.name || "Yuko"}`}
                  </button>
                  <button type="button" onClick={async () => { setLiveConsoleMenuOpen(false); stopSpeech(); await silenceNow(); await refresh(); }}>
                    <Icon name="power" size={15} />
                    Silenciar ahora
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className={`liveConsoleBanner ${chatMode === "stream" ? "stream" : "admin"}`}>
            {chatMode === "admin" ? (
              <>
                <span>⌘</span>
                Solo lo ves tú. Yuko responde aquí en privado y reconoce tus órdenes.
              </>
            ) : (
              <>
                <Icon name="safety" size={14} />
                Mensaje de espectador: entra por moderación, cola y guardia antes de que Yuko responda.
              </>
            )}
          </div>

          {voicePlaybackNotice && <p className="chatNotice">{voicePlaybackNotice}</p>}
          {imageNotice && <p className="chatNotice">{imageNotice}</p>}

          <div className="messages liveConsoleMessages">
            {messages.map((message, index) => (
              <ChatMessage
                key={`${message.role}-${index}`}
                message={message}
                personaName={persona.name || "Yuko"}
                onReplay={(response) => replaySpeech(response)}
                onUseImageInScene={(item) => void useChatImageInScene(item)}
                onNarrateImage={(item, mode) => void narrateChatImage(item, mode)}
                onRemoveImage={removeChatImage}
              />
            ))}
            {!messages.length && (
              <div className="emptyChat">
                <strong>Sistema listo para pruebas</strong>
                <span>Administrador habla directo y sin límite. Chat del directo pasa por guardia, cola y seguridad.</span>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="chatComposer liveComposer">
            {pendingImage && (
              <div className="attachedImagePreview">
                <img src={pendingImage.previewUrl} alt="" />
                <span>Imagen lista para Yuko y overlay OBS: {pendingImage.fileName}</span>
                <button type="button" onClick={() => { setPendingImage(null); setImageNotice(""); }}>Quitar</button>
              </div>
            )}
            {chatMode === "stream" && (
              <label className="streamUserField">
                Usuario simulado
                <input value={streamUser} onChange={(event) => setStreamUser(event.target.value)} placeholder="viewer" disabled={busy} />
                <small>Solo afecta mensajes enviados desde este simulador. Twitch usa usuarios reales.</small>
              </label>
            )}
            <div className="composerField">
              <textarea
                value={input}
                maxLength={chatMode === "stream" ? 2000 : undefined}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={chatMode === "admin"
                  ? personaEnabled ? `Habla con ${persona.name || "Yuko"} como administrador...` : "Pregunta a Gemma normal sin personalidad..."
                  : "Simula un mensaje del chat del directo..."}
                disabled={busy}
              />
            </div>
            <div className="composerActions">
              <button
                type="button"
                className={`toolButton personaModeButton ${personaEnabled ? "active" : ""}`}
                title={personaEnabled ? "Personalidad Yuko activa. Cambiar a Gemma normal." : "Gemma normal activo. Reactivar personalidad Yuko."}
                onClick={() => setPersonaEnabled((current) => !current)}
              >
                {personaEnabled ? "Yuko" : "Gemma"}
              </button>
              <label className="toolButton imageToolButton" title="Subir imagen para Yuko">
                <Icon name="image" size={17} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void attachChatImage(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button className="sendButton" disabled={!canSubmitChat}>{busy ? "Pensando" : <><Icon name="send" size={17} /> Enviar</>}</button>
            </div>
            <div className="liveComposerHints">
              <span>Enter enviar · Shift+Enter nueva línea</span>
              <span>{chatMode === "admin" ? "sin límite · privado con Yuko" : `${input.length} / 2000 · directo con guardia`}</span>
            </div>
          </form>
        </section>

        <aside className="controlPanel operatorPanel" ref={controlScrollRef}>
          {activeControlTab !== "live" && (
            <div className="operatorHeader">
              <span>{workspaceTitle(activeControlTab)}</span>
              <strong>{fallbackActive ? "Revisar modelo" : status ? "Operativo" : "Inicializando"}</strong>
            </div>
          )}

          <div className={activeControlTab === "live" ? "controlTabBody liveRailStack" : "controlTabBody"}>
            {activeControlTab === "live" && (
              <LiveTab
                guard={guard}
                latestVisualImage={latestVisualImage}
                referenceImage={scene.referenceImage}
                referenceImageAvailable={referenceImageAvailable}
                visualAutoEnabled={visualAutoEnabled}
                visualAutoIntervalSeconds={visualAutoIntervalSeconds}
                visualAutoNarrationEnabled={visualAutoNarrationEnabled}
                visualBusy={visualNarrationBusy}
                visualCaptureBusy={visualCaptureBusy}
                visualLastAnalysisAt={visualLastAnalysisAt}
                visualLastChangeScore={visualLastChangeScore}
                visualLastFrameAt={visualLastFrameAt}
                visualNotice={visualNarrationNotice}
                visualVisionState={visualVisionState}
                voiceActive={avatarSpeaking || (tts?.ready ?? false) || audioUnlocked}
                voiceSource={liveVoiceSource}
                voiceSpeaking={avatarSpeaking}
                voiceTestNotice={voiceTestNotice}
                onCapture={(mode) => void narrateScreenCapture(mode)}
                onClearReference={(deleteFile) => void clearReferenceImage(deleteFile)}
                onIntervalChange={(value) => setVisualAutoIntervalSeconds(normalizeVisualIntervalSeconds(value))}
                onStartAuto={() => void startVisualAuto()}
                onStopAuto={() => stopVisualAuto()}
                onToggleAutoNarration={setVisualAutoNarrationEnabled}
              />
            )}

            {activeControlTab === "safety" && (
              <SafetyTab mode={mode} guard={guard} onChangeMode={(item) => void updateMode(item)} />
            )}

            {activeControlTab === "scene" && (
              <SceneTab
                scene={scene}
                backgrounds={backgrounds}
                activeBackground={activeBackground}
                busy={sceneBusy}
                notice={sceneNotice}
                onUpdate={updateSceneLocal}
                onSave={() => void persistScene()}
                onReset={() => {
                  const scrollTop = captureControlScroll();
                  sceneDirtyRef.current = true;
                  sceneSaveVersionRef.current += 1;
                  sceneRef.current = defaultScene;
                  setScene(defaultScene);
                  setAvatarCamera(defaultScene.cameraPreset);
                  void persistScene(defaultScene);
                  restoreControlScroll(scrollTop);
                }}
                onUpload={(file) => void uploadSceneBackground(file)}
                onOpenPreview={openPreview}
              />
            )}

            {activeControlTab === "avatar" && (
              <AvatarTab
                avatarNotice={avatarNotice}
                camera={avatarCamera}
                emotion={stageEmotion}
                intensity={stageEmotionIntensity}
                signal={avatarSignal}
                speaking={avatarSpeaking}
                status={avatarStatus}
                vtsBusy={vtsBusy}
                vtsHotkeys={vtsHotkeys}
                vtsNotice={vtsNotice}
                vtsStatus={vtsStatus}
                onCameraChange={(camera) => updateSceneLocal({ cameraPreset: camera })}
                onEmotionPreview={previewAvatarEmotion}
                onSpeechTest={previewAvatarSpeechMotion}
                onUploadVrm={(file) => void persistAvatarFile(file)}
                onVtsConnect={() => void handleVtsConnect()}
                onVtsDisconnect={() => void handleVtsDisconnect()}
                onVtsMap={(emotion, hotkey) => void handleVtsMap(emotion, hotkey)}
                onVtsRefreshHotkeys={() => void refreshVts()}
                onVtsTest={(emotion) => void handleVtsTest(emotion)}
              />
            )}

            {activeControlTab === "persona" && (
              <PersonaTab
                assistantName={assistantName}
                persona={persona}
                personaEnabled={personaEnabled}
                personaNotice={personaNotice}
                onPersonaEnabledChange={setPersonaEnabled}
                onPersonaFieldChange={(field, value) => setPersona({ ...persona, [field]: value })}
                onSavePersona={() => void updatePersona()}
              />
            )}

            {activeControlTab === "memory" && memoryPanel}

            {activeControlTab === "voice" && (
              <VoiceTab
                assistantName={assistantName}
                audioUnlocked={audioUnlocked}
                savedVoiceBackend={savedVoiceBackend}
                selectedVoice={selectedVoice}
                tts={tts}
                voiceBackendChoice={voiceBackendChoice}
                voiceBusy={voiceBusy}
                voiceChoice={voiceChoice}
                voiceDetailText={voiceDetailText}
                voiceLatency={voiceLatency}
                voiceNotice={voiceNotice}
                voiceOptions={voiceOptions}
                voicePlaybackNotice={voicePlaybackNotice}
                voiceStatusLabel={voiceStatusLabel}
                voiceTestNotice={voiceTestNotice}
                voiceVolume={voiceVolume}
                onActivateVoice={() => void activateVoice()}
                onApplyVoice={() => void applyVoice()}
                onPlayVoiceTest={() => void playVoiceTest()}
                onSelectBrowserBackend={() => { setVoiceBackendChoice("browser"); setVoiceChoice(localStorage.getItem("mivtuberia.browserVoiceId") || ""); setVoiceNotice(""); setVoiceTestNotice(""); }}
                onSelectKokoroBackend={() => { setVoiceBackendChoice("kokoro"); setVoiceChoice(tts?.selectedVoiceId || tts?.availableVoices?.[0]?.id || tts?.voices[0]?.id || ""); setVoiceNotice(""); setVoiceTestNotice(""); }}
                onVoiceChoiceChange={setVoiceChoice}
                onVoiceVolumeChange={(pct) => {
                  setVoiceVolumeState(pct);
                  setVoiceVolume(pct / 100);
                }}
              />
            )}

            {activeControlTab === "model" && (
              <ModelTab
                activeProvider={activeProvider}
                activeProviderRaw={activeProviderRaw}
                assistantName={assistantName}
                geminiModelChoice={geminiModelChoice}
                geminiModels={geminiModels}
                geminiModelsNotice={geminiModelsNotice}
                lastInferenceStale={lastInferenceStale}
                lastResponse={lastResponse}
                loadedChatModels={loadedChatModels}
                loadedModelWarning={loadedModelWarning}
                modelBusy={modelBusy}
                modelChoice={modelChoice}
                modelMismatchWarning={modelMismatchWarning}
                modelName={modelName}
                modelNotice={modelNotice}
                models={models}
                runtimeDraftDirty={runtimeDraftDirty}
                selectedBaseUrl={selectedBaseUrl}
                selectedProvider={selectedProvider}
                serverRunning={serverRunning}
                status={status}
                geminiKeyConfigured={Boolean(secretsStatus?.GEMINI_API_KEY)}
                secretsBusy={secretsBusy}
                secretsNotice={secretsNotice}
                onSaveGeminiKey={(key) => saveSecretsFromUi({ GEMINI_API_KEY: key }, "API key de Gemini guardada.")}
                onApplyActiveModel={() => void applyActiveModel()}
                onApplyModel={() => void applyModel()}
                onBaseUrlChange={setRuntimeDraftBaseUrl}
                onGeminiModelChange={setGeminiModelChoice}
                onModelChoiceChange={setModelChoice}
                onProviderChange={setRuntimeDraftProvider}
                onUpdateRuntimeBase={() => void updateRuntimeBase()}
              />
            )}

            {activeControlTab === "viewers" && (
              <ViewersTab
                assistantName={assistantName}
                autonomyBusy={autonomyBusy}
                autonomyNotice={autonomyNotice}
                autonomyState={autonomyState}
                modelName={modelName}
                selectedStreamUser={selectedStreamUser}
                status={status}
                streamHistoryNotice={streamHistoryNotice}
                streamUserMessages={streamUserMessages}
                streamUserQuery={streamUserQuery}
                streamUsers={streamUsers}
                tikfinityBusy={tikfinityBusy}
                tikfinityKeywords={tikfinityKeywords}
                tikfinityNotice={tikfinityNotice}
                tikfinityState={tikfinityState}
                tikfinityWsUrl={tikfinityWsUrl}
                twitchBusy={twitchBusy}
                twitchNotice={twitchNotice}
                twitchStatus={twitchStatus}
                twitchStatusLabel={twitchStatusLabel(twitchStatus)}
                twitchCredsConfigured={{
                  channel: Boolean(secretsStatus?.TWITCH_CHANNEL),
                  botUsername: Boolean(secretsStatus?.TWITCH_BOT_USERNAME),
                  oauthToken: Boolean(secretsStatus?.TWITCH_OAUTH_TOKEN)
                }}
                onAutonomyTrigger={() => void handleAutonomyTrigger()}
                onConnectTikfinity={() => void handleConnectTikfinity()}
                onConnectTwitch={() => void handleConnectTwitch()}
                onDisconnectTikfinity={() => void handleDisconnectTikfinity()}
                onDisconnectTwitch={() => void handleDisconnectTwitch()}
                onOpenPreview={openPreview}
                onRefreshStreamUserMessages={(userId) => void refreshStreamUserMessages(userId)}
                onSaveAutonomyConfig={(updates) => void saveAutonomyConfig(updates)}
                onSaveTikfinityConfig={(updates) => void saveTikfinityConfig(updates)}
                onSearchStreamUsers={() => void handleSearchStreamUsers()}
                onSelectStreamUser={(user) => void selectStreamUser(user)}
                onStreamUserQueryChange={setStreamUserQuery}
                onTikfinityKeywordsChange={setTikfinityKeywords}
                onTikfinityTestEvent={() => void handleTikfinityTestEvent()}
                onTikfinityWsUrlChange={setTikfinityWsUrl}
              />
            )}

            {activeControlTab === "logs" && <LogsTab logs={logs} />}

            {activeControlTab === "settings" && (
              <SettingsTab
                activeAvatarUrl={activeAvatarUrl}
                avatarStatus={avatarStatus}
                currentHost={currentHost}
                models={models}
                setupAccepted={setupAccepted}
                status={status}
                statusError={systemStatusError}
                termsAccepted={setupTermsAccepted}
                tts={tts}
                onAcceptTerms={setSetupTermsAccepted}
                onContinue={() => acceptSetup()}
                secretsBusy={secretsBusy}
                secretsNotice={secretsNotice}
                secretsStatus={secretsStatus}
                onSaveSecrets={saveSecretsFromUi}
                onRefresh={() => void refresh()}
              />
            )}
          </div>
        </aside>
      </div>
      </div>
    </main>
  );
}

// request() lanza el cuerpo crudo de la respuesta; si es JSON con {error}, extraerlo.
function apiErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (parsed?.error) return String(parsed.error);
  } catch {
    // texto plano: usarlo tal cual
  }
  return raw || fallback;
}

function workspaceTitle(tab: ControlTab) {
  const labels: Record<ControlTab, string> = {
    live: "Live",
    scene: "Escena / OBS",
    avatar: "Avatar",
    voice: "Voz / Audio",
    model: "Modelo / Cerebro",
    persona: "Persona",
    memory: "Memoria",
    safety: "Safety / Guardia",
    viewers: "Directo / Entradas",
    logs: "Registros",
    settings: "Ajustes"
  };
  return labels[tab];
}

function ReadyForStreamCard({ items, fallbackActive }: {
  items: Array<{ label: string; ok: boolean; warn: boolean; note: string }>;
  fallbackActive: boolean;
}) {
  const hardMissing = items.filter((item) => !item.ok && !item.warn).length;
  const warnings = items.filter((item) => item.warn).length;
  const pending = hardMissing + warnings + (fallbackActive ? 1 : 0);
  const title = pending ? "Casi listo" : "Listo para stream";
  return (
    <div className={`readyChecklist cockpitCard ${hardMissing ? "error" : warnings || fallbackActive ? "warn" : "ok"} liveReadyCard`}>
      <div className="readyHeader">
        <div>
          <strong>{title}</strong>
          <span>{pending ? `${pending} pendiente${pending === 1 ? "" : "s"}` : "todo en orden"}</span>
        </div>
        <div className="readySeal">{pending ? "!" : "✓"}</div>
      </div>
      <div className="readyItems">
        {items.map((item) => (
          <div className={`readyItem ${item.ok ? "ok" : item.warn ? "warn" : "error"}`} key={item.label}>
            <span>{item.ok ? "✓" : item.warn ? "!" : "×"}</span>
            <strong>{item.label}</strong>
            <small>{item.note}</small>
          </div>
        ))}
        {fallbackActive && (
          <div className="readyItem warn">
            <span>!</span>
            <strong>Modelo en fallback</strong>
            <small>revisar proveedor</small>
          </div>
        )}
      </div>
    </div>
  );
}

function AvatarLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "avatarStage compact avatarStageLoading" : "avatarStage avatarStageLoading"}>
      {!compact && <div className="avatarBackdropPortrait" />}
      <div className="loadingPulse">
        <strong>Cargando avatar</strong>
        <span>Preparando escena 3D...</span>
      </div>
    </div>
  );
}

function SpeakerPage() {
  const [connected, setConnected] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  const [lastText, setLastText] = useState("Esperando respuestas de Yuko...");
  const [lastAudio, setLastAudio] = useState("Sin audio reproducido todavía.");
  const [lastError, setLastError] = useState("");
  const seenResponsesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ws = new WebSocket(eventsWebSocketUrl());
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => {
      setConnected(false);
      setLastError("No pude conectar con /events.");
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type !== "response" && data.type !== "response_audio") return;
      const response = data.payload as ChatResponse;
      if (!response?.id || seenResponsesRef.current.has(response.id)) return;
      if (data.type === "response" && response.ttsPending) return;
      seenResponsesRef.current.add(response.id);
      setLastText(response.text);
      enqueueSpeech(response);
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const onSpeech = (event: Event) => {
      const detail = (event as CustomEvent<{ state: "start" | "end"; responseId?: string }>).detail;
      if (detail?.state === "start") {
        setLastAudio(`Reproduciendo ${detail.responseId || "respuesta"}`);
        setLastError("");
      }
      if (detail?.state === "end") setLastAudio(`Último audio terminado ${formatShortTime()}`);
    };
    const onVoiceError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setLastError(detail?.message || "El navegador bloqueó el audio. Pulsa Activar audio de Yuko.");
    };
    const onAudioUnlocked = (event: Event) => {
      const detail = (event as CustomEvent<{ unlocked?: boolean }>).detail;
      setAudioUnlocked(Boolean(detail?.unlocked));
      if (detail?.unlocked) setLastError("");
    };
    window.addEventListener("luma:speech", onSpeech);
    window.addEventListener("luma:voice-error", onVoiceError);
    window.addEventListener("luma:audio-unlocked", onAudioUnlocked);
    return () => {
      window.removeEventListener("luma:speech", onSpeech);
      window.removeEventListener("luma:voice-error", onVoiceError);
      window.removeEventListener("luma:audio-unlocked", onAudioUnlocked);
    };
  }, []);

  async function activateSpeakerAudio() {
    try {
      await unlockAudio();
      setAudioUnlocked(true);
      setLastAudio("Audio activo. OBS ya puede capturar esta fuente.");
      setLastError("");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "No pude activar el audio de Yuko.");
    }
  }

  return (
    <main className="speakerPage">
      <section className="speakerCard">
        <div className="sectionTitle">
          <span>C</span>
          <div>
            <strong>Audio de Yuko</strong>
            <small>{connected ? "Conectado a eventos locales" : "Desconectado de eventos locales"}</small>
          </div>
        </div>
        <button className="primary" type="button" onClick={() => void activateSpeakerAudio()}>
          {audioUnlocked ? "Audio activo" : "Activar audio de Yuko"}
        </button>
        <div className="speakerStatusGrid">
          <StatusMetric label="Estado" value={connected ? "conectado" : "desconectado"} />
          <StatusMetric label="Audio" value={audioUnlocked ? "activo" : "bloqueado"} />
        </div>
        <div className="speakerReadout">
          <strong>Último texto recibido</strong>
          <p>{lastText}</p>
        </div>
        <div className="speakerReadout">
          <strong>Último audio</strong>
          <p>{lastAudio}</p>
        </div>
        {lastError && <p className="chatNotice error">{lastError}</p>}
      </section>
    </main>
  );
}

function normalizeAudioVisualDuration(response: ChatResponse) {
  const timingDuration = response.timings?.audioDurationMs || response.timings?.speechPlaybackMs;
  if (typeof timingDuration === "number" && Number.isFinite(timingDuration) && timingDuration >= 250 && timingDuration <= 60000) return Math.round(timingDuration);
  const wavDuration = response.audio ? readWavDurationMs(response.audio.base64) : undefined;
  if (wavDuration && wavDuration >= 250 && wavDuration <= 60000) return wavDuration;
  return 2500;
}

function readWavDurationMs(base64: string) {
  try {
    const binary = atob(base64);
    if (binary.length < 44 || binary.slice(0, 4) !== "RIFF" || binary.slice(8, 12) !== "WAVE") return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const view = new DataView(bytes.buffer);
    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let dataBytes = 0;
    while (offset + 8 <= view.byteLength) {
      const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (chunkId === "fmt " && chunkStart + 16 <= view.byteLength) {
        channels = view.getUint16(chunkStart + 2, true);
        sampleRate = view.getUint32(chunkStart + 4, true);
        bitsPerSample = view.getUint16(chunkStart + 14, true);
      }
      if (chunkId === "data") {
        dataBytes = chunkSize;
        break;
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    if (!bytesPerSecond || !dataBytes) return undefined;
    return Math.round((dataBytes / bytesPerSecond) * 1000);
  } catch {
    return undefined;
  }
}

function ModelStatusCard({ model, mode, latency, llmLatency, voiceLatency, context, emotion, intensity }: {
  model: string;
  mode: string;
  latency: string;
  llmLatency: string;
  voiceLatency: string;
  context: string;
  emotion: string;
  intensity: string;
}) {
  return (
    <div className="modelStatus glassCard">
      <h2>Estado del modelo</h2>
      <div className="metricGrid">
        <StatusMetric label="Modelo" value={model} />
        <StatusMetric label="Total" value={latency} />
        <StatusMetric label="LLM" value={llmLatency} />
        <StatusMetric label="Voz" value={voiceLatency} />
        <StatusMetric label="Modo" value={mode} />
        <StatusMetric label="Contexto" value={context} />
        <StatusMetric label="Emoción" value={emotion} />
        <StatusMetric label="Intensidad" value={intensity} />
      </div>
    </div>
  );
}

function SceneReferenceOverlay({ image, compact = false }: { image: NonNullable<SceneSettings["referenceImage"]>; compact?: boolean }) {
  return (
    <div
      className={compact ? "sceneReferenceOverlay compact" : "sceneReferenceOverlay"}
      style={referenceOverlayStyle(image)}
      aria-label={`Imagen de referencia ${image.name}`}
    >
      <img src={referenceImageSrc(image)} alt="" />
    </div>
  );
}

function ChatMessage({ message, personaName, onReplay, onUseImageInScene, onNarrateImage, onRemoveImage }: {
  message: ChatMessageItem;
  personaName: string;
  onReplay: (response: ChatResponse) => void;
  onUseImageInScene: (message: ChatMessageItem) => void;
  onNarrateImage: (message: ChatMessageItem, mode: VisualPromptMode) => void;
  onRemoveImage: (message: ChatMessageItem) => void;
}) {
  const isUser = message.role === "user";
  const author = message.author || (isUser ? "Administrador" : personaName);
  const avatar = message.avatar || author.slice(0, 1).toUpperCase() || "L";
  const showAuthor = !isUser || message.source === "twitch" || message.source === "guard" || author !== "Administrador";
  return (
    <article className={`message ${message.role} ${message.source ? `source-${message.source}` : ""}`}>
      {!isUser && <div className="messageAvatar">{avatar}</div>}
      <div className="messageStack">
        {showAuthor && <strong className="messageAuthor">{author}</strong>}
        <div className="bubble">
          {message.image && (
            <figure className="messageImage">
              <button type="button" className="messageImageButton" onClick={() => onNarrateImage(message, "look")} title="Pedir a Yuko que mire esta imagen">
                <img src={message.image.src} alt={message.image.name} />
              </button>
              <figcaption>{message.image.name}</figcaption>
              {message.image.attachment && (
                <div className="messageImageActions">
                  <button type="button" onClick={() => onUseImageInScene(message)}>Usar en escena</button>
                  <button type="button" onClick={() => onNarrateImage(message, "look")}>Mirar</button>
                  <button type="button" onClick={() => onNarrateImage(message, "narrate")}>Narrar</button>
                  {message.id && <button type="button" onClick={() => onRemoveImage(message)}>Quitar del chat</button>}
                </div>
              )}
            </figure>
          )}
          <p>{message.text}</p>
          <div className="messageMeta">
            {message.meta && <small title={message.response ? responseTimingTitle(message.response) : undefined}>{message.meta}</small>}
            <span>{formatMessageTime(message.createdAt)} {isUser ? "✓✓" : ""}</span>
            {!isUser && message.response && (
              <button type="button" title="Reproducir voz" aria-label="Reproducir voz" onClick={() => onReplay(message.response!)}>
                ▶
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function chatHistoryToMessage(item: ChatHistoryMessageItem, personaName: string): ChatMessageItem {
  const isUser = item.role === "user";
  const source = normalizeMessageSource(item.source);
  const response = isUser ? undefined : historyItemToResponse(item);
  const author = isUser ? authorForHistorySource(item.source) : personaName;
  return {
    id: String(item.id),
    role: item.role,
    text: item.content,
    createdAt: item.created_at,
    meta: response ? responseMeta(response) : historyItemMeta(item),
    author,
    avatar: isUser ? undefined : author.slice(0, 1).toUpperCase(),
    source,
    response
  };
}

function historyItemToResponse(item: ChatHistoryMessageItem): ChatResponse | undefined {
  const provider = normalizeHistoryProvider(item.provider || item.source);
  const model = typeof item.model === "string" ? item.model.trim() : "";
  const timings = parseHistoryTimings(item.timings_json, item.audio_kind);
  if (!provider || !model || !timings) return undefined;
  const { emotion, intensity } = parseHistoryEmotion(item.emotion, item.emotion_intensity);
  const action = normalizeHistoryAction(item.action);
  return {
    id: item.response_id || `history:${item.id}`,
    createdAt: item.created_at,
    text: item.content,
    emotion,
    emotionIntensity: intensity,
    action,
    approved: action === "speak",
    provider,
    model,
    timings,
    audio: null,
    notices: [],
    moderation: {
      decision: "allow",
      reason: "history",
      score: 0,
      source: item.source || provider
    }
  };
}

function parseHistoryTimings(raw?: string | null, audioKind?: string | null): ChatResponse["timings"] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const timings: Partial<ChatResponse["timings"]> = {};
    const numericKeys: Array<keyof ChatResponse["timings"]> = [
      "receivedToStartMs",
      "personaReadMs",
      "historyReadMs",
      "contextCompactMs",
      "memoryReadMs",
      "promptBuildMs",
      "llmMs",
      "llmHttpMs",
      "reasoningRepairMs",
      "lengthRepairMs",
      "responseExtractMs",
      "llmTraceSaveMs",
      "ttsMs",
      "firstAudioMs",
      "totalTtsMs",
      "messagePersistMs",
      "broadcastMs",
      "totalMs",
      "speechStartDelayMs",
      "speechPlaybackMs",
      "audioDurationMs"
    ];
    for (const key of numericKeys) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        (timings as Record<string, number>)[key] = value;
      }
    }
    const storedKind = typeof parsed.audioKind === "string" ? parsed.audioKind : audioKind;
    if (storedKind === "audio" || storedKind === "speechSynthesis" || storedKind === "none") {
      timings.audioKind = storedKind;
    }
    if (parsed.ttsBackend === "browser" || parsed.ttsBackend === "kokoro") timings.ttsBackend = parsed.ttsBackend;
    if (parsed.ttsEngine === "browser" || parsed.ttsEngine === "kokoro-python" || parsed.ttsEngine === "kokoro-onnx") timings.ttsEngine = parsed.ttsEngine;
    if (typeof parsed.ttsFallbackUsed === "boolean") timings.ttsFallbackUsed = parsed.ttsFallbackUsed;
    if (!hasTiming(timings.llmMs) || !hasTiming(timings.ttsMs) || !hasTiming(timings.totalMs)) return undefined;
    return timings as ChatResponse["timings"];
  } catch {
    return undefined;
  }
}

function normalizeHistoryProvider(provider?: string | null): ChatResponse["provider"] | undefined {
  if (provider === "lmstudio" || provider === "ollama" || provider === "gemini" || provider === "fallback") return provider;
  return undefined;
}

function normalizeHistoryAction(action?: string | null): ChatResponse["action"] {
  if (action === "speak" || action === "blocked" || action === "draft" || action === "silent" || action === "ignored") return action;
  return "speak";
}

function parseHistoryEmotion(raw?: string | null, storedIntensity?: number | null): { emotion: Emotion; intensity: EmotionIntensity } {
  const [rawEmotion, rawIntensity] = String(raw || "neutral").split(":");
  const emotion: Emotion = rawEmotion === "happy" || rawEmotion === "annoyed" || rawEmotion === "sad" || rawEmotion === "surprised" || rawEmotion === "thinking" || rawEmotion === "safe"
    ? rawEmotion
    : "neutral";
  const numeric = Number(storedIntensity ?? rawIntensity ?? 3);
  const intensity = Math.max(1, Math.min(10, Number.isFinite(numeric) ? Math.round(numeric) : 3)) as EmotionIntensity;
  return { emotion, intensity };
}

function normalizeMessageSource(source?: string | null): ChatMessageItem["source"] | undefined {
  if (source === "admin") return "admin";
  if (source === "twitch") return "twitch";
  if (source === "simulator") return "simulator";
  return undefined;
}

function authorForHistorySource(source?: string | null) {
  if (source === "admin") return "Administrador";
  if (source === "twitch") return "Twitch";
  if (source === "simulator") return "Chat del directo";
  return "Chat local";
}

function historyItemMeta(item: ChatHistoryMessageItem) {
  if (item.role === "user") return item.source || undefined;
  const parts = [
    typeof item.model === "string" && item.model.trim() ? item.model.trim() : "",
    normalizeHistoryProvider(item.provider || item.source) ? (item.provider || item.source || "") : "",
    normalizeHistoryAction(item.action) !== "speak" ? chatActionLabel(normalizeHistoryAction(item.action)) : "",
    item.emotion ? `${emotionLabel(parseHistoryEmotion(item.emotion, item.emotion_intensity).emotion)} ${parseHistoryEmotion(item.emotion, item.emotion_intensity).intensity}/10` : ""
  ];
  return parts.filter(Boolean).join(" | ") || item.source || undefined;
}

function responseMeta(response: ChatResponse) {
  const timings = response.timings;
  const parts = [
    response.model,
    hasTiming(timings.totalMs) ? `total ${formatDuration(timings.totalMs)}` : "",
    hasTiming(timings.llmMs) ? `LLM ${formatDuration(timings.llmMs)}` : "",
    hasTiming(timings.memoryReadMs) ? `memoria ${formatDuration(timings.memoryReadMs)}` : "",
    hasTiming(timings.historyReadMs) ? `historial ${formatDuration(timings.historyReadMs)}` : "",
    hasTiming(timings.promptBuildMs) ? `prompt ${formatDuration(timings.promptBuildMs)}` : "",
    hasTiming(timings.lengthRepairMs) ? `repair corte ${formatDuration(timings.lengthRepairMs)}` : "",
    response.ttsPending ? "TTS preparando audio" : "",
    hasTiming(timings.ttsMs) ? `TTS ${formatDuration(timings.ttsMs)}` : "",
    timings.ttsEngine ? `TTS ${ttsEngineLabel(timings.ttsEngine, timings.ttsFallbackUsed)}` : "",
    hasTiming(timings.speechStartDelayMs) ? `voz inicia ${formatDuration(timings.speechStartDelayMs)}` : "",
    hasTiming(timings.speechPlaybackMs) ? `voz dura ${formatDuration(timings.speechPlaybackMs)}` : "",
    timings.audioKind ? audioKindLabel(timings.audioKind) : "",
    `${chatActionLabel(response.action)}`,
    `${emotionLabel(response.emotion)} ${response.emotionIntensity || 3}/10`
  ];
  return parts.filter(Boolean).join(" | ");
}

function responseTimingTitle(response: ChatResponse) {
  const timings = response.timings;
  const rows = [
    `Modelo: ${response.model}`,
    hasTiming(timings.totalMs) ? `Total: ${formatDuration(timings.totalMs)}` : "",
    hasTiming(timings.llmMs) ? `LLM: ${formatDuration(timings.llmMs)}` : "",
    hasTiming(timings.llmHttpMs) ? `HTTP LLM: ${formatDuration(timings.llmHttpMs)}` : "",
    hasTiming(timings.memoryReadMs) ? `Memoria: ${formatDuration(timings.memoryReadMs)}` : "",
    hasTiming(timings.historyReadMs) ? `Historial: ${formatDuration(timings.historyReadMs)}` : "",
    hasTiming(timings.promptBuildMs) ? `Prompt: ${formatDuration(timings.promptBuildMs)}` : "",
    hasTiming(timings.responseExtractMs) ? `Extraccion: ${formatDuration(timings.responseExtractMs)}` : "",
    hasTiming(timings.reasoningRepairMs) ? `Repair: ${formatDuration(timings.reasoningRepairMs)}` : "",
    hasTiming(timings.lengthRepairMs) ? `Repair corte: ${formatDuration(timings.lengthRepairMs)}` : "",
    hasTiming(timings.llmTraceSaveMs) ? `Trace: ${formatDuration(timings.llmTraceSaveMs)}` : "",
    hasTiming(timings.ttsMs) ? `TTS: ${formatDuration(timings.ttsMs)}` : "",
    timings.ttsEngine ? `Backend TTS: ${ttsEngineLabel(timings.ttsEngine, timings.ttsFallbackUsed)}` : "",
    hasTiming(timings.firstAudioMs) ? `Primer audio TTS: ${formatDuration(timings.firstAudioMs)}` : "",
    hasTiming(timings.totalTtsMs) ? `Total TTS: ${formatDuration(timings.totalTtsMs)}` : "",
    hasTiming(timings.messagePersistMs) ? `Persistencia: ${formatDuration(timings.messagePersistMs)}` : "",
    hasTiming(timings.broadcastMs) ? `Broadcast: ${formatDuration(timings.broadcastMs)}` : "",
    hasTiming(timings.speechStartDelayMs) ? `Voz inicia: ${formatDuration(timings.speechStartDelayMs)}` : "",
    hasTiming(timings.speechPlaybackMs) ? `Voz dura: ${formatDuration(timings.speechPlaybackMs)}` : "",
    hasTiming(timings.audioDurationMs) ? `Audio metadata: ${formatDuration(timings.audioDurationMs)}` : "",
    timings.audioKind ? `Voz: ${audioKindLabel(timings.audioKind)}` : ""
  ];
  return rows.filter(Boolean).join("\n");
}

function audioKindLabel(kind: ChatResponse["timings"]["audioKind"]) {
  if (kind === "audio") return "audio generado";
  if (kind === "speechSynthesis") return "voz navegador";
  if (kind === "none") return "sin voz";
  return "";
}

function ttsEngineLabel(engine: ChatResponse["timings"]["ttsEngine"], fallbackUsed?: boolean) {
  if (fallbackUsed) return "fallback navegador";
  if (engine === "kokoro-onnx") return "Kokoro ONNX";
  if (engine === "kokoro-python") return "Kokoro";
  return "navegador";
}

function hasTiming(ms?: number | null): ms is number {
  return typeof ms === "number" && Number.isFinite(ms);
}

function formatDuration(ms?: number | null) {
  if (!hasTiming(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function AccordionSection({ title, icon, defaultOpen = false, children }: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="accordionCard" open={defaultOpen}>
      <summary>
        <span className="accordionIcon">{icon}</span>
        <strong>{title}</strong>
        <span className="chevron">⌄</span>
      </summary>
      <div className="accordionBody">{children}</div>
    </details>
  );
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function platformLabel(platform: string) {
  const labels: Record<string, string> = {
    local: "Local",
    twitch: "Twitch",
    tikfinity: "TikFinity",
    youtube: "YouTube",
    kick: "Kick"
  };
  return labels[platform] || platform;
}

function emptyGuardStatus(): GuardStatus {
  return {
    ok: true,
    queueLength: 0,
    nextResponseInMs: 0,
    cooldownMs: 0,
    userCooldownMs: 0,
    lastSelected: null,
    recent: []
  };
}

function moderationBotMessage(result: ChatIngestPayload) {
  const reason = moderationReasonLabel(result.moderation.reason);
  if (result.queued) {
    return `Mensaje aceptado y puesto en cola. Si gana turno, Yuko lo leerá. Motivo: ${reason}.`;
  }
  if (result.moderation.decision === "blocked") {
    return `Yuko no leerá ese mensaje porque fue bloqueado por seguridad. Motivo: ${reason}.`;
  }
  return `Yuko no leerá ese mensaje. Motivo: ${reason}.`;
}

function chatActionLabel(action: ChatResponse["action"]) {
  const labels: Record<ChatResponse["action"], string> = {
    speak: "hablar",
    blocked: "bloqueado",
    draft: "borrador",
    silent: "silencio",
    ignored: "ignorado"
  };
  return labels[action];
}

function twitchStatusLabel(status: TwitchStatusPayload | null) {
  if (!status) return "pendiente";
  if (status.connected) return "conectado";
  if (status.state === "connecting") return "conectando";
  if (status.state === "error") return "error";
  if (!status.enabled) return "deshabilitado";
  if (!status.configured) return "sin configurar";
  return "desconectado";
}

function readErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Error desconocido");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // The backend often returns plain text; keep it as-is.
  }
  return raw;
}

function isObsBrowserSource() {
  return /\bOBS\b|OBSStudio|obs-browser/i.test(window.navigator.userAgent);
}

// Abre /viewer o /speaker para previsualizar. En la app de escritorio (Tauri) abre una
// VENTANA NATIVA (window.open no funciona dentro del webview); en navegador (dev) abre
// una pestaña. Requiere withGlobalTauri + permiso core:webview:allow-create-webview-window.
function openPreview(route: "viewer" | "speaker") {
  const tauriApi = (window as unknown as {
    __TAURI__?: { webviewWindow?: { WebviewWindow?: new (label: string, options: Record<string, unknown>) => unknown } };
  }).__TAURI__;
  const WebviewWindowCtor = tauriApi?.webviewWindow?.WebviewWindow;
  if (WebviewWindowCtor) {
    try {
      new WebviewWindowCtor(`preview-${route}`, {
        url: `/${route}`,
        title: route === "viewer" ? "Vista previa Viewer" : "Vista previa Speaker",
        width: route === "viewer" ? 960 : 460,
        height: route === "viewer" ? 600 : 220
      });
      return;
    } catch {
      // Si la ventana nativa falla, caemos al navegador (modo dev).
    }
  }
  window.open(`/${route}`, "_blank", "noopener");
}

function normalizeSceneClient(settings: Partial<SceneSettings>): SceneSettings {
  const preset = String(settings.cameraPreset || defaultScene.cameraPreset);
  return {
    ...defaultScene,
    activeBackground: String(settings.activeBackground || ""),
    referenceImage: normalizeReferenceImageClient(settings.referenceImage),
    cameraPreset: ["bust", "half", "full", "obs"].includes(preset) ? preset as SceneSettings["cameraPreset"] : defaultScene.cameraPreset,
    cameraDistance: normalizeSceneNumber("cameraDistance", settings.cameraDistance),
    cameraHeight: normalizeSceneNumber("cameraHeight", settings.cameraHeight),
    cameraX: normalizeSceneNumber("cameraX", settings.cameraX),
    cameraY: normalizeSceneNumber("cameraY", settings.cameraY),
    avatarScale: normalizeSceneNumber("avatarScale", settings.avatarScale),
    captionVisible: settings.captionVisible !== false,
    mode: "scene16x9"
  };
}

function findBackground(items: BackgroundItem[], id: string) {
  return items.find((item) => item.id === id) || null;
}

function normalizeReferenceImageClient(image: Partial<NonNullable<SceneSettings["referenceImage"]>> | null | undefined): SceneSettings["referenceImage"] {
  if (!image?.id || !image.url) return null;
  return {
    id: String(image.id),
    name: String(image.name || image.id),
    url: String(image.url),
    visible: image.visible !== false,
    x: clampPercent(Number(image.x), 64),
    y: clampPercent(Number(image.y), 54),
    width: clampPercent(Number(image.width), 24, 8, 72),
    aspectRatio: normalizeAspectRatioClient(Number(image.aspectRatio)),
    opacity: clampPercent(Number(image.opacity), 100, 20, 100),
    borderVisible: image.borderVisible !== false,
    borderColor: normalizeBorderColorClient(image.borderColor)
  };
}

async function referenceImageToChatAttachment(image: NonNullable<SceneSettings["referenceImage"]>): Promise<ChatImageAttachment> {
  const response = await fetch(referenceImageSrc(image));
  if (!response.ok) throw new Error("No pude leer la imagen de referencia.");
  const blob = await response.blob();
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("La imagen de referencia no es PNG, JPG o WebP.");
  if (blob.size > 8 * 1024 * 1024) throw new Error("La imagen de referencia supera 8 MB.");
  const base64 = await blobToBase64(blob);
  return {
    name: image.name,
    mimeType: blob.type as ChatImageAttachment["mimeType"],
    base64,
    aspectRatio: image.aspectRatio
  };
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pude convertir la imagen."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function createVideoFromStream(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("La captura de pantalla tardó demasiado.")), 5000);
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    if (video.videoWidth && video.videoHeight) finish();
    else video.onloadedmetadata = finish;
  });
  return video;
}

async function captureFrameFromStream(stream: MediaStream): Promise<VisualNarrationImage> {
  const video = await createVideoFromStream(stream);
  const frame = await captureFrameFromVideo(video, "capture", "captura-visual");
  return frame.image;
}

async function captureFrameFromVideo(video: HTMLVideoElement, kind: VisualNarrationImage["kind"], namePrefix: string): Promise<CapturedVisualFrame> {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const scale = Math.min(1, 960 / sourceWidth, 540 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No pude preparar la captura visual.");
  context.drawImage(video, 0, 0, width, height);
  const hash = visualFrameHash(canvas);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((item) => item ? resolve(item) : reject(new Error("No pude convertir la captura.")), "image/jpeg", 0.84);
  });
  if (blob.size > 8 * 1024 * 1024) throw new Error("La captura supera 8 MB. Elige una ventana más pequeña o intenta de nuevo.");
  const base64 = await blobToBase64(blob);
  const src = URL.createObjectURL(blob);
  const name = `${namePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
  return {
    hash,
    image: {
      src,
      name,
      kind,
      attachment: {
        name,
        mimeType: "image/jpeg",
        base64,
        aspectRatio: width / height
      }
    }
  };
}

function visualFrameHash(canvas: HTMLCanvasElement) {
  const width = 24;
  const height = 14;
  const tiny = document.createElement("canvas");
  tiny.width = width;
  tiny.height = height;
  const context = tiny.getContext("2d", { willReadFrequently: true });
  if (!context) return new Uint8ClampedArray();
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const hash = new Uint8ClampedArray(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const target = index * 3;
    hash[target] = pixels[offset];
    hash[target + 1] = pixels[offset + 1];
    hash[target + 2] = pixels[offset + 2];
  }
  return hash;
}

function frameChangeScore(previous: Uint8ClampedArray | null, next: Uint8ClampedArray) {
  if (!previous || previous.length !== next.length || next.length === 0) return 255;
  let total = 0;
  let changedPixels = 0;
  let maxDiff = 0;
  const channels = 3;
  const pixels = Math.floor(next.length / channels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels;
    const diff = (
      Math.abs(next[offset] - previous[offset])
      + Math.abs(next[offset + 1] - previous[offset + 1])
      + Math.abs(next[offset + 2] - previous[offset + 2])
    ) / channels;
    total += diff;
    if (diff > 9) changedPixels += 1;
    if (diff > maxDiff) maxDiff = diff;
  }
  const average = total / Math.max(1, pixels);
  const changedRatio = changedPixels / Math.max(1, pixels);
  return average + changedRatio * 65 + maxDiff * 0.12;
}

function visualPrompt(mode: VisualPromptMode) {
  if (mode === "auto") {
    return "Mira este frame como narradora de stream. La app ya detectó un cambio visual; describe en 1 frase natural y específica lo visible o lo que acaba de llamar la atención. No confirmes que puedes ver la imagen, no digas 'sí puedo verla' y no hables del sistema. Solo responde SIN_CAMBIOS si la imagen está vacía, ilegible o no tiene ningún elemento describible.";
  }
  if (mode === "narrate") {
    return "Narra esta escena para el directo en 1-2 frases naturales, con energía de streamer y detalles concretos visibles. No confirmes que puedes ver la imagen: describe directamente lo visible. No inventes detalles que no se vean.";
  }
  return "Mira esta imagen como inspección privada y dime en una frase concreta qué ves, de forma factual y breve. No lo conviertas en narración de stream. No confirmes que puedes verla: describe directamente lo visible. Si no puedes verla, dilo sin inventar.";
}

function isVisualNoChanges(response: ChatResponse | null | undefined) {
  return response?.text?.trim().replace(/[.!¡!¿?]+$/g, "").toUpperCase() === "SIN_CAMBIOS"
    || response?.notices?.includes("visual_no_changes")
    || response?.notices?.includes("visual_model_unavailable");
}

function normalizeVisualIntervalSeconds(value: unknown) {
  const interval = Math.round(Number(value));
  if (!Number.isFinite(interval)) return VISUAL_DEFAULT_INTERVAL_SECONDS;
  return Math.min(VISUAL_MAX_INTERVAL_SECONDS, Math.max(VISUAL_MIN_INTERVAL_SECONDS, interval));
}

function fileToChatImage(file: File) {
  return new Promise<PendingChatImage>((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      reject(new Error("Sube una imagen PNG, JPG o WebP."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("La imagen para Yuko debe pesar menos de 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pude leer la imagen."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      const finish = (aspectRatio = 16 / 9) => resolve({
          name: file.name,
          fileName: file.name,
          mimeType: file.type as PendingChatImage["mimeType"],
          base64: separator >= 0 ? result.slice(separator + 1) : result,
          previewUrl: result,
          aspectRatio
        });
      const probe = new Image();
      probe.onload = () => finish(probe.naturalWidth && probe.naturalHeight ? probe.naturalWidth / probe.naturalHeight : 16 / 9);
      probe.onerror = () => finish();
      probe.src = result;
    };
    reader.readAsDataURL(file);
  });
}

