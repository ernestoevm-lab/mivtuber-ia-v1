import { useState } from "react";
import type { AvatarRuntimeStatus } from "../AvatarStage.js";
import { SystemSetupPanel } from "../components/SystemSetupPanel.js";
import type { LocalModel, StatusPayload, TtsPayload } from "../types.js";
import { ControlSection, StatusMetric } from "./shared.js";

type SecretKey =
  | "GEMINI_API_KEY"
  | "OPENROUTER_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "MINIMAX_API_KEY"
  | "TWITCH_CHANNEL"
  | "TWITCH_BOT_USERNAME"
  | "TWITCH_OAUTH_TOKEN";

const providerSecretFields: Array<{ key: SecretKey; label: string; placeholder: string; note: string }> = [
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API key",
    placeholder: "AIza...",
    note: "Google AI Studio. Se usa cuando el proveedor activo es Gemini."
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter API key",
    placeholder: "sk-or-...",
    note: "Guardada para habilitar proveedor OpenRouter cuando el backend lo conecte."
  },
  {
    key: "DEEPSEEK_API_KEY",
    label: "DeepSeek API key",
    placeholder: "sk-...",
    note: "Guardada localmente para el proveedor DeepSeek."
  },
  {
    key: "MINIMAX_API_KEY",
    label: "MiniMax API key",
    placeholder: "MiniMax key",
    note: "Guardada localmente para voz/modelos MiniMax cuando se active ese flujo."
  }
];

const twitchSecretFields: Array<{ key: SecretKey; label: string; placeholder: string; type?: string }> = [
  { key: "TWITCH_CHANNEL", label: "Canal de Twitch", placeholder: "tu_canal", type: "text" },
  { key: "TWITCH_BOT_USERNAME", label: "Usuario del bot", placeholder: "bot_username", type: "text" },
  { key: "TWITCH_OAUTH_TOKEN", label: "Token OAuth", placeholder: "oauth:...", type: "password" }
];

