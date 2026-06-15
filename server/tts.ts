import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { runtime, scriptsDir, updateRuntimeVoiceConfig } from "./config.js";

export interface LocalVoice {
  id: string;
  name: string;
  lang: string;
  configured: boolean;
  backend: "browser" | "kokoro";
}

export interface TtsSynthesisResult {
  audio: { mimeType: "audio/wav"; base64: string } | null;
  notice?: string;
  backend: "browser" | "kokoro";
  engine: "browser" | "kokoro-python" | "kokoro-onnx";
  voice?: string;
  fallbackUsed: boolean;
  timings: {
    firstAudioMs?: number;
    totalTtsMs: number;
    audioDurationMs?: number;
    rtf?: number;
  };
}

const legacyKokoroVoices: Array<{ id: string; name: string; lang: string; engine: "kokoro-python" | "kokoro-onnx" }> = [
  { id: "jf_alpha", name: "Alpha JP kawaii", lang: "e" },
  { id: "jf_gongitsune", name: "Gongitsune JP soft", lang: "e" },
  { id: "jf_nezumi", name: "Nezumi JP cute", lang: "e" },
  { id: "jf_tebukuro", name: "Tebukuro JP gentle", lang: "e" }
].map((voice) => ({ ...voice, engine: "kokoro-python" as const }));

const kokoroOnnxVoices: Array<{ id: string; name: string; lang: string; engine: "kokoro-python" | "kokoro-onnx" }> = [
  { id: "ef_dora", name: "Dora ES femenina / ef_dora", lang: "es", engine: "kokoro-onnx" },
  { id: "em_alex", name: "Alex ES masculino / em_alex", lang: "es", engine: "kokoro-onnx" },
  { id: "em_santa", name: "Santa ES masculino / em_santa", lang: "es", engine: "kokoro-onnx" },
  { id: "jf_alpha", name: "Alpha JP femenina estilo ES / jf_alpha", lang: "es", engine: "kokoro-onnx" },
  { id: "jf_gongitsune", name: "Gongitsune JP femenina suave ES / jf_gongitsune", lang: "es", engine: "kokoro-onnx" },
  { id: "jf_nezumi", name: "Nezumi JP femenina cute ES / jf_nezumi", lang: "es", engine: "kokoro-onnx" },
  { id: "jf_tebukuro", name: "Tebukuro JP femenina gentle ES / jf_tebukuro", lang: "es", engine: "kokoro-onnx" },
  { id: "af_heart", name: "Heart EN femenina soft / af_heart", lang: "en-us", engine: "kokoro-onnx" },
  { id: "af_bella", name: "Bella EN femenina / af_bella", lang: "en-us", engine: "kokoro-onnx" },
  { id: "af_nova", name: "Nova EN femenina / af_nova", lang: "en-us", engine: "kokoro-onnx" }
];

let worker: KokoroWorker | null = null;
let onnxWorker: KokoroOnnxWorker | null = null;
const ttsCache = new Map<string, {
  audio: { mimeType: "audio/wav"; base64: string };
  audioDurationMs?: number;
  engine: TtsSynthesisResult["engine"];
  voice: string;
}>();
const maxTtsCacheItems = 24;

export function listVoices(options: { activeOnly?: boolean } = {}): LocalVoice[] {
  const status = getTtsCapability();
  const items = status.engine === "kokoro-onnx" ? kokoroOnnxVoices : legacyKokoroVoices;
  if (!status.localAvailable) return [];
  if (options.activeOnly && status.activeBackend !== "kokoro") return [];
  return items.map((voice) => ({
    ...voice,
    backend: "kokoro" as const,
    configured: voice.id === runtime.kokoroVoice
  }));
}

