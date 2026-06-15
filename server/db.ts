import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type DbPayload = Record<string, unknown>;
type DbRow = Record<string, any>;

interface Statement {
  all(...params: unknown[]): DbRow[];
  get(...params: unknown[]): DbRow | undefined;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

interface DatabaseConnection {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
}

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as new (filename: string) => DatabaseConnection;

const rootDir = process.env.MIVTUBERIA_ROOT_DIR || process.cwd();
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "vtuber.sqlite");

let sqlite: DatabaseConnection | null = null;

const stopwords = new Set([
  "a", "al", "and", "are", "as", "be", "como", "con", "cual", "cuando", "de", "del", "dime",
  "donde", "el", "en", "era", "eres", "esa", "ese", "eso", "esta", "este", "esto",
  "for", "from", "how", "is", "la", "las", "lo", "los", "me", "mi", "mis", "of",
  "para", "pero", "por", "porque", "que", "quien", "recuerda", "recuerdas", "se", "sobre", "soy",
  "su", "sus", "te", "tengo", "the", "tienes", "to", "tu", "tus", "un", "una", "uno", "what", "when",
  "where", "who", "y",
]);

const genericMemoryTerms = new Set([
  "cosa", "favorita", "favorito", "imagen", "juego", "personaje", "probar",
  "probarme", "probarte", "recuerdo", "usuario",
]);

export function db<T = unknown>(command: string, payload: DbPayload = {}): Promise<T> {
  try {
    return Promise.resolve(executeCommand(command, payload) as T);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.reject(new Error(`SQLite command "${command}" failed: ${message}`));
  }
}

export async function initDb(): Promise<void> {
  await db("init");
}

