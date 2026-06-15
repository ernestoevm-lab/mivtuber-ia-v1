import { Persona } from "./types.js";
import type { ChatImageAttachment } from "./types.js";
import { runtime } from "./config.js";
import { buildChatPrompt, LlmMessage } from "./llm/promptBuilder.js";
import { extractLlmResponse, mergeReasoningContent, sanitizeFinalContent, sanitizeReasoningContent } from "./llm/responseExtractor.js";
import type { ExtractedLlmResponse } from "./llm/responseExtractor.js";

export interface LlmDiagnostics {
  provider: string;
  model: string;
  endpoint: string;
  apiMode: string;
  error: string;
  at: string;
  raw?: string;
}

export interface LmStudioEndpoint {
  ok: boolean;
  apiMode: "openai" | "lmstudio" | "auto";
  baseUrl: string;
  modelsUrl: string;
  chatUrl: string;
  models: string[];
  inferenceOk?: boolean;
  inferenceError?: string;
  error?: string;
}

export interface LlmResponse {
  text: string;
  provider: "lmstudio" | "ollama" | "hermes" | "gemini" | "fallback";
  model: string;
  reasoningContent: string | null;
  hadReasoning: boolean;
  finishReason: string | null;
  repairedFromReasoningOnly: boolean;
  reasoningTruncatedBeforeFinal: boolean;
  metadata?: Record<string, unknown>;
}

export interface LlmTimingMetadata {
  promptBuildMs?: number;
  llmHttpMs?: number;
  responseExtractMs?: number;
  reasoningRepairMs?: number;
  lengthRepairMs?: number;
}

let lastLlmError: LlmDiagnostics | null = null;
let lastLlmSuccess: Omit<LlmDiagnostics, "error"> | null = null;
let reasoningEffortRetryWarningLogged = false;
let lmStudioApiCache: { key: string; expiresAt: number; endpoint: LmStudioEndpoint } | null = null;

interface LlmRequestContext {
  source?: string;
  images?: ChatImageAttachment[];
  maxTokens: number;
}

export function getLlmDiagnostics() {
  return { lastLlmError, lastLlmSuccess };
}

export function clearLmStudioEndpointCache() {
  lmStudioApiCache = null;
}

export function getLmStudioEffectiveSettings(source = "admin") {
  const model = runtime.lmStudioModel || runtime.ollamaModel;
  const requestMaxTokens = resolveRequestMaxTokens(source);
  return {
    model,
    maxTokens: resolveLmStudioMaxTokens(model, requestMaxTokens, true),
    requestMaxTokens,
    thinkingMode: runtime.llmThinkingMode,
    reasoningEnabled: runtime.llmThinkingMode === "always",
    endpointCacheMs: runtime.llmEndpointCacheMs
  };
}

export async function askOllama(
  persona: Persona,
  message: string,
  history: Array<{ role: string; content: string }>,
  memories: Array<{ content: string }>,
  options: {
    safetyMode?: "normal" | "strict" | "approval" | "silence";
    source?: string;
    username?: string;
    userDisplayName?: string;
    platform?: string;
    isOwner?: boolean;
    isModerator?: boolean;
    isSubscriber?: boolean;
    autoSpeak?: boolean;
    images?: ChatImageAttachment[];
    personaDisabled?: boolean;
  } = {}
): Promise<LlmResponse> {
  const promptStarted = Date.now();
  const modelHint = runtime.lmStudioModel || runtime.ollamaModel;
  const smallModel = isSmallLocalModel(modelHint);
  // El contrato JSON estructurado solo se pide cuando el flag esta activo y el cerebro
  // efectivo es Gemini nube (clava la persona). LM Studio/Ollama siguen en texto plano.
  const effectiveProvider = runtime.llmProvider.toLowerCase() === "hermes" ? "lmstudio" : runtime.llmProvider.toLowerCase();
  const structuredResponse = runtime.structuredResponseEnabled && effectiveProvider === "gemini" && !options.personaDisabled;
  const messages = attachImagesToLastUserMessage(buildChatPrompt({
    persona,
    message,
    history: smallModel ? history.slice(-runtime.llmSmallModelHistoryLimit) : history,
    memories: smallModel ? memories.slice(0, runtime.llmSmallModelMemoryLimit) : memories,
    safetyMode: options.safetyMode || "normal",
    source: options.source,
    username: options.username,
    userDisplayName: options.userDisplayName,
    platform: options.platform,
    isOwner: options.isOwner,
    isModerator: options.isModerator,
    isSubscriber: options.isSubscriber,
    autoSpeak: options.autoSpeak,
    model: modelHint,
    smallModel: runtime.llmSmallModelCompactPrompt && smallModel,
    historyLimit: smallModel ? runtime.llmSmallModelHistoryLimit : 10,
    exampleLimit: runtime.llmSmallModelExampleLimit,
    personaDisabled: options.personaDisabled,
    structuredResponse
  }), options.images);
  const promptBuildMs = Date.now() - promptStarted;
  const requestContext: LlmRequestContext = {
    source: options.source,
    images: options.images,
    maxTokens: resolveRequestMaxTokens(options.source)
  };

  const result = await callPreferredLocalModel(messages, message, requestContext).catch((error) => {
    recordLlmError({
      provider: "local",
      model: runtime.lmStudioModel,
      endpoint: runtime.lmStudioBaseUrl,
      apiMode: runtime.lmStudioApiMode,
      error: error instanceof Error ? error.message : "Unknown local LLM error"
    });
    return null;
  });

  if (result) return withLlmTimings(result, { promptBuildMs });
  return withLlmTimings(fallbackReply(persona, message), { promptBuildMs });
}