export function getTtsStatus() {
  const capability = getTtsCapability();
  const effectiveVoiceId = resolveKokoroVoice(runtime.kokoroVoice, capability.engine);
  const selectedVoice = listVoices().find((voice) => voice.id === effectiveVoiceId);
  const notice = capability.activeBackend === "kokoro"
    ? `TTS local activo · Kokoro ONNX · voz ${effectiveVoiceId}`
    : capability.fallbackReason || "Voz navegador activa.";

  return {
    ok: true,
    provider: runtime.ttsBackend,
    experimentalLocal: runtime.ttsExperimentalLocal,
    streamingEnabled: runtime.ttsStreamingEnabled,
    ready: capability.activeBackend === "kokoro",
    localAvailable: capability.localAvailable,
    activeBackend: capability.activeBackend,
    fallbackReason: capability.fallbackReason,
    engine: capability.engine,
    kokoroPython: runtime.kokoroPython,
    kokoroModelPath: runtime.kokoroModelPath,
    kokoroVoicesPath: runtime.kokoroVoicesPath,
    kokoroVoice: effectiveVoiceId,
    kokoroLang: runtime.kokoroLang,
    kokoroSpeed: runtime.kokoroSpeed,
    kokoroHfHome: runtime.kokoroHfHome,
    selectedVoiceId: selectedVoice?.id || effectiveVoiceId,
    availableVoices: listVoices(),
    voices: listVoices({ activeOnly: true }),
    kokoro: {
      configured: capability.localAvailable,
      workerReady: capability.workerReady,
      modelPathExists: capability.modelPathExists,
      voicesPathExists: capability.voicesPathExists,
      pythonExists: capability.pythonExists,
      voice: effectiveVoiceId,
      language: runtime.kokoroLang,
      speed: runtime.kokoroSpeed
    },
    notice
  };
}

export function configureVoice(input: {
  voiceId?: string;
  backend?: "browser" | "kokoro";
  experimentalLocal?: boolean;
  speed?: number;
}) {
  const backend = input.backend || runtime.ttsBackend;
  const capability = getTtsCapability({ backend, experimentalLocal: input.experimentalLocal });
  const voice = input.voiceId ? listVoices().find((item) => item.id === input.voiceId) : undefined;
  if (backend === "kokoro" && !capability.localAvailable) {
    throw new Error(capability.fallbackReason || "Kokoro no esta disponible.");
  }
  if (backend === "kokoro" && !voice) {
    throw new Error("La voz Kokoro seleccionada no esta disponible.");
  }
  const next = updateRuntimeVoiceConfig({
    ttsBackend: backend,
    ttsExperimentalLocal: backend === "kokoro" ? input.experimentalLocal !== false : false,
    kokoroVoice: backend === "kokoro" ? voice?.id || runtime.kokoroVoice : runtime.kokoroVoice,
    kokoroLang: backend === "kokoro" ? voice?.lang || runtime.kokoroLang : runtime.kokoroLang,
    kokoroSpeed: normalizeSpeed(input.speed ?? runtime.kokoroSpeed)
  });
  return { ok: true, runtime: next, voice: voice || null, status: getTtsStatus() };
}