function getSqlite() {
  if (!sqlite) {
    mkdirSync(dataDir, { recursive: true });
    sqlite = new BetterSqlite3(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }
  return sqlite;
}

function executeCommand(command: string, payload: DbPayload) {
  const conn = getSqlite();
  initSchema(conn);

  switch (command) {
    case "init":
      return { ok: true, db: dbPath };
    case "add_message":
      return addMessage(conn, payload);
    case "recent_messages":
      return recentMessages(conn, payload);
    case "message_stats":
      return messageStats(conn);
    case "messages_for_compaction":
      return messagesForCompaction(conn, payload);
    case "archive_messages":
      return archiveMessages(conn, payload);
    case "context_summary":
      return contextSummary(conn);
    case "replace_context_summary":
      return replaceContextSummary(conn, payload);
    case "update_message_timings":
      return updateMessageTimings(conn, payload);
    case "add_memory":
      return addMemory(conn, payload);
    case "memories":
      return memories(conn, payload);
    case "add_memory_v2":
    case "upsert_memory":
      return upsertMemory(conn, payload);
    case "memory_search":
      return memorySearch(conn, payload);
    case "recent_memories":
      return recentMemories(conn, payload);
    case "archive_memory":
      return archiveMemory(conn, payload);
    case "update_memory_importance":
      return updateMemoryImportance(conn, payload);
    case "update_memory":
      return updateMemory(conn, payload);
    case "delete_memory":
      return deleteMemory(conn, payload);
    case "add_blocked":
      return addBlocked(conn, payload);
    case "add_moderation":
      return addModeration(conn, payload);
    case "add_llm_trace":
      return addLlmTrace(conn, payload);
    case "moderation_recent":
      return moderationRecent(conn, payload);
    case "upsert_chat_user":
      return upsertChatUser(conn, payload);
    case "add_chat_message":
      return addChatMessage(conn, payload);
    case "chat_users_search":
      return chatUsersSearch(conn, payload);
    case "chat_user_messages":
      return chatUserMessages(conn, payload);
    case "recent_chat_messages":
      return recentChatMessages(conn, payload);
    case "blocked_recent":
      return blockedRecent(conn, payload);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function initSchema(conn: DatabaseConnection) {
  conn.exec(`
    create table if not exists messages (
      id integer primary key autoincrement,
      role text not null,
      content text not null,
      emotion text,
      source text,
      created_at datetime default current_timestamp
    );

    create table if not exists memories (
      id integer primary key autoincrement,
      content text not null,
      importance integer default 1,
      created_at datetime default current_timestamp
    );

    create table if not exists blocked_events (
      id integer primary key autoincrement,
      reason text not null,
      content text not null,
      mode text,
      created_at datetime default current_timestamp
    );

    create table if not exists moderation_events (
      id integer primary key autoincrement,
      decision text not null,
      reason text not null,
      score integer default 0,
      content text not null,
      source text,
      user text,
      created_at datetime default current_timestamp
    );

    create table if not exists chat_users (
      id text primary key,
      platform text not null,
      platform_user_id text,
      username text not null,
      display_name text,
      is_moderator integer default 0,
      is_subscriber integer default 0,
      is_owner integer default 0,
      badges_json text,
      first_seen_at datetime default current_timestamp,
      last_seen_at datetime default current_timestamp,
      message_count integer default 0
    );

    create table if not exists chat_messages (
      id text primary key,
      platform text not null,
      source text not null,
      channel_id text,
      channel_name text,
      user_id text,
      username text,
      display_name text,
      direction text not null,
      content text not null,
      moderation_decision text,
      moderation_reason text,
      moderation_score integer,
      reply_to_message_id text,
      response_id text,
      raw_json text,
      created_at datetime default current_timestamp
    );

    create table if not exists llm_traces (
      id integer primary key autoincrement,
      created_at datetime default current_timestamp,
      provider text,
      model text,
      user_id text,
      username text,
      source text,
      user_message_id text,
      user_message_text text,
      final_content text,
      reasoning_content text,
      reasoning_present integer default 0,
      reasoning_truncated_before_final integer default 0,
      repaired_from_reasoning_only integer default 0,
      finish_reason text,
      latency_ms integer,
      error text
    );

    create index if not exists idx_llm_traces_username_created_at
      on llm_traces(username, created_at);
    create index if not exists idx_llm_traces_user_id_created_at
      on llm_traces(user_id, created_at);
    create index if not exists idx_llm_traces_created_at
      on llm_traces(created_at);
  `);

  ensureColumn(conn, "llm_traces", "reasoning_truncated_before_final", "integer default 0");
  ensureColumn(conn, "llm_traces", "finish_reason", "text");
  ensureColumn(conn, "messages", "response_id", "text");
  ensureColumn(conn, "messages", "provider", "text");
  ensureColumn(conn, "messages", "model", "text");
  ensureColumn(conn, "messages", "action", "text");
  ensureColumn(conn, "messages", "emotion_intensity", "integer");
  ensureColumn(conn, "messages", "timings_json", "text");
  ensureColumn(conn, "messages", "audio_kind", "text");
  ensureColumn(conn, "messages", "archived", "integer default 0");
  ensureColumn(conn, "memories", "kind", "text default 'fact'");
  ensureColumn(conn, "memories", "scope", "text default 'global'");
  ensureColumn(conn, "memories", "source", "text");
  ensureColumn(conn, "memories", "username", "text");
  ensureColumn(conn, "memories", "confidence", "real default 0.7");
  ensureColumn(conn, "memories", "last_seen_at", "datetime");
  ensureColumn(conn, "memories", "evidence_json", "text");
  ensureColumn(conn, "memories", "updated_at", "datetime");
  ensureColumn(conn, "memories", "pinned", "integer default 0");
  ensureColumn(conn, "memories", "archived", "integer default 0");

  conn.exec(`
    create index if not exists idx_memories_active_importance
      on memories(archived, pinned, importance, updated_at);
    create index if not exists idx_memories_username_source
      on memories(username, source, archived);
    create index if not exists idx_messages_response_id
      on messages(response_id);
    create index if not exists idx_messages_archived_id
      on messages(archived, id);
  `);
}

function ensureColumn(conn: DatabaseConnection, table: string, column: string, definition: string) {
  const rows = conn.prepare(`pragma table_info(${table})`).all();
  if (rows.some((row) => row.name === column)) return;
  conn.prepare(`alter table ${table} add column ${column} ${definition}`).run();
}

function memorySelectSql(tail: string) {
  return `
    select id, content, importance, kind, scope, source, username, confidence,
           last_seen_at, evidence_json, updated_at, pinned, archived, created_at
    from memories
    ${tail}
  `;
}

function addMessage(conn: DatabaseConnection, payload: DbPayload) {
  conn.prepare(`
    insert into messages (
      role, content, emotion, source, created_at,
      response_id, provider, model, action, emotion_intensity, timings_json, audio_kind
    )
    values (?, ?, ?, ?, coalesce(?, current_timestamp), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stringValue(payload.role, "assistant"),
    stringValue(payload.content, ""),
    nullableValue(payload.emotion),
    stringValue(payload.source, "local"),
    nullableValue(payload.created_at),
    nullableValue(payload.response_id),
    nullableValue(payload.provider),
    nullableValue(payload.model),
    nullableValue(payload.action),
    nullableValue(payload.emotion_intensity),
    payload.timings ? JSON.stringify(payload.timings) : null,
    nullableValue(payload.audio_kind),
  );
  return { ok: true };
}

function recentMessages(conn: DatabaseConnection, payload: DbPayload) {
  const limit = intValue(payload.limit, 12);
  const rows = conn.prepare(`
    select id, role, content, emotion, source,
           response_id,
           coalesce(provider, (
             select t.provider
             from llm_traces t
             where messages.role = 'assistant'
               and messages.content = t.final_content
               and abs(strftime('%s', messages.created_at) - strftime('%s', t.created_at)) <= 5
             order by t.id desc
             limit 1
           )) as provider,
           coalesce(model, (
             select t.model
             from llm_traces t
             where messages.role = 'assistant'
               and messages.content = t.final_content
               and abs(strftime('%s', messages.created_at) - strftime('%s', t.created_at)) <= 5
             order by t.id desc
             limit 1
           )) as model,
           action, emotion_intensity, timings_json, audio_kind,
           coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), created_at) as created_at
    from messages
    where coalesce(archived, 0) = 0
    order by id desc
    limit ?
  `).all(limit);
  return { ok: true, items: rows.reverse() };
}

function messageStats(conn: DatabaseConnection) {
  const row = conn.prepare(`
    select
      count(*) as total,
      sum(case when coalesce(archived, 0) = 0 then 1 else 0 end) as active,
      sum(case when coalesce(archived, 0) = 1 then 1 else 0 end) as archived
    from messages
  `).get();
  return { ok: true, item: row };
}

function messagesForCompaction(conn: DatabaseConnection, payload: DbPayload) {
  const limit = clamp(intValue(payload.limit, 24), 1, 500);
  const rows = conn.prepare(`
    select id, role, content, emotion, source,
           coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), created_at) as created_at
    from messages
    where coalesce(archived, 0) = 0
    order by id asc
    limit ?
  `).all(limit);
  return { ok: true, items: rows };
}

function archiveMessages(conn: DatabaseConnection, payload: DbPayload) {
  const ids = arrayValue(payload.ids)
    .map((item) => String(item).trim())
    .filter((item) => /^\d+$/.test(item))
    .map((item) => Number.parseInt(item, 10));
  if (!ids.length) return { ok: true, archived: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const result = conn.prepare(`update messages set archived = 1 where id in (${placeholders})`).run(...ids);
  return { ok: true, archived: result.changes };
}

function contextSummary(conn: DatabaseConnection) {
  const row = conn.prepare(memorySelectSql(`
    where kind = 'summary'
      and source = 'context_compaction'
      and coalesce(archived, 0) = 0
    order by coalesce(updated_at, created_at) desc, id desc
    limit 1
  `)).get();
  return { ok: true, item: row ?? null };
}

function replaceContextSummary(conn: DatabaseConnection, payload: DbPayload) {
  const content = stringValue(payload.content).trim();
  if (!content) return { ok: false, error: "content is required" };
  return conn.transaction(() => {
    conn.prepare(`
      update memories
      set archived = 1, updated_at = current_timestamp
      where kind = 'summary'
        and source = 'context_compaction'
        and coalesce(archived, 0) = 0
    `).run();
    const result = conn.prepare(`
      insert into memories (
        content, importance, kind, scope, source, username, confidence,
        last_seen_at, evidence_json, updated_at, pinned, archived
      ) values (?, ?, 'summary', 'global', 'context_compaction', null, ?, current_timestamp, ?, current_timestamp, 1, 0)
    `).run(
      content,
      intValue(payload.importance, 5),
      floatValue(payload.confidence, 0.85),
      JSON.stringify(arrayValue(payload.evidence)),
    );
    const row = conn.prepare(memorySelectSql("where id = ?")).get(result.lastInsertRowid);
    return { ok: true, item: row };
  })();
}

function updateMessageTimings(conn: DatabaseConnection, payload: DbPayload) {
  const responseId = stringValue(payload.response_id).trim();
  if (!responseId) return { ok: false, error: "response_id is required" };
  const row = conn.prepare(
    "select id, timings_json from messages where response_id = ? and role = 'assistant' order by id desc limit 1",
  ).get(responseId);
  if (!row) return { ok: false, error: "message not found" };
  let existing: DbRow = {};
  try {
    existing = JSON.parse(String(row.timings_json || "{}")) as DbRow;
  } catch {
    existing = {};
  }
  const incoming = asRecord(payload.timings);
  for (const key of ["ttsMs", "firstAudioMs", "totalTtsMs", "speechStartDelayMs", "speechPlaybackMs", "audioDurationMs", "totalMs"]) {
    if (typeof incoming[key] === "number" && Number.isFinite(incoming[key])) {
      existing[key] = Math.round(incoming[key]);
    }
  }
  for (const key of ["ttsBackend", "ttsEngine"]) {
    if (typeof incoming[key] === "string" && incoming[key].trim()) existing[key] = incoming[key].trim();
  }
  if (typeof incoming.ttsFallbackUsed === "boolean") existing.ttsFallbackUsed = incoming.ttsFallbackUsed;
  let audioKind = stringValue(payload.audio_kind || incoming.audioKind).trim();
  if (!["audio", "speechSynthesis", "none"].includes(audioKind)) audioKind = "";
  if (audioKind) existing.audioKind = audioKind;
  conn.prepare("update messages set timings_json = ?, audio_kind = coalesce(?, audio_kind) where id = ?")
    .run(JSON.stringify(existing), audioKind || null, row.id);
  return { ok: true, response_id: responseId, updated: 1 };
}

function addMemory(conn: DatabaseConnection, payload: DbPayload) {
  const result = conn.prepare(`
    insert into memories (
      content, importance, kind, scope, source, username, confidence,
      last_seen_at, evidence_json, updated_at, pinned, archived
    ) values (?, ?, ?, ?, ?, ?, ?, current_timestamp, ?, current_timestamp, ?, 0)
  `).run(
    stringValue(payload.content, ""),
    intValue(payload.importance, 1),
    stringValue(payload.kind, "fact"),
    stringValue(payload.scope, "global"),
    nullableValue(payload.source),
    nullableValue(payload.username),
    floatValue(payload.confidence, 0.9),
    JSON.stringify(arrayValue(payload.evidence)),
    payload.pinned ? 1 : 0,
  );
  const row = conn.prepare(memorySelectSql("where id = ?")).get(result.lastInsertRowid);
  return { ok: true, item: row };
}

function memories(conn: DatabaseConnection, payload: DbPayload) {
  const limit = intValue(payload.limit, 8);
  const rows = conn.prepare(memorySelectSql(
    "where coalesce(archived, 0) = 0 order by coalesce(pinned, 0) desc, importance desc, coalesce(updated_at, created_at) desc, id desc limit ?",
  )).all(limit);
  return { ok: true, items: rows };
}

function upsertMemory(conn: DatabaseConnection, payload: DbPayload) {
  const content = stringValue(payload.content).trim();
  if (!content) return { ok: false, error: "content is required" };
  return conn.transaction(() => {
    const username = stringValue(payload.username).trim();
    const scope = stringValue(payload.scope, "global").trim() || "global";
    const existing = findSimilarMemory(conn, content, username, scope);
    const evidence = arrayValue(payload.evidence);
    let memoryId: unknown;
    let action: string;
    if (existing) {
      const overlap = tokenOverlap(content, existing.content);
      conn.prepare(`
        update memories
        set importance = max(importance, ?),
            kind = coalesce(?, kind),
            scope = coalesce(?, scope),
            source = coalesce(?, source),
            username = coalesce(?, username),
            confidence = max(coalesce(confidence, 0.7), ?),
            last_seen_at = current_timestamp,
            evidence_json = ?,
            updated_at = current_timestamp,
            pinned = max(coalesce(pinned, 0), ?),
            archived = 0
        where id = ?
      `).run(
        intValue(payload.importance, intValue(existing.importance, 3)),
        stringValue(payload.kind, "fact"),
        scope,
        nullableValue(payload.source),
        username || null,
        floatValue(payload.confidence, 0.7),
        JSON.stringify(evidence),
        payload.pinned ? 1 : 0,
        existing.id,
      );
      memoryId = existing.id;
      action = overlap >= 0.55 ? "updated" : "skipped_duplicate";
    } else {
      const result = conn.prepare(`
        insert into memories (
          content, importance, kind, scope, source, username, confidence,
          last_seen_at, evidence_json, updated_at, pinned, archived
        ) values (?, ?, ?, ?, ?, ?, ?, current_timestamp, ?, current_timestamp, ?, 0)
      `).run(
        content,
        intValue(payload.importance, 3),
        stringValue(payload.kind, "fact"),
        scope,
        nullableValue(payload.source),
        username || null,
        floatValue(payload.confidence, 0.7),
        JSON.stringify(evidence),
        payload.pinned ? 1 : 0,
      );
      memoryId = result.lastInsertRowid;
      action = "saved";
    }
    const row = conn.prepare(memorySelectSql("where id = ?")).get(memoryId);
    return { ok: true, action, item: row };
  })();
}

function memorySearch(conn: DatabaseConnection, payload: DbPayload) {
  const query = stringValue(payload.query).trim();
  const limit = clamp(intValue(payload.limit, 8), 1, 30);
  const username = stringValue(payload.username).trim();
  const source = stringValue(payload.source).trim();
  const { tokens, specificTokens, genericTokens, entityTokens } = queryTokenGroups(query);
  const rows = conn.prepare(memorySelectSql("where coalesce(archived, 0) = 0")).all();
  const scored: Array<{ score: number; item: DbRow }> = [];
  for (const row of rows) {
    if (username && row.username && row.username !== username) continue;
    const globalSummary = row.kind === "summary" && row.source === "context_compaction" && row.pinned;
    if (source && row.source && row.source !== source && !globalSummary) continue;
    const text = normalizeText(row.content || "");
    const specificScore = specificTokens.filter((token) => tokenMatches(token, text)).length;
    const genericScore = genericTokens.filter((token) => tokenMatches(token, text)).length;
    const entityScore = entityTokens.filter((token) => tokenMatches(token, text)).length;
    const tokenScore = specificScore + genericScore + entityScore;
    const coverageScore = tokenScore / Math.max(1, tokens.length);
    const hasSemanticMatch = specificScore > 0 || entityScore > 0 || genericScore >= 2;
    if (tokens.length && !hasSemanticMatch && !row.pinned) continue;
    const importance = intValue(row.importance, 1);
    const score = (
      entityScore * 28
      + specificScore * 16
      + genericScore * 3
      + Math.trunc(coverageScore * 18)
      + (hasSemanticMatch ? importance * 2 : 0)
      + (row.pinned ? 40 : 0)
    );
    scored.push({
      score,
      item: {
        ...row,
        _score: score,
        _specific_score: specificScore,
        _generic_score: genericScore,
        _entity_score: entityScore,
      },
    });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(right.item.updated_at || right.item.created_at || "").localeCompare(String(left.item.updated_at || left.item.created_at || ""));
  });
  return { ok: true, items: scored.slice(0, limit).map((item) => item.item) };
}

function recentMemories(conn: DatabaseConnection, payload: DbPayload) {
  const limit = clamp(intValue(payload.limit, 20), 1, 100);
  const rows = conn.prepare(memorySelectSql(
    "where coalesce(archived, 0) = 0 order by coalesce(updated_at, created_at) desc, id desc limit ?",
  )).all(limit);
  return { ok: true, items: rows };
}

function archiveMemory(conn: DatabaseConnection, payload: DbPayload) {
  const memoryId = intRequired(payload.id, "id");
  conn.prepare("update memories set archived = 1, updated_at = current_timestamp where id = ?").run(memoryId);
  return { ok: true, archived: memoryId };
}

function updateMemoryImportance(conn: DatabaseConnection, payload: DbPayload) {
  const memoryId = intRequired(payload.id, "id");
  const importance = clamp(intValue(payload.importance, 3), 1, 5);
  conn.prepare("update memories set importance = ?, updated_at = current_timestamp where id = ?").run(importance, memoryId);
  const row = conn.prepare(memorySelectSql("where id = ?")).get(memoryId);
  return { ok: Boolean(row), item: row ?? null };
}

function updateMemory(conn: DatabaseConnection, payload: DbPayload) {
  const memoryId = intRequired(payload.id, "id");
  conn.prepare("update memories set content = ?, importance = ?, updated_at = current_timestamp where id = ?")
    .run(stringValue(payload.content, ""), intValue(payload.importance, 1), memoryId);
  const row = conn.prepare(memorySelectSql("where id = ?")).get(memoryId);
  return { ok: Boolean(row), item: row ?? null };
}

function deleteMemory(conn: DatabaseConnection, payload: DbPayload) {
  const memoryId = intRequired(payload.id, "id");
  const result = conn.prepare("delete from memories where id = ?").run(memoryId);
  return { ok: true, deleted: result.changes };
}

function addBlocked(conn: DatabaseConnection, payload: DbPayload) {
  conn.prepare("insert into blocked_events (reason, content, mode) values (?, ?, ?)")
    .run(stringValue(payload.reason, "blocked"), stringValue(payload.content, ""), nullableValue(payload.mode));
  return { ok: true };
}

function addModeration(conn: DatabaseConnection, payload: DbPayload) {
  conn.prepare("insert into moderation_events (decision, reason, score, content, source, user) values (?, ?, ?, ?, ?, ?)")
    .run(
      stringValue(payload.decision, "ignored"),
      stringValue(payload.reason, "unknown"),
      intValue(payload.score, 0),
      stringValue(payload.content, ""),
      stringValue(payload.source, "local"),
      nullableValue(payload.user),
    );
  return { ok: true };
}

function addLlmTrace(conn: DatabaseConnection, payload: DbPayload) {
  conn.prepare(`
    insert into llm_traces (
      provider, model, user_id, username, source, user_message_id, user_message_text,
      final_content, reasoning_content, reasoning_present, reasoning_truncated_before_final,
      repaired_from_reasoning_only, finish_reason,
      latency_ms, error
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nullableValue(payload.provider),
    nullableValue(payload.model),
    nullableValue(payload.user_id),
    nullableValue(payload.username),
    nullableValue(payload.source),
    nullableValue(payload.user_message_id),
    nullableValue(payload.user_message_text),
    nullableValue(payload.final_content),
    nullableValue(payload.reasoning_content),
    payload.reasoning_present ? 1 : 0,
    payload.reasoning_truncated_before_final ? 1 : 0,
    payload.repaired_from_reasoning_only ? 1 : 0,
    nullableValue(payload.finish_reason),
    payload.latency_ms !== undefined && payload.latency_ms !== null ? intValue(payload.latency_ms, 0) : null,
    nullableValue(payload.error),
  );
  return { ok: true };
}