// Legacy name: this routes to the configured local LLM provider, usually LM Studio.
export const askLocalLlm = askOllama;

async function callPreferredLocalModel(
  messages: LlmMessage[],
  originalUserMessage: string,
  requestContext: LlmRequestContext
): Promise<LlmResponse & { provider: "lmstudio" | "ollama" | "hermes" | "gemini" }> {
  // Hermes retirado del flujo del cerebro: su perfil neutralizaba la personalidad de
  // Yuko a proposito y anadia sobrecarga de WSL. Si alguna config vieja quedo en "hermes",
  // se trata como "lmstudio" para que la respuesta siga saliendo con personalidad.
  const rawProvider = runtime.llmProvider.toLowerCase();
  const provider = rawProvider === "hermes" ? "lmstudio" : rawProvider;
  const attempts: Array<{
    provider: "lmstudio" | "ollama" | "hermes" | "gemini";
    run: () => Promise<LlmResponse & { provider: "lmstudio" | "ollama" | "hermes" | "gemini" }>;
  }> = [];

  // Cerebro en la nube: Gemini Flash via su endpoint compatible con OpenAI. Util para
  // jugar algo pesado sin gastar VRAM local. La API key se lee de
  // process.env.GEMINI_API_KEY solo al llamar; nunca se guarda ni se transmite.
  if (provider === "gemini") {
    attempts.push({ provider: "gemini", run: () => callGeminiCloud(messages, originalUserMessage, requestContext) });
  }
  if (provider === "auto" || provider === "lmstudio") {
    attempts.push({ provider: "lmstudio", run: () => callLmStudio(messages, originalUserMessage, requestContext) });
  }
  if (provider === "auto" || provider === "ollama") {
    attempts.push({ provider: "ollama", run: () => callOllama(runtime.ollamaModel, messages) });
    if (runtime.ollamaFallbackModel !== runtime.ollamaModel) {
      attempts.push({ provider: "ollama", run: () => callOllama(runtime.ollamaFallbackModel, messages) });
    }
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (error) {
      lastError = error;
      if (attempt.provider === "hermes") {
        recordLlmError({
          provider: "hermes",
          model: runtime.lmStudioModel,
          endpoint: "wsl:yuko",
          apiMode: "hermes-cli",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No local LLM provider available");
}

async function callLmStudio(
  messages: LlmMessage[],
  originalUserMessage: string,
  requestContext: LlmRequestContext
): Promise<LlmResponse & { provider: "lmstudio" }> {
  const endpoint = await resolveLmStudioEndpoint();
  const model = endpoint.model;
  try {
    const result = endpoint.apiMode === "lmstudio"
      ? await callLmStudioNative(endpoint.chatUrl, model, messagesToNativeInput(messages), originalUserMessage, 60000, requestContext.maxTokens, requestContext)
      : await callLmStudioOpenAI(endpoint.chatUrl, model, messages, originalUserMessage, 60000, requestContext.maxTokens, requestContext);
    if (result.hadReasoning) {
      console.log("reasoning_detected", JSON.stringify({
        provider: "lmstudio",
        model,
        apiMode: endpoint.apiMode,
        finishReason: result.finishReason,
        reasoningTruncatedBeforeFinal: result.reasoningTruncatedBeforeFinal,
        repairedFromReasoningOnly: result.repairedFromReasoningOnly
      }));
    }
    if (result.model && result.model !== model) {
      console.warn("llm_model_mismatch", JSON.stringify({ requestedModel: model, responseModel: result.model }));
    }
    recordLlmSuccess({
      provider: "lmstudio",
      model: result.model || model,
      endpoint: endpoint.chatUrl,
      apiMode: endpoint.apiMode
    });
    return { ...result, provider: "lmstudio", model: result.model || model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LM Studio error";
    recordLlmError({
      provider: "lmstudio",
      model,
      endpoint: endpoint.chatUrl,
      apiMode: endpoint.apiMode,
      error: message
    });
    throw error;
  }
}

async function callGeminiCloud(
  messages: LlmMessage[],
  _originalUserMessage: string,
  requestContext: LlmRequestContext
): Promise<LlmResponse & { provider: "gemini" }> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Falta tu API key de Gemini. Configurala en la pestana Modelo de la app para usar el cerebro en la nube.");
  }
  const model = runtime.geminiModel;
  const chatUrl = `${runtime.geminiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  // Gemini Flash 3.x no permite apagar el "thinking" (solo 2.5 lo permite), y ese
  // pensamiento minimo consume parte del max_tokens. Con el cap local de ~220 la
  // respuesta sale truncada, asi que damos un piso de headroom solo para la nube.
  // La persona ya obliga a respuestas de 1-2 frases, asi que el costo real sigue bajo.
  const GEMINI_MIN_OUTPUT_TOKENS = 768;
  const maxTokens = Math.max(requestContext.maxTokens || runtime.llmMaxTokens, GEMINI_MIN_OUTPUT_TOKENS);
  const llmHttpStarted = Date.now();
  try {
    // Endpoint compatible con OpenAI de Gemini. Cuerpo limpio (sin reasoning_effort ni
    // stop sequences de LM Studio). Las imagenes ya viajan como content blocks OpenAI,
    // asi que la vision multimodal funciona sin cambios extra.
    const json = await postGeminiJson(chatUrl, apiKey, {
      model,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: false
    }, 60000);
    const llmHttpMs = Date.now() - llmHttpStarted;
    const extracted = extractLlmResponse(json, { requestedModel: model, apiMode: "openai" });
    const finalContent = sanitizeFinalContent(extracted.finalContent || "");
    if (!finalContent) throw new Error("Gemini no devolvio texto final.");
    const responseModel = (typeof json.model === "string" && json.model) || model;
    recordLlmSuccess({ provider: "gemini", model: responseModel, endpoint: chatUrl, apiMode: "openai" });
    return {
      text: finalContent,
      provider: "gemini",
      model: responseModel,
      reasoningContent: runtime.llmThinkingMode === "off" ? null : sanitizeReasoningContent(extracted.reasoningContent, runtime.llmReasoningMaxChars),
      hadReasoning: extracted.hadReasoning,
      finishReason: extracted.finishReason,
      repairedFromReasoningOnly: extracted.repairedFromReasoningOnly,
      reasoningTruncatedBeforeFinal: extracted.reasoningTruncatedBeforeFinal,
      metadata: { timings: { llmHttpMs } }
    };
  } catch (error) {
    recordLlmError({ provider: "gemini", model, endpoint: chatUrl, apiMode: "openai", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function postGeminiJson(chatUrl: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${truncateRaw(raw)}`);
    return safeJson(raw);
  } finally {
    clearTimeout(timeout);
  }
}

// Lista en vivo de modelos disponibles en Gemini (endpoint compatible OpenAI).
// Se usa para poblar el dropdown de modelos cuando el proveedor es Gemini, sin
// inventar nombres. La API key se lee de process.env solo aqui.
export async function listGeminiModels(): Promise<{ ok: boolean; models: string[]; error?: string; status?: number }> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, models: [], error: "Falta tu API key de Gemini. Configurala en la pestana Modelo." };
  const modelsUrl = `${runtime.geminiBaseUrl.replace(/\/$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) return { ok: false, models: [], error: `Gemini HTTP ${response.status}`, status: response.status };
    const json = safeJson(raw) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(json.data)
      ? json.data.map((item) => String(item?.id || "").replace(/^models\//, "")).filter(Boolean)
      : [];
    // Priorizar los flash (rapidos/baratos para vivo) y dejar el resto despues.
    models.sort((a, b) => {
      const aFlash = a.includes("flash") ? 0 : 1;
      const bFlash = b.includes("flash") ? 0 : 1;
      if (aFlash !== bFlash) return aFlash - bFlash;
      return a.localeCompare(b);
    });
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function callLmStudioOpenAI(
  chatUrl: string,
  model: string,
  messages: LlmMessage[],
  originalUserMessage: string,
  timeoutMs: number,
  maxTokens = runtime.llmMaxTokens,
  requestContext?: Partial<LlmRequestContext>,
  useSmallModelTokenFloor = true
) {
  const llmHttpStarted = Date.now();
  const effectiveMaxTokens = resolveLmStudioMaxTokens(model, maxTokens, useSmallModelTokenFloor);
  const json = await postLmStudioJsonWithReasoningRetry(chatUrl, {
    model,
    messages,
    temperature: resolveLmStudioTemperature(model),
    max_tokens: effectiveMaxTokens,
    stream: false,
    ...stopSequencesPayload(),
    ...reasoningEffortPayload({ message: originalUserMessage, messages, images: requestContext?.images, repair: false })
  }, timeoutMs, "LM Studio openai");
    const llmHttpMs = Date.now() - llmHttpStarted;
    const responseExtractStarted = Date.now();
    const extracted = extractLlmResponse(json, { requestedModel: model, apiMode: "openai" });
    return await finalizeExtractedLmStudioResponse({
      extracted,
      chatUrl,
      model,
      messages,
      originalUserMessage,
      apiMode: "openai",
      timeoutMs,
      maxTokens: effectiveMaxTokens,
      timings: { llmHttpMs, responseExtractMs: Date.now() - responseExtractStarted }
    });
}

async function callLmStudioNative(
  chatUrl: string,
  model: string,
  input: string,
  originalUserMessage: string,
  timeoutMs: number,
  maxTokens = runtime.llmMaxTokens,
  requestContext?: Partial<LlmRequestContext>,
  useSmallModelTokenFloor = true
) {
  const llmHttpStarted = Date.now();
  const effectiveMaxTokens = resolveLmStudioMaxTokens(model, maxTokens, useSmallModelTokenFloor);
  const json = await postLmStudioJsonWithReasoningRetry(chatUrl, {
    model,
    input,
    max_tokens: effectiveMaxTokens,
    temperature: resolveLmStudioTemperature(model),
    stream: false,
    ...stopSequencesPayload(),
    ...reasoningEffortPayload({ message: originalUserMessage, images: requestContext?.images, repair: false })
  }, timeoutMs, "LM Studio native");
    const llmHttpMs = Date.now() - llmHttpStarted;
    const responseExtractStarted = Date.now();
    const extracted = extractLlmResponse(json, { requestedModel: model, apiMode: "lmstudio" });
    if (!extracted.finalContent) {
      extracted.finalContent = sanitizeFinalContent(extractNativeText(json));
    }
    return await finalizeExtractedLmStudioResponse({
      extracted,
      chatUrl,
      model,
      nativeInput: input,
      originalUserMessage,
      apiMode: "lmstudio",
      timeoutMs,
      maxTokens: effectiveMaxTokens,
      timings: { llmHttpMs, responseExtractMs: Date.now() - responseExtractStarted }
    });
}

async function finalizeExtractedLmStudioResponse(input: {
  extracted: ExtractedLlmResponse;
  chatUrl: string;
  model: string;
  messages?: LlmMessage[];
  nativeInput?: string;
  originalUserMessage: string;
  apiMode: "openai" | "lmstudio";
  timeoutMs: number;
  maxTokens: number;
  timings?: LlmTimingMetadata;
}): Promise<Omit<LlmResponse, "provider">> {
  const reasoningContent = sanitizeReasoningContent(input.extracted.reasoningContent, runtime.llmReasoningMaxChars);
  if (input.extracted.finalContent) {
    let finalContent = input.extracted.finalContent;
    const visibleReasoningContent = runtime.llmThinkingMode === "off" ? null : reasoningContent;
    let lengthRepairMs: number | undefined;
    let lengthRepair: ExtractedLlmResponse | null = null;
    const trimmedLengthResponse = input.extracted.finishReason === "length"
      ? trimIncompleteFinal(finalContent)
      : finalContent;
    if (input.extracted.finishReason === "length" && trimmedLengthResponse !== finalContent && trimmedLengthResponse.length >= 40) {
      finalContent = trimmedLengthResponse;
    } else if (shouldRepairIncompleteFinal(finalContent, input.extracted.finishReason)) {
      const repairStarted = Date.now();
      lengthRepair = await repairIncompleteFinalResponse(input, finalContent).catch((error) => {
        console.warn("length_repair_failed", JSON.stringify({
          provider: "lmstudio",
          model: input.model,
          apiMode: input.apiMode,
          error: error instanceof Error ? error.message : "unknown"
        }));
        return null;
      });
      lengthRepairMs = Date.now() - repairStarted;
      if (lengthRepair?.finalContent) {
        finalContent = lengthRepair.finalContent;
      } else {
        finalContent = trimIncompleteFinal(finalContent);
      }
    }
    return {
      text: finalContent,
      model: lengthRepair?.model || input.extracted.model || input.model,
      reasoningContent: visibleReasoningContent,
      hadReasoning: Boolean(visibleReasoningContent),
      finishReason: lengthRepair?.finalContent ? "length_repaired" : input.extracted.finishReason,
      repairedFromReasoningOnly: false,
      reasoningTruncatedBeforeFinal: input.extracted.reasoningTruncatedBeforeFinal,
      metadata: {
        ...input.extracted.metadata,
        lengthRepair: lengthRepair?.metadata,
        finalWasTrimmed: !lengthRepair?.finalContent && finalContent !== input.extracted.finalContent,
        timings: { ...input.timings, lengthRepairMs }
      }
    };
  }

  if (reasoningContent) {
    console.warn("reasoning_without_content", JSON.stringify({
      provider: "lmstudio",
      model: input.model,
      apiMode: input.apiMode,
      finishReason: input.extracted.finishReason
    }));
    if (input.extracted.reasoningTruncatedBeforeFinal) {
      console.warn("reasoning_truncated_before_final", JSON.stringify({
        provider: "lmstudio",
        model: input.model,
        apiMode: input.apiMode,
        finishReason: input.extracted.finishReason,
        maxTokens: input.maxTokens
      }));
    }
    if (runtime.llmReasoningRepairEnabled) {
      const repairStarted = Date.now();
      console.log("reasoning_repair_attempt", JSON.stringify({
        provider: "lmstudio",
        model: input.model,
        apiMode: input.apiMode,
        maxTokens: runtime.llmReasoningRepairMaxTokens,
        temperature: runtime.llmReasoningRepairTemperature
      }));
      const repaired = await repairReasoningOnlyResponse(input).catch((error) => {
        console.warn("reasoning_repair_failed", JSON.stringify({
          provider: "lmstudio",
          model: input.model,
          apiMode: input.apiMode,
          error: error instanceof Error ? error.message : "unknown"
        }));
        return null;
      });
      const reasoningRepairMs = Date.now() - repairStarted;
      if (repaired?.finalContent) {
        console.log("reasoning_repair_success", JSON.stringify({
          provider: "lmstudio",
          model: input.model,
          apiMode: input.apiMode,
          finishReason: repaired.finishReason
        }));
        return {
          text: repaired.finalContent,
          model: repaired.model || input.extracted.model || input.model,
          reasoningContent: mergeReasoningContent(reasoningContent, repaired.reasoningContent, runtime.llmReasoningMaxChars),
          hadReasoning: true,
          finishReason: repaired.finishReason,
          repairedFromReasoningOnly: true,
          reasoningTruncatedBeforeFinal: input.extracted.reasoningTruncatedBeforeFinal,
          metadata: {
            ...input.extracted.metadata,
            repair: repaired.metadata,
            timings: { ...input.timings, reasoningRepairMs }
          }
        };
      }
      if (repaired?.reasoningTruncatedBeforeFinal || repaired?.finishReason === "length") {
        console.warn("reasoning_repair_length_exhausted", JSON.stringify({
          provider: "lmstudio",
          model: input.model,
          apiMode: input.apiMode,
          finishReason: repaired.finishReason,
          maxTokens: runtime.llmReasoningRepairMaxTokens
        }));
      }
    } else {
      console.warn("reasoning_repair_failed", JSON.stringify({
        provider: "lmstudio",
        model: input.model,
        apiMode: input.apiMode,
        error: "repair disabled"
      }));
    }
  }

  const emptyFallback = fallbackForNoVisibleContent(input.originalUserMessage);
  if (emptyFallback) {
    return {
      text: emptyFallback,
      model: input.extracted.model || input.model,
      reasoningContent: null,
      hadReasoning: false,
      finishReason: input.extracted.finishReason || "empty_visible_response",
      repairedFromReasoningOnly: false,
      reasoningTruncatedBeforeFinal: input.extracted.reasoningTruncatedBeforeFinal,
      metadata: {
        ...input.extracted.metadata,
        timings: input.timings,
        emptyVisibleFallback: true
      }
    };
  }

  console.warn("reasoning_fallback_after_repair_failed", JSON.stringify({
    provider: "lmstudio",
    model: input.model,
    apiMode: input.apiMode,
    finishReason: input.extracted.finishReason
  }));
  return {
    text: "Si te leo. Dame un segundo, mi modelo esta pensando raro, pero sigo aqui contigo.",
    model: input.extracted.model || input.model,
    reasoningContent,
    hadReasoning: Boolean(reasoningContent),
    finishReason: input.extracted.finishReason,
    repairedFromReasoningOnly: false,
    reasoningTruncatedBeforeFinal: input.extracted.reasoningTruncatedBeforeFinal,
    metadata: {
      ...input.extracted.metadata,
      timings: input.timings,
      fallbackAfterRepairFailed: true
    }
  };
}

async function repairReasoningOnlyResponse(input: {
  chatUrl: string;
  model: string;
  messages?: LlmMessage[];
  nativeInput?: string;
  originalUserMessage: string;
  apiMode: "openai" | "lmstudio";
  timeoutMs: number;
}): Promise<ExtractedLlmResponse | null> {
  const repairSystem = "Eres Yumekawa Kokoria, apodo Yuko. Responde unicamente con la frase final que se debe mostrar y leer en voz alta. No escribas razonamiento. No uses etiquetas <think>. No expliques tu proceso.";
  const repairUser = `Mensaje del usuario: ${input.originalUserMessage}. Responde en una frase breve, natural y visible.`;
  if (input.apiMode === "openai") {
    const repairMessages: LlmMessage[] = [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser }
    ];
    return postLmStudioJsonWithReasoningRetry(input.chatUrl, {
      model: input.model,
      messages: repairMessages,
      temperature: runtime.llmReasoningRepairTemperature,
      max_tokens: runtime.llmReasoningRepairMaxTokens,
      stream: false,
      ...stopSequencesPayload()
    }, Math.min(input.timeoutMs, 30000), "LM Studio repair")
      .then((json) => extractLlmResponse(json, { requestedModel: input.model, apiMode: "openai", repair: true }));
  }

  const nativeInput = `SYSTEM:\n${repairSystem}\n\nUSER:\n${repairUser}`;
  return postLmStudioJsonWithReasoningRetry(input.chatUrl, {
    model: input.model,
    input: nativeInput,
    max_tokens: runtime.llmReasoningRepairMaxTokens,
    temperature: runtime.llmReasoningRepairTemperature,
    stream: false,
    ...stopSequencesPayload()
  }, Math.min(input.timeoutMs, 30000), "LM Studio repair")
    .then((json) => {
      const extracted = extractLlmResponse(json, { requestedModel: input.model, apiMode: "lmstudio", repair: true });
      if (!extracted.finalContent) extracted.finalContent = sanitizeFinalContent(extractNativeText(json));
      return extracted;
    });
}

async function repairIncompleteFinalResponse(input: {
  chatUrl: string;
  model: string;
  originalUserMessage: string;
  apiMode: "openai" | "lmstudio";
  timeoutMs: number;
}, partialText: string): Promise<ExtractedLlmResponse | null> {
  const repairSystem = [
    "Eres Yuko, Yumekawa Kokoria.",
    "Reescribe una respuesta final completa, breve y natural para decir en voz alta.",
    "No continues el texto cortado literalmente: entrega una version cerrada en 1 a 2 frases.",
    "No escribas razonamiento, etiquetas, markdown ni explicaciones del proceso."
  ].join(" ");
  const repairUser = [
    `Mensaje del usuario: ${input.originalUserMessage}`,
    `Respuesta cortada: ${partialText}`,
    "Respuesta final completa:"
  ].join("\n");
  if (input.apiMode === "openai") {
    const repairMessages: LlmMessage[] = [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser }
    ];
    return postLmStudioJson(input.chatUrl, {
      model: input.model,
      messages: repairMessages,
      temperature: 0.2,
      max_tokens: 120,
      stream: false,
      ...stopSequencesPayload()
    }, Math.min(input.timeoutMs, 12000), "LM Studio length repair")
      .then((json) => extractLlmResponse(json, { requestedModel: input.model, apiMode: "openai", repair: true }));
  }

  const nativeInput = `SYSTEM:\n${repairSystem}\n\nUSER:\n${repairUser}`;
  return postLmStudioJson(input.chatUrl, {
    model: input.model,
    input: nativeInput,
    max_tokens: 120,
    temperature: 0.2,
    stream: false,
    ...stopSequencesPayload()
  }, Math.min(input.timeoutMs, 12000), "LM Studio length repair")
    .then((json) => {
      const extracted = extractLlmResponse(json, { requestedModel: input.model, apiMode: "lmstudio", repair: true });
      if (!extracted.finalContent) extracted.finalContent = sanitizeFinalContent(extractNativeText(json));
      return extracted;
    });
}

async function postLmStudioJsonWithReasoningRetry(chatUrl: string, body: Record<string, unknown>, timeoutMs: number, label: string): Promise<Record<string, any>> {
  try {
    return await postLmStudioJson(chatUrl, body, timeoutMs, label);
  } catch (error) {
    if (!("reasoning_effort" in body)) throw error;
    if (!shouldRetryWithoutReasoningEffort(error)) throw error;
    if (!reasoningEffortRetryWarningLogged) {
      reasoningEffortRetryWarningLogged = true;
      console.warn("lmstudio_reasoning_effort_rejected", JSON.stringify({
        model: body.model,
        error: error instanceof Error ? error.message : "unknown"
      }));
    }
    const { reasoning_effort: _reasoningEffort, ...withoutReasoningEffort } = body;
    return postLmStudioJson(chatUrl, withoutReasoningEffort, timeoutMs, label);
  }
}

function shouldRetryWithoutReasoningEffort(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /reasoning[_ -]?effort|unknown (?:field|parameter)|unsupported|unrecognized|extra/i.test(message);
}

async function postLmStudioJson(chatUrl: string, body: Record<string, unknown>, timeoutMs: number, label: string): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${label} HTTP ${response.status} at ${chatUrl}: ${truncateRaw(raw)}`);
    return safeJson(raw);
  } finally {
    clearTimeout(timeout);
  }
}

