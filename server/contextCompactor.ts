import { runtime } from "./config.js";
import { db } from "./db.js";

interface MessageStatsResult {
  ok: boolean;
  item?: {
    total?: number;
    active?: number;
    archived?: number;
  };
}

interface CompactMessage {
  id: number;
  role: string;
  content: string;
  emotion?: string | null;
  source?: string | null;
  created_at?: string | null;
}

interface MessagesForCompactionResult {
  ok: boolean;
  items?: CompactMessage[];
}

interface ContextSummaryResult {
  ok: boolean;
  item?: {
    content?: string;
  } | null;
}

export interface ContextCompactionResult {
  compacted: boolean;
  activeMessages: number;
  archivedMessages: number;
  summaryChars: number;
}

export async function maybeCompactConversationContext(): Promise<ContextCompactionResult> {
  const threshold = Math.max(8, runtime.llmCompactionMessageThreshold);
  const keepMessages = Math.max(4, Math.min(runtime.llmCompactionKeepMessages, threshold - 1));
  const stats = await db<MessageStatsResult>("message_stats");
  const activeMessages = Number(stats.item?.active || 0);
  if (!stats.ok || activeMessages <= threshold) {
    return { compacted: false, activeMessages, archivedMessages: 0, summaryChars: 0 };
  }

  const compactLimit = Math.max(1, activeMessages - keepMessages);
  const messagesResult = await db<MessagesForCompactionResult>("messages_for_compaction", { limit: compactLimit });
  const messages = messagesResult.items || [];
  if (!messages.length) {
    return { compacted: false, activeMessages, archivedMessages: 0, summaryChars: 0 };
  }

  const previous = await db<ContextSummaryResult>("context_summary").catch(() => ({ ok: false, item: null }));
  const maxSummaryChars = Math.max(2400, Math.min(7000, Math.round(runtime.llmContextBudgetChars * 0.24)));
  const summary = buildRollingSummary(previous.item?.content || "", messages, maxSummaryChars);

  await db("replace_context_summary", {
    content: summary,
    importance: 5,
    confidence: 0.86,
    evidence: messages.slice(-12).map((message) => ({
      id: message.id,
      role: message.role,
      at: message.created_at || null
    }))
  });

  const archived = await db<{ ok: boolean; archived?: number }>("archive_messages", {
    ids: messages.map((message) => message.id)
  });

  return {
    compacted: true,
    activeMessages,
    archivedMessages: Number(archived.archived || messages.length),
    summaryChars: summary.length
  };
}

function buildRollingSummary(previousContent: string, messages: CompactMessage[], maxChars: number) {
  const previous = stripCompactionHeader(previousContent);
  const transcript = compactTranscript(messages);
  const previousBudget = previous ? Math.round(maxChars * 0.45) : 0;
  const transcriptBudget = Math.max(1200, maxChars - previousBudget - 420);
  const parts = [
    "Resumen compacto persistente de Yuko.",
    "Usalo como memoria conversacional cuando el historial reciente ya fue reiniciado.",
    previous ? `Resumen anterior:\n${clipMiddle(previous, previousBudget)}` : "",
    `Interacciones archivadas recientemente:\n${clipMiddle(transcript, transcriptBudget)}`,
    "Prioridad: conservar preferencias del creador, instrucciones vigentes, tono deseado y datos personales utiles."
  ].filter(Boolean);
  return clipMiddle(parts.join("\n\n"), maxChars);
}

function stripCompactionHeader(content: string) {
  return String(content || "")
    .replace(/^Resumen compacto persistente de Yuko\.\s*/i, "")
    .replace(/^Usalo como memoria conversacional.*?\n\n/is, "")
    .trim();
}

function compactTranscript(messages: CompactMessage[]) {
  const lines: string[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "Yuko" : "Usuario";
    const emotion = message.emotion ? ` [${message.emotion}]` : "";
    const when = message.created_at ? ` (${message.created_at})` : "";
    lines.push(`- ${role}${emotion}${when}: ${clipOneLine(message.content, role === "Yuko" ? 220 : 260)}`);
  }
  return lines.join("\n");
}

function clipOneLine(value: string, maxChars: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trim()}...`;
}

function clipMiddle(value: string, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  if (maxChars < 32) return text.slice(0, maxChars);
  const head = Math.ceil(maxChars * 0.58);
  const tail = Math.max(12, maxChars - head - 24);
  return `${text.slice(0, head).trim()}\n...\n${text.slice(-tail).trim()}`;
}