function moderationRecent(conn: DatabaseConnection, payload: DbPayload) {
  const limit = intValue(payload.limit, 30);
  const rows = conn.prepare(
    "select decision, reason, score, content, source, user, created_at from moderation_events order by id desc limit ?",
  ).all(limit);
  return { ok: true, items: rows };
}

function upsertChatUser(conn: DatabaseConnection, payload: DbPayload) {
  const userId = stringValue(payload.id).trim();
  if (!userId) return { ok: false, error: "id is required" };
  conn.prepare(`
    insert into chat_users (
      id, platform, platform_user_id, username, display_name,
      is_moderator, is_subscriber, is_owner, badges_json,
      first_seen_at, last_seen_at, message_count
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp, current_timestamp, ?)
    on conflict(id) do update set
      platform = excluded.platform,
      platform_user_id = coalesce(excluded.platform_user_id, chat_users.platform_user_id),
      username = excluded.username,
      display_name = coalesce(excluded.display_name, chat_users.display_name),
      is_moderator = excluded.is_moderator,
      is_subscriber = excluded.is_subscriber,
      is_owner = excluded.is_owner,
      badges_json = excluded.badges_json,
      last_seen_at = current_timestamp,
      message_count = chat_users.message_count + excluded.message_count
  `).run(
    userId,
    stringValue(payload.platform, "local"),
    nullableValue(payload.platform_user_id),
    stringValue(payload.username, "viewer"),
    nullableValue(payload.display_name),
    payload.is_moderator ? 1 : 0,
    payload.is_subscriber ? 1 : 0,
    payload.is_owner ? 1 : 0,
    JSON.stringify(arrayValue(payload.badges)),
    intValue(payload.message_count, 0),
  );
  return { ok: true };
}

