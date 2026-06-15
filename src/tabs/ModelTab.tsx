import { useState } from "react";
import type { ChatResponse, LocalModel, StatusPayload } from "../types.js";
import { ControlSection, StatusMetric } from "./shared.js";

export function ModelTab({
  activeProvider,
  activeProviderRaw,
  assistantName,
  geminiModelChoice,
  geminiModels,
  geminiModelsNotice,
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
  geminiKeyConfigured,
  secretsBusy,
  secretsNotice,
  onSaveGeminiKey,
  onApplyActiveModel,
  onApplyModel,
  onBaseUrlChange,
  onGeminiModelChange,
  onModelChoiceChange,
  onProviderChange,
  onUpdateRuntimeBase
}: {
  activeProvider: string;
  activeProviderRaw: string;
  assistantName: string;
  geminiModelChoice: string;
  geminiModels: string[];
  geminiModelsNotice: string;
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
  geminiKeyConfigured: boolean;
  secretsBusy: boolean;
  secretsNotice: string;
  onSaveGeminiKey: (key: string) => Promise<boolean>;
  onApplyActiveModel: () => void;
  onApplyModel: () => void;
  onBaseUrlChange: (baseUrl: string) => void;
  onGeminiModelChange: (model: string) => void;
  onModelChoiceChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onUpdateRuntimeBase: () => void;
}) {
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const lmStudioDetected = serverRunning && Boolean(models.length || loadedChatModels.length);
  return (
    <ControlSection title="Modelo" icon="M">
      {activeProviderRaw === "gemini" ? (
        <div className="runtimeStatus"><span className="dot on" /><span>Gemini (nube) activo · {status?.runtime.geminiModel || "modelo por elegir"}</span></div>
      ) : (
        <div className="runtimeStatus"><span className={serverRunning ? "dot on" : "dot"} /><span>{serverRunning ? "LM Studio activo" : "LM Studio apagado"}</span></div>
      )}
      <div className="modelLoadStatus">
        <StatusMetric label="Proveedor guardado" value={activeProvider} />
        <StatusMetric label="Proveedor seleccionado" value={selectedProvider} />
        <StatusMetric label="Modelo que usará la app" value={modelName !== "..." ? modelName : "sin configurar"} />
        <StatusMetric label="Modelos activos en LM Studio" value={loadedChatModels.join(", ") || "ninguno detectado"} />
        <StatusMetric label="Tipo de API detectada" value={activeProviderRaw === "gemini" ? "openai-compatible · nube" : `${status?.runtime.lmStudioDetected?.apiMode || status?.runtime.lmStudioApiMode || "auto"} · ${status?.runtime.lmStudioDetected?.ok ? "detectado" : "pendiente"}`} />
        <StatusMetric label="Última inferencia" value={lastInferenceStale ? `pendiente con ${modelName}` : status?.runtime.lastLlmSuccess ? `${status.runtime.lastLlmSuccess.provider} · ${status.runtime.lastLlmSuccess.model}` : lastResponse ? `${lastResponse.provider} · ${lastResponse.model}` : "sin uso"} />
      </div>
      {runtimeDraftDirty && <p className="chatNotice">Tienes cambios sin guardar: el proveedor seleccionado todavía no es el proveedor activo real.</p>}
      {status?.runtime.lastLlmError && <p className="chatNotice">Último error LLM: {status.runtime.lastLlmError.apiMode} · {status.runtime.lastLlmError.model} · {status.runtime.lastLlmError.error}</p>}
      {modelMismatchWarning && <p className="chatNotice">{modelMismatchWarning}</p>}
      {loadedModelWarning && <p className="chatNotice">{loadedModelWarning}</p>}
      {lastResponse?.provider === "fallback" && <p className="chatNotice">{assistantName} está usando fallback. Pulsa “Detectar modelo ya cargado” si LM Studio ya muestra un modelo READY.</p>}
      <p className="muted">Proveedor decide quién arma la respuesta. LM Studio usa el modelo local; Gemini usa nube; Auto/Ollama mantienen el comportamiento configurado del backend.</p>
      <label>Proveedor de respuesta<select value={selectedProvider} onChange={(event) => onProviderChange(event.target.value)}>
        <option value="lmstudio">LM Studio</option><option value="gemini">Gemini (nube)</option><option value="auto">Auto</option><option value="ollama">Ollama</option>
      </select></label>
      {selectedProvider === "gemini" ? (
        <>
          <div className="runtimeStatus">
            <span className={geminiKeyConfigured ? "dot on" : "dot"} />
            <span>{geminiKeyConfigured ? "API key de Gemini configurada" : "Falta tu API key de Gemini (gratis en Google AI Studio)"}</span>
          </div>
          <label>API key de Gemini
            <input
              type="password"
              value={geminiKeyDraft}
              autoComplete="off"
              placeholder={geminiKeyConfigured ? "Pega una key nueva solo para reemplazarla" : "Pega aquí tu API key y pulsa Guardar"}
              onChange={(event) => setGeminiKeyDraft(event.target.value)}
            />
          </label>
          <div className="buttonGrid">
            <button
              type="button"
              disabled={secretsBusy || !geminiKeyDraft.trim()}
              onClick={() => {
                void onSaveGeminiKey(geminiKeyDraft.trim()).then((saved) => {
                  if (saved) setGeminiKeyDraft("");
                });
              }}
            >{secretsBusy ? "Probando" : "Guardar y activar Gemini"}</button>
          </div>
          <p className="muted">Al guardar una key válida, Yuko empieza a usar Gemini automáticamente. La key queda solo en esta PC y nunca se vuelve a mostrar. También puedes administrarla en Ajustes.</p>
          <label>Modelo de Gemini (nube)<select value={geminiModelChoice} onChange={(event) => onGeminiModelChange(event.target.value)}>
            <option value="">{geminiModels.length ? "Seleccionar modelo" : "Sin lista disponible"}</option>
            {geminiModels.map((model) => <option key={model} value={model}>{model}</option>)}
            {geminiModelChoice && !geminiModels.includes(geminiModelChoice) && <option value={geminiModelChoice}>{geminiModelChoice}</option>}
          </select></label>
          {geminiModelsNotice && <p className="sceneHint">{geminiModelsNotice}</p>}
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
        <button title="Guarda el proveedor y el modelo elegido." className="secondary" onClick={onUpdateRuntimeBase} disabled={modelBusy}>{selectedProvider === "gemini" ? "Guardar proveedor y modelo" : "Guardar proveedor"}</button>
      </div>
      <p className="sceneHint">{modelNotice || (selectedProvider === "gemini" ? "Gemini corre en la nube; con tu key activada solo elige el modelo si quieres cambiarlo. No usa VRAM local." : selectedProvider === "lmstudio" ? "Cargar arranca ese modelo en LM Studio; Detectar toma el READY actual; Guardar proveedor fija el ajuste." : "Guardar proveedor fija el ajuste.")}</p>
    </ControlSection>
  );
}
