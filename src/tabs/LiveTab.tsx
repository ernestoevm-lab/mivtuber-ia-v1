import { Icon } from "../components/Icons.js";
import type { GuardStatus, SceneSettings, VisualNarrationImage, VisualPromptMode, VisualVisionState } from "../types.js";
import { formatShortTime, moderationDecisionLabel, moderationReasonLabel, VISUAL_MAX_INTERVAL_SECONDS, VISUAL_MIN_INTERVAL_SECONDS, visualKindLabel } from "./shared.js";

export function LiveTab({ guard, latestVisualImage, referenceImage, referenceImageAvailable, visualAutoEnabled, visualAutoIntervalSeconds, visualAutoNarrationEnabled, visualBusy, visualCaptureBusy, visualLastAnalysisAt, visualLastChangeScore, visualLastFrameAt, visualNotice, visualVisionState, voiceActive, voiceSource, voiceSpeaking, voiceTestNotice, onCapture, onClearReference, onIntervalChange, onStartAuto, onStopAuto, onToggleAutoNarration }: {
  guard: GuardStatus | null;
  latestVisualImage: VisualNarrationImage | null;
  referenceImage: SceneSettings["referenceImage"];
  referenceImageAvailable: boolean;
  visualAutoEnabled: boolean;
  visualAutoIntervalSeconds: number;
  visualAutoNarrationEnabled: boolean;
  visualBusy: boolean;
  visualCaptureBusy: boolean;
  visualLastAnalysisAt: string;
  visualLastChangeScore: number | null;
  visualLastFrameAt: string;
  visualNotice: string;
  visualVisionState: VisualVisionState;
  voiceActive: boolean;
  voiceSource: string;
  voiceSpeaking: boolean;
  voiceTestNotice: string;
  onCapture: (mode: VisualPromptMode) => void;
  onClearReference: (deleteFile: boolean) => void;
  onIntervalChange: (value: number) => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onToggleAutoNarration: (enabled: boolean) => void;
}) {
  return (
    <>
      <VoiceActivityCard active={voiceActive} speaking={voiceSpeaking} source={voiceSource} />
      {voiceTestNotice && <p className="chatNotice liveVoiceNotice">{voiceTestNotice}</p>}

      <LiveVisionCard
        referenceImage={referenceImage}
        referenceImageAvailable={referenceImageAvailable}
        latestVisualImage={latestVisualImage}
        visualAutoEnabled={visualAutoEnabled}
        visualAutoNarrationEnabled={visualAutoNarrationEnabled}
        visualAutoIntervalSeconds={visualAutoIntervalSeconds}
        visualVisionState={visualVisionState}
        visualBusy={visualBusy}
        visualCaptureBusy={visualCaptureBusy}
        visualNotice={visualNotice}
        visualLastFrameAt={visualLastFrameAt}
        visualLastAnalysisAt={visualLastAnalysisAt}
        visualLastChangeScore={visualLastChangeScore}
        onCapture={onCapture}
        onStartAuto={onStartAuto}
        onStopAuto={onStopAuto}
        onToggleAutoNarration={onToggleAutoNarration}
        onIntervalChange={onIntervalChange}
        onClearReference={onClearReference}
      />

      <section className="liveGuardCard cockpitCard">
        <header className="liveCardHeader">
          <Icon name="safety" size={17} />
          <div>
            <strong>Guardia y cola</strong>
            <span>ritmo · próximo · cola</span>
          </div>
        </header>
        <div className="liveGuardMetrics">
          <div>
            <span>Ritmo</span>
            <strong>{guard ? `${Math.ceil(guard.cooldownMs / 1000)}s` : "8s"}</strong>
          </div>
          <div>
            <span>En cola</span>
            <strong>{guard?.queueLength ?? 0}</strong>
          </div>
          <div>
            <span>Bloqueadas</span>
            <strong>{guard?.recent.filter((item) => item.decision === "blocked").length ?? 0}</strong>
          </div>
        </div>
        <div className="liveGuardNext">
          <div className="subhead">
            <div className="subhead__title">Siguiente en hablar</div>
            <div className="subhead__hint">próximo {guard ? Math.ceil(guard.nextResponseInMs / 1000) : 0}s</div>
          </div>
          {guard?.lastSelected ? (
            <article className="liveQueueItem next">
              <span>→</span>
              <div>
                <strong>{guard.lastSelected.user || guard.lastSelected.source || "directo"}</strong>
                <p>{guard.lastSelected.content}</p>
              </div>
            </article>
          ) : (
            <p className="muted">Sin selección reciente.</p>
          )}
        </div>
        <div className="liveGuardRecent">
          <div className="subhead">
            <div className="subhead__title">Actividad reciente</div>
            <div className="subhead__hint">{guard?.recent.length ?? 0} eventos</div>
          </div>
          <div className="liveQueueList">
            {guard?.recent.slice(0, 4).map((item, index) => (
              <article className={`liveQueueItem ${item.decision === "blocked" ? "blocked" : ""}`} key={`${item.created_at}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{moderationDecisionLabel(item.decision)} · {moderationReasonLabel(item.reason)}</strong>
                  <p>{item.user || item.source || "chat"}: {item.content}</p>
                </div>
              </article>
            ))}
            {!guard?.recent.length && <p className="muted">Sin actividad de cola todavía.</p>}
          </div>
        </div>
      </section>

    </>
  );
}

function VoiceActivityCard({ active, speaking, source }: { active: boolean; speaking: boolean; source: string }) {
  return (
    <div className={`voiceActivity glassCard liveVoiceCard ${speaking ? "speaking" : active ? "ready" : ""}`}>
      <header className="liveCardHeader">
        <Icon name="speaker" size={17} />
        <div>
          <strong>Voz de Yuko</strong>
          <span>{speaking ? "hablando" : active ? "lista" : "en espera"}</span>
        </div>
      </header>
      <div className="liveVoiceWave" aria-hidden="true">
        {Array.from({ length: 28 }).map((_, index) => <span key={index} style={{ animationDelay: `-${index * 55}ms` }} />)}
      </div>
      <div className="liveVoiceMeta">
        <strong>{source}</strong>
        <span>{speaking ? "hablando" : active ? "lista" : "en espera"}</span>
      </div>
    </div>
  );
}

function LiveVisionCard({ referenceImage, referenceImageAvailable, latestVisualImage, visualAutoEnabled, visualAutoNarrationEnabled, visualAutoIntervalSeconds, visualVisionState, visualBusy, visualCaptureBusy, visualNotice, visualLastFrameAt, visualLastAnalysisAt, visualLastChangeScore, onCapture, onStartAuto, onStopAuto, onToggleAutoNarration, onIntervalChange, onClearReference }: {
  referenceImage: SceneSettings["referenceImage"];
  referenceImageAvailable: boolean;
  latestVisualImage: VisualNarrationImage | null;
  visualAutoEnabled: boolean;
  visualAutoNarrationEnabled: boolean;
  visualAutoIntervalSeconds: number;
  visualVisionState: VisualVisionState;
  visualBusy: boolean;
  visualCaptureBusy: boolean;
  visualNotice: string;
  visualLastFrameAt: string;
  visualLastAnalysisAt: string;
  visualLastChangeScore: number | null;
  onCapture: (mode: VisualPromptMode) => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onToggleAutoNarration: (enabled: boolean) => void;
  onIntervalChange: (value: number) => void;
  onClearReference: (deleteFile: boolean) => void;
}) {
  const busy = visualBusy || visualCaptureBusy;
  const sourceName = visualAutoEnabled
    ? "pantalla activa"
    : latestVisualImage
      ? `${visualKindLabel(latestVisualImage.kind)} · ${latestVisualImage.name}`
      : referenceImage
        ? `overlay · ${referenceImage.name}`
        : "sin fuente";
  const lastFrameLabel = visualLastFrameAt ? formatShortTime(visualLastFrameAt) : "sin preview";
  const lastAnalysisLabel = visualLastAnalysisAt ? formatShortTime(visualLastAnalysisAt) : "sin análisis";
  const changeLabel = visualLastChangeScore === null ? "—" : `${Math.round(visualLastChangeScore)}`;
  const referenceReady = Boolean(referenceImage && referenceImageAvailable);

  return (
    <details className="liveVisionCard cockpitCard">
      <summary>
        <div className="liveCardHeader">
          <Icon name="eye" size={17} />
          <div>
            <strong>Visión / Narrar pantalla</strong>
            <span>{visualVisionLabel(visualVisionState)}</span>
          </div>
        </div>
        <span className={`liveVisionStatus ${visualAutoEnabled ? "on" : visualVisionState === "error" ? "error" : ""}`}>
          {visualAutoEnabled ? "viendo" : "manual"}
        </span>
      </summary>

      <div className="liveVisionBody">
        <div className="liveVisionSource">
          <span>Fuente</span>
          <strong>{sourceName}</strong>
        </div>

        <div className="liveVisionMetrics">
          <div>
            <span>Preview</span>
            <strong>{lastFrameLabel}</strong>
          </div>
          <div>
            <span>Análisis</span>
            <strong>{lastAnalysisLabel}</strong>
          </div>
          <div>
            <span>Cambio</span>
            <strong>{changeLabel}</strong>
          </div>
        </div>

        <div className="liveVisionActions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onCapture("look")}>
            <Icon name="monitor" size={14} />
            Mirar pantalla
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onCapture("narrate")}>
            <Icon name="speaker" size={14} />
            Narrar pantalla
          </button>
        </div>

        <div className="liveVisionToggles">
          <button type="button" className={visualAutoEnabled ? "btn btn--danger" : "btn btn--ghost"} disabled={visualCaptureBusy} onClick={visualAutoEnabled ? onStopAuto : onStartAuto}>
            <Icon name={visualAutoEnabled ? "close" : "eye"} size={14} />
            {visualAutoEnabled ? "Detener visión" : "Activar visión"}
          </button>
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={visualAutoNarrationEnabled}
              disabled={!visualAutoEnabled}
              onChange={(event) => onToggleAutoNarration(event.target.checked)}
            />
            Narrar sola cuando la pantalla cambie
          </label>
        </div>

        <label className="liveVisionRange">
          <span>Intervalo de captura</span>
          <input
            type="range"
            min={VISUAL_MIN_INTERVAL_SECONDS}
            max={VISUAL_MAX_INTERVAL_SECONDS}
            step="1"
            value={visualAutoIntervalSeconds}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
          />
          <output>{visualAutoIntervalSeconds}s</output>
        </label>

        <div className="liveVisionOverlay">
          <div className="liveVisionOverlayStatus">
            <span>Overlay</span>
            <strong>{referenceImage ? referenceImage.name : "sin imagen"}</strong>
            {referenceImage && !referenceReady && <small>archivo no disponible</small>}
          </div>
          <div>
            <button type="button" className="btn btn--ghost" disabled={!referenceImage || visualBusy} onClick={() => onClearReference(false)}>
              <Icon name="close" size={14} />
              Quitar overlay
            </button>
            <button type="button" className="btn btn--ghost liveVisionDanger" disabled={!referenceImage || visualBusy} onClick={() => onClearReference(true)}>
              <Icon name="image" size={14} />
              Borrar archivo
            </button>
          </div>
        </div>

        <p className={`liveVisionNotice ${visualVisionState === "error" ? "error" : ""}`}>
          {visualNotice || "Mirar describe para ti; Narrar redacta una línea lista para directo."}
        </p>
      </div>
    </details>
  );
}

function visualVisionLabel(state: VisualVisionState) {
  switch (state) {
    case "selecting": return "eligiendo fuente";
    case "watching": return "viendo pantalla";
    case "analyzing": return "analizando";
    case "busy": return "modelo ocupado";
    case "no-change": return "sin cambios";
    case "error": return "error";
    default: return "visión apagada";
  }
}
