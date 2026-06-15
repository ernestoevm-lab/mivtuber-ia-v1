import { useState } from "react";
import type { ChatResponse, LocalModel, StatusPayload } from "../types.js";
import { ControlSection, StatusMetric } from "./shared.js";

const CLOUD_PROVIDERS = ["gemini", "openrouter", "deepseek", "minimax"];
const CLOUD_PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini (nube)",
  openrouter: "OpenRouter (nube)",
  deepseek: "DeepSeek (nube)",
  minimax: "MiniMax (nube)"
};

export function ModelTab({
  activeProvider,
  activeProviderRaw,
  assistantName,
  cloudModelChoice,
  cloudModels,
  cloudModelsNotice,
  lastInferenceStale,
  lastResponse,
  loadedChatModels,
  loadedModelWarning,
  modelBusy,
  modelChoice,
  modelMismatchWarning,
  modelName,
  modelNotice,
  models,
  runtimeDraftDirty,
  selectedBaseUrl,
  selectedProvider,
  serverRunning,
  status,
  cloudKeyConfigured,
  secretsBusy,
  secretsNotice,
  onSaveCloudKey,
  onApplyActiveModel,
  onApplyModel,
  onBaseUrlChange,
  onCloudModelChange,
  onModelChoiceChange,
  onProviderChange,
  onUpdateRuntimeBase
}: {
  activeProvider: string;
  activeProviderRaw: string;
  assistantName: string;
  cloudModelChoice: string;
  cloudModels: string[];
  cloudModelsNotice: string;
  lastInferenceStale: boolean;
  lastResponse: ChatResponse | null;
  loadedChatModels: string[];
  loadedModelWarning: string;
  modelBusy: boolean;
  modelChoice: string;
  modelMismatchWarning: string;
  modelName: string;
  modelNotice: string;
  models: LocalModel[];
  runtimeDraftDirty: boolean;
  selectedBaseUrl: string;
  selectedProvider: string;
  serverRunning: boolean;
  status: StatusPayload | null;
  cloudKeyConfigured: boolean;
  secretsBusy: boolean;
  secretsNotice: string;
  onSaveCloudKey: (key: string) => Promise<boolean>;
  onApplyActiveModel: () => void;
  onApplyModel: () => void;
  onBaseUrlChange: (baseUrl: string) => void;
  onCloudModelChange: (model: string) => void;
  onModelChoiceChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onUpdateRuntimeBase: () => void;
}) {
  const [cloudKeyDraft, setCloudKeyDraft] = useState("");
  const lmStudioDetected = serverRunning && Boolean(models.length || loadedChatModels.length);
  const selectedIsCloud = CLOUD_PROVIDERS.includes(selectedProvider);
  const activeIsCloud = CLOUD_PROVIDERS.includes(activeProviderRaw);
  const cloudLabel = CLOUD_PROVIDER_LABELS[selectedProvider] || "Nube";
  const cloudActiveModel = activeProviderRaw === "gemini" ? status?.runtime.geminiModel
    : activeProviderRaw === "openrouter" ? status?.runtime.openrouterModel
      : activeProviderRaw === "deepseek" ? status?.runtime.deepseekModel
        : activeProviderRaw === "minimax" ? status?.runtime.minimaxModel
          : "";
  return (
    <ControlSection title="Modelo" icon="M">
      {activeIsCloud ? (
        <div className="runtimeStatus"><span className="dot on" /><span>{CLOUD_PROVIDER_LABELS[activeProviderRaw] || "Nube"} activo · {cloudActiveModel || "modelo por elegir"}</span></div>
      ) : (
        <div className="runtimeStatus"><span className={serverRunning ? "dot on" : "dot"} /><span>{serverRunning ? "LM Studio activo" : "LM Studio apagado"}</span></div>
      )}
      <div className="modelLoadStatus">
        <StatusMetric label="Proveedor guardado" value={activeProvider} />
        <StatusMetric label="Proveedor seleccionado" value={selectedProvider} />
        <StatusMetric label="Modelo que usará la app" value={modelName !== "..." ? modelName : "sin configurar"} />
        <StatusMetric label="Modelos activos en LM Studio" value={loadedChatModels.join(", ") || "ninguno detectado"} />
        <StatusMetric label="Tipo de API detectada" value={activeIsCloud ? "openai-compatible · nube" : `${status?.runtime.lmStudioDetected?.apiMode || status?.runtime.lmStudioApiMode || "auto"} · ${status?.runtime.lmStudioDetected?.ok ? "detectado" : "pendiente"}`} />
        <StatusMetric label="Última inferencia" value={lastInferenceStale ? `pendiente con ${modelName}` : status?.runtime.lastLlmSuccess ? `${status.runtime.lastLlmSuccess.provider} · ${status.runtime.lastLlmSuccess.model}` : lastResponse ? `${lastResponse.provider} · ${lastResponse.model}` : "sin uso"} />
      </div>
      {runtimeDraftDirty && <p className="chatNotice">Tienes cambios sin guardar: el proveedor seleccionado todavía no es el proveedor activo real.</p>}
      {status?.runtime.lastLlmError && <p className="chatNotice">Último error LLM: {status.runtime.lastLlmError.apiMode} · {status.runtime.lastLlmError.model} · {status.runtime.lastLlmError.error}</p>}
      {modelMismatchWarning && <p className="chatNotice">{modelMismatchWarning}</p>}
      {loadedModelWarning && <p className="chatNotice">{loadedModelWarning}</p>}
      {lastResponse?.provider === "fallback" && <p className="chatNotice">{assistantName} está usando fallback. Pulsa “Detectar modelo ya cargado” si LM Studio ya muestra un modelo READY.</p>}
      <p className="muted">Proveedor decide quién arma la respuesta. LM Studio usa el modelo local; los cerebros de nube (Gemini/OpenRouter/DeepSeek/MiniMax) usan tu API key; Auto/Ollama mantienen el comportamiento configurado del backend.</p>
      <label>Proveedor de respuesta<select value={selectedProvider} onChange={(event) => onProviderChange(event.target.value)}>
        <option value="lmstudio">LM Studio</option>
        <option value="gemini">Gemini (nube)</option>
        <option value="openrouter">OpenRouter (nube)</option>
        <option value="deepseek">DeepSeek (nube)</option>
        <option value="minimax">MiniMax (nube)</option>
        <option value="auto">Auto</option>
        <option value="ollama">Ollama</option>
      </select></label>
      {selectedIsCloud ? (
        <>
          <div className="runtimeStatus">
            <span className={cloudKeyConfigured ? "dot on" : "dot"} />
            <span>{cloudKeyConfigured ? `API key de ${cloudLabel} configurada` : `Falta tu API key de ${cloudLabel}`}</span>
          </div>
          <label>API key de {cloudLabel}
            <input
              type="password"
              value={cloudKeyDraft}
              autoComplete="off"
              placeholder={cloudKeyConfigured ? "Pega una key nueva solo para reemplazarla" : "Pega aquí tu API key y pulsa Guardar"}
              onChange={(event) => setCloudKeyDraft(event.target.value)}
            />
          </label>
          <div className="buttonGrid">
            <button
              type="button"
              disabled={secretsBusy || !cloudKeyDraft.trim()}
              onClick={() => {
                void onSaveCloudKey(cloudKeyDraft.trim()).then((saved) => {
                  if (saved) setCloudKeyDraft("");
                });
              }}
            >{secretsBusy ? "Guardando" : selectedProvider === "gemini" ? "Guardar y activar Gemini" : "Guardar API key"}</button>
          </div>
          <p className="muted">La key queda solo en esta PC y nunca se vuelve a mostrar. También puedes administrarla en Ajustes. {selectedProvider === "gemini" ? "Al guardar una key válida de Gemini, Yuko empieza a usarla automáticamente." : "Después elige el modelo y pulsa “Guardar proveedor y modelo” para activarlo."}</p>
          <label>Modelo de {cloudLabel}<select value={cloudModelChoice} onChange={(event) => onCloudModelChange(event.target.value)}>
            <option value="">{cloudModels.length ? "Seleccionar modelo" : "Sin lista disponible"}</option>
            {cloudModels.map((model) => <option key={model} value={model}>{model}</option>)}
            {cloudModelChoice && !cloudModels.includes(cloudModelChoice) && <option value={cloudModelChoice}>{cloudModelChoice}</option>}
          </select></label>
          {cloudModelsNotice && <p className="sceneHint">{cloudModelsNotice}</p>}
          {secretsNotice && <p className="sceneHint">{secretsNotice}</p>}
        </>
      ) : selectedProvider === "lmstudio" ? (
        <>
          <div className="runtimeStatus">
            <span className={lmStudioDetected ? "dot on" : "dot"} />
            <span>{lmStudioDetected ? "LM Studio detectado" : "LM Studio no detectado"}</span>
          </div>
          {!lmStudioDetected && (
            <p className="muted">LM Studio es el cerebro <strong>local opcional</strong> (corre en tu PC, sin nube). No viene incluido: instala la app <em>LM Studio</em> aparte, carga un modelo y enciende su servidor local. Cuando esté corriendo, aquí aparecerá solo. Si prefieres lo más fácil, usa <strong>Gemini (nube)</strong> con tu API key.</p>
          )}
          <label>Modelo local de LM Studio<select value={modelChoice} onChange={(event) => onModelChoiceChange(event.target.value)}>
            <option value="">{models.length ? "Seleccionar modelo" : "Abre LM Studio para ver modelos"}</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.loaded ? "* " : ""}{model.displayName || model.id}</option>)}
          </select></label>
          <details className="lmStudioAdvanced">
            <summary>Avanzado: URL de LM Studio</summary>
            <label>URL del servidor (por defecto es automática)
              <input value={selectedBaseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="http://127.0.0.1:1234" />
            </label>
          </details>
        </>
      ) : (
        <>
          <label>Modelo local<select value={modelChoice} onChange={(event) => onModelChoiceChange(event.target.value)}>
            <option value="">Seleccionar modelo</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.loaded ? "* " : ""}{model.displayName || model.id}</option>)}
          </select></label>
        </>
      )}
      <div className="buttonGrid">
        {selectedProvider === "lmstudio" && <button title="Carga en LM Studio el modelo seleccionado arriba y lo guarda como modelo de la app." onClick={onApplyModel} disabled={modelBusy || !modelChoice}>{modelBusy ? "Cargando" : "Cargar y usar modelo seleccionado"}</button>}
        {selectedProvider === "lmstudio" && <button title="No carga nada nuevo; detecta el modelo que ya está READY en LM Studio y lo guarda en la app." className="secondary" onClick={onApplyActiveModel} disabled={modelBusy || !serverRunning}>Detectar modelo ya cargado</button>}
        <button title="Guarda el proveedor y el modelo elegido." className="secondary" onClick={onUpdateRuntimeBase} disabled={modelBusy}>{selectedIsCloud ? "Guardar proveedor y modelo" : "Guardar proveedor"}</button>
      </div>
      <p className="sceneHint">{modelNotice || (selectedIsCloud ? `${cloudLabel} corre en la nube; con tu key elige el modelo y pulsa guardar. No usa VRAM local.` : selectedProvider === "lmstudio" ? "Cargar arranca ese modelo en LM Studio; Detectar toma el READY actual; Guardar proveedor fija el ajuste." : "Guardar proveedor fija el ajuste.")}</p>
    </ControlSection>
  );
}
