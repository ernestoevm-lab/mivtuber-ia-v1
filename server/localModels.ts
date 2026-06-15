import { execFile } from "node:child_process";
import { runtime, updateRuntimeModelConfig } from "./config.js";
import { clearLmStudioEndpointCache, detectLmStudioApi, detectLmStudioInferenceEndpoint } from "./ollama.js";

export interface LocalModel {
  id: string;
  displayName: string;
  params?: string;
  sizeBytes?: number;
  loaded: boolean;
}

export interface LocalModelSwitchResult {
  ok: true;
  runtime: ReturnType<typeof updateRuntimeModelConfig>;
  serverRunning: boolean;
  active: string[];
  models: LocalModel[];
  apiMode?: string;
  detectedBaseUrl?: string;
  unloaded: string[];
  unloadWarnings: string[];
  activeChatModels: string[];
}

export async function listLocalModels(): Promise<{ serverRunning: boolean; active: string[]; models: LocalModel[]; apiMode?: string; detectedBaseUrl?: string }> {
  const [diskModels, activeModels, serverRunning] = await Promise.all([
    lmsJson<Array<Record<string, unknown>>>(["ls", "--llm", "--json"]).catch(() => []),
    lmsJson<Array<Record<string, unknown>>>(["ps", "--json"]).catch(() => []),
    isLmStudioServerRunning()
  ]);
  const activeIds = activeModels
    .map((model) => String(model.identifier || model.modelKey || ""))
    .filter(Boolean);
  const activeChatIds = activeIds.filter((id) => !isEmbeddingModel(id));
  const models: LocalModel[] = diskModels.map((model) => {
    const id = String(model.modelKey || model.id || model.indexedModelIdentifier || "");
    return {
      id,
      displayName: String(model.displayName || id),
      params: model.paramsString ? String(model.paramsString) : undefined,
      sizeBytes: typeof model.sizeBytes === "number" ? model.sizeBytes : undefined,
      loaded: activeChatIds.includes(id)
    };
  }).filter((model) => model.id && !isEmbeddingModel(model.id));

  for (const active of activeModels) {
    const id = String(active.identifier || active.modelKey || "");
    if (!id || isEmbeddingModel(id)) continue;
    if (!models.some((model) => model.id === id)) {
      models.push({ id, displayName: String(active.displayName || id), loaded: true });
    }
  }

  const api = await detectLmStudioApi().catch(() => null);
  return {
    serverRunning: serverRunning || activeIds.length > 0 || Boolean(api?.ok),
    active: activeChatIds,
    models,
    apiMode: api?.ok ? api.apiMode : runtime.lmStudioApiMode,
    detectedBaseUrl: api?.ok ? api.baseUrl : runtime.lmStudioBaseUrl
  };
}

export async function selectLmStudioModel(modelId: string): Promise<LocalModelSwitchResult> {
  await lms(["server", "start"]).catch(() => undefined);
  const before = await getActiveChatModelIds();
  const preloadUnload = await unloadOtherChatModels(modelId, before);
  clearLmStudioEndpointCache();
  await lms([
    "load",
    modelId,
    "--identifier",
    modelId,
    "--parallel",
    "1",
    "--yes"
  ].concat(lmStudioLoadFlags()), 180000);
  clearLmStudioEndpointCache();
  const afterLoad = await getActiveChatModelIds();
  const postloadUnload = await unloadOtherChatModels(modelId, afterLoad);
  const detected = await detectLmStudioInferenceEndpoint(modelId).catch(() => null);
  const config = updateRuntimeModelConfig({
    llmProvider: "lmstudio",
    lmStudioBaseUrl: detected?.ok ? detected.baseUrl : runtime.lmStudioBaseUrl || "http://127.0.0.1:1234/v1",
    lmStudioApiMode: detected?.ok ? detected.apiMode as "openai" | "lmstudio" : runtime.lmStudioApiMode,
    lmStudioModel: modelId
  });
  clearLmStudioEndpointCache();
  const modelState = await listLocalModels();
  return {
    ok: true,
    runtime: config,
    ...modelState,
    unloaded: [...preloadUnload.unloaded, ...postloadUnload.unloaded],
    unloadWarnings: [...preloadUnload.warnings, ...postloadUnload.warnings],
    activeChatModels: modelState.active
  };
}

