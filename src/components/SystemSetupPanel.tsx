import type { AvatarRuntimeStatus } from "../AvatarStage.js";
import type { LocalModel, StatusPayload, TtsPayload } from "../types.js";

// Fallback para mostrar URLs OBS antes de recibir /api/status; cuando el backend
// responde, usamos el puerto real que reporta el runtime.
const DEFAULT_BACKEND_ORIGIN = "http://127.0.0.1:8787";

type SetupMode = "onboarding" | "panel";
type CheckLevel = "loading" | "success" | "warning" | "error" | "empty";

type SystemCheck = {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  nextStep: string;
};

export function SystemSetupPanel({
  activeAvatarUrl,
  avatarStatus,
  models,
  mode,
  setupAccepted,
  status,
  statusError,
  termsAccepted,
  tts,
  onAcceptTerms,
  onContinue,
  onRefresh
}: {
  activeAvatarUrl: string;
  avatarStatus: AvatarRuntimeStatus;
  models: LocalModel[];
  mode: SetupMode;
  setupAccepted: boolean;
  status: StatusPayload | null;
  statusError?: string;
  termsAccepted: boolean;
  tts: TtsPayload | null;
  onAcceptTerms: (accepted: boolean) => void;
  onContinue: () => void;
  onRefresh: () => void;
}) {
  const checks = buildSystemChecks({ activeAvatarUrl, avatarStatus, models, status, statusError, tts });
  const obsOrigin = status?.runtime.port ? `http://127.0.0.1:${status.runtime.port}` : DEFAULT_BACKEND_ORIGIN;
  const blockingError = checks.some((check) => check.id === "backend" && check.level === "error");
  const limitedMode = checks.some((check) => check.level === "warning" || check.level === "empty");
  const shellClass = mode === "onboarding" ? "setupShell" : "systemPanel";
  const primaryLabel = mode === "panel"
    ? setupAccepted ? "Aviso aceptado" : "Aceptar aviso"
    : limitedMode ? "Entrar en modo limitado" : "Entrar a MiVtuberIA";

  return (
    <section className={shellClass} aria-label={mode === "onboarding" ? "Primer inicio de MiVtuberIA" : "Estado del sistema"}>
      <div className="setupSurface">
        <header className="setupHeader">
          <div>
            <span className="setupEyebrow">Primer inicio</span>
            <h1>Configurar MiVtuberIA</h1>
            <p>
              Yuko funciona como app local. Esta pantalla revisa lo necesario para hablar, verse en OBS y entrar
              aunque falte algo no critico.
            </p>
          </div>
          <span className={`setupReadiness ${blockingError ? "error" : limitedMode ? "warning" : "success"}`}>
            {blockingError ? "Revisar backend" : limitedMode ? "Modo limitado disponible" : "Lista para usar"}
          </span>
        </header>

        {mode === "onboarding" && (
          <div className="termsBox">
            <label>
              <input checked={termsAccepted} onChange={(event) => onAcceptTerms(event.target.checked)} type="checkbox" />
              <span>
                Acepto usar MiVtuberIA en modo familiar, revisar las respuestas de Yuko antes de salir en directo y no
                pegar secretos, tokens ni datos privados en los mensajes de prueba.
              </span>
            </label>
          </div>
        )}

        <div className="systemChecks">
          {checks.map((check) => (
            <article className={`systemCheck ${check.level}`} key={check.id}>
              <span className="systemCheckIcon">{levelIcon(check.level)}</span>
              <div>
                <strong>{check.title}</strong>
                <p>{check.detail}</p>
                <small>{check.nextStep}</small>
              </div>
            </article>
          ))}
        </div>

        <div className="obsSetupCard">
          <div>
            <strong>OBS</strong>
            <p>Agrega dos Browser Sources para separar visual y audio.</p>
          </div>
          <dl>
            <dt>Visual</dt>
            <dd>{`${obsOrigin}/viewer`}</dd>
            <dt>Audio</dt>
            <dd>{`${obsOrigin}/speaker`}</dd>
          </dl>
        </div>

        <div className="setupActions">
          <button className="primaryAction" disabled={(mode === "onboarding" && !termsAccepted) || (mode === "panel" && setupAccepted)} onClick={onContinue} type="button">
            {primaryLabel}
          </button>
          <button className="secondary" onClick={onRefresh} type="button">Revisar otra vez</button>
        </div>

        {setupAccepted && mode === "panel" && (
          <p className="setupFootnote">Aviso inicial aceptado en este equipo. No se guardan secretos en este ajuste local.</p>
        )}
      </div>
    </section>
  );
}

