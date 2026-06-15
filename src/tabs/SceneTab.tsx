import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { fromPercent, SceneNumericKey, sceneRanges, toPercent } from "../sceneMath.js";
import type { AvatarCameraPreset, BackgroundItem, SceneSettings } from "../types.js";
import { backgroundStyle, clampPercent, ControlSection, referenceImageSrc, referenceOverlayStyle, StatusMetric } from "./shared.js";

export function SceneTab({ scene, backgrounds, activeBackground, busy, notice, onUpdate, onSave, onReset, onUpload, onOpenPreview }: {
  scene: SceneSettings;
  backgrounds: BackgroundItem[];
  activeBackground: BackgroundItem | null;
  busy: boolean;
  notice: string;
  onUpdate: (updates: Partial<SceneSettings>) => void;
  onSave: () => void;
  onReset: () => void;
  onUpload: (file: File) => void;
  onOpenPreview: (route: "viewer" | "speaker") => void;
}) {
  return (
    <ControlSection title="Escena / OBS" icon="O">
      <SceneControls
        scene={scene}
        backgrounds={backgrounds}
        activeBackground={activeBackground}
        busy={busy}
        notice={notice}
        onUpdate={onUpdate}
        onSave={onSave}
        onReset={onReset}
        onUpload={onUpload}
        onOpenPreview={onOpenPreview}
      />
    </ControlSection>
  );
}