export async function synthesize(text: string, override?: {
  voice?: string;
  lang?: string;
  speed?: number;
  backend?: "browser" | "kokoro";
  experimentalLocal?: boolean;
}): Promise<TtsSynthesisResult> {
  const started = Date.now();
  const speechText = cleanSpeechText(text);
  if (!speechText) {
    return {
      audio: null,
      notice: "La respuesta no tenia texto limpio para voz.",
      backend: "browser",
      engine: "browser",
      fallbackUsed: true,
      timings: { totalTtsMs: Date.now() - started }
    };
  }

  const effectiveBackend = override?.backend || runtime.ttsBackend;
  const effectiveExperimentalLocal = override?.experimentalLocal ?? runtime.ttsExperimentalLocal;
  if (effectiveBackend !== "kokoro" || !effectiveExperimentalLocal) {
    return {
      audio: null,
      notice: "Voz navegador activa.",
      backend: "browser",
      engine: "browser",
      fallbackUsed: true,
      timings: { totalTtsMs: Date.now() - started }
    };
  }

  if (!runtime.kokoroPython || !fs.existsSync(runtime.kokoroPython)) {
    return {
      audio: null,
      notice: "Kokoro no esta configurado; la UI usara voz del navegador si esta disponible.",
      backend: "kokoro",
      engine: runtime.kokoroModelPath && runtime.kokoroVoicesPath ? "kokoro-onnx" : "kokoro-python",
      fallbackUsed: true,
      timings: { totalTtsMs: Date.now() - started }
    };
  }

  const output = path.join(os.tmpdir(), `local-vtuber-kokoro-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  const lang = override?.lang || runtime.kokoroLang || "e";
  const speed = normalizeSpeed(override?.speed ?? runtime.kokoroSpeed);
  const onnxConfigured = Boolean(runtime.kokoroModelPath && runtime.kokoroVoicesPath && fs.existsSync(runtime.kokoroModelPath) && fs.existsSync(runtime.kokoroVoicesPath));
  const voice = resolveKokoroVoice(override?.voice || runtime.kokoroVoice || "jf_alpha", onnxConfigured ? "kokoro-onnx" : "kokoro-python");
  const onnxRequested = Boolean(runtime.kokoroModelPath || runtime.kokoroVoicesPath);

  if (onnxRequested && !onnxConfigured) {
    return {
      audio: null,
      notice: "Kokoro ONNX no encontro modelo/voces; la UI usara voz del navegador si esta disponible.",
      backend: "kokoro",
      engine: "kokoro-onnx",
      voice,
      fallbackUsed: true,
      timings: { totalTtsMs: Date.now() - started }
    };
  }

  try {
    if (onnxConfigured) {
      onnxWorker ??= new KokoroOnnxWorker();
      const cacheKey = ttsCacheKey({ engine: "kokoro-onnx", voice, lang: normalizeOnnxLanguage(lang), speed, text: speechText });
      const cached = ttsCache.get(cacheKey);
      if (cached) {
        const totalTtsMs = Date.now() - started;
        return {
          audio: cached.audio,
          backend: "kokoro",
          engine: "kokoro-onnx",
          voice: cached.voice,
          fallbackUsed: false,
          timings: {
            firstAudioMs: totalTtsMs,
            totalTtsMs,
            audioDurationMs: cached.audioDurationMs,
            rtf: 0
          }
        };
      }
      const audio = await onnxWorker.synthesize({ text: speechText, voice, lang: normalizeOnnxLanguage(lang), speed });
      const audioBuffer = Buffer.from(audio.base64, "base64");
      const audioDurationMs = readWavDurationMs(audioBuffer);
      rememberTtsCache(cacheKey, { audio, audioDurationMs, engine: "kokoro-onnx", voice });
      const totalTtsMs = Date.now() - started;
      return {
        audio,
        backend: "kokoro",
        engine: "kokoro-onnx",
        voice,
        fallbackUsed: false,
        timings: {
          firstAudioMs: totalTtsMs,
          totalTtsMs,
          audioDurationMs,
          rtf: audioDurationMs ? round(totalTtsMs / audioDurationMs, 3) : undefined
        }
      };
    }
    worker ??= new KokoroWorker();
    const cacheKey = ttsCacheKey({ engine: "kokoro-python", voice, lang, speed, text: speechText });
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      const totalTtsMs = Date.now() - started;
      return {
        audio: cached.audio,
        backend: "kokoro",
        engine: "kokoro-python",
        voice: cached.voice,
        fallbackUsed: false,
        timings: {
          firstAudioMs: totalTtsMs,
          totalTtsMs,
          audioDurationMs: cached.audioDurationMs,
          rtf: 0
        }
      };
    }
    const audio = await worker.synthesize({ text: speechText, voice, lang, speed });
    const audioBuffer = Buffer.from(audio.base64, "base64");
    const audioDurationMs = readWavDurationMs(audioBuffer);
    rememberTtsCache(cacheKey, { audio, audioDurationMs, engine: "kokoro-python", voice });
    const totalTtsMs = Date.now() - started;
    return {
      audio,
      backend: "kokoro",
      engine: "kokoro-python",
      voice,
      fallbackUsed: false,
      timings: {
        firstAudioMs: totalTtsMs,
        totalTtsMs,
        audioDurationMs,
        rtf: audioDurationMs ? round(totalTtsMs / audioDurationMs, 3) : undefined
      }
    };
  } catch (error) {
    console.warn("Kokoro TTS failed; browser fallback will be used:", error instanceof Error ? error.message : error);
    if (onnxConfigured) {
      return {
        audio: null,
        notice: "Kokoro fallo; la UI usara voz del navegador si esta disponible.",
        backend: "kokoro",
        engine: "kokoro-onnx",
        voice,
        fallbackUsed: true,
        timings: { totalTtsMs: Date.now() - started }
      };
    }
  }

  try {
    const script = path.join(scriptsDir, "kokoro_tts.py");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(runtime.kokoroPython, [
        script,
        "--text", speechText,
        "--output", output,
        "--voice", voice,
        "--lang", lang,
        "--speed", String(speed)
      ], {
        env: {
          ...process.env,
          HF_HOME: runtime.kokoroHfHome,
          HF_HUB_DISABLE_SYMLINKS_WARNING: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `Kokoro exited with ${code}`));
      });
    });

    const base64 = fs.readFileSync(output).toString("base64");
    const audioDurationMs = readWavDurationMs(fs.readFileSync(output));
    fs.rmSync(output, { force: true });
    const totalTtsMs = Date.now() - started;
    return {
      audio: { mimeType: "audio/wav", base64 },
      backend: "kokoro",
      engine: "kokoro-python",
      voice,
      fallbackUsed: false,
      timings: {
        firstAudioMs: totalTtsMs,
        totalTtsMs,
        audioDurationMs,
        rtf: audioDurationMs ? round(totalTtsMs / audioDurationMs, 3) : undefined
      }
    };
  } catch (error) {
    fs.rmSync(output, { force: true });
    console.warn("Kokoro one-shot failed; browser fallback will be used:", error instanceof Error ? error.message : error);
    return {
      audio: null,
      notice: "Kokoro fallo; la UI usara voz del navegador si esta disponible.",
      backend: "kokoro",
      engine: "kokoro-python",
      voice,
      fallbackUsed: true,
      timings: { totalTtsMs: Date.now() - started }
    };
  }
}

function getTtsCapability(override: { backend?: "browser" | "kokoro"; experimentalLocal?: boolean } = {}) {
  const provider = override.backend || runtime.ttsBackend;
  const experimentalLocal = override.experimentalLocal ?? runtime.ttsExperimentalLocal;
  const pythonExists = Boolean(runtime.kokoroPython && fs.existsSync(runtime.kokoroPython));
  const modelPathExists = Boolean(runtime.kokoroModelPath && fs.existsSync(runtime.kokoroModelPath));
  const voicesPathExists = Boolean(runtime.kokoroVoicesPath && fs.existsSync(runtime.kokoroVoicesPath));
  const onnxRequested = Boolean(runtime.kokoroModelPath || runtime.kokoroVoicesPath);
  const onnxConfigured = modelPathExists && voicesPathExists;
  const engine: TtsSynthesisResult["engine"] = onnxConfigured || onnxRequested ? "kokoro-onnx" : "kokoro-python";
  let fallbackReason: string | null = null;
  if (provider !== "kokoro") fallbackReason = "Voz navegador activa.";
  else if (!experimentalLocal) fallbackReason = "Kokoro seleccionado, pero TTS_EXPERIMENTAL_LOCAL esta desactivado.";
  else if (!pythonExists) fallbackReason = "Kokoro no configurado: falta KOKORO_PYTHON o la venv local.";
  else if (onnxRequested && !modelPathExists) fallbackReason = "Kokoro no configurado: falta KOKORO_MODEL_PATH.";
  else if (onnxRequested && !voicesPathExists) fallbackReason = "Kokoro no configurado: falta KOKORO_VOICES_PATH.";
  const localAvailable = pythonExists && (!onnxRequested || onnxConfigured);
  const activeLocal = provider === "kokoro" && experimentalLocal && localAvailable;
  return {
    provider,
    experimentalLocal,
    pythonExists,
    modelPathExists,
    voicesPathExists,
    engine,
    localAvailable,
    activeBackend: activeLocal ? "kokoro" as const : "browser" as const,
    fallbackReason,
    workerReady: engine === "kokoro-onnx" ? Boolean(onnxWorker?.isActive()) : Boolean(worker?.isActive())
  };
}

export async function warmTts() {
  if (runtime.ttsBackend !== "kokoro" || !runtime.ttsExperimentalLocal || !runtime.kokoroPython || !fs.existsSync(runtime.kokoroPython)) return;
  const voice = runtime.kokoroVoice || "jf_alpha";
  const lang = runtime.kokoroLang || "e";
  const speed = normalizeSpeed(runtime.kokoroSpeed);
  if (runtime.kokoroModelPath && runtime.kokoroVoicesPath && fs.existsSync(runtime.kokoroModelPath) && fs.existsSync(runtime.kokoroVoicesPath)) {
    onnxWorker ??= new KokoroOnnxWorker();
    await onnxWorker.synthesize({ text: "hola", voice, lang: normalizeOnnxLanguage(lang), speed });
    return;
  }
  worker ??= new KokoroWorker();
  await worker.synthesize({ text: "hola", voice, lang, speed });
}

async function synthesizeKokoroOnnx(request: { text: string; output: string; voice: string; lang: string; speed: number; started: number }): Promise<TtsSynthesisResult> {
  const script = path.join(scriptsDir, "tts_kokoro_onnx.py");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(runtime.kokoroPython, [
      script,
      "--text", request.text,
      "--output", request.output,
      "--model", runtime.kokoroModelPath,
      "--voices", runtime.kokoroVoicesPath,
      "--voice", request.voice,
      "--lang", request.lang,
      "--speed", String(request.speed)
    ], {
      env: {
        ...process.env,
        HF_HOME: runtime.kokoroHfHome,
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Kokoro ONNX exited with ${code}`));
    });
  });
  const buffer = fs.readFileSync(request.output);
  const base64 = buffer.toString("base64");
  const audioDurationMs = readWavDurationMs(buffer);
  fs.rmSync(request.output, { force: true });
  const totalTtsMs = Date.now() - request.started;
  return {
    audio: { mimeType: "audio/wav", base64 },
    backend: "kokoro",
    engine: "kokoro-onnx",
    voice: request.voice,
    fallbackUsed: false,
    timings: {
      firstAudioMs: totalTtsMs,
      totalTtsMs,
      audioDurationMs,
      rtf: audioDurationMs ? round(totalTtsMs / audioDurationMs, 3) : undefined
    }
  };
}