function addChatMessage(conn: DatabaseConnection, payload: DbPayload) {
  const messageId = stringValue(payload.id).trim();
  if (!messageId) return { ok: false, error: "id is required" };
  conn.prepare(`
    insert or replace into chat_messages (
      id, platform, source, channel_id, channel_name, user_id, username, display_name,
      direction, content, moderation_decision, moderation_reason, moderation_score,
      reply_to_message_id, response_id, raw_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, current_timestamp))
  `).run(
    messageId,
    stringValue(payload.platform, "local"),
    stringValue(payload.source, "simulator"),
    nullableValue(payload.channel_id),
    nullableValue(payload.channel_name),
    nullableValue(payload.user_id),
    nullableValue(payload.username),
    nullableValue(payload.display_name),
    stringValue(payload.direction, "inbound"),
    stringValue(payload.content, ""),
    nullableValue(payload.moderation_decision),
    nullableValue(payload.moderation_reason),
    nullableValue(payload.moderation_score),
    nullableValue(payload.reply_to_message_id),
    nullableValue(payload.response_id),
    Object.prototype.hasOwnProperty.call(payload, "raw") ? (JSON.stringify(payload.raw) ?? null) : null,
    nullableValue(payload.created_at),
  );
  return { ok: true };
}

function chatUsersSearch(conn: DatabaseConnection, payload: DbPayload) {
  const query = stringValue(payload.query).trim();
  const limit = clamp(intValue(payload.limit, 20), 1, 100);
  const pattern = `%${query}%`;
  const rows = conn.prepare(`
    select id, platform, platform_user_id, username, display_name,
           is_moderator, is_subscriber, is_owner, badges_json,
           first_seen_at, last_seen_at, message_count
    from chat_users
    where ? = '' or username like ? or coalesce(display_name, '') like ? or platform like ?
    order by last_seen_at desc
    limit ?
  `).all(query, pattern, pattern, pattern, limit);
  return { ok: true, items: rows };
}

