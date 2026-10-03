/**
 * Valoración 360 (`docs/09-diagnostico-y-hoja-de-ruta.md` §5).
 *
 * Diez criterios en dos grupos, la misma escala para iniciativas del
 * diagnóstico y para proyectos del Portafolio. Los votados llegan agregados por
 * `voting.ts`; los calculados se convierten en nota con tramos relativos al
 * tamaño del cliente.
 *
 *     valor      = Σ_{V} peso · (nota − 1) / 4 · 100 / Σ pesos de valor
 *     viabilidad = Σ_{E} peso · (nota − 1) / 4 · 100 / Σ pesos de viabilidad
 *     total      = Σ_{todos} peso · (nota − 1) / 4 · 100
 *
 * Los tres resultados salen en puntos básicos (0..10000 = 0..100,00).
 */

import {
  assertWeightsSumToFull,
  FULL_BP,
  LEVEL_MAX,
  LEVEL_MIN,
  MILLI,
  roundHalfUp,
  type BasisPoints,
  type Level,
  type LevelMilli,
} from './scale.js';

export const VALUE_CRITERIA = [
  'V1_STRATEGIC',
  'V2_BUSINESS',
  'V3_PEOPLE',
  'V4_RISK_COMPLIANCE',
  'V5_RETURN',
] as const;

export const FEASIBILITY_CRITERIA = [
  'E1_CAPEX',
  'E2_OPEX',
  'E3_INTERNAL_CAPACITY',
  'E4_TIME_TO_VALUE',
  'E5_SOLUTION_MATURITY',
] as const;

export const CRITERIA = [...VALUE_CRITERIA, ...FEASIBILITY_CRITERIA] as const;

export type ValueCriterion = (typeof VALUE_CRITERIA)[number];
export type FeasibilityCriterion = (typeof FEASIBILITY_CRITERIA)[number];
export type Criterion = (typeof CRITERIA)[number];

/** Los que puntúa la dirección. El resto se calcula con datos. */
export const VOTED_CRITERIA: readonly Criterion[] = [
  'V1_STRATEGIC',
  'V2_BUSINESS',
  'V3_PEOPLE',
  'V4_RISK_COMPLIANCE',
  'E5_SOLUTION_MATURITY',
];

/** Pesos por defecto: valor 60 %, viabilidad 40 %; el retorno, el que más. */
export const DEFAULT_CRITERIA_WEIGHTS: Readonly<Record<Criterion, BasisPoints>> = {
  V1_STRATEGIC: 1_200,
  V2_BUSINESS: 1_200,
  V3_PEOPLE: 800,
  V4_RISK_COMPLIANCE: 1_200,
  V5_RETURN: 1_600,
  E1_CAPEX: 1_000,
  E2_OPEX: 800,
  E3_INTERNAL_CAPACITY: 800,
  E4_TIME_TO_VALUE: 600,
  E5_SOLUTION_MATURITY: 800,
};

/**
 * Tramo de "menos es mejor": `bounds` son los límites de las notas 5, 4, 3 y
 * 2, en orden creciente. Por encima del último, nota 1. Con `inclusive`, el
 * límite pertenece a la nota mejor ("hasta 6 meses"); sin él, a la peor
 * ("menos del 2 %").
 */
export interface LowerIsBetterBands {
  readonly bounds: readonly [number, number, number, number];
  readonly inclusive: boolean;
}

/** Tramos por defecto del documento §5.2. Porcentajes en puntos básicos, tiempos en meses. */
export const DEFAULT_BANDS = {
  /** Payback en décimas de mes (61 = 6,1 meses). */
  V5_RETURN: { bounds: [60, 120, 240, 360], inclusive: true },
  E1_CAPEX: { bounds: [200, 500, 1_000, 2_000], inclusive: false },
  E2_OPEX: { bounds: [100, 300, 600, 1_000], inclusive: false },
  E3_INTERNAL_CAPACITY: { bounds: [200, 500, 1_000, 2_000], inclusive: false },
  E4_TIME_TO_VALUE: { bounds: [3, 6, 12, 18], inclusive: false },
} as const satisfies Record<string, LowerIsBetterBands>;

