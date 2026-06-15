import { Icon, type IconName } from "./Icons.js";

type StatusState = "ok" | "warn" | "err" | "off";

const statusLabels: Record<StatusState, string> = {
  ok: "operativo",
  warn: "atencion",
  err: "error",
  off: "apagado"
};

function StatusPill({
  icon,
  label,
  state,
  value
}: {
  icon: IconName;
  label: string;
  state: StatusState;
  value: string;
}) {
  return (
    <button className={`status-pill status-pill--${state}`} title={`${label} · ${statusLabels[state]} · ${value}`} type="button">
      <span className="status-pill__dot" />
      <Icon name={icon} size={13} />
      <span className="status-pill__text">
        <span>{label}</span>
        <span className="status-pill__value">{value}</span>
      </span>
    </button>
  );
}

export function TopBar({
  audioReady,
  fallbackActive,
  host,
  mobileMenuOpen,
  modelLabel,
  modelReady,
  notice,
  serverReady,
  shutdownBusy,
  shutdownConfirm,
  speakerReady,
  twitchReady,
  viewerReady,
  onAskShutdown,
  onCancelShutdown,
  onConfirmShutdown,
  onToggleMobileMenu
}: {
  audioReady: boolean;
  fallbackActive: boolean;
  host: string;
  mobileMenuOpen: boolean;
  modelLabel: string;
  modelReady: boolean;
  notice: string;
  serverReady: boolean;
  shutdownBusy: boolean;
  shutdownConfirm: boolean;
  speakerReady: boolean;
  twitchReady: boolean;
  viewerReady: boolean;
  onAskShutdown: () => void;
  onCancelShutdown: () => void;
  onConfirmShutdown: () => void;
  onToggleMobileMenu: () => void;
}) {
  const backendState: StatusState = serverReady ? "ok" : "err";
  const modelState: StatusState = fallbackActive ? "warn" : modelReady ? "ok" : "off";
  const audioState: StatusState = audioReady ? "ok" : "warn";
  const twitchState: StatusState = twitchReady ? "ok" : "off";
  const obsState: StatusState = viewerReady && speakerReady ? "ok" : viewerReady || speakerReady ? "warn" : "off";
  const obsValue = viewerReady && speakerReady ? "viewer/speaker" : viewerReady ? "solo viewer" : speakerReady ? "solo speaker" : "pendiente";

  return (
    <>
      <header className="topbar cockpitTopbar">
        <button
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Cerrar navegacion" : "Abrir navegacion"}
          className="sidebarToggle"
          onClick={onToggleMobileMenu}
          type="button"
        >
          <Icon name={mobileMenuOpen ? "close" : "menu"} size={19} />
        </button>

        <div className="topbar__title">
          MiVtuberIA
          <small>{host || "app local"}</small>
        </div>

        <div className="status-strip" role="group" aria-label="Estado del sistema">
          <StatusPill icon="cpu" label="Backend" state={backendState} value={serverReady ? "online" : "offline"} />
          <StatusPill icon="bot" label="Modelo" state={modelState} value={fallbackActive ? "fallback" : modelReady ? modelLabel : "pendiente"} />
          <StatusPill icon="mic" label="Audio" state={audioState} value={audioReady ? "activo" : "bloqueado"} />
          <StatusPill icon="twitch" label="Twitch" state={twitchState} value={twitchReady ? "conectado" : "offline"} />
          <StatusPill icon="monitor" label="OBS" state={obsState} value={obsValue} />
        </div>

        <div className="topbar__divider" />

        {notice && <span className="shutdownNotice">{notice}</span>}
        <button className="btn-shutdown" disabled={shutdownBusy} onClick={onAskShutdown} type="button">
          <Icon name="power" size={15} />
          {shutdownBusy ? "Apagando..." : "Apagar"}
        </button>
      </header>

      {shutdownConfirm && (
        <div className="scrim" role="presentation" onMouseDown={shutdownBusy ? undefined : onCancelShutdown}>
          <section
            aria-labelledby="shutdown-dialog-title"
            aria-modal="true"
            className="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="dialog__icon" aria-hidden="true">
              <Icon name="power" size={22} />
            </div>
            <h2 className="dialog__title" id="shutdown-dialog-title">Apagar MiVtuberIA</h2>
            <p className="dialog__body">
              Esto detiene el backend local, las conexiones de stream y la salida de audio de Yuko.
            </p>
            <div className="dialog__row">
              <button className="btn btn--ghost" disabled={shutdownBusy} onClick={onCancelShutdown} type="button">Cancelar</button>
              <button className="btn btn--danger" disabled={shutdownBusy} onClick={onConfirmShutdown} type="button">
                {shutdownBusy ? "Apagando..." : "Confirmar apagado"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