function chatUserMessages(conn: DatabaseConnection, payload: DbPayload) {
  const userId = stringValue(payload.id).trim();
  const limit = clamp(intValue(payload.limit, 50), 1, 200);
  const rows = conn.prepare(`
    select id, platform, source, channel_id, channel_name, user_id, username, display_name,
           direction, content, moderation_decision, moderation_reason, moderation_score,
           reply_to_message_id, response_id, created_at
    from chat_messages
    where user_id = ?
       or reply_to_message_id in (select id from chat_messages where user_id = ? and direction = 'inbound')
    order by created_at asc, rowid asc
    limit ?
  `).all(userId, userId, limit);
  return { ok: true, items: rows };
}

function recentChatMessages(conn: DatabaseConnection, payload: DbPayload) {
  const limit = clamp(intValue(payload.limit, 50), 1, 200);
  const rows = conn.prepare(`
    select id, platform, source, channel_id, channel_name, user_id, username, display_name,
           direction, content, moderation_decision, moderation_reason, moderation_score,
           reply_to_message_id, response_id, created_at
    from chat_messages
    order by created_at desc, rowid desc
    limit ?
  `).all(limit);
  return { ok: true, items: rows.reverse() };
}

function blockedRecent(conn: DatabaseConnection, payload: DbPayload) {
  const limit = intValue(payload.limit, 20);
  const rows = conn.prepare("select reason, content, mode, created_at from blocked_events order by id desc limit ?").all(limit);
  return { ok: true, items: rows };
}

