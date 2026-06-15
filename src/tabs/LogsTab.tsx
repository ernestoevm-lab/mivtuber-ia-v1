import { ControlSection, translateLogLine } from "./shared.js";

export function LogsTab({ logs }: { logs: string[] }) {
  return (
    <ControlSection title="Registros" icon="L">
      <div className="streamIntegrationCard">
        <strong>Registro tecnico</strong>
        <p className="sceneHint">Vista cronologica sin filtros todavia. Para investigacion de viewers usa Directo; filtros por fecha, usuario, plataforma o motivo de Guardia quedan pendientes para el panel de auditoria.</p>
      </div>
      <div className="logs">{logs.map((item, index) => <code key={index}>{translateLogLine(item)}</code>)}</div>
    </ControlSection>
  );
}
