import type { Persona } from "../types.js";
import { ControlSection } from "./shared.js";

type PersonaTextField =
  | "name"
  | "tone"
  | "lore"
  | "likes"
  | "dislikes"
  | "humorStyle"
  | "relationshipToUser"
  | "streamingStyle"
  | "boundaries";

export function PersonaTab({
  assistantName,
  persona,
  personaEnabled,
  personaNotice,
  onPersonaEnabledChange,
  onPersonaFieldChange,
  onSavePersona
}: {
  assistantName: string;
  persona: Persona;
  personaEnabled: boolean;
  personaNotice: string;
  onPersonaEnabledChange: (enabled: boolean) => void;
  onPersonaFieldChange: (field: PersonaTextField, value: string) => void;
  onSavePersona: () => void;
}) {
  return (
    <ControlSection title="Persona" icon="P">
      <p className="sceneHint">Identidad editable de {assistantName}. Persona define como habla Yuko; Memoria vive en su propia pestana para recuerdos concretos.</p>
      <div className="personaModePanel">
        <div className="personaModeCopy">
          <span>Modo de respuesta</span>
          <strong>{personaEnabled ? `${persona.name || "Yuko"} / personaje activo` : "Gemma 4 normal"}</strong>
          <p>
            {personaEnabled
              ? "Usa la personalidad, lore, memoria local y estilo de Yuko."
              : "Omite la personalidad de Yuko y responde como modelo base para pruebas directas."}
          </p>
        </div>
        <div className="personaModeSwitch" role="group" aria-label="Modo de respuesta">
          <button
            type="button"
            className={personaEnabled ? "active" : ""}
            onClick={() => onPersonaEnabledChange(true)}
          >
            Yuko
          </button>
          <button
            type="button"
            className={!personaEnabled ? "active" : ""}
            onClick={() => onPersonaEnabledChange(false)}
          >
            Gemma normal
          </button>
        </div>
      </div>
      <label>Nombre<input value={persona.name} onChange={(event) => onPersonaFieldChange("name", event.target.value)} /></label>
      <label>Tono<textarea value={persona.tone} onChange={(event) => onPersonaFieldChange("tone", event.target.value)} /></label>
      <label>Lore<textarea value={persona.lore} onChange={(event) => onPersonaFieldChange("lore", event.target.value)} /></label>
      <label>Gustos<textarea value={persona.likes} onChange={(event) => onPersonaFieldChange("likes", event.target.value)} /></label>
      <label>Disgustos<textarea value={persona.dislikes} onChange={(event) => onPersonaFieldChange("dislikes", event.target.value)} /></label>
      <label>Humor<textarea value={persona.humorStyle} onChange={(event) => onPersonaFieldChange("humorStyle", event.target.value)} /></label>
      <label>Relacion con usuario<textarea value={persona.relationshipToUser} onChange={(event) => onPersonaFieldChange("relationshipToUser", event.target.value)} /></label>
      <label>Estilo del directo<textarea value={persona.streamingStyle} onChange={(event) => onPersonaFieldChange("streamingStyle", event.target.value)} /></label>
      <label>Limites<textarea value={persona.boundaries} onChange={(event) => onPersonaFieldChange("boundaries", event.target.value)} /></label>
      <button onClick={onSavePersona}>Guardar persona</button>
      {personaNotice && <p className={personaNotice.includes("correctamente") ? "sceneHint" : "chatNotice"}>{personaNotice}</p>}
    </ControlSection>
  );
}
