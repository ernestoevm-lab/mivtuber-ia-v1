import type { AutonomyStatePayload, StatusPayload, StreamHistoryMessageItem, StreamUserHistoryItem, TikfinityStatePayload, TwitchStatusPayload } from "../types.js";
import { ControlSection, formatShortTime, moderationReasonLabel } from "./shared.js";

export function ViewersTab({
  assistantName,
  autonomyBusy,
  autonomyNotice,
  autonomyState,
  modelName,
  selectedStreamUser,
  status,
  streamHistoryNotice,
  streamUserMessages,
  streamUserQuery,
  streamUsers,
  tikfinityBusy,
  tikfinityKeywords,
  tikfinityNotice,
  tikfinityState,
  tikfinityWsUrl,
  twitchBusy,
  twitchCredsConfigured,
  twitchNotice,
  twitchStatus,
  twitchStatusLabel,
  onAutonomyTrigger,
  onConnectTikfinity,
  onConnectTwitch,
  onDisconnectTikfinity,
  onDisconnectTwitch,
  onOpenPreview,
  onRefreshStreamUserMessages,
  onSaveAutonomyConfig,
  onSaveTikfinityConfig,
  onSearchStreamUsers,
  onSelectStreamUser,
  onStreamUserQueryChange,
  onTikfinityKeywordsChange,
  onTikfinityTestEvent,
  onTikfinityWsUrlChange
}: {
  assistantName: string;
  autonomyBusy: boolean;
  autonomyNotice: string;
  autonomyState: AutonomyStatePayload | null;
  modelName: string;
  selectedStreamUser: StreamUserHistoryItem | null;
  status: StatusPayload | null;
  streamHistoryNotice: string;
  streamUserMessages: StreamHistoryMessageItem[];
  streamUserQuery: string;
  streamUsers: StreamUserHistoryItem[];
  tikfinityBusy: boolean;
  tikfinityKeywords: string;
  tikfinityNotice: string;
  tikfinityState: TikfinityStatePayload | null;
  tikfinityWsUrl: string;
  twitchBusy: boolean;
  twitchCredsConfigured: { channel: boolean; botUsername: boolean; oauthToken: boolean };
  twitchNotice: string;
  twitchStatus: TwitchStatusPayload | null;
  twitchStatusLabel: string;
  onAutonomyTrigger: () => void;
  onConnectTikfinity: () => void;
  onConnectTwitch: () => void;
  onDisconnectTikfinity: () => void;
  onDisconnectTwitch: () => void;
  onOpenPreview: (route: "viewer" | "speaker") => void;
  onRefreshStreamUserMessages: (userId: string) => void;
  onSaveAutonomyConfig: (updates: Partial<AutonomyStatePayload["config"]>) => void;
  onSaveTikfinityConfig: (updates?: Partial<TikfinityStatePayload["config"]>) => void;
  onSearchStreamUsers: () => void;
  onSelectStreamUser: (user: StreamUserHistoryItem) => void;
  onStreamUserQueryChange: (query: string) => void;
  onTikfinityKeywordsChange: (keywords: string) => void;
  onTikfinityTestEvent: () => void;
  onTikfinityWsUrlChange: (url: string) => void;
}) {
  const twitchCredsReady = twitchCredsConfigured.channel && twitchCredsConfigured.botUsername && twitchCredsConfigured.oauthToken;

  return (
    <ControlSection title="Directo / Entradas" icon="D">
      <dl className="streamStatus">
        <dt>OBS</dt><dd>/viewer como Browser Source</dd>
        <dt>Conexion</dt><dd>{status ? "local activa" : "pendiente"}</dd>
        <dt>Modelo</dt><dd>{modelName}</dd>
        <dt>Kokoro</dt><dd>{status?.runtime.kokoroConfigured ? "configurado" : "pendiente"}</dd>
        <dt>Twitch</dt><dd>{twitchStatusLabel}</dd>
      </dl>
      <button className="viewerLink" type="button" onClick={() => onOpenPreview("viewer")}>Abrir vista previa del viewer</button>

      <div className="streamIntegrationCard">
        <header>
          <strong>Twitch solo lectura</strong>
          <span>{twitchStatus?.state || "desconectado"}</span>
        </header>
        <dl className="streamStatus">
          <dt>Canal</dt><dd>{twitchStatus?.channel || "sin configurar"}</dd>
          <dt>Mensajes</dt><dd>{twitchStatus?.messagesReceived ?? 0}</dd>
          <dt>Ultimo usuario</dt><dd>{twitchStatus?.lastUser || "sin eventos"}</dd>
          <dt>Ultimo mensaje</dt><dd>{twitchStatus?.lastMessage || "sin mensajes todavia"}</dd>
        </dl>
        <div className="runtimeStatus">
          <span className={twitchCredsReady ? "dot on" : "dot"} />
          <span>{twitchCredsReady ? "Credenciales configuradas en Ajustes" : "Faltan credenciales en Ajustes"}</span>
        </div>
        <div className="streamActions">
          <button className="secondary" type="button" onClick={onConnectTwitch} disabled={twitchBusy || twitchStatus?.connected || !twitchCredsReady}>Conectar Twitch</button>
          <button className="secondary" type="button" onClick={onDisconnectTwitch} disabled={twitchBusy || !twitchStatus?.connected}>Desconectar</button>
        </div>
        {twitchStatus?.lastMessage ? (
          <div className="streamTimeline">
            <article className="streamHistoryItem inbound">
              <span>{twitchStatus.lastUser || twitchStatus.channel || "Twitch"}</span>
              <p>{twitchStatus.lastMessage}</p>
              <small>Twitch - ultimo mensaje recibido</small>
            </article>
          </div>
        ) : <p className="sceneHint">Sin mensajes de Twitch todavia.</p>}
        {twitchNotice && <p className="streamNotice">{twitchNotice}</p>}
        {twitchStatus?.lastError && <p className="streamNotice errorText">{twitchStatus.lastError}</p>}
        <p className="sceneHint">Solo lectura: {assistantName} recibe mensajes de Twitch y los pasa por Guardia, pero no escribe al chat. Las credenciales se administran en Ajustes.</p>
      </div>

      <div className="streamIntegrationCard">
        <header>
          <strong>TikFinity LIVE</strong>
          <span>{tikfinityState?.status || "disabled"}</span>
        </header>
        <dl className="streamStatus">
          <dt>WebSocket</dt><dd>{tikfinityState?.wsUrl || tikfinityWsUrl}</dd>
          <dt>Eventos</dt><dd>{tikfinityState?.recentEvents.length ?? 0}</dd>
          <dt>Ultimo error</dt><dd>{tikfinityState?.lastError || "sin error"}</dd>
          <dt>Ultimo evento</dt><dd>{tikfinityState?.recentEvents[0] ? `${tikfinityState.recentEvents[0].type} - ${tikfinityState.recentEvents[0].displayName || tikfinityState.recentEvents[0].username || "anon"}` : "sin eventos"}</dd>
        </dl>
        <label>URL WebSocket<input value={tikfinityWsUrl} onChange={(event) => onTikfinityWsUrlChange(event.target.value)} placeholder="ws://127.0.0.1:21213/" /></label>
        <label>Keywords<input value={tikfinityKeywords} onChange={(event) => onTikfinityKeywordsChange(event.target.value)} placeholder="yuko, @yuko, kokoria" /></label>
        <div className="streamActions">
          <button className="secondary" type="button" onClick={onConnectTikfinity} disabled={tikfinityBusy || tikfinityState?.status === "connected"}>Conectar TikFinity</button>
          <button className="secondary" type="button" onClick={onDisconnectTikfinity} disabled={tikfinityBusy || tikfinityState?.status === "disabled" || tikfinityState?.status === "disconnected"}>Desconectar</button>
          <button className="secondary" type="button" onClick={onTikfinityTestEvent} disabled={tikfinityBusy}>Test event</button>
          <button className="secondary" type="button" onClick={() => onSaveTikfinityConfig()} disabled={tikfinityBusy}>Guardar</button>
        </div>
        <div className="streamActions">
          <label><input type="checkbox" checked={tikfinityState?.config.enabled || false} onChange={(event) => onSaveTikfinityConfig({ enabled: event.target.checked })} /> TikFinity ON</label>
          <label><input type="checkbox" checked={tikfinityState?.config.respondToChat !== false} onChange={(event) => onSaveTikfinityConfig({ respondToChat: event.target.checked })} /> Responder comentarios</label>
          <label><input type="checkbox" checked={tikfinityState?.config.respondToMentionsOnly || false} onChange={(event) => onSaveTikfinityConfig({ respondToMentionsOnly: event.target.checked })} /> Solo menciones</label>
        </div>
        {tikfinityNotice && <p className="streamNotice">{tikfinityNotice}</p>}
        {tikfinityState?.recentEvents.length ? (
          <div className="streamTimeline">
            {tikfinityState.recentEvents.slice(0, 5).map((event) => (
              <article key={event.id} className="streamHistoryItem inbound">
                <span>{event.displayName || event.username || event.type}</span>
                <p>{event.text || event.giftName || `${event.type} recibido`}</p>
                <small>TikFinity - {formatShortTime(new Date(event.timestamp).toISOString())}</small>
              </article>
            ))}
          </div>
        ) : <p className="sceneHint">Sin eventos TikFinity todavia. Usa Test event para validar sin LIVE activo.</p>}
      </div>

      <div className="streamIntegrationCard">
        <header>
          <strong>Autonomia de Yuko</strong>
          <span>{autonomyState?.config.mode || "off"} - {autonomyState?.config.intensity || "low"}</span>
        </header>
        <dl className="streamStatus">
          <dt>Puede hablar</dt><dd>{autonomyState?.canSpeak.ok ? "si" : autonomyState?.canSpeak.reason || "no"}</dd>
          <dt>Cooldown</dt><dd>{formatDuration(autonomyState?.runtime.cooldownMs)}</dd>
          <dt>TTS ocupado</dt><dd>{autonomyState?.runtime.ttsQueueLength ? "si" : "no"}</dd>
          <dt>LLM ocupado</dt><dd>{autonomyState?.runtime.llmBusy ? "si" : "no"}</dd>
        </dl>
        <div className="streamSearchRow">
          <select value={autonomyState?.config.mode || "off"} onChange={(event) => onSaveAutonomyConfig({ enabled: event.target.value !== "off", mode: event.target.value as AutonomyStatePayload["config"]["mode"] })}>
            <option value="off">OFF</option>
            <option value="companion">Acompanante</option>
            <option value="vtuber">VTuber</option>
          </select>
          <select value={autonomyState?.config.intensity || "low"} onChange={(event) => onSaveAutonomyConfig({ intensity: event.target.value as AutonomyStatePayload["config"]["intensity"] })}>
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
          <button className="secondary" type="button" onClick={onAutonomyTrigger} disabled={autonomyBusy}>Probar autonomia</button>
        </div>
        <div className="streamActions">
          <label><input type="checkbox" checked={autonomyState?.config.allowLiveChatResponses !== false} onChange={(event) => onSaveAutonomyConfig({ allowLiveChatResponses: event.target.checked })} /> Chat del directo</label>
          <label><input type="checkbox" checked={autonomyState?.config.liveChatRespondToMentionsFirst !== false} onChange={(event) => onSaveAutonomyConfig({ liveChatRespondToMentionsFirst: event.target.checked })} /> Priorizar menciones</label>
        </div>
        {autonomyState?.lastDecision && (
          <dl className="streamStatus">
            <dt>Accion</dt><dd>{autonomyState.lastDecision.action}</dd>
            <dt>Score</dt><dd>{autonomyState.lastDecision.score}/{autonomyState.lastDecision.threshold}</dd>
            <dt>Razon</dt><dd>{autonomyState.lastDecision.blockedBy || autonomyState.lastDecision.reason}</dd>
            <dt>Hora</dt><dd>{formatShortTime(new Date(autonomyState.lastDecision.createdAt).toISOString())}</dd>
          </dl>
        )}
        {autonomyNotice && <p className="streamNotice">{autonomyNotice}</p>}
        <p className="sceneHint">OFF no habla sola. Acompanante interviene poco. VTuber puede reaccionar mas a chat, follows y regalos sin inventar vision.</p>
      </div>

      <div className="streamIntegrationCard">
        <header>
          <strong>Historial de viewers</strong>
          <span>{streamUsers.length} resultados</span>
        </header>
        <div className="streamSearchRow">
          <input value={streamUserQuery} onChange={(event) => onStreamUserQueryChange(event.target.value)} placeholder="Buscar usuario o display name" />
          <button className="secondary" type="button" onClick={onSearchStreamUsers}>Buscar</button>
        </div>
        {streamHistoryNotice && <p className="streamNotice">{streamHistoryNotice}</p>}
        <div className="streamUserList">
          {streamUsers.map((user) => (
            <button key={user.id} type="button" className={selectedStreamUser?.id === user.id ? "active" : ""} onClick={() => onSelectStreamUser(user)}>
              <strong>{user.display_name || user.username}</strong>
              <span>{platformLabel(user.platform)} - @{user.username} - {user.message_count} mensajes</span>
            </button>
          ))}
        </div>
        {selectedStreamUser && (
          <div className="streamTimeline">
            <header>
              <strong>{selectedStreamUser.display_name || selectedStreamUser.username}</strong>
              <button className="secondary" type="button" onClick={() => onRefreshStreamUserMessages(selectedStreamUser.id)}>Actualizar</button>
            </header>
            {streamUserMessages.map((item) => (
              <article key={item.id} className={`streamHistoryItem ${item.direction}`}>
                <span>{item.direction === "outbound" ? assistantName : item.display_name || item.username || "viewer"}</span>
                <p>{item.content}</p>
                <small>{platformLabel(item.platform)} - {item.channel_name || "sin canal"} - {formatShortTime(item.created_at)}{item.moderation_reason ? ` - ${moderationReasonLabel(item.moderation_reason)}` : ""}</small>
              </article>
            ))}
            {!streamUserMessages.length && <p className="sceneHint">Sin mensajes guardados para este viewer.</p>}
          </div>
        )}
        <p className="sceneHint">Historial local consultable. No es memoria automatica y no se envia al chat de Twitch.</p>
      </div>
    </ControlSection>
  );
}

function hasTiming(ms?: number | null): ms is number {
  return typeof ms === "number" && Number.isFinite(ms);
}

function formatDuration(ms?: number | null) {
  if (!hasTiming(ms)) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
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
