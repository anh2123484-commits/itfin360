/**
 * Madurez por dimensión (`docs/09-diagnostico-y-hoja-de-ruta.md` §3).
 *
 * Una dimensión vale la media de sus preguntas. Una respuesta sin evidencia
 * cuenta como máximo nivel 2: decir que algo está definido no lo define.
 */

import { assertLevel, MILLI, roundHalfUp, type Level, type LevelMilli } from './scale.js';

/** Las nueve dimensiones del modelo de NovaEra Nexus, en el orden del documento. */
export const MATURITY_DIMENSIONS = [
  'D1_STRATEGY',
  'D2_PROCESSES',
  'D3_DATA',
  'D4_TECHNOLOGY',
  'D5_CYBERSECURITY',
  'D6_COMPLIANCE',
  'D7_AI',
  'D8_SUPPLIERS',
  'D9_PEOPLE',
] as const;

export type MaturityDimension = (typeof MATURITY_DIMENSIONS)[number];

/** Nivel máximo que cuenta una respuesta sin evidencia. */
export const LEVEL_CAP_WITHOUT_EVIDENCE: Level = 2;

export interface MaturityAnswer {
  readonly level: Level;
  readonly hasEvidence: boolean;
}

/** Nivel que cuenta de verdad una respuesta, después de aplicar el tope sin evidencia. */
export function effectiveLevel(answer: MaturityAnswer): Level {
  const level = assertLevel(answer.level, 'Respuesta de madurez');
  if (answer.hasEvidence) return level;
  return level > LEVEL_CAP_WITHOUT_EVIDENCE ? LEVEL_CAP_WITHOUT_EVIDENCE : level;
}

/**
 * Nivel de una dimensión en milésimas. Sin respuestas devuelve `null`: una
 * dimensión que nadie ha contestado no vale 1, vale "sin dato".
 */
export function dimensionLevel(answers: readonly MaturityAnswer[]): LevelMilli | null {
  if (answers.length === 0) return null;
  const total = answers.reduce((sum, answer) => sum + effectiveLevel(answer), 0);
  return roundHalfUp((total * MILLI) / answers.length);
}

/**
 * Brecha entre el objetivo y el nivel actual, en milésimas. Positiva si falta
 * camino; cero o negativa si ya se está en el objetivo o por encima.
 */
export function maturityGap(current: LevelMilli, target: LevelMilli): LevelMilli {
  return target - current;
}

/**
 * Brechas que justifican una línea de trabajo por defecto: las mayores que un
 * nivel entero, ordenadas de mayor a menor.
 */
export function dimensionsNeedingWork(
  levels: Readonly<Partial<Record<MaturityDimension, { current: LevelMilli; target: LevelMilli }>>>,
  minimumGap: LevelMilli = MILLI,
): MaturityDimension[] {
  const gaps: { dimension: MaturityDimension; gap: LevelMilli; order: number }[] = [];
  MATURITY_DIMENSIONS.forEach((dimension, order) => {
    const entry = levels[dimension];
    if (entry === undefined) return;
    const gap = maturityGap(entry.current, entry.target);
    if (gap > minimumGap) gaps.push({ dimension, gap, order });
  });
  return gaps.sort((a, b) => b.gap - a.gap || a.order - b.order).map((entry) => entry.dimension);
}
