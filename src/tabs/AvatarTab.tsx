import type { VtsHotkeyItem, VtsStatusPayload } from "../api.js";
import type { AvatarSignal } from "../avatar/types.js";
import type { AvatarRuntimeStatus } from "../AvatarStage.js";
import type { AvatarCameraPreset, Emotion, EmotionIntensity } from "../types.js";
import { ControlSection, emotionLabel, StatusMetric } from "./shared.js";

export function AvatarTab({ avatarNotice, camera, emotion, intensity, signal, speaking, status, vtsBusy, vtsHotkeys, vtsNotice, vtsStatus, onCameraChange, onEmotionPreview, onSpeechTest, onUploadVrm, onVtsConnect, onVtsDisconnect, onVtsMap, onVtsRefreshHotkeys, onVtsTest }: {
  avatarNotice: string;
  camera: AvatarCameraPreset;
  emotion: Emotion;
  intensity: EmotionIntensity;
  signal: AvatarSignal;
  speaking: boolean;
  status: AvatarRuntimeStatus;
  vtsBusy: boolean;
  vtsHotkeys: VtsHotkeyItem[];
  vtsNotice: string;
  vtsStatus: VtsStatusPayload | null;
  onCameraChange: (camera: AvatarCameraPreset) => void;
  onEmotionPreview: (emotion: Emotion) => void;
  onSpeechTest: () => void;
  onUploadVrm: (file: File) => void;
  onVtsConnect: () => void;
  onVtsDisconnect: () => void;
  onVtsMap: (emotion: string, hotkey: string) => void;
  onVtsRefreshHotkeys: () => void;
  onVtsTest: (emotion: string) => void;
}) {
  return (
    <ControlSection title="Avatar" icon="A">
      <div className="heroActions">
        <label className="heroUpload">
          <span>Cargar VRM</span>
          <input
            type="file"
            accept=".vrm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadVrm(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button className="secondary" type="button" onClick={onSpeechTest}>Probar movimiento</button>
      </div>
      {avatarNotice && <p className="sceneHint">{avatarNotice}</p>}
      <AvatarControls
        status={status}
        emotion={emotion}
        intensity={intensity}
        signal={signal}
        camera={camera}
        speaking={speaking}
        onCameraChange={onCameraChange}
        onEmotionPreview={onEmotionPreview}
        onSpeechTest={onSpeechTest}
      />
      <div className="streamIntegrationCard">
        <header>
          <strong>VTube Studio (Live2D)</strong>
          <span>{vtsStatus?.authenticated ? "conectado" : vtsStatus?.connected ? "sin permiso" : "desconectado"}</span>
        </header>
        <p className="muted">Yuko refleja su emoción como expresión del modelo en VTube Studio. Conéctate, acepta el popup de permiso en VTS, y mapea cada emoción a un hotkey de tu modelo.</p>
        <dl className="streamStatus">
          <dt>Estado</dt><dd>{vtsStatus?.authenticated ? "autenticado" : vtsStatus?.connected ? "conectado, falta permiso" : "desconectado"}</dd>
          <dt>Modelo</dt><dd>{vtsStatus?.modelName || "—"}</dd>
          <dt>API</dt><dd>{vtsStatus?.url || "ws://127.0.0.1:8001"}</dd>
        </dl>
        <div className="buttonGrid">
          <button type="button" onClick={onVtsConnect} disabled={vtsBusy}>{vtsBusy ? "Conectando" : "Conectar VTS"}</button>
          <button type="button" className="secondary" onClick={onVtsDisconnect} disabled={vtsBusy || !vtsStatus?.connected}>Desconectar</button>
          <button type="button" className="secondary" onClick={onVtsRefreshHotkeys} disabled={vtsBusy || !vtsStatus?.authenticated}>Releer hotkeys</button>
        </div>
        {vtsStatus?.authenticated && (
          <div className="vtsEmotionMap">
            <p className="muted">Mapea cada emoción de Yuko a una expresión/hotkey de tu modelo:</p>
            {([["happy", "Feliz"], ["sad", "Triste"], ["annoyed", "Molesta"], ["surprised", "Sorprendida"], ["thinking", "Pensando"], ["neutral", "Neutral"], ["safe", "Tranquila"]] as const).map(([emo, label]) => (
              <label key={emo}>{label}
                <select value={vtsStatus.emotionMap[emo] || ""} onChange={(event) => onVtsMap(emo, event.target.value)}>
                  <option value="">— sin asignar —</option>
                  {vtsHotkeys.map((hk) => <option key={hk.hotkeyID} value={hk.name || hk.hotkeyID}>{hk.name || hk.hotkeyID}</option>)}
                </select>
                <button type="button" className="secondary" onClick={() => onVtsTest(emo)} disabled={!vtsStatus.emotionMap[emo]}>Probar</button>
              </label>
            ))}
          </div>
        )}
        {vtsNotice && <p className="sceneHint">{vtsNotice}</p>}
      </div>
    </ControlSection>
  );
}

function AvatarControls({ status, emotion, intensity, signal, camera, speaking, onCameraChange, onEmotionPreview, onSpeechTest }: {
  status: AvatarRuntimeStatus;
  emotion: Emotion;
  intensity: EmotionIntensity;
  signal: AvatarSignal;
  camera: AvatarCameraPreset;
  speaking: boolean;
  onCameraChange: (camera: AvatarCameraPreset) => void;
  onEmotionPreview: (emotion: Emotion) => void;
  onSpeechTest: () => void;
}) {
  const expressions = status.expressions.length ? status.expressions.slice(0, 10).join(", ") : "pendientes";
  return (
    <div className="avatarControls">
      <div className="avatarReadout">
        <span className={status.hasVrm ? "dot on" : "dot"} />
        <div>
          <strong>{status.hasVrm ? "VRM activo" : "Avatar temporal"}</strong>
          <small>{status.notice}</small>
        </div>
      </div>

      <div className="avatarSpecGrid">
        <StatusMetric label="Fuente" value={status.source} />
        <StatusMetric label="Emoción" value={`${emotionLabel(emotion)} ${intensity}/10`} />
        <StatusMetric label="Señal" value={`${signal.mood} · ${signal.action} · ${signal.intensity}/10`} />
        <StatusMetric label="Respuesta" value={shortSignalId(signal.responseId)} />
        <StatusMetric label="Lipsync" value={status.supportsLipSync || speaking ? "activo" : "suave"} />
        <StatusMetric label="Blendshapes" value={`${status.expressions.length}`} />
      </div>

      <label>
        Cámara
        <select value={camera} onChange={(event) => onCameraChange(event.target.value as AvatarCameraPreset)}>
          <option value="bust">Busto</option>
          <option value="half">Medio cuerpo</option>
          <option value="full">Cuerpo completo</option>
          <option value="obs">OBS</option>
        </select>
      </label>

      <div className="emotionGrid">
        {(["neutral", "happy", "sad", "annoyed", "surprised", "thinking", "safe"] as Emotion[]).map((item) => (
          <button
            type="button"
            className={emotion === item ? "active" : ""}
            key={item}
            onClick={() => onEmotionPreview(item)}
          >
            {emotionLabel(item)}
          </button>
        ))}
      </div>

      <button type="button" onClick={onSpeechTest}>Probar lipsync</button>
      <p className="avatarExpressionList">Expresiones detectadas: {expressions}</p>
    </div>
  );
}

function shortSignalId(responseId?: string) {
  return responseId ? responseId.slice(0, 8) : "sin respuesta";
}