export async function useActiveLmStudioModel() {
  const activeModels = await lmsJson<Array<Record<string, unknown>>>(["ps", "--json"]).catch(() => []);
  const active = activeModels
    .map((model) => String(model.identifier || model.modelKey || ""))
    .find((id) => id && !isEmbeddingModel(id));
  if (!active) throw new Error("No encontre un modelo READY en LM Studio.");
  const detected = await detectLmStudioInferenceEndpoint(active);
  const config = updateRuntimeModelConfig({
    llmProvider: "lmstudio",
    lmStudioBaseUrl: detected.ok ? detected.baseUrl : runtime.lmStudioBaseUrl,
    lmStudioApiMode: detected.ok ? detected.apiMode as "openai" | "lmstudio" : runtime.lmStudioApiMode,
    lmStudioModel: active
  });
  clearLmStudioEndpointCache();
  return { ok: true, runtime: config, activeModel: active, api: detected, ...(await listLocalModels()) };
}

async function getActiveChatModelIds() {
  const activeModels = await lmsJson<Array<Record<string, unknown>>>(["ps", "--json"]).catch(() => []);
  return activeModels
    .map((model) => String(model.identifier || model.modelKey || ""))
    .filter((id) => id && !isEmbeddingModel(id));
}

// Descarga TODOS los modelos cargados en LM Studio para liberar VRAM. Se usa al
// cambiar a un proveedor en la nube (Gemini), donde el modelo local ya no hace
// falta. Best-effort: si lms no esta o no hay nada cargado, no pasa nada.
export async function unloadAllLocalModels(): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    const output = await lms(["unload", "--all"], 60000);
    console.log("lmstudio_unload_all", JSON.stringify({ output: output.slice(0, 160) }));
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown unload error";
    console.warn("lmstudio_unload_all_failed", JSON.stringify({ error: message }));
    return { ok: false, error: message };
  }
}

async function unloadOtherChatModels(selectedModelId: string, activeIds: string[]) {
  const uniqueIds = Array.from(new Set(activeIds)).filter((id) => id && id !== selectedModelId && !isEmbeddingModel(id));
  const unloaded: string[] = [];
  const warnings: string[] = [];
  for (const id of uniqueIds) {
    try {
      await lms(["unload", id], 60000);
      unloaded.push(id);
      console.log("lmstudio_model_unloaded", JSON.stringify({ model: id, selectedModel: selectedModelId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown unload error";
      warnings.push(`${id}: ${message}`);
      console.warn("lmstudio_model_unload_failed", JSON.stringify({ model: id, selectedModel: selectedModelId, error: message }));
    }
  }
  return { unloaded, warnings };
}

function lmStudioLoadFlags() {
  const flags: string[] = [];
  const gpuOffload = String(runtime.lmStudioGpuOffload || process.env.LM_STUDIO_GPU_OFFLOAD || "").trim();
  const contextLength = String(runtime.lmStudioContextLength || process.env.LM_STUDIO_CONTEXT_LENGTH || "").trim();
  const ttl = String(runtime.lmStudioTtl || process.env.LM_STUDIO_TTL || "").trim();

  if (gpuOffload) flags.push("--gpu", gpuOffload);
  if (contextLength) flags.push("--context-length", contextLength);
  if (ttl) flags.push("--ttl", ttl);
  return flags;
}

function isEmbeddingModel(id: string) {
  return /embedding|embed/i.test(id);
}

async function isLmStudioServerRunning() {
  const output = await lms(["server", "status"]).catch(() => "");
  return /running/i.test(output);
}

function lmsJson<T>(args: string[]): Promise<T> {
  return lms(args).then((stdout) => JSON.parse(stdout) as T);
}

function lms(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("lms", args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve((stdout || stderr).trim());
    });
  });
}