export function stopTtsWorker() {
  worker?.shutdown();
  worker = null;
  onnxWorker?.shutdown();
  onnxWorker = null;
  ttsCache.clear();
}

function ttsCacheKey(input: { engine: string; voice: string; lang: string; speed: number; text: string }) {
  return createHash("sha256")
    .update(`${input.engine}\0${input.voice}\0${input.lang}\0${input.speed}\0${input.text}`)
    .digest("hex");
}

function rememberTtsCache(key: string, item: {
  audio: { mimeType: "audio/wav"; base64: string };
  audioDurationMs?: number;
  engine: TtsSynthesisResult["engine"];
  voice: string;
}) {
  ttsCache.delete(key);
  ttsCache.set(key, item);
  while (ttsCache.size > maxTtsCacheItems) {
    const oldest = ttsCache.keys().next().value;
    if (!oldest) break;
    ttsCache.delete(oldest);
  }
}

class KokoroOnnxWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private stderr = "";
  private key = "";
  private ready: Promise<void> | null = null;
  private pending = new Map<string, {
    resolve: (audio: { mimeType: "audio/wav"; base64: string }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  async synthesize(request: { text: string; voice: string; lang: string; speed: number }) {
    await this.ensureReady();
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Kokoro ONNX worker is not writable.");
    }
    const id = randomUUID();
    const result = new Promise<{ mimeType: "audio/wav"; base64: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Kokoro ONNX worker timed out."));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    return result;
  }

  shutdown() {
    this.stop();
  }

  isActive() {
    return Boolean(this.child && this.ready);
  }

  private async ensureReady() {
    const nextKey = `${runtime.kokoroPython}|${runtime.kokoroModelPath}|${runtime.kokoroVoicesPath}`;
    if (this.child && this.ready && this.key === nextKey) return this.ready;

    this.stop();
    this.key = nextKey;
    this.stderr = "";
    const script = path.join(scriptsDir, "kokoro_onnx_worker.py");
    this.child = spawn(runtime.kokoroPython, [
      script,
      "--model", runtime.kokoroModelPath,
      "--voices", runtime.kokoroVoicesPath
    ], {
      env: {
        ...process.env,
        HF_HOME: runtime.kokoroHfHome,
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (data) => this.readStdout(data.toString()));
    this.child.stderr.on("data", (data) => {
      this.stderr += data.toString();
      if (this.stderr.length > 4000) this.stderr = this.stderr.slice(-4000);
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("close", (code) => {
      const detail = this.stderr.trim() || `Kokoro ONNX worker exited with ${code}`;
      this.child = null;
      this.ready = null;
      this.rejectAll(new Error(detail));
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Kokoro ONNX worker did not become ready.")), 120_000);
      const readyId = "__ready__";
      this.pending.set(readyId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pending.delete(readyId);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pending.delete(readyId);
          reject(error);
        },
        timeout
      });
    });

    return this.ready;
  }

  private readStdout(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string) {
    let payload: any;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.type === "ready") {
      const ready = this.pending.get("__ready__");
      if (!ready) return;
      if (payload.ok) ready.resolve({ mimeType: "audio/wav", base64: "" });
      else ready.reject(new Error(payload.error || "Kokoro ONNX worker failed to start."));
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(payload.id);
    if (payload.ok && payload.audio) {
      pending.resolve({ mimeType: "audio/wav", base64: payload.audio });
    } else {
      pending.reject(new Error(payload.error || "Kokoro ONNX worker failed."));
    }
  }

  private stop() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.ready = null;
    this.rejectAll(new Error("Kokoro ONNX worker restarted."));
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

class KokoroWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private stderr = "";
  private key = "";
  private ready: Promise<void> | null = null;
  private pending = new Map<string, {
    resolve: (audio: { mimeType: "audio/wav"; base64: string }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  async synthesize(request: { text: string; voice: string; lang: string; speed: number }) {
    await this.ensureReady();
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Kokoro worker is not writable.");
    }

    const id = randomUUID();
    const result = new Promise<{ mimeType: "audio/wav"; base64: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Kokoro worker timed out."));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
    });

    this.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    return result;
  }

  shutdown() {
    this.stop();
  }

  isActive() {
    return Boolean(this.child && this.ready);
  }

  private async ensureReady() {
    const nextKey = `${runtime.kokoroPython}|${runtime.kokoroHfHome}`;
    if (this.child && this.ready && this.key === nextKey) {
      return this.ready;
    }

    this.stop();
    this.key = nextKey;
    this.stderr = "";
    const script = path.join(scriptsDir, "kokoro_worker.py");
    this.child = spawn(runtime.kokoroPython, [script], {
      env: {
        ...process.env,
        HF_HOME: runtime.kokoroHfHome,
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (data) => this.readStdout(data.toString()));
    this.child.stderr.on("data", (data) => {
      this.stderr += data.toString();
      if (this.stderr.length > 4000) this.stderr = this.stderr.slice(-4000);
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("close", (code) => {
      const detail = this.stderr.trim() || `Kokoro worker exited with ${code}`;
      this.child = null;
      this.ready = null;
      this.rejectAll(new Error(detail));
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Kokoro worker did not become ready."));
      }, 120_000);
      const readyId = "__ready__";
      this.pending.set(readyId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pending.delete(readyId);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pending.delete(readyId);
          reject(error);
        },
        timeout
      });
    });

    return this.ready;
  }

  private readStdout(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string) {
    let payload: any;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.type === "ready") {
      const ready = this.pending.get("__ready__");
      if (!ready) return;
      if (payload.ok) ready.resolve({ mimeType: "audio/wav", base64: "" });
      else ready.reject(new Error(payload.error || "Kokoro worker failed to start."));
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(payload.id);
    if (payload.ok && payload.audio) {
      pending.resolve({ mimeType: "audio/wav", base64: payload.audio });
    } else {
      pending.reject(new Error(payload.error || "Kokoro worker failed."));
    }
  }

  private stop() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.ready = null;
    this.rejectAll(new Error("Kokoro worker restarted."));
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function normalizeSpeed(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0.95;
  return Math.max(0.6, Math.min(1.4, value));
}

function normalizeOnnxLanguage(value: string) {
  const lang = String(value || "").trim().toLowerCase();
  if (lang === "e") return "es";
  if (lang === "a") return "en-us";
  return lang || "es";
}

function resolveKokoroVoice(value: string, engine: TtsSynthesisResult["engine"]) {
  const voice = String(value || "").trim();
  const catalog = engine === "kokoro-onnx" ? kokoroOnnxVoices : legacyKokoroVoices;
  return catalog.some((item) => item.id === voice) ? voice : catalog[0]?.id || "ef_dora";
}

function readWavDurationMs(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return undefined;
  const byteRate = buffer.readUInt32LE(28);
  const dataIndex = buffer.indexOf(Buffer.from("data"));
  if (byteRate <= 0 || dataIndex < 0 || dataIndex + 8 > buffer.length) return undefined;
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  return Math.round((dataSize / byteRate) * 1000);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanSpeechText(text: string) {
  return normalizeSpeechLetters(text)
    .replace(/\b(?:simbolo|símbolo|signo)\s+de\s+(?:copyright|copy\s*right|derechos?\s+de\s+autor|marca\s+registrada|trademark|registered)\b/gi, " ")
    .replace(/\b(?:copyright|copy\s*right|registered\s+trademark|trademark)\s+(?:symbol|sign)\b/gi, " ")
    .replace(/\b(?:copyright|copy\s*right)\b/gi, " ")
    .replace(/https?:\/\/\S+/gi, " enlace ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200d\ufe0e\ufe0f]/gi, "")
    .replace(/[\u{1f1e6}-\u{1f1ff}]/gu, "")
    .replace(/[\u{1f300}-\u{1faff}]/gu, "")
    .replace(/[\u{2600}-\u{27bf}]/gu, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/[.,;:!?¿¡"'“”‘’«»()[\]{}<>*_~`#|\\/+=^$%&@-]+/g, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpeechLetters(text: string) {
  return text
    .replace(/gü([ei])/gi, (_match, vowel: string) => `w${vowel.toLowerCase()}`)
    .replace(/ñ/g, "ni")
    .replace(/Ñ/g, "Ni")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