export function SettingsTab({
  activeAvatarUrl,
  avatarStatus,
  currentHost,
  models,
  setupAccepted,
  status,
  statusError,
  termsAccepted,
  tts,
  onAcceptTerms,
  onContinue,
  secretsBusy,
  secretsNotice,
  secretsStatus,
  onSaveSecrets,
  onRefresh
}: {
  activeAvatarUrl: string;
  avatarStatus: AvatarRuntimeStatus;
  currentHost: string;
  models: LocalModel[];
  setupAccepted: boolean;
  status: StatusPayload | null;
  statusError?: string;
  termsAccepted: boolean;
  tts: TtsPayload | null;
  onAcceptTerms: (accepted: boolean) => void;
  onContinue: () => void;
  secretsBusy: boolean;
  secretsNotice: string;
  secretsStatus: Record<string, boolean> | null;
  onSaveSecrets: (updates: Record<string, string>, successNotice: string) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const backendOrigin = status?.runtime.port ? `http://127.0.0.1:${status.runtime.port}` : "http://127.0.0.1:8787";
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});

  const updateDraft = (key: SecretKey, value: string) => {
    setSecretDrafts((current) => ({ ...current, [key]: value }));
  };

  const saveProviderKey = (key: SecretKey, label: string) => {
    const value = secretDrafts[key] || "";
    return onSaveSecrets({ [key]: value }, `${label} guardada en esta PC.`).then((saved) => {
      if (saved) setSecretDrafts((current) => ({ ...current, [key]: "" }));
      return saved;
    });
  };

  const deleteProviderKey = (key: SecretKey, label: string) => {
    return onSaveSecrets({ [key]: "" }, `${label} eliminada de esta PC.`).then((saved) => {
      if (saved) setSecretDrafts((current) => ({ ...current, [key]: "" }));
      return saved;
    });
  };

  const saveTwitchKeys = () => {
    const updates: Record<string, string> = {};
    for (const field of twitchSecretFields) {
      if (secretDrafts[field.key] !== undefined) updates[field.key] = secretDrafts[field.key];
    }
    return onSaveSecrets(updates, "Credenciales de Twitch guardadas.").then((saved) => {
      if (saved) {
        setSecretDrafts((current) => ({
          ...current,
          TWITCH_CHANNEL: "",
          TWITCH_BOT_USERNAME: "",
          TWITCH_OAUTH_TOKEN: ""
        }));
      }
      return saved;
    });
  };

  const twitchDraftDirty = twitchSecretFields.some((field) => secretDrafts[field.key] !== undefined);

  return (
    <ControlSection title="Ajustes" icon="S">
      <SystemSetupPanel
        activeAvatarUrl={activeAvatarUrl}
        avatarStatus={avatarStatus}
        mode="panel"
        models={models}
        setupAccepted={setupAccepted}
        status={status}
        statusError={statusError}
        termsAccepted={termsAccepted}
        tts={tts}
        onAcceptTerms={onAcceptTerms}
        onContinue={onContinue}
        onRefresh={onRefresh}
      />
      <div className="modelLoadStatus">
        <StatusMetric label="Panel" value={`http://${currentHost}/`} />
        <StatusMetric label="Viewer OBS" value={`${backendOrigin}/viewer`} />
        <StatusMetric label="Speaker OBS" value={`${backendOrigin}/speaker`} />
        <StatusMetric label="Backend" value={status ? "online" : "pendiente"} />
      </div>
      <section className="secretSettingsPanel" aria-label="Claves API y credenciales">
        <header>
          <div>
            <strong>Claves API y credenciales</strong>
            <p>Se guardan solo en el archivo `.env` local de esta instalacion. La app nunca vuelve a mostrar el valor guardado.</p>
          </div>
          <span>{configuredCount(secretsStatus)} configuradas</span>
        </header>

        <div className="secretProviderGrid">
          {providerSecretFields.map((field) => (
            <article className="secretProviderCard" key={field.key}>
              <div className="secretProviderHeader">
                <div>
                  <strong>{field.label}</strong>
                  <p>{field.note}</p>
                </div>
                <span className={secretsStatus?.[field.key] ? "secretStatus on" : "secretStatus"}>
                  {secretsStatus?.[field.key] ? "Configurada" : "Pendiente"}
                </span>
              </div>
              <label>
                Nueva clave
                <input
                  type="password"
                  value={secretDrafts[field.key] || ""}
                  autoComplete="off"
                  placeholder={secretsStatus?.[field.key] ? "Pega una nueva clave para reemplazarla" : field.placeholder}
                  onChange={(event) => updateDraft(field.key, event.target.value)}
                />
              </label>
              <div className="secretActions">
                <button type="button" disabled={secretsBusy || !secretDrafts[field.key]?.trim()} onClick={() => void saveProviderKey(field.key, field.label)}>
                  {secretsBusy ? "Guardando" : "Guardar"}
                </button>
                <button className="secondary" type="button" disabled={secretsBusy || !secretsStatus?.[field.key]} onClick={() => void deleteProviderKey(field.key, field.label)}>
                  Borrar
                </button>
              </div>
            </article>
          ))}
        </div>

        <article className="secretProviderCard">
          <div className="secretProviderHeader">
            <div>
              <strong>Twitch</strong>
              <p>Credenciales del canal y bot para leer chat en directo.</p>
            </div>
            <span className={twitchConfigured(secretsStatus) ? "secretStatus on" : "secretStatus"}>
              {twitchConfigured(secretsStatus) ? "Completo" : "Incompleto"}
            </span>
          </div>
          <div className="secretProviderGrid compact">
            {twitchSecretFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type={field.type || "password"}
                  value={secretDrafts[field.key] || ""}
                  autoComplete="off"
                  placeholder={secretsStatus?.[field.key] ? "Configurado" : field.placeholder}
                  onChange={(event) => updateDraft(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="secretActions">
            <button type="button" disabled={secretsBusy || !twitchDraftDirty} onClick={() => void saveTwitchKeys()}>
              {secretsBusy ? "Guardando" : "Guardar Twitch"}
            </button>
          </div>
        </article>

        {secretsNotice && <p className="streamNotice">{secretsNotice}</p>}
      </section>
      <p className="sceneHint">Para OBS usa Browser Source con las URLs de Viewer y Speaker. La ventana de vista previa sirve para revisar, no como fuente principal de OBS.</p>
    </ControlSection>
  );
}

function configuredCount(status: Record<string, boolean> | null) {
  if (!status) return 0;
  return providerSecretFields.filter((field) => status[field.key]).length;
}

function twitchConfigured(status: Record<string, boolean> | null) {
  return Boolean(status?.TWITCH_CHANNEL && status.TWITCH_BOT_USERNAME && status.TWITCH_OAUTH_TOKEN);
}
