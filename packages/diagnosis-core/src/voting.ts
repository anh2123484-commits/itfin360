/**
 * Votación de la dirección (`docs/09-diagnostico-y-hoja-de-ruta.md` §5.4).
 *
 * Tres pasos para cada iniciativa y criterio:
 *
 * 1. Dentro de una función con varias personas, media aritmética de sus votos.
 *    Así una función con tres personas no pesa el triple.
 * 2. Entre funciones, media geométrica ponderada por el peso de decisión,
 *    renormalizado sobre las funciones que han votado (agregación de juicios
 *    individuales, Forman y Peniwati, 1998). Una nota muy baja pesa más que en
 *    una media aritmética: el 1 del CISO en riesgo baja de verdad la nota.
 * 3. Quórum: si las funciones que han votado no llegan al peso mínimo, no hay
 *    nota. Una iniciativa sin quórum no entra en la matriz.
 *
 * El consenso es la medida de Tastle y Wierman (2007) sobre la distribución
 * ponderada de votos: 1 si todos votan igual, 0 si la mitad vota 1 y la otra
 * mitad 5.
 */

import {
  assertLevel,
  FULL_BP,
  LEVEL_MAX,
  LEVEL_MIN,
  roundHalfUp,
  toMilli,
  type BasisPoints,
  type Level,
  type LevelMilli,
} from './scale.js';

/** Un voto. `null` es "no lo sé": cuenta como abstención, no como un 3. */
export interface Vote {
  readonly orgFunction: string;
  readonly level: Level | null;
}

/** Quórum por defecto: el 60 % del peso de decisión. */
export const DEFAULT_QUORUM_BP: BasisPoints = 6_000;

/** Umbrales de consenso del documento. */
export const CONSENSUS_REVIEW_BELOW_BP: BasisPoints = 7_000;
export const CONSENSUS_DEBATE_BELOW_BP: BasisPoints = 5_000;

export type ConsensusFlag = 'OK' | 'REVIEW' | 'DEBATE';

/** Criterio con nota: hay quórum. */
export interface ScoredCriterion {
  readonly status: 'SCORED';
  /** Nota agregada, en milésimas (1000..5000). */
  readonly level: LevelMilli;
  /** Consenso de Tastle y Wierman, en puntos básicos (0..10000). */
  readonly consensus: BasisPoints;
  readonly consensusFlag: ConsensusFlag;
  /** Peso de decisión de las funciones que han votado. */
  readonly coverage: BasisPoints;
  /** Nota media de cada función que ha votado, en milésimas. */
  readonly byFunction: Readonly<Record<string, LevelMilli>>;
}

/** Criterio sin quórum: no entra en la matriz. */
export interface NoQuorumCriterion {
  readonly status: 'NO_QUORUM';
  readonly coverage: BasisPoints;
}

export type CriterionResult = ScoredCriterion | NoQuorumCriterion;

interface FunctionScore {
  readonly orgFunction: string;
  /** Peso de decisión de la función, en puntos básicos. */
  readonly weight: BasisPoints;
  /** Media de la función, con decimales; solo vive dentro del cálculo. */
  readonly mean: number;
  /** Peso renormalizado entre las funciones que han votado; suma 1. */
  readonly share: number;
}

/** Clasifica un consenso según los umbrales del documento. */
export function consensusFlag(consensus: BasisPoints): ConsensusFlag {
  if (consensus < CONSENSUS_DEBATE_BELOW_BP) return 'DEBATE';
  if (consensus < CONSENSUS_REVIEW_BELOW_BP) return 'REVIEW';
  return 'OK';
}

/**
 * Consenso de Tastle y Wierman sobre una distribución ponderada:
 *
 *     Cns = 1 + Σ p_i · log2(1 − |X_i − μ| / d)
 *
 * con `d` la amplitud de la escala (5 − 1 = 4). Admite valores no enteros en
 * `X_i` (la media de una función), que es como se usa aquí.
 */