function findSimilarMemory(conn: DatabaseConnection, content: string, username = "", scope = "global") {
  const normalized = content.toLowerCase().split(/\s+/).join(" ");
  const exact = conn.prepare(`
    select id, content, importance, evidence_json from memories
    where lower(content) = lower(?)
      and coalesce(username, '') = ?
      and coalesce(scope, 'global') = ?
      and coalesce(archived, 0) = 0
    limit 1
  `).get(content, username, scope);
  if (exact) return exact;
  const rows = conn.prepare(`
    select id, content, importance, evidence_json from memories
    where coalesce(username, '') = ?
      and coalesce(scope, 'global') = ?
      and coalesce(archived, 0) = 0
    order by coalesce(updated_at, created_at) desc
    limit 200
  `).all(username, scope);
  let best: DbRow | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const other = stringValue(row.content).toLowerCase().split(/\s+/).join(" ");
    if (normalized.includes(other) || other.includes(normalized)) return row;
    const score = tokenOverlap(content, row.content);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best && bestScore >= 0.72 ? best : null;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("")
    .map((ch) => /[\p{L}\p{N}]/u.test(ch) ? ch.toLowerCase() : /\s/u.test(ch) ? " " : " ")
    .join("");
}

function wordTokens(value: unknown) {
  return normalizeText(value).split(/\s+/).filter((token) => token.length >= 3);
}

