export interface ExtractedLlmResponse {
  finalContent: string | null;
  reasoningContent: string | null;
  hadReasoning: boolean;
  finishReason: string | null;
  repairedFromReasoningOnly: boolean;
  reasoningTruncatedBeforeFinal: boolean;
  model?: string;
  provider?: string;
  metadata: Record<string, unknown>;
}

export function extractLlmResponse(
  payload: unknown,
  metadata: Record<string, unknown> = {}
): ExtractedLlmResponse {
  const json = asRecord(payload);
  const choice = Array.isArray(json.choices) ? asRecord(json.choices[0]) : {};
  const message = asRecord(choice.message);
  const delta = asRecord(choice.delta);

  const finalCandidates = [
    message.content,
    delta.content,
    choice.text,
    json.content,
    json.text,
    json.response,
    json.output,
    asRecord(json.message).content
  ];
  const reasoningCandidates = [
    message.reasoning_content,
    message.reasoning,
    message.thinking,
    delta.reasoning_content,
    delta.reasoning,
    delta.thinking,
    choice.reasoning_content,
    choice.reasoning,
    choice.thinking,
    json.reasoning_content,
    json.reasoning,
    json.thinking
  ];

  const finalContent = sanitizeFinalContent(joinText(finalCandidates));
  const reasoningContent = sanitizeReasoningContent(joinText(reasoningCandidates));
  const finishReason = normalizeFinishReason(choice.finish_reason || choice.finishReason || json.finish_reason || json.finishReason);
  const reasoningTruncatedBeforeFinal = !finalContent && Boolean(reasoningContent) && finishReason === "length";

  return {
    finalContent,
    reasoningContent,
    hadReasoning: Boolean(reasoningContent),
    finishReason,
    repairedFromReasoningOnly: false,
    reasoningTruncatedBeforeFinal,
    model: typeof json.model === "string" && json.model.trim() ? json.model.trim() : undefined,
    provider: typeof json.provider === "string" && json.provider.trim() ? json.provider.trim() : undefined,
    metadata: {
      finishReason,
      reasoningTruncatedBeforeFinal,
      responseModel: typeof json.model === "string" ? json.model : null,
      ...metadata
    }
  };
}

export function sanitizeFinalContent(value: string | null | undefined): string | null {
  const withoutThink = String(value || "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think\b[^>]*>/gi, " ");
  const finalMatch = withoutThink.match(/\b(?:Final|Respuesta final|Respuesta|Answer)\s*:\s*([\s\S]+)$/i);
  const text = (finalMatch ? finalMatch[1] : withoutThink)
    .replace(/^\s*(?:Reasoning|Razonamiento|Pensamiento|Thinking)\s*:\s*/i, "")
    .replace(/^\s*(?:Final|Respuesta final|Answer)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function sanitizeReasoningContent(value: string | null | undefined, maxChars = 8000): string | null {
  const text = String(value || "")
    .replace(/<\/?think\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function mergeReasoningContent(
  first: string | null | undefined,
  second: string | null | undefined,
  maxChars = 8000
) {
  const parts = [first, second].map((item) => String(item || "").trim()).filter(Boolean);
  return sanitizeReasoningContent(parts.join("\n\n--- repair ---\n\n"), maxChars);
}

function joinText(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map((item) => stringifyContentPart(item)).join("");
      return stringifyContentPart(value);
    })
    .filter(Boolean)
    .join("\n");
}

function stringifyContentPart(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  return "";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function normalizeFinishReason(value: unknown): string | null {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}
