/**
 * Motor de cálculo puro del diagnóstico de NovaEra Nexus
 * (`docs/09-diagnostico-y-hoja-de-ruta.md`).
 *
 * Igual que `finance-core`: sin I/O, sin Prisma, sin `fetch` y sin
 * `Date.now()`. Todo lo que sale son enteros (milésimas de nivel, puntos
 * básicos); los decimales solo viven dentro de cada cálculo.
 */

export {
  assertLevel,
  assertWeightsSumToFull,
  FULL_BP,
  isLevel,
  LEVEL_MAX,
  LEVEL_MIN,
  MILLI,
  roundHalfUp,
  toMilli,
  type BasisPoints,
  type Level,
  type LevelMilli,
} from './scale.js';

export {
  dimensionLevel,
  dimensionsNeedingWork,
  effectiveLevel,
  LEVEL_CAP_WITHOUT_EVIDENCE,
  MATURITY_DIMENSIONS,
  maturityGap,
  type MaturityAnswer,
  type MaturityDimension,
} from './maturity.js';

export {
  aggregateCriterion,
  CONSENSUS_DEBATE_BELOW_BP,
  CONSENSUS_REVIEW_BELOW_BP,
  consensusFlag,
  DEFAULT_QUORUM_BP,
  tastleWiermanConsensus,
  type ConsensusFlag,
  type CriterionResult,
  type NoQuorumCriterion,
  type ScoredCriterion,
  type Vote,
} from './voting.js';

export { rocWeights, rocWeightsFromRanking, toBasisPoints } from './weights.js';

export {
  CRITERIA,
  DEFAULT_BANDS,
  DEFAULT_CRITERIA_WEIGHTS,
  DEFAULT_QUADRANT_THRESHOLD,
  FEASIBILITY_CRITERIA,
  levelFromBands,
  quadrant,
  shareOf,
  valuate,
  VALUE_CRITERIA,
  VOTED_CRITERIA,
  type Criterion,
  type FeasibilityCriterion,
  type LowerIsBetterBands,
  type Quadrant,
  type Valuation,
  type ValueCriterion,
} from './valuation.js';