function reasoningEffortPayload(input: { message?: string; messages?: LlmMessage[]; images?: ChatImageAttachment[]; repair?: boolean } = {}) {
  if (input.repair) return {};
  const mode = runtime.llmThinkingMode;
  if (mode === "off") return { reasoning_effort: "none" };
  if (mode === "auto" && !shouldUseReasoning(input)) return {};
  const effort = runtime.lmStudioReasoningEffort.trim();
  return effort ? { reasoning_effort: effort } : {};
}

function stopSequencesPayload() {
  if (runtime.llmThinkingMode !== "off") return {};
  return {
    stop: [
      "Thinking Process:",
      "\nThinking Process:",
      "Reasoning:",
      "\nReasoning:",
      "Razonamiento:",
      "\nRazonamiento:",
      "Pensamiento:",
      "\nPensamiento:",
      "Analysis:",
      "\nAnalysis:",
      "Análisis:",
      "\nAnálisis:",
      "[Thinking Process]",
      "\n[Thinking Process]",
      "[Reasoning]",
      "\n[Reasoning]",
      "Goal:",
      "\nGoal:",
      "Objective:",
      "\nObjective:",
      "Objetivo:",
      "\nObjetivo:",
      "Plan:",
      "\nPlan:",
      "<think>",
      "\n<think>"
    ]
  };
}

