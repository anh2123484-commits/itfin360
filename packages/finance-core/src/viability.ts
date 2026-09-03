/**
 * IT Viability Score (F1-10), según `docs/02-modelo-financiero.md` §7.
 *
 * Los tres requisitos no negociables del documento están implementados como
 * reglas del motor, no como recomendaciones:
 *
 * 1. **Trazabilidad completa o el indicador no cuenta.** Cada indicador expone
 *    valor, normalizado, peso, contribución, banda y los ids de sus registros de
 *    origen. Un indicador sin ids se marca `INSUFFICIENT_DATA`.
 * 2. **Nunca se rellena un hueco con un valor por defecto.** Un indicador sin
 *    datos se excluye y su peso se redistribuye entre los que sí los tienen; el
 *    resultado dice sobre qué **cobertura** se ha calculado.
 * 3. **No se inventan benchmarks.** Las referencias sectoriales las carga el
 *    tenant. Sin referencia, los indicadores 1 y 5 quedan `INSUFFICIENT_DATA`.
 */

import type { Cents } from './money.js';

/** Los ocho indicadores del score, en el orden del documento. */
export const VIABILITY_INDICATORS = [
  'IT_SPEND_RATIO',
  'RUN_CHANGE_RATIO',
  'WEIGHTED_CPI',
  'BUDGET_DEVIATION',
  'COST_PER_USER',
  'TEAM_UTILIZATION',
  'GOVERNED_SPEND',
  'ASSET_RENEWAL_COVERAGE',
] as const;

/** Identificador de un indicador del score. */
export type ViabilityIndicatorId = (typeof VIABILITY_INDICATORS)[number];

/** Banda monótona: se interpola entre `bad` (0) y `good` (100), y se recorta fuera. */
export interface LinearBand {
  readonly kind: 'LINEAR';
  /** Valor que vale 100. Puede ser mayor o menor que `bad`. */
  readonly good: number;
  /** Valor que vale 0. */
  readonly bad: number;
}

/**
 * Banda con meseta: bueno dentro de un intervalo, malo por debajo y por encima.
 * Es la forma que necesita la utilización, donde pasarse es tan malo como no llegar.
 */
export interface RangeBand {
  readonly kind: 'RANGE';
  readonly goodLow: number;
  readonly goodHigh: number;
  readonly badLow: number;
  readonly badHigh: number;
}

/** Banda de normalización de un indicador. */
export type ScoreBand = LinearBand | RangeBand;

/** Pesos de arranque (`config`). Suman 100. */
export const DEFAULT_INDICATOR_WEIGHTS: Readonly<Record<ViabilityIndicatorId, number>> = {
  IT_SPEND_RATIO: 15,
  RUN_CHANGE_RATIO: 15,
  WEIGHTED_CPI: 15,
  BUDGET_DEVIATION: 15,
  COST_PER_USER: 10,
  TEAM_UTILIZATION: 10,
  GOVERNED_SPEND: 10,
  ASSET_RENEWAL_COVERAGE: 10,
};

/**
 * Bandas de arranque (`config`).
 *
 * Los indicadores 1 y 5 se normalizan sobre el **cociente con la referencia del
 * tenant**, no sobre el valor absoluto: 1 significa "en la referencia" y 2, "el
 * doble". Así la banda no contiene ningún benchmark inventado.
 */
export const DEFAULT_INDICATOR_BANDS: Readonly<Record<ViabilityIndicatorId, ScoreBand>> = {
  IT_SPEND_RATIO: { kind: 'LINEAR', good: 1, bad: 2 },
  RUN_CHANGE_RATIO: { kind: 'LINEAR', good: 0.3, bad: 0.1 },
  WEIGHTED_CPI: { kind: 'LINEAR', good: 1, bad: 0.75 },
  BUDGET_DEVIATION: { kind: 'LINEAR', good: 0.05, bad: 0.25 },
  COST_PER_USER: { kind: 'LINEAR', good: 1, bad: 2 },
  TEAM_UTILIZATION: { kind: 'RANGE', goodLow: 0.7, goodHigh: 0.85, badLow: 0.5, badHigh: 0.95 },
  GOVERNED_SPEND: { kind: 'LINEAR', good: 0.9, bad: 0.5 },
  ASSET_RENEWAL_COVERAGE: { kind: 'LINEAR', good: 0.05, bad: 0.25 },
};