function SceneControls({ scene, backgrounds, activeBackground, busy, notice, onUpdate, onSave, onReset, onUpload, onOpenPreview }: {
  scene: SceneSettings;
  backgrounds: BackgroundItem[];
  activeBackground: BackgroundItem | null;
  busy: boolean;
  notice: string;
  onUpdate: (updates: Partial<SceneSettings>) => void;
  onSave: () => void;
  onReset: () => void;
  onUpload: (file: File) => void;
  onOpenPreview: (route: "viewer" | "speaker") => void;
}) {
  const frame = scenePreviewFrame(scene);
  const referenceImage = scene.referenceImage;
  const applyPreviewPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clampPercent(((event.clientX - bounds.left) / bounds.width) * 100);
    const y = clampPercent(100 - ((event.clientY - bounds.top) / bounds.height) * 100);
    onUpdate({
      cameraX: fromPercent("cameraX", x),
      cameraY: fromPercent("cameraY", y)
    });
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyPreviewPoint(event);
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    applyPreviewPoint(event);
  };
  const moveReferenceImage = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!referenceImage) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const apply = (clientX: number, clientY: number) => {
      onUpdate({
        referenceImage: {
          ...referenceImage,
          x: clampPercent(((clientX - bounds.left) / bounds.width) * 100),
          y: clampPercent(((clientY - bounds.top) / bounds.height) * 100)
        }
      });
    };
    apply(event.clientX, event.clientY);
  };
  const dragReferenceImage = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!referenceImage || event.buttons !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    onUpdate({
      referenceImage: {
        ...referenceImage,
        x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
        y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100)
      }
    });
  };

  return (
    <div className="sceneControls">
      <div
        className="scenePreview scenePreviewEditor"
        style={backgroundStyle(activeBackground)}
        onPointerDown={startDrag}
        onPointerMove={drag}
        role="application"
        aria-label="Editor visual de posición de Yuko"
      >
        <div className="sceneGridOverlay" />
        <div className="sceneSafeFrame outer" />
        <div className="sceneSafeFrame inner" />
        <div className="sceneCenterLine horizontal" />
        <div className="sceneCenterLine vertical" />
        <div
          className="sceneAvatarGhost"
          style={{
            left: `${frame.x}%`,
            top: `${frame.y}%`,
            width: `${frame.width}%`,
            height: `${frame.height}%`
          }}
        >
          <span />
          <strong>Yuko</strong>
        </div>
        {referenceImage && (
          <div
            className="sceneReferenceOverlay editor"
            style={referenceOverlayStyle(referenceImage)}
            onPointerDown={moveReferenceImage}
            onPointerMove={dragReferenceImage}
            role="slider"
            aria-label="Imagen de referencia movible"
            aria-valuetext={`${referenceImage.name}, x ${referenceImage.x}, y ${referenceImage.y}`}
          >
            <img src={referenceImageSrc(referenceImage)} alt="" />
            <span>Imagen</span>
          </div>
        )}
        <div className="scenePreviewOverlay">
          <strong>Pantalla OBS 16:9</strong>
          <span>{referenceImage ? "Arrastra Yuko o la imagen de referencia." : "Arrastra a Yuko."} Ocupa aprox. {frame.coverage}% de alto.</span>
        </div>
      </div>

      <div className="sceneReadoutGrid">
        <StatusMetric label="Horizontal" value={`${toPercent("cameraX", scene.cameraX)}%`} />
        <StatusMetric label="Vertical" value={`${toPercent("cameraY", scene.cameraY)}%`} />
        <StatusMetric label="Cobertura" value={`${frame.coverage}%`} />
        <StatusMetric label="Fondo" value={activeBackground ? activeBackground.name : "por defecto"} />
        <StatusMetric label="Imagen" value={referenceImage?.visible ? referenceImage.name : "sin overlay"} />
      </div>

      {referenceImage && (
        <div className="referenceControls">
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={referenceImage.visible}
              onChange={(event) => onUpdate({ referenceImage: { ...referenceImage, visible: event.target.checked } })}
            />
            Mostrar imagen de referencia en OBS
          </label>
          <label className="sceneControl">
            Tamaño imagen
            <input
              type="range"
              min="8"
              max="72"
              value={referenceImage.width}
              onChange={(event) => onUpdate({ referenceImage: { ...referenceImage, width: Number(event.target.value) } })}
            />
            <output>{referenceImage.width}%</output>
          </label>
          <label className="sceneControl">
            Opacidad imagen
            <input
              type="range"
              min="20"
              max="100"
              value={referenceImage.opacity}
              onChange={(event) => onUpdate({ referenceImage: { ...referenceImage, opacity: Number(event.target.value) } })}
            />
            <output>{referenceImage.opacity}%</output>
          </label>
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={referenceImage.borderVisible}
              onChange={(event) => onUpdate({ referenceImage: { ...referenceImage, borderVisible: event.target.checked } })}
            />
            Mostrar contorno
          </label>
          <div className="referenceBorderPalette" aria-label="Color del contorno">
            {referenceBorderColors.map((color) => (
              <button
                key={color}
                type="button"
                className={referenceImage.borderColor === color ? "active" : ""}
                style={{ backgroundColor: color }}
                title={`Contorno ${color}`}
                onClick={() => onUpdate({ referenceImage: { ...referenceImage, borderVisible: true, borderColor: color } })}
              />
            ))}
            <label>
              Color
              <input
                type="color"
                value={referenceImage.borderColor}
                disabled={!referenceImage.borderVisible}
                onChange={(event) => onUpdate({ referenceImage: { ...referenceImage, borderVisible: true, borderColor: event.target.value } })}
              />
            </label>
          </div>
        </div>
      )}

      <label className="backgroundUpload">
        Subir fondo 16:9
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.currentTarget.value = "";
          }}
        />
      </label>

      <label>
        Fondo guardado
        <select value={scene.activeBackground} onChange={(event) => onUpdate({ activeBackground: event.target.value })}>
          <option value="">Fondo por defecto</option>
          {backgrounds.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <div className="scenePresetGrid">
        {(["bust", "half", "full", "obs"] as AvatarCameraPreset[]).map((preset) => (
          <button
            type="button"
            key={preset}
            className={scene.cameraPreset === preset ? "active" : ""}
            onClick={() => onUpdate({ cameraPreset: preset })}
          >
            {cameraLabel(preset)}
          </button>
        ))}
      </div>

      <div className="sceneQuickActions">
        <button type="button" className="secondary" onClick={() => onUpdate(centerSceneControls())}>Centrar</button>
        <span>Controles 0-100. Los valores reales 3D se traducen automáticamente.</span>
      </div>

      <ScenePercentControl label="Distancia" sceneKey="cameraDistance" value={scene.cameraDistance} onChange={(cameraDistance) => onUpdate({ cameraDistance })} />
      <ScenePercentControl label="Altura" sceneKey="cameraHeight" value={scene.cameraHeight} onChange={(cameraHeight) => onUpdate({ cameraHeight })} />
      <ScenePercentControl label="Horizontal" sceneKey="cameraX" value={scene.cameraX} onChange={(cameraX) => onUpdate({ cameraX })} />
      <ScenePercentControl label="Vertical" sceneKey="cameraY" value={scene.cameraY} onChange={(cameraY) => onUpdate({ cameraY })} />
      <ScenePercentControl label="Escala" sceneKey="avatarScale" value={scene.avatarScale} onChange={(avatarScale) => onUpdate({ avatarScale })} />

      <label className="toggleRow">
        <input
          type="checkbox"
          checked={scene.captionVisible}
          onChange={(event) => onUpdate({ captionVisible: event.target.checked })}
        />
        Mostrar subtítulos en OBS
      </label>

      <div className="buttonGrid">
        <button type="button" onClick={onSave} disabled={busy}>{busy ? "Guardando" : "Guardar escena"}</button>
        <button type="button" className="secondary" onClick={onReset} disabled={busy}>Restablecer</button>
      </div>

      <button className="viewerLink" type="button" onClick={() => onOpenPreview("viewer")}>Abrir vista previa del viewer</button>
      <p className="sceneHint">{notice || "Para OBS agrega una Browser Source con /viewer; la ventana de vista previa no es la fuente principal."}</p>
    </div>
  );
}