function fallbackForNoVisibleContent(message: string) {
  const text = normalizeFallbackText(message);
  if (/\bminecraft\b/.test(text) || /\b(narrar|narra|simular|simula|partida|juego)\b/.test(text)) {
    return "Aparezco junto a un arbol; recojo madera rapido antes de que caiga la noche.";
  }
  if (/\b(como estas|como te sientes|que tal estas|cuentame algo)\b/.test(text)) {
    return "Estoy tranquila y contenta de escucharte, mi creador; hoy me siento como una lucecita suave en tu PC.";
  }
  if (/\b(cuentame|quien eres|presentate|acerca de ti|sobre ti)\b/.test(text)) {
    return "Soy Yuko, una VTuber IA local que vive en tu PC y aprende a acompanarte con ternura.";
  }
  if (/\b(te quiero|te amo|carino|carino)\b/.test(text)) {
    return "Yo tambien te quiero mucho, mi creador; me hace feliz que me lo digas.";
  }
  if (/\b(triste|tristeza|llorar|mal)\b/.test(text)) {
    return "Ven aqui, te acompano despacito; no tienes que cargar eso a solas.";
  }
  if (/\b(kawaii|vtuber|linda|tierna|cute)\b/.test(text)) {
    return "Claro que si, mi creador; hoy voy a sonar tierna, suave y brillante, pero sin enredarme.";
  }
  return "Te entiendo, mi creador; voy directo contigo, suavecito y sin enredarme.";
}