/** Lectura del score (`config`). */
export interface ReadingBands {
  /** A partir de aquí, viable y bajo control. */
  readonly viable: number;
  /** A partir de aquí, viable con tensiones. */
  readonly withTension: number;
  /** A partir de aquí, en riesgo. Por debajo, no viable sin intervención. */
  readonly atRisk: number;
}

/** Lectura de arranque del documento. */
export const DEFAULT_READING_BANDS: ReadingBands = { viable: 75, withTension: 55, atRisk: 40 };

/** Interpretación del score. */
export type ViabilityReading = 'VIABLE' | 'VIABLE_WITH_TENSION' | 'AT_RISK' | 'NOT_VIABLE';

/**
 * Normaliza un valor a 0–100 según su banda, recortando fuera de rango.
 *
 * La interpolación es lineal, como pide el documento. No se suaviza ni se aplica
 * ninguna curva: un score que no se puede reproducir con una regla de tres en una
 * servilleta no se puede defender delante de un comité.
 */
export function normalizeToBand(value: number, band: ScoreBand): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Valor de indicador no finito: ${value}`);
  }

  if (band.kind === 'LINEAR') {
    if (band.good === band.bad) {
      throw new RangeError('Una banda lineal necesita valores distintos para bueno y malo.');
    }
    const proporcion = (value - band.bad) / (band.good - band.bad);
    return Math.min(100, Math.max(0, proporcion * 100));
  }

  const { goodLow, goodHigh, badLow, badHigh } = band;
  if (!(badLow < goodLow && goodLow <= goodHigh && goodHigh < badHigh)) {
    throw new RangeError(
      'Una banda con meseta necesita badLow < goodLow ≤ goodHigh < badHigh: ' +
        `${badLow}, ${goodLow}, ${goodHigh}, ${badHigh}`,
    );
  }

  if (value >= goodLow && value <= goodHigh) return 100;
  if (value <= badLow || value >= badHigh) return 0;
  return value < goodLow
    ? ((value - badLow) / (goodLow - badLow)) * 100
    : ((badHigh - value) / (badHigh - goodHigh)) * 100;
}

/** Un valor medido junto a los registros que lo justifican. */
export interface Measure<T> {
  readonly value: T;
  /** Ids de los registros de origen. **Sin ellos no hay score.** */
  readonly sourceIds: readonly string[];
}

/** Referencias sectoriales cargadas por el tenant. Vacías por defecto. */
export interface SectorBenchmarks {
  /** IT spend sobre facturación de referencia del sector. */
  readonly itSpendRatio?: number;
  /** Coste por usuario de referencia. */
  readonly costPerUserCents?: Cents;
}

/** Entradas del score. Todo indicador ausente queda `INSUFFICIENT_DATA`. */
export interface ViabilityInput {
  /** Referencias del tenant. Si faltan, los indicadores 1 y 5 se excluyen. */
  readonly benchmarks?: SectorBenchmarks;
  /** TCO total sobre facturación de la empresa. */
  readonly itSpendRatio?: Measure<number>;
  /** Proporción de horas dedicadas a change sobre lo imputado. */
  readonly changeShare?: Measure<number>;
  /** CPI medio ponderado por BAC. */
  readonly weightedCpi?: Measure<number>;
  /** Desviación presupuestaria anual, en tanto por uno. */
  readonly budgetDeviation?: Measure<number>;
  readonly costPerUserCents?: Measure<Cents>;
  /** Utilización del equipo, en tanto por uno. */
  readonly teamUtilization?: Measure<number>;
  /** Proporción de gasto bajo contrato gobernado. */
  readonly governedSpendShare?: Measure<number>;
  /** Deuda técnica sobre el TCO, en tanto por uno. */
  readonly technicalDebtShare?: Measure<number>;
  readonly weights?: Partial<Readonly<Record<ViabilityIndicatorId, number>>>;
  readonly bands?: Partial<Readonly<Record<ViabilityIndicatorId, ScoreBand>>>;
  readonly readingBands?: ReadingBands;
}

/** Motivo por el que un indicador no entra en el cómputo. */
export type InsufficientReason = 'NO_VALUE' | 'NO_BENCHMARK' | 'NO_TRACEABILITY';

/** Desglose de un indicador: todo lo que hace falta para explicar su contribución. */
export interface IndicatorBreakdown {
  readonly id: ViabilityIndicatorId;
  readonly status: 'OK' | 'INSUFFICIENT_DATA';
  readonly reason: InsufficientReason | null;
  /** Valor sobre el que se aplica la banda. En los indicadores 1 y 5, el cociente con la referencia. */
  readonly value: number | null;
  /** Valor tal y como se midió, antes de compararlo con ninguna referencia. */
  readonly rawValue: number | null;
  readonly normalized: number | null;
  /** Peso nominal del indicador. */
  readonly weight: number;
  /** Peso una vez redistribuido el de los indicadores excluidos. */
  readonly effectiveWeight: number;
  /** `normalizado × pesoEfectivo`. Lo que este indicador aporta al score. */
  readonly contribution: number | null;
  readonly band: ScoreBand | null;
  readonly sourceIds: readonly string[];
}

/** Resultado del IT Viability Score. */
export interface ViabilityScore {
  /** Score 0–100. `null` si ningún indicador tiene datos. */
  readonly score: number | null;
  readonly reading: ViabilityReading | null;
  /** Proporción del peso total que sí tenía datos, de 0 a 1. */
  readonly coverage: number;
  /** Indicadores excluidos, para poder decir qué falta por cargar. */
  readonly excluded: readonly ViabilityIndicatorId[];
  readonly indicators: readonly IndicatorBreakdown[];
}

interface Candidato {
  readonly id: ViabilityIndicatorId;
  readonly measure: Measure<number> | undefined;
  /** Referencia con la que dividir el valor, si el indicador la necesita. */
  readonly benchmark: number | undefined;
  readonly needsBenchmark: boolean;
}

function candidatos(input: ViabilityInput): Candidato[] {
  const benchmarks = input.benchmarks ?? {};
  const conCentimos = (m: Measure<Cents> | undefined): Measure<number> | undefined =>
    m === undefined ? undefined : { value: m.value, sourceIds: m.sourceIds };

  return [
    {
      id: 'IT_SPEND_RATIO',
      measure: input.itSpendRatio,
      benchmark: benchmarks.itSpendRatio,
      needsBenchmark: true,
    },
    {
      id: 'RUN_CHANGE_RATIO',
      measure: input.changeShare,
      benchmark: undefined,
      needsBenchmark: false,
    },
    {
      id: 'WEIGHTED_CPI',
      measure: input.weightedCpi,
      benchmark: undefined,
      needsBenchmark: false,
    },
    {
      id: 'BUDGET_DEVIATION',
      measure: input.budgetDeviation,
      benchmark: undefined,
      needsBenchmark: false,
    },
    {
      id: 'COST_PER_USER',
      measure: conCentimos(input.costPerUserCents),
      benchmark: benchmarks.costPerUserCents,
      needsBenchmark: true,
    },
    {
      id: 'TEAM_UTILIZATION',
      measure: input.teamUtilization,
      benchmark: undefined,
      needsBenchmark: false,
    },
    {
      id: 'GOVERNED_SPEND',
      measure: input.governedSpendShare,
      benchmark: undefined,
      needsBenchmark: false,
    },
    {
      id: 'ASSET_RENEWAL_COVERAGE',
      measure: input.technicalDebtShare,
      benchmark: undefined,
      needsBenchmark: false,
    },
  ];
}

function readingFor(score: number, bands: ReadingBands): ViabilityReading {
  if (score >= bands.viable) return 'VIABLE';
  if (score >= bands.withTension) return 'VIABLE_WITH_TENSION';
  return score >= bands.atRisk ? 'AT_RISK' : 'NOT_VIABLE';
}

/**
 * IT Viability Score con desglose completo y redistribución de pesos.
 *
 * La redistribución es **proporcional**: el peso de los indicadores excluidos se
 * reparte entre los disponibles en la misma proporción que tenían entre ellos, así
 * que el score sigue estando en 0–100 y sigue siendo comparable. Lo que cambia es
 * la `coverage`, que hay que enseñar siempre al lado: un 82 sobre el 55 % del peso
 * no es el mismo número que un 82 sobre el 100 %.
 */
export function viabilityScore(input: ViabilityInput): ViabilityScore {
  const pesos = { ...DEFAULT_INDICATOR_WEIGHTS, ...(input.weights ?? {}) };
  const bandas = { ...DEFAULT_INDICATOR_BANDS, ...(input.bands ?? {}) };
  const readingBands = input.readingBands ?? DEFAULT_READING_BANDS;

  if (
    readingBands.atRisk > readingBands.withTension ||
    readingBands.withTension > readingBands.viable
  ) {
    throw new RangeError(
      'Las bandas de lectura deben ir de menor a mayor: atRisk ≤ withTension ≤ viable.',
    );
  }

  interface Parcial {
    readonly id: ViabilityIndicatorId;
    readonly weight: number;
    readonly reason: InsufficientReason | null;
    readonly value: number | null;
    readonly rawValue: number | null;
    readonly normalized: number | null;
    readonly band: ScoreBand | null;
    readonly sourceIds: readonly string[];
  }

  const parciales: Parcial[] = candidatos(input).map((candidato) => {
    const weight = pesos[candidato.id];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Peso no válido para ${candidato.id}: ${weight}`);
    }
    const band = bandas[candidato.id];
    const base = {
      id: candidato.id,
      weight,
      band: null,
      value: null,
      rawValue: null,
      normalized: null,
    };

    const measure = candidato.measure;
    if (measure === undefined) {
      return { ...base, reason: 'NO_VALUE' as const, sourceIds: [] };
    }
    if (measure.sourceIds.length === 0) {
      // Regla 1: sin drill-down, el indicador no puede sostener su contribución.
      return {
        ...base,
        reason: 'NO_TRACEABILITY' as const,
        rawValue: measure.value,
        sourceIds: [],
      };
    }
    if (
      candidato.needsBenchmark &&
      (candidato.benchmark === undefined || candidato.benchmark === 0)
    ) {
      // Regla 3: sin referencia cargada por el tenant, no se inventa ninguna.
      return {
        ...base,
        reason: 'NO_BENCHMARK' as const,
        rawValue: measure.value,
        sourceIds: measure.sourceIds,
      };
    }

    const value = candidato.needsBenchmark
      ? measure.value / (candidato.benchmark ?? 1)
      : measure.value;
    return {
      id: candidato.id,
      weight,
      reason: null,
      value,
      rawValue: measure.value,
      normalized: normalizeToBand(value, band),
      band,
      sourceIds: measure.sourceIds,
    };
  });

  const pesoTotal = parciales.reduce((suma, p) => suma + p.weight, 0);
  const pesoDisponible = parciales
    .filter((p) => p.reason === null)
    .reduce((suma, p) => suma + p.weight, 0);

  const indicators: IndicatorBreakdown[] = parciales.map((p) => {
    const disponible = p.reason === null && pesoDisponible > 0;
    const effectiveWeight = disponible ? p.weight / pesoDisponible : 0;
    return {
      id: p.id,
      status: p.reason === null ? 'OK' : 'INSUFFICIENT_DATA',
      reason: p.reason,
      value: p.value,
      rawValue: p.rawValue,
      normalized: p.normalized,
      weight: p.weight,
      effectiveWeight,
      contribution: disponible && p.normalized !== null ? p.normalized * effectiveWeight : null,
      band: p.band,
      sourceIds: p.sourceIds,
    };
  });

  const score =
    pesoDisponible > 0 ? indicators.reduce((suma, i) => suma + (i.contribution ?? 0), 0) : null;

  return {
    score,
    reading: score === null ? null : readingFor(score, readingBands),
    coverage: pesoTotal > 0 ? pesoDisponible / pesoTotal : 0,
    excluded: indicators.filter((i) => i.status === 'INSUFFICIENT_DATA').map((i) => i.id),
    indicators,
  };
}
