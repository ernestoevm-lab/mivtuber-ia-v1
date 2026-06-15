import type { FormEvent } from "react";
import type { MemoryItem } from "../types.js";
import { ControlSection, formatShortTime } from "./shared.js";

export function MemoryTab({
  assistantName,
  busy,
  memories,
  newImportance,
  newMemory,
  onArchive,
  onEditContent,
  onEditImportance,
  onNewImportanceChange,
  onNewMemoryChange,
  onRemove,
  onSave,
  onSubmit
}: {
  assistantName: string;
  busy: boolean;
  memories: MemoryItem[];
  newImportance: number;
  newMemory: string;
  onArchive: (id: number) => void;
  onEditContent: (id: number, content: string) => void;
  onEditImportance: (id: number, rawValue: string) => void;
  onNewImportanceChange: (rawValue: string) => void;
  onNewMemoryChange: (value: string) => void;
  onRemove: (id: number) => void;
  onSave: (memory: MemoryItem) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <ControlSection title="Memoria manual" icon="R">
      <p className="sceneHint">Recuerdos locales que Yuko puede usar al responder. Persona define estilo; Memoria guarda hechos concretos sobre ti, el canal o preferencias.</p>
      <form className="memoryForm" onSubmit={onSubmit}>
        <label>Nuevo recuerdo<textarea value={newMemory} onChange={(event) => onNewMemoryChange(event.target.value)} placeholder={`Ej. Al usuario le gusta que ${assistantName} responda en espanol.`} /></label>
        <label>Importancia para Yuko<input type="number" min="1" max="5" value={newImportance} onChange={(event) => onNewImportanceChange(event.target.value)} /></label>
        <button disabled={busy || !newMemory.trim()}>{busy ? "Guardando" : "Recordar"}</button>
      </form>
      <p className="sceneHint">Importancia: 1 = detalle menor, 3 = dato util, 5 = dato que Yuko debe priorizar cuando aplique.</p>
      <div className="memoryList">
        {memories.map((memory) => (
          <article className="memoryItem" key={memory.id}>
            <textarea value={memory.content} onChange={(event) => onEditContent(memory.id, event.target.value)} />
            <div className="memoryMeta">
              <label>Importancia<input type="number" min="1" max="5" value={memory.importance} onChange={(event) => onEditImportance(memory.id, event.target.value)} /></label>
              <span>{memory.kind || "fact"} - {formatShortTime(memory.updated_at || memory.created_at)}</span>
            </div>
            <div className="buttonGrid">
              <button className="secondary" onClick={() => onSave(memory)} disabled={busy}>Guardar</button>
              <button className="secondary" onClick={() => onArchive(memory.id)} disabled={busy}>Archivar</button>
              <button className="danger" onClick={() => onRemove(memory.id)} disabled={busy}>Borrar</button>
            </div>
          </article>
        ))}
        {!memories.length && <p className="muted">Sin recuerdos manuales todavia.</p>}
      </div>
    </ControlSection>
  );
}