/** Nota de 1 a 5 de un valor donde menos es mejor. `null` (no se recupera) es 1. */
export function levelFromBands(value: number | null, bands: LowerIsBetterBands): Level {
  if (value === null) return 1;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Valor fuera de rango para un tramo: ${value}`);
  }
  const [b5, b4, b3, b2] = bands.bounds;
  if (!(b5 <= b4 && b4 <= b3 && b3 <= b2)) {
    throw new RangeError('Los límites de un tramo deben ir en orden creciente');
  }
  const within = (bound: number): boolean => (bands.inclusive ? value <= bound : value < bound);
  if (within(b5)) return 5;
  if (within(b4)) return 4;
  if (within(b3)) return 3;
  if (within(b2)) return 2;
  return 1;
}

/** Proporción en puntos básicos de una parte sobre un total (CAPEX sobre presupuesto IT). */
export function shareOf(part: number, whole: number): BasisPoints {
  if (!Number.isFinite(part) || part < 0) {
    throw new RangeError(`La parte debe ser no negativa: ${part}`);
  }
  if (!Number.isFinite(whole) || whole <= 0) {
    throw new RangeError(`El total de referencia debe ser positivo: ${whole}`);
  }
  return roundHalfUp((part * FULL_BP) / whole);
}

export interface Valuation {
  readonly value: BasisPoints;
  readonly feasibility: BasisPoints;
  readonly total: BasisPoints;
}

function weightedNormalised(
  criteria: readonly Criterion[],
  levels: Readonly<Record<Criterion, LevelMilli>>,
  weights: Readonly<Record<Criterion, BasisPoints>>,
): { readonly numerator: number; readonly weight: number } {
  let numerator = 0;
  let weight = 0;
  for (const criterion of criteria) {
    const level = levels[criterion];
    if (!Number.isInteger(level) || level < LEVEL_MIN * MILLI || level > LEVEL_MAX * MILLI) {
      throw new RangeError(`${criterion}: la nota debe estar entre 1000 y 5000 milésimas`);
    }
    numerator += weights[criterion] * (level - LEVEL_MIN * MILLI);
    weight += weights[criterion];
  }
  return { numerator, weight };
}

const SPAN = (LEVEL_MAX - LEVEL_MIN) * MILLI;

/**
 * Valor, viabilidad y total de una iniciativa. Exige nota en los diez
 * criterios: una valoración a medias no se pinta en la matriz.
 */
export function valuate(
  levels: Readonly<Record<Criterion, LevelMilli>>,
  weights: Readonly<Record<Criterion, BasisPoints>> = DEFAULT_CRITERIA_WEIGHTS,
): Valuation {
  assertWeightsSumToFull(weights, 'Pesos de la Valoración 360');
  const value = weightedNormalised(VALUE_CRITERIA, levels, weights);
  const feasibility = weightedNormalised(FEASIBILITY_CRITERIA, levels, weights);
  const ratio = (part: { numerator: number; weight: number }): BasisPoints =>
    part.weight === 0 ? 0 : roundHalfUp((part.numerator * FULL_BP) / (part.weight * SPAN));
  return {
    value: ratio(value),
    feasibility: ratio(feasibility),
    total: roundHalfUp(((value.numerator + feasibility.numerator) * FULL_BP) / (FULL_BP * SPAN)),
  };
}

export type Quadrant = 'DO_NOW' | 'PLAN' | 'FILL_IN' | 'RETHINK';

/** Umbral por defecto de los dos ejes de la matriz: 50 sobre 100. */
export const DEFAULT_QUADRANT_THRESHOLD: BasisPoints = 5_000;

/** Cuadrante de la matriz de priorización: valor en vertical, viabilidad en horizontal. */
export function quadrant(
  valuation: Pick<Valuation, 'value' | 'feasibility'>,
  valueThreshold: BasisPoints = DEFAULT_QUADRANT_THRESHOLD,
  feasibilityThreshold: BasisPoints = DEFAULT_QUADRANT_THRESHOLD,
): Quadrant {
  const highValue = valuation.value >= valueThreshold;
  const feasible = valuation.feasibility >= feasibilityThreshold;
  if (highValue) return feasible ? 'DO_NOW' : 'PLAN';
  return feasible ? 'FILL_IN' : 'RETHINK';
}