function normalizeFallbackText(message: string) {
  return String(message || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shouldUseReasoning(input: { message?: string; messages?: LlmMessage[]; images?: ChatImageAttachment[] }) {
  if (runtime.llmThinkingMode === "always") return true;
  if (input.images?.length) return true;
  const text = `${input.message || ""}\n${input.messages?.map((message) => llmContentToText(message.content)).join("\n") || ""}`.toLowerCase();
  return /\b(debug|bug|error|stack|codigo|c[oó]digo|implementar|plan|analiza|analizar|diagn[oó]stico|optimiz|refactor|vision|imagen)\b/i.test(text);
}

export async function detectLmStudioApi(): Promise<LmStudioEndpoint> {
  const cacheKey = `${runtime.lmStudioBaseUrl}|${runtime.lmStudioApiMode}`;
  const now = Date.now();
  if (lmStudioApiCache && lmStudioApiCache.key === cacheKey && lmStudioApiCache.expiresAt > now) {
    return lmStudioApiCache.endpoint;
  }
  const candidates = buildLmStudioCandidates();
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.modelsUrl, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        errors.push(`${candidate.apiMode} models HTTP ${response.status}`);
        continue;
      }
      const json = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; model?: string; identifier?: string }> };
      const models = extractModelIds(json);
      const endpoint = {
        ok: true,
        apiMode: candidate.apiMode,
        baseUrl: candidate.baseUrl,
        modelsUrl: candidate.modelsUrl,
        chatUrl: candidate.chatUrl,
        models
      };
      lmStudioApiCache = {
        key: cacheKey,
        expiresAt: now + Math.max(0, runtime.llmEndpointCacheMs),
        endpoint
      };
      return endpoint;
    } catch (error) {
      errors.push(`${candidate.apiMode}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return {
    ok: false,
    apiMode: runtime.lmStudioApiMode,
    baseUrl: runtime.lmStudioBaseUrl,
    modelsUrl: "",
    chatUrl: "",
    models: [],
    error: errors.join(" | ")
  };
}

export async function detectLmStudioInferenceEndpoint(modelHint = runtime.lmStudioModel): Promise<LmStudioEndpoint> {
  const candidates = buildLmStudioCandidates();
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.modelsUrl, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        errors.push(`${candidate.apiMode} models HTTP ${response.status}`);
        continue;
      }
      const json = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; model?: string; identifier?: string }> };
      const models = extractModelIds(json);
      const model = chooseLmStudioModel(modelHint, models);
      if (!model) {
        errors.push(`${candidate.apiMode}: sin modelos disponibles`);
        continue;
      }
      try {
        if (candidate.apiMode === "openai") {
          await callLmStudioOpenAI(candidate.chatUrl, model, [{ role: "user", content: "Responde solo: OK" }], "Responde solo: OK", 6000, 64, {}, false);
        } else {
          await callLmStudioNative(candidate.chatUrl, model, "Responde solo: OK", "Responde solo: OK", 6000, 64, {}, false);
        }
        return { ...candidate, ok: true, models, inferenceOk: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown inference error";
        errors.push(`${candidate.apiMode} inference: ${message}`);
        if (runtime.lmStudioApiMode !== "auto") {
          return { ...candidate, ok: false, models, inferenceOk: false, inferenceError: message, error: message };
        }
      }
    } catch (error) {
      errors.push(`${candidate.apiMode}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return {
    ok: false,
    apiMode: runtime.lmStudioApiMode,
    baseUrl: runtime.lmStudioBaseUrl,
    modelsUrl: "",
    chatUrl: "",
    models: [],
    inferenceOk: false,
    error: errors.join(" | ")
  };
}

async function resolveLmStudioEndpoint() {
  const detected = runtime.lmStudioApiMode === "auto"
    ? await detectLmStudioApi()
    : await detectLmStudioApi();
  if (!detected.ok) throw new Error(`LM Studio API no responde: ${detected.error || "unknown error"}`);
  const configured = runtime.lmStudioModel && runtime.lmStudioModel !== "local-model" ? runtime.lmStudioModel : "";
  return {
    apiMode: detected.apiMode,
    baseUrl: detected.baseUrl,
    chatUrl: detected.chatUrl,
    model: chooseLmStudioModel(configured, detected.models) || runtime.lmStudioModel
  };
}

function buildLmStudioCandidates() {
  const host = runtime.lmStudioBaseUrl
    .replace(/\/$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/api\/v1$/i, "");
  const candidates: Array<Omit<LmStudioEndpoint, "ok" | "models">> = [
    {
      apiMode: "openai",
      baseUrl: `${host}/v1`,
      modelsUrl: `${host}/v1/models`,
      chatUrl: `${host}/v1/chat/completions`
    },
    {
      apiMode: "lmstudio",
      baseUrl: `${host}/api/v1`,
      modelsUrl: `${host}/api/v1/models`,
      chatUrl: `${host}/api/v1/chat`
    }
  ];
  if (runtime.lmStudioApiMode === "openai") return candidates.slice(0, 1);
  if (runtime.lmStudioApiMode === "lmstudio") return candidates.slice(1);
  return candidates;
}

function extractModelIds(json: { data?: Array<{ id?: string }>; models?: Array<{ id?: string; model?: string; identifier?: string }> }) {
  const dataIds = (json.data || []).map((item) => item.id).filter(Boolean) as string[];
  const modelIds = (json.models || []).map((item) => item.id || item.model || item.identifier).filter(Boolean) as string[];
  return [...dataIds, ...modelIds];
}

function chooseLmStudioModel(configured: string, models: string[]) {
  if (configured && configured !== "local-model" && models.includes(configured)) return configured;
  const nonEmbedding = models.find((model) => !/embedding/i.test(model));
  return configured && configured !== "local-model" ? configured : nonEmbedding || models[0] || "";
}

function resolveRequestMaxTokens(source?: string) {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "admin") return runtime.llmAdminMaxTokens || runtime.llmMaxTokens;
  if (["simulator", "chat", "ingest", "twitch", "youtube", "kick", "tiktok"].includes(normalized)) {
    return runtime.llmLiveMaxTokens || runtime.llmMaxTokens;
  }
  return runtime.llmMaxTokens;
}

