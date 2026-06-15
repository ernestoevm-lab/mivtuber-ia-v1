import type { GuardStatus, SafetyMode } from "../types.js";
import { ControlSection, safetyModeDescription, safetyModeLabel } from "./shared.js";

export function SafetyTab({ mode, guard, onChangeMode }: {
  mode: SafetyMode;
  guard: GuardStatus | null;
  onChangeMode: (mode: SafetyMode) => void;
}) {
  return (
    <ControlSection title="Guardia de chat" icon="G">
      <div className="segmented compact">
        {(["normal", "strict", "approval", "silence"] as SafetyMode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => onChangeMode(item)}>
            {safetyModeLabel(item)}
          </button>
        ))}
      </div>
      <div className="safetyExplainer">
        <strong>Cómo funciona</strong>
        <span>{safetyModeDescription(mode)}</span>
        <span>Administrador salta la guardia. Chat del directo entra a moderación, cola y cooldown para parecer chat real.</span>
      </div>
      <div className="guardStats">
        <span>cola {guard?.queueLength ?? 0}</span>
        <span>ritmo {guard ? Math.ceil(guard.cooldownMs / 1000) : 8}s</span>
        <span>próximo {guard ? Math.ceil(guard.nextResponseInMs / 1000) : 0}s</span>
      </div>
      <div className="guardList">
        {guard?.lastSelected && (
          <article className="guardItem selected">
            <strong>Elegido</strong>
            <span>{guard.lastSelected.user || guard.lastSelected.source}: {guard.lastSelected.content}</span>
          </article>
        )}
        {guard?.recent.map((item, index) => (
          <article className="guardItem" key={`${item.created_at}-${index}`}>
            <strong>{item.decision} · {item.reason} · {item.score}</strong>
            <span>{item.user || item.source}: {item.content}</span>
          </article>
        ))}
        {!guard?.recent.length && !guard?.lastSelected && <p className="muted">Sin actividad de cola todavía.</p>}
      </div>
    </ControlSection>
  );
}