export function tastleWiermanConsensus(
  distribution: readonly { readonly value: number; readonly share: number }[],
): BasisPoints {
  const totalShare = distribution.reduce((sum, item) => sum + item.share, 0);
  if (distribution.length === 0 || totalShare <= 0) {
    throw new RangeError('El consenso necesita al menos un voto con peso');
  }
  const width = LEVEL_MAX - LEVEL_MIN;
  const mean = distribution.reduce((sum, item) => sum + item.value * item.share, 0) / totalShare;
  let entropyTerm = 0;
  for (const item of distribution) {
    // Un peso cero no aporta y, si estuviera en el extremo, daría 0 · log2(0).
    if (item.share <= 0) continue;
    const p = item.share / totalShare;
    const relative = 1 - Math.abs(item.value - mean) / width;
    // Con la mitad en cada extremo `relative` vale 0,5 y el término, −0,5: el
    // logaritmo nunca llega a 0 dentro de la escala.
    entropyTerm += p * Math.log2(relative);
  }
  const consensus = 1 + entropyTerm;
  return roundHalfUp(Math.min(1, Math.max(0, consensus)) * FULL_BP);
}

function functionScores(
  votes: readonly Vote[],
  functionWeights: Readonly<Record<string, BasisPoints>>,
): FunctionScore[] {
  const grouped = new Map<string, { weight: BasisPoints; levels: Level[] }>();
  for (const vote of votes) {
    if (vote.level === null) continue;
    const level = assertLevel(vote.level, `Voto de ${vote.orgFunction}`);
    const weight = functionWeights[vote.orgFunction];
    if (weight === undefined) {
      throw new RangeError(`La función ${vote.orgFunction} no tiene peso de decisión`);
    }
    const entry = grouped.get(vote.orgFunction);
    if (entry === undefined) grouped.set(vote.orgFunction, { weight, levels: [level] });
    else entry.levels.push(level);
  }
  const voted = [...grouped.entries()].filter(([, entry]) => entry.weight > 0);
  const totalWeight = voted.reduce((sum, [, entry]) => sum + entry.weight, 0);
  return voted.map(([orgFunction, entry]) => ({
    orgFunction,
    weight: entry.weight,
    mean: entry.levels.reduce<number>((sum, level) => sum + level, 0) / entry.levels.length,
    share: entry.weight / totalWeight,
  }));
}

/**
 * Agrega los votos de un criterio para una iniciativa.
 *
 * `functionWeights` son los pesos de decisión del cliente en puntos básicos y
 * deben sumar 10000 sobre las funciones que pueden votar ese criterio. Una
 * función con peso cero puede votar, pero su voto no cuenta ni para la nota ni
 * para el quórum.
 */
export function aggregateCriterion(
  votes: readonly Vote[],
  functionWeights: Readonly<Record<string, BasisPoints>>,
  quorum: BasisPoints = DEFAULT_QUORUM_BP,
): CriterionResult {
  const totalWeight = Object.values(functionWeights).reduce((sum, weight) => sum + weight, 0);
  if (totalWeight !== FULL_BP) {
    throw new RangeError(
      `Los pesos de decisión suman ${totalWeight} y deben sumar ${FULL_BP} sobre quien puede votar`,
    );
  }
  const scores = functionScores(votes, functionWeights);
  const coverage = scores.reduce((sum, score) => sum + score.weight, 0);
  if (scores.length === 0 || coverage < quorum) {
    return { status: 'NO_QUORUM', coverage };
  }
  const logMean = scores.reduce((sum, score) => sum + score.share * Math.log(score.mean), 0);
  const consensus = tastleWiermanConsensus(
    scores.map((score) => ({ value: score.mean, share: score.share })),
  );
  const byFunction: Record<string, LevelMilli> = {};
  for (const score of scores) byFunction[score.orgFunction] = toMilli(score.mean);
  return {
    status: 'SCORED',
    level: toMilli(Math.exp(logMean)),
    consensus,
    consensusFlag: consensusFlag(consensus),
    coverage,
    byFunction,
  };
}