function relevantTokens(query: unknown) {
  return wordTokens(query).filter((token) => !stopwords.has(token));
}

function queryTokenGroups(query: unknown) {
  const tokens = relevantTokens(query);
  const genericTokens = tokens.filter((token) => genericMemoryTerms.has(token));
  const specificTokens = tokens.filter((token) => !genericMemoryTerms.has(token));
  const rawWords = String(query || "").split(/\s+/).map((part) => part.replace(/^[¿?¡!.,:;()[\]{}"']+|[¿?¡!.,:;()[\]{}"']+$/g, ""));
  const entityTokens: string[] = [];
  for (const [index, word] of rawWords.entries()) {
    const normalized = normalizeText(word).trim();
    if (normalized.length < 4 || stopwords.has(normalized) || genericMemoryTerms.has(normalized)) continue;
    if (index > 0 && (/^\p{Lu}/u.test(word) || /\p{Lu}/u.test(word.slice(1)))) {
      entityTokens.push(normalized);
    }
  }
  return { tokens, specificTokens, genericTokens, entityTokens };
}

function tokenVariants(token: string) {
  const variants = new Set([token]);
  if (token.length > 5 && token.endsWith("te")) variants.add(token.slice(0, -2));
  if (token.length > 5 && token.endsWith("me")) variants.add(token.slice(0, -2));
  if (token.length > 4 && token.endsWith("s")) variants.add(token.slice(0, -1));
  return variants;
}

function tokenMatches(token: string, normalizedText: string) {
  const padded = ` ${normalizedText} `;
  return [...tokenVariants(token)].some((variant) => padded.includes(` ${variant} `) || (variant.length >= 5 && normalizedText.includes(variant)));
}

function memoryTokens(text: unknown) {
  return new Set(relevantTokens(text));
}

function tokenOverlap(left: unknown, right: unknown) {
  const leftTokens = memoryTokens(left);
  const rightTokens = memoryTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function stringValue(value: unknown, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function nullableValue(value: unknown) {
  return value === undefined ? null : value;
}

function intValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intRequired(value: unknown, name: string) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is required`);
  return parsed;
}

function floatValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): DbRow {
  return value && typeof value === "object" ? value as DbRow : {};
}
