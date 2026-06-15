import type { LocalVoice, TtsPayload } from "../types.js";
import { ControlSection, StatusMetric } from "./shared.js";

export function VoiceTab({
  assistantName,
  audioUnlocked,
  savedVoiceBackend,
  selectedVoice,
  tts,
  voiceBackendChoice,
  voiceBusy,
  voiceChoice,
  voiceDetailText,
  voiceLatency,
  voiceNotice,
  voiceOptions,
  voicePlaybackNotice,
  voiceStatusLabel,
  voiceTestNotice,
  voiceVolume,
  onActivateVoice,
  onApplyVoice,
  onPlayVoiceTest,
  onSelectBrowserBackend,
  onSelectKokoroBackend,
  onVoiceChoiceChange,
  onVoiceVolumeChange
}: {
  assistantName: string;
  audioUnlocked: boolean;
  savedVoiceBackend: "browser" | "kokoro";
  selectedVoice?: LocalVoice;
  tts: TtsPayload | null;
  voiceBackendChoice: "browser" | "kokoro";
  voiceBusy: boolean;
  voiceChoice: string;
  voiceDetailText: string;
  voiceLatency: number | null;
  voiceNotice: string;
  voiceOptions: LocalVoice[];
  voicePlaybackNotice: string;
  voiceStatusLabel: string;
  voiceTestNotice: string;
  voiceVolume: number;
  onActivateVoice: () => void;
  onApplyVoice: () => void;
  onPlayVoiceTest: () => void;
  onSelectBrowserBackend: () => void;
  onSelectKokoroBackend: () => void;
  onVoiceChoiceChange: (voiceId: string) => void;
  onVoiceVolumeChange: (volume: number) => void;
}) {
  return (
    <ControlSection title="Voz" icon="V">
      <div className="runtimeStatus"><span className={tts?.ready || audioUnlocked ? "dot on" : "dot"} /><span>{voiceStatusLabel}</span></div>
      <div className="voiceBackendSwitch" role="group" aria-label="Backend de voz">
        <button type="button" className={voiceBackendChoice === "browser" ? "active" : ""} onClick={onSelectBrowserBackend}>Voz navegador</button>
        <button type="button" className={voiceBackendChoice === "kokoro" ? "active" : ""} onClick={onSelectKokoroBackend}>Kokoro ONNX (experimental)</button>
      </div>
      {voiceBackendChoice === "kokoro" && !tts?.localAvailable && (
        <p className="sceneHint">Kokoro es la voz local experimental: requiere una instalación aparte y no viene incluida en el instalador beta. Mientras no esté instalada, {assistantName} habla con la voz del navegador.</p>
      )}
      <div className="voiceStatusGrid">
        <StatusMetric label="Backend guardado" value={tts?.provider === "kokoro" ? "Kokoro ONNX" : "Navegador"} />
        <StatusMetric label="Probando con" value={voiceBackendChoice === "kokoro" ? "Kokoro ONNX" : "Navegador"} />
        <StatusMetric label="Local TTS" value={tts?.activeBackend === "kokoro" ? "activo" : tts?.localAvailable ? "disponible" : "no configurado"} />
        <StatusMetric label="Worker" value={tts?.kokoro?.workerReady ? "listo" : voiceBackendChoice === "kokoro" && tts?.localAvailable ? "se inicia al probar" : "—"} />
        <StatusMetric label="Voz actual" value={selectedVoice?.name || voiceChoice || tts?.selectedVoiceId || "—"} />
      </div>
      <div className="buttonGrid">
        <button type="button" onClick={onActivateVoice}>{audioUnlocked ? "Audio activo" : `Activar audio de ${assistantName}`}</button>
        <a className="viewerLink" href="/speaker" target="_blank" rel="noreferrer">Abrir /speaker</a>
      </div>
      <label className="voiceVolumeControl">
        <span>Volumen de la voz: {voiceVolume}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={voiceVolume}
          onChange={(event) => onVoiceVolumeChange(Number(event.target.value))}
        />
      </label>
      {voicePlaybackNotice && <p className="chatNotice">{voicePlaybackNotice}</p>}
      <div className="voiceChoicePanel">
        <strong>{voiceBackendChoice === "kokoro" ? "Voces Kokoro disponibles" : "Voces reales del navegador"}</strong>
        <div className="voiceChoiceList" role="listbox" aria-label="Voces disponibles">
          {voiceOptions.map((voice) => {
            const inUse = voice.configured && voiceBackendChoice === savedVoiceBackend;
            const selected = voiceChoice === voice.id;
            return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              className={`${selected ? "active" : ""}${inUse ? " inUse" : ""}`}
              key={`${voice.backend || voiceBackendChoice}-${voice.id}`}
              onClick={() => onVoiceChoiceChange(voice.id)}
            >
              <span>{voice.name}</span>
              <small>{voice.lang}{inUse ? " · en uso" : selected ? " · seleccionada" : ""}</small>
            </button>
          );})}
          {!voiceOptions.length && <p className="muted">{voiceBackendChoice === "kokoro" ? tts?.fallbackReason || "Kokoro no tiene voces disponibles." : "No hay voces speechSynthesis disponibles todavía en este navegador."}</p>}
        </div>
      </div>
      <div className="buttonGrid">
        <button onClick={onPlayVoiceTest} disabled={voiceBusy || (voiceBackendChoice === "kokoro" && !voiceChoice)}>{voiceBusy ? "Probando" : "Probar voz"}</button>
        <button className="secondary" onClick={onApplyVoice} disabled={voiceBusy || (voiceBackendChoice === "kokoro" && !voiceChoice)}>Guardar voz</button>
      </div>
      <div className="voiceInfo">
        <span>{voiceNotice || voiceDetailText}</span>
        {voiceTestNotice && <span>{voiceTestNotice}</span>}
        {voiceLatency !== null && <span>{voiceLatency}ms</span>}
        {tts?.fallbackReason && !(voiceBackendChoice === "kokoro" && tts.localAvailable) && <span>{tts.fallbackReason}</span>}
      </div>
    </ControlSection>
  );
}