function buildSystemChecks({
  activeAvatarUrl,
  avatarStatus,
  models,
  status,
  statusError,
  tts
}: {
  activeAvatarUrl: string;
  avatarStatus: AvatarRuntimeStatus;
  models: LocalModel[];
  status: StatusPayload | null;
  statusError?: string;
  tts: TtsPayload | null;
}): SystemCheck[] {
  const lmStudio = status?.runtime.lmStudioDetected;
  const loadedModels = models.filter((model) => model.loaded);
  const detectedModelCount = lmStudio?.models?.length || 0;
  const hasModel = loadedModels.length > 0 || detectedModelCount > 0;
  const configuredModel = status?.runtime.lmStudioModel || "modelo configurado";
  const kokoroReady = tts?.activeBackend === "kokoro" && Boolean(tts.ready);
  const browserVoiceReady = Boolean(tts && (tts.activeBackend === "browser" || tts.provider === "browser"));
  const hasVrm = Boolean(avatarStatus.hasVrm || activeAvatarUrl);

  return [
    {
      id: "backend",
      level: status?.ok ? "success" : statusError ? "error" : "loading",
      title: "Backend local",
      detail: status?.ok
        ? "El servicio local de MiVtuberIA esta listo."
        : statusError || "Esperando el servicio local que arranca junto con la app.",
      nextStep: status?.ok ? "Puedes usar la cabina." : "Si tarda demasiado, revisa la seccion Logs."
    },
    {
      id: "safety",
      level: status ? "success" : "loading",
      title: "Modo familiar",
      detail: status ? `Guardia activa en modo ${safetyLabel(status.safety.mode)}.` : "Cargando reglas de seguridad locales.",
      nextStep: "El modo familiar es el punto de partida para pruebas y directo."
    },
    {
      id: "lmstudio",
      level: !status ? "loading" : lmStudio?.ok ? "success" : "warning",
      title: "Cerebro local de Yuko",
      detail: lmStudio?.ok
        ? "LM Studio responde en esta PC."
        : "LM Studio no esta conectado todavia o no responde en la URL configurada.",
      nextStep: lmStudio?.ok ? "Ahora revisa que haya un modelo cargado." : "Abre LM Studio y deja un modelo listo; Yuko puede entrar en modo limitado mientras tanto."
    },
    {
      id: "model",
      level: !status ? "loading" : hasModel ? "success" : "empty",
      title: "Modelo LLM",
      detail: hasModel
        ? `Modelo disponible: ${loadedModels[0]?.displayName || loadedModels[0]?.id || lmStudio?.models?.[0] || configuredModel}.`
        : "No hay un modelo listo para respuestas inteligentes.",
      nextStep: hasModel ? "Yuko puede responder con el modelo local." : "Carga un modelo en LM Studio o usa la app en fallback limitado."
    },
    {
      id: "voice",
      level: !tts ? "loading" : kokoroReady ? "success" : browserVoiceReady ? "warning" : "empty",
      title: "Voz",
      detail: kokoroReady
        ? `Kokoro esta listo con la voz ${tts.kokoroVoice}.`
        : browserVoiceReady
          ? "Kokoro no esta activo; Yuko usara voz del navegador."
          : "No hay voz local lista todavia.",
      nextStep: kokoroReady ? "Audio local listo." : "Puedes probar con voz del navegador y configurar Kokoro despues."
    },
    {
      id: "avatar",
      level: hasVrm ? "success" : "warning",
      title: "Avatar",
      detail: hasVrm ? "Hay un VRM activo para Yuko." : "No hay VRM activo; se mostrara avatar fallback.",
      nextStep: hasVrm ? "La escena puede usar el avatar cargado." : "Puedes cargar un VRM despues desde Avatar sin bloquear la app."
    },
    {
      id: "obs",
      level: status?.ok ? "success" : "loading",
      title: "Viewer y speaker",
      detail: "La escena visual y el audio para OBS estan separados.",
      nextStep: "Usa las rutas de OBS de esta pantalla cuando prepares el directo."
    }
  ];
}

function levelIcon(level: CheckLevel) {
  const icons: Record<CheckLevel, string> = {
    loading: "...",
    success: "OK",
    warning: "!",
    error: "X",
    empty: "-"
  };
  return icons[level];
}

function safetyLabel(mode: StatusPayload["safety"]["mode"]) {
  const labels: Record<StatusPayload["safety"]["mode"], string> = {
    normal: "familiar normal",
    strict: "estricto",
    approval: "aprobacion manual",
    silence: "silencio"
  };
  return labels[mode];
}