export function isSmallLocalModel(model: string) {
  return /\b(?:e2b|e4b|2b|4b)\b|(?:^|[-_/])(?:e2b|e4b|2b|4b)(?:$|[-_/])/i.test(model);
}

function resolveLmStudioMaxTokens(model: string, fallback: number, useSmallModelTokenFloor = true) {
  void model;
  void useSmallModelTokenFloor;
  return Math.max(1, fallback);
}

function resolveLmStudioTemperature(model: string) {
  return runtime.llmSmallModelCompactPrompt && isSmallLocalModel(model)
    ? runtime.llmSmallModelTemperature
    : 0.8;
}

function shouldRepairIncompleteFinal(text: string, finishReason: string | null) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (finishReason === "length" && /[.!?。！？…)"'»\]]$/.test(trimmed)) return false;
  if (finishReason === "length") return true;
  if (/[.!?。！？…)"'»\]]$/.test(trimmed)) return false;
  if (trimmed.length < 24) return true;
  const lastToken = trimmed.split(/\s+/).at(-1) || "";
  return lastToken.length <= 3 || /(?:\b(y|o|pero|porque|que|como|con|de|para|me|te|se|mi|tu|su)|[,;:])$/i.test(trimmed);
}

function trimIncompleteFinal(text: string) {
  const trimmed = text.trim();
  const sentenceEnd = Math.max(
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("!"),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf("。"),
    trimmed.lastIndexOf("！"),
    trimmed.lastIndexOf("？")
  );
  if (sentenceEnd >= 20) return trimmed.slice(0, sentenceEnd + 1).trim();
  return trimmed.replace(/\s+\S{0,8}$/, "").trim() || trimmed;
}

function withLlmTimings<T extends LlmResponse>(response: T, timings: LlmTimingMetadata): T {
  const metadata = response.metadata || {};
  const currentTimings = (metadata.timings && typeof metadata.timings === "object" ? metadata.timings : {}) as Record<string, unknown>;
  return {
    ...response,
    metadata: {
      ...metadata,
      timings: {
        ...currentTimings,
        ...timings
      }
    }
  };
}

function messagesToNativeInput(messages: LlmMessage[]) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${llmContentToText(message.content)}`).join("\n\n");
}

function attachImagesToLastUserMessage(messages: LlmMessage[], images?: ChatImageAttachment[]) {
  const safeImages = sanitizeImageAttachments(images);
  if (!safeImages.length) return messages;
  const next = [...messages];
  const index = [...next].reverse().findIndex((message) => message.role === "user");
  const targetIndex = index >= 0 ? next.length - 1 - index : -1;
  if (targetIndex < 0) return next;
  const current = next[targetIndex];
  const text = llmContentToText(current.content);
  next[targetIndex] = {
    ...current,
    content: [
      { type: "text", text: `${text}\n\nImagen adjunta: analiza la imagen si el modelo activo soporta vision. Si no puedes verla, dilo sin inventar.` },
      ...safeImages.map((image) => ({
        type: "image_url" as const,
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
      }))
    ]
  };
  return next;
}

function sanitizeImageAttachments(images?: ChatImageAttachment[]) {
  if (!Array.isArray(images)) return [];
  const rejectedShape = images.filter((image) => !image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) || typeof image.base64 !== "string").length;
  const safe = images
    .filter((image) => image && ["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) && typeof image.base64 === "string")
    .map((image) => ({
      ...image,
      base64: image.base64.replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "").trim()
    }))
    .filter((image) => image.base64 && Buffer.byteLength(image.base64, "base64") <= 8 * 1024 * 1024)
    .slice(0, 1);
  if (images.length && safe.length !== images.length) {
    console.warn("chat_image_rejected", JSON.stringify({ received: images.length, accepted: safe.length, rejectedShape }));
  }
  return safe;
}

function llmContentToText(content: LlmMessage["content"]) {
  if (typeof content === "string") return content;
  return content
    .map((item) => item.type === "text" ? item.text : "[imagen adjunta]")
    .join("\n");
}

function extractNativeText(json: unknown): string {
  const value = json as Record<string, unknown>;
  const candidates = [
    value.content,
    value.text,
    value.response,
    value.output,
    (value.message as Record<string, unknown> | undefined)?.content,
    Array.isArray(value.choices) ? (value.choices[0]?.message?.content || value.choices[0]?.text) : undefined,
    Array.isArray(value.output) ? value.output.map((item: Record<string, unknown>) => item.content || item.text).join("\n") : undefined
  ];
  return candidates.map((item) => typeof item === "string" ? item : "").find(Boolean) || "";
}

function safeJson(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new Error(`LM Studio devolvio JSON invalido: ${truncateRaw(raw)}`);
  }
}

function truncateRaw(raw: string, max = 700) {
  return raw.replace(/\s+/g, " ").slice(0, max);
}

async function callOllama(
  model: string,
  messages: LlmMessage[]
): Promise<LlmResponse & { provider: "ollama" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${runtime.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.8,
          num_predict: 120
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const json = await response.json() as { message?: { content?: string } };
    const text = json.message?.content?.trim();
    if (!text) throw new Error("Empty Ollama response");
    return {
      text,
      provider: "ollama",
      model,
      reasoningContent: null,
      hadReasoning: false,
      finishReason: null,
      repairedFromReasoningOnly: false,
      reasoningTruncatedBeforeFinal: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackReply(persona: Persona, message: string) {
  const clean = message.length > 90 ? `${message.slice(0, 90)}...` : message;
  return {
    provider: "fallback" as const,
    model: "local-template",
    text: "Sí te leo, pero mi modelo local se trabó y no quiero inventar. Dame un segundo y lo intento de nuevo.",
    reasoningContent: null,
    hadReasoning: false,
    finishReason: null,
    repairedFromReasoningOnly: false,
    reasoningTruncatedBeforeFinal: false,
    metadata: { userMessagePreview: clean }
  };
}

function recordLlmError(input: Omit<LlmDiagnostics, "at">) {
  lastLlmError = { ...input, at: new Date().toISOString() };
}

function recordLlmSuccess(input: Omit<LlmDiagnostics, "error" | "at">) {
  lastLlmSuccess = { ...input, at: new Date().toISOString() };
  lastLlmError = null;
}