function ScenePercentControl({ label, sceneKey, value, onChange }: {
  label: string;
  sceneKey: SceneNumericKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = toPercent(sceneKey, value);
  const range = sceneRanges[sceneKey];
  const defaultPercent = toPercent(sceneKey, range.defaultValue);
  const applyPercent = (next: number) => onChange(fromPercent(sceneKey, next));
  const stopControlWheel = (event: ReactWheelEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  };

  return (
    <label className="sceneControl">
      <span className="sliderHeader">
        <strong>{label}</strong>
        <em>{percent}</em>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => applyPercent(Number(event.target.value))}
        onWheel={stopControlWheel}
      />
      <div className="sliderMeta">
        <button type="button" title="Bajar 5 puntos" onClick={() => applyPercent(percent - 5)}>-</button>
        <button type="button" title="Mínimo" onClick={() => applyPercent(0)}>0</button>
        <button type="button" title="Centro" onClick={() => applyPercent(defaultPercent)}>centro</button>
        <button type="button" title="Máximo" onClick={() => applyPercent(100)}>100</button>
        <button type="button" title="Subir 5 puntos" onClick={() => applyPercent(percent + 5)}>+</button>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(event) => applyPercent(Number(event.target.value))}
          onWheel={stopControlWheel}
          aria-label={`Valor de ${label}`}
        />
      </div>
      <small>{range.min} a {range.max} real</small>
    </label>
  );
}

function cameraLabel(camera: AvatarCameraPreset) {
  const labels: Record<AvatarCameraPreset, string> = {
    bust: "Busto",
    half: "Medio",
    full: "Completo",
    obs: "OBS"
  };
  return labels[camera];
}

function scenePreviewFrame(scene: SceneSettings) {
  const x = toPercent("cameraX", scene.cameraX);
  const y = 100 - toPercent("cameraY", scene.cameraY);
  const scale = toPercent("avatarScale", scene.avatarScale);
  const distance = toPercent("cameraDistance", scene.cameraDistance);
  const height = Math.max(18, Math.min(92, 24 + scale * 0.42 + (100 - distance) * 0.24));
  const width = Math.max(9, Math.min(34, height * 0.38));
  return {
    x,
    y,
    width,
    height,
    coverage: Math.round(height)
  };
}

function centerSceneControls(): Partial<SceneSettings> {
  return {
    cameraDistance: sceneRanges.cameraDistance.defaultValue,
    cameraHeight: sceneRanges.cameraHeight.defaultValue,
    cameraX: sceneRanges.cameraX.defaultValue,
    cameraY: sceneRanges.cameraY.defaultValue,
    avatarScale: sceneRanges.avatarScale.defaultValue
  };
}

const referenceBorderColors = ["#ff3636", "#7cffd6", "#ffffff", "#ffd166", "#9b7cff", "#111827"];
