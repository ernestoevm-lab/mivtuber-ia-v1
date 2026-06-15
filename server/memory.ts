import { db } from "./db.js";

export interface MemorySearchItem {
  id: number;
  content: string;
  importance: number;
  kind?: string;
  scope?: string;
  source?: string | null;
  username?: string | null;
  confidence?: number;
  pinned?: number;
  archived?: number;
  created_at: string;
  updated_at?: string | null;
  _score?: number;
  _specific_score?: number;
  _generic_score?: number;
  _entity_score?: number;
}

export async function searchRelevantMemories(input: {
  query: string;
  limit: number;
  source?: string;
  username?: string;
}) {
  const result = await db<{ ok: boolean; items: MemorySearchItem[] }>("memory_search", {
    query: input.query,
    limit: input.limit,
    source: input.source,
    username: input.username
  }).catch((error) => {
    console.warn("memory_search_failed", JSON.stringify({
      source: input.source || null,
      username: input.username || null,
      error: compactError(error)
    }));
    return { ok: false, items: [] };
  });
  const items = result.items || [];
  console.log("memory_search_result_count", JSON.stringify({ count: items.length, source: input.source || null, username: input.username || null }));
  if (items[0]) {
    console.log("memory_search_top_result", JSON.stringify({
      id: items[0].id,
      score: items[0]._score ?? null,
      specific: items[0]._specific_score ?? null,
      generic: items[0]._generic_score ?? null,
      entity: items[0]._entity_score ?? null
    }));
  }
  return items;
}

export async function maybeExtractMemory(input: {
  userMessage: string;
  assistantResponse: string;
  source?: string;
  username?: string;
}) {
  const candidates = extractDurableMemories(input.userMessage);
  let saved = 0;
  for (const content of candidates) {
    console.log("memory_candidate_detected", JSON.stringify({
      chars: content.length,
      source: input.source || null,
      username: input.username || null
    }));
    const result = await db<{ ok: boolean; action?: string; item?: { id?: number } }>("upsert_memory", {
      content,
      importance: inferImportance(content),
      kind: "fact",
      scope: input.username ? "user" : "global",
      source: input.source,
      username: input.username,
      confidence: 0.78,
      evidence: [{ user: input.userMessage, assistant: input.assistantResponse.slice(0, 240) }]
    }).catch((error) => {
      console.warn("memory_save_failed", JSON.stringify({
        chars: content.length,
        source: input.source || null,
        username: input.username || null,
        error: compactError(error)
      }));
      return { ok: false, action: undefined, item: undefined };
    });
    if (result.ok) {
      saved += 1;
      const action = result.action || "saved";
      const event = action === "updated" ? "memory_updated" : action === "skipped_duplicate" ? "memory_skipped_duplicate" : "memory_saved";
      console.log(event, JSON.stringify({
        id: result.item?.id || null,
        chars: content.length,
        source: input.source || null,
        username: input.username || null
      }));
    }
  }
  return saved;
}

function extractDurableMemories(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const memories = new Set<string>();
  const lower = text.toLowerCase();

  const rememberMatch = text.match(/\brecuerda(?:\s+que)?\s+(.+)/i);
  if (rememberMatch?.[1]) {
    memories.add(`El usuario pidio recordar que ${cleanFact(rememberMatch[1])}.`);
  }

  const imageMatch = text.match(/\b(?:esta|esa|la)\s+imagen\s+proviene\s+de\s+(.+?)(?:\s+y\s+|,\s*y\s+|$)/i);
  const leftCharacterMatch = text.match(/\b(?:personaje|principal|sujeto)\s+(?:que\s+)?(?:esta\s+)?a\s+la\s+izquierda\s+(?:es|se llama)\s+(.+)/i);
  if (imageMatch?.[1]) {
    const imageFact = cleanFact(imageMatch[1]);
    const characterFact = leftCharacterMatch?.[1] ? ` y que el personaje a la izquierda es ${cleanFact(leftCharacterMatch[1])}` : "";
    memories.add(`El usuario indico que una imagen compartida proviene de ${imageFact}${characterFact}.`);
  }

  const characterMatch = text.match(/\b(?:este|esta|ese|esa)\s+personaje\s+(?:es|se llama)\s+(.+)/i);
  if (characterMatch?.[1]) {
    memories.add(`El usuario indico que este personaje es ${cleanFact(characterMatch[1])}.`);
  }

  const favoriteMatch = text.match(/\bmi\s+(.{3,60}?)\s+favorit[oa]\s+es\s+(.+)/i);
  if (favoriteMatch?.[1] && favoriteMatch?.[2]) {
    memories.add(`El ${cleanFact(favoriteMatch[1])} favorito del usuario es ${cleanFact(favoriteMatch[2])}.`);
  }

  const preferenceMatch = text.match(/\b(?:prefiero|me gusta|no me gusta|odio)\s+(.+)/i);
  if (preferenceMatch?.[1]) {
    const verb = lower.includes("no me gusta") || lower.includes("odio") ? "no le gusta" : "prefiere";
    memories.add(`El usuario ${verb} ${cleanFact(preferenceMatch[1])}.`);
  }

  const projectMatch = text.match(/\b(?:mi|este)\s+(?:proyecto|canal|personaje|juego)\s+(?:se llama|es)\s+(.+)/i);
  if (projectMatch?.[1]) {
    memories.add(`El usuario indico que su proyecto/canal/personaje/juego es ${cleanFact(projectMatch[1])}.`);
  }

  if (/\b(estoy usando|uso|trabajo con)\b/i.test(text)) {
    const usingMatch = text.match(/\b(?:estoy usando|uso|trabajo con)\s+(.+)/i);
    if (usingMatch?.[1]) memories.add(`El usuario esta usando o trabajando con ${cleanFact(usingMatch[1])}.`);
  }

  return [...memories].map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item.length >= 24).slice(0, 3);
}

function cleanFact(value: string) {
  return value
    .replace(/[.!?]+$/g, "")
    .replace(/^que\s+/i, "")
    .trim();
}

function inferImportance(content: string) {
  if (/recuerda|favorito|canal|proyecto|personaje|Dead as Disco|Lycaon|Zenless/i.test(content)) return 5;
  if (/prefiere|no le gusta|usando|trabajando/i.test(content)) return 4;
  return 3;
}

function compactError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 160);
  return String(error).slice(0, 160);
}
