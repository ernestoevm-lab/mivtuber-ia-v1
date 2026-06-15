/* Fuentes de movimiento "humano" para la actuación procedural del avatar.
   Lo que delata a un avatar procedural es la periodicidad: senos puros se perciben
   como robóticos en segundos. Una VTuber humana con tracking de cámara muestra:
   - ruido de baja amplitud NO armónico (la cabeza nunca está quieta ni en órbita),
   - micro-sacadas de mirada (drift lento + corrección rápida, con retorno a cámara),
   - reacomodos posturales esporádicos (deriva y se recoloca cada varios segundos),
   - respiración asimétrica (inhala más rápido de lo que exhala). */

// Suma de senos con frecuencias inconmensurables (1, φ, 1+√2): suave, acotado a ~[-1,1]
// y sin periodo perceptible. Sustituto barato de Perlin para esta escala de uso.
export function organicNoise(t: number, seed: number) {
  return (
    Math.sin(t + seed) * 0.52 +
    Math.sin(t * 1.618 + seed * 2.7) * 0.31 +
    Math.sin(t * 2.414 + seed * 5.3) * 0.17
  );
}

// Respiración asimétrica: la fase se deforma para que la inhalación sea más corta que la
// exhalación (aprox. 40/60), como en reposo humano. Devuelve ~[-1,1].
export function breatheWave(t: number, rate = 1.18, seed = 0) {
  const x = t * rate + seed;
  return Math.sin(x + 0.42 * Math.sin(x));
}

/* ---------- Micro-mirada (sacadas) ---------- */

export type MicroGazeState = {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  nextSaccadeAt: number;
};

export function createMicroGaze(): MicroGazeState {
  return { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, nextSaccadeAt: 0.8 };
}

// Cada 1.2–4.2s la mirada "salta" a un nuevo micro-objetivo (sacada) y entre saltos
// deriva lentamente. Un 55% de las sacadas regresa al centro: una streamer vuelve a
// mirar a cámara/chat constantemente. La transición usa una constante de tiempo corta
// (~90ms) — las sacadas reales son rápidas, no un lerp perezoso.
export function updateMicroGaze(state: MicroGazeState, t: number, delta: number, energy: number) {
  if (t >= state.nextSaccadeAt) {
    const recenter = Math.random() < 0.55;
    const reach = 1 + energy * 0.5;
    state.targetYaw = recenter ? 0 : (Math.random() * 2 - 1) * 0.048 * reach;
    state.targetPitch = recenter ? 0 : (Math.random() * 2 - 1) * 0.03 * reach;
    state.nextSaccadeAt = t + 1.2 + Math.random() * 3.0;
  }
  const saccade = 1 - Math.exp(-22 * delta);
  state.yaw += (state.targetYaw - state.yaw) * saccade;
  state.pitch += (state.targetPitch - state.pitch) * saccade;
  return state;
}

/* ---------- Reacomodo postural ---------- */

export type PostureDriftState = {
  swayBias: number;
  rollBias: number;
  targetSway: number;
  targetRoll: number;
  nextShiftAt: number;
};

export function createPostureDrift(): PostureDriftState {
  return { swayBias: 0, rollBias: 0, targetSway: 0, targetRoll: 0, nextShiftAt: 4 };
}

// Cada 6–14s el cuerpo cambia sutilmente de "apoyo": un bias lento de giro/inclinación
// del torso hacia el que se asienta con suavidad (no es un gesto, es postura).
export function updatePostureDrift(state: PostureDriftState, t: number, delta: number) {
  if (t >= state.nextShiftAt) {
    state.targetSway = (Math.random() * 2 - 1) * 0.035;
    state.targetRoll = (Math.random() * 2 - 1) * 0.014;
    state.nextShiftAt = t + 6 + Math.random() * 8;
  }
  const settle = 1 - Math.exp(-1.6 * delta);
  state.swayBias += (state.targetSway - state.swayBias) * settle;
  state.rollBias += (state.targetRoll - state.rollBias) * settle;
  return state;
}

/* ---------- Cabeceo de énfasis al hablar ---------- */

export type SpeechNodState = {
  pulse: number;
  prevWeight: number;
};

export function createSpeechNod(): SpeechNodState {
  return { pulse: 0, prevWeight: 0 };
}

// Las personas cabecean al ARRANCAR una frase y en los picos de énfasis, no en onda
// continua. Disparamos un impulso cuando la envolvente de voz sube con fuerza (inicio
// de frase/sílaba acentuada) y lo dejamos decaer; el resultado sigue al audio real.
export function updateSpeechNod(state: SpeechNodState, speakingWeight: number, delta: number) {
  const rising = speakingWeight - state.prevWeight;
  if (speakingWeight > 0.22 && rising > 0.12) {
    state.pulse = Math.min(1, state.pulse + rising * 2.2);
  }
  state.pulse *= Math.exp(-5.5 * delta);
  state.prevWeight += (speakingWeight - state.prevWeight) * Math.min(1, 14 * delta);
  return state.pulse;
}
