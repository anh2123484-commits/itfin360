/**
 * Earned Value Management (F1-07), según `docs/02-modelo-financiero.md` §5.1.
 *
 * Los índices devuelven `null` cuando su denominador es cero, nunca `0` ni
 * `Infinity`: un proyecto sin coste real todavía no tiene un CPI perfecto, tiene
 * un CPI que aún no se puede calcular, y el semáforo del comité debe distinguirlo.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, multiplyCents, roundHalfUp, subtractCents } from './money.js';

/** Estado de un hito del proyecto. */
export type MilestoneStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

/** Método de cálculo del avance real (`config`). */
export type ProgressMethod = 'WEIGHTED_MILESTONES' | 'ZERO_FIFTY_HUNDRED';

/** Hito ponderado del proyecto. */
export interface ProjectMilestone {
  readonly id: string;
  /** Peso relativo del hito. No hace falta que los pesos sumen 1. */
  readonly weight: number;
  readonly status: MilestoneStatus;
  /**
   * Avance declarado del hito, de 0 a 1. Sólo lo usa `WEIGHTED_MILESTONES`.
   * Sin declarar, un hito en curso cuenta **0**: es lo conservador, y para el
   * caso contrario está la regla 0/50/100.
   */
  readonly progress?: number;
}

const ZERO_FIFTY_HUNDRED: Readonly<Record<MilestoneStatus, number>> = {
  NOT_STARTED: 0,
  IN_PROGRESS: 0.5,
  COMPLETED: 1,
};

function milestoneProgress(milestone: ProjectMilestone, method: ProgressMethod): number {
  if (method === 'ZERO_FIFTY_HUNDRED') return ZERO_FIFTY_HUNDRED[milestone.status];
  if (milestone.progress === undefined) return milestone.status === 'COMPLETED' ? 1 : 0;
  if (!Number.isFinite(milestone.progress) || milestone.progress < 0 || milestone.progress > 1) {
    throw new RangeError(`Avance de hito fuera de 0–1: ${milestone.progress}`);
  }
  return milestone.progress;
}

/**
 * Avance real del proyecto, de 0 a 1, a partir de sus hitos.
 *
 * **Nunca** se calcula como horas consumidas entre horas previstas: eso mide
 * consumo, no avance, y es exactamente el error que hace que un proyecto parezca
 * ir bien hasta el día antes de la entrega. Sin hitos devuelve `null`.
 */
export function projectProgress(
  milestones: readonly ProjectMilestone[],
  method: ProgressMethod = 'WEIGHTED_MILESTONES',
): number | null {
  if (milestones.length === 0) return null;

  let weightSum = 0;
  let earned = 0;
  for (const milestone of milestones) {
    if (!Number.isFinite(milestone.weight) || milestone.weight < 0) {
      throw new RangeError(`Peso de hito no válido: ${milestone.weight}`);
    }
    weightSum += milestone.weight;
    earned += milestone.weight * milestoneProgress(milestone, method);
  }

  return weightSum > 0 ? earned / weightSum : null;
}

/** Valor de un avance (0–1) sobre el presupuesto baseline: sirve para EV y para PV. */
export function valueOfProgress(bacCents: Cents, progress: number): Cents {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(`El avance debe estar entre 0 y 1: ${progress}`);
  }
  return multiplyCents(bacCents, progress);
}

/** Entradas de EVM en un corte temporal. */
export interface EvmInput {
  /** Presupuesto baseline vigente. */
  readonly bacCents: Cents;
  /** Valor ganado: `BAC × avanceReal`. */
  readonly evCents: Cents;
  /** Coste real acumulado. */
  readonly acCents: Cents;
  /** Valor planificado: `BAC × avancePlanificado`. */
  readonly pvCents: Cents;
}

/** Cuadro EVM completo. */
export interface Evm {
  readonly bacCents: Cents;
  readonly evCents: Cents;
  readonly acCents: Cents;
  readonly pvCents: Cents;
  /** Cost Variance: `EV − AC`. Negativo, sobrecoste. */
  readonly cvCents: Cents;
  /** Schedule Variance: `EV − PV`. Negativo, retraso. */
  readonly svCents: Cents;
  /** `EV / AC`. `null` si `AC = 0`. */
  readonly cpi: number | null;
  /** `EV / PV`. `null` si `PV = 0`. */
  readonly spi: number | null;
  /** `AC + (BAC − EV) / CPI`, método por rendimiento. `null` si no hay CPI. */
  readonly eacCents: Cents | null;
  /** `AC + (BAC − EV)`, para desviaciones consideradas puntuales. Siempre calculable. */
  readonly eacOptimisticCents: Cents;
  /** `EAC − AC`. `null` si no hay EAC. */
  readonly etcCents: Cents | null;
  /** `BAC − EAC`. Negativo, se acabará gastando de más. `null` si no hay EAC. */
  readonly vacCents: Cents | null;
  /** `(BAC − EV) / (BAC − AC)`. `null` si ya se ha consumido el presupuesto. */
  readonly tcpi: number | null;
}

/**
 * Cuadro EVM a partir de BAC, EV, AC y PV.
 *
 * El EAC por defecto es el **método por rendimiento**: asume que lo que queda se
 * gastará al ritmo al que se ha gastado hasta ahora. `eacOptimisticCents` da la
 * variante que trata la desviación como puntual; se devuelven las dos porque la
 * diferencia entre ambas es justo la conversación que hay que tener en el comité.
 */
export function evm(input: EvmInput): Evm {
  const { bacCents, evCents, acCents, pvCents } = input;

  const cpi = acCents === 0 ? null : evCents / acCents;
  const spi = pvCents === 0 ? null : evCents / pvCents;
  const restante = subtractCents(bacCents, evCents);

  const eacCents =
    cpi === null || cpi === 0 ? null : addCents(acCents, roundHalfUp(restante / cpi));
  const eacOptimisticCents = addCents(acCents, restante);
  const presupuestoSinConsumir = subtractCents(bacCents, acCents);

  return {
    bacCents,
    evCents,
    acCents,
    pvCents,
    cvCents: subtractCents(evCents, acCents),
    svCents: subtractCents(evCents, pvCents),
    cpi,
    spi,
    eacCents,
    eacOptimisticCents,
    etcCents: eacCents === null ? null : subtractCents(eacCents, acCents),
    vacCents: eacCents === null ? null : subtractCents(bacCents, eacCents),
    tcpi: presupuestoSinConsumir === 0 ? null : restante / presupuestoSinConsumir,
  };
}

/** Umbral por defecto para considerar un proyecto entregado dentro de presupuesto. */
export const DEFAULT_ON_BUDGET_THRESHOLD = 0.1;

/** Un proyecto ya entregado, para las métricas de fiabilidad. */
export interface DeliveredProject {
  readonly projectId: string;
  /** Presupuesto de la **baseline inicial**, no de la última re-baseline. */
  readonly initialBacCents: Cents;
  readonly actualCostCents: Cents;
  /** Días de desviación frente a la fecha de la baseline inicial. */
  readonly scheduleDeviationDays: number;
  readonly rebaselineCount: number;
}

/** Fiabilidad de entrega del departamento. */
export interface DeliveryReliability {
  /** On-time delivery. `null` sin proyectos entregados. */
  readonly onTimeDelivery: number | null;
  /** On-budget delivery. `null` sin proyectos entregados. */
  readonly onBudgetDelivery: number | null;
  readonly rebaselineIndex: number | null;
  readonly deliveredCount: number;
}

/**
 * Fiabilidad de entrega, medida **siempre contra la baseline inicial**.
 *
 * El documento es explícito: si sólo se enseña la comparación contra la baseline
 * vigente, re-baselinear borra el problema. Por eso `initialBacCents` es el campo
 * que entra aquí, y el número de re-baselines se publica al lado.
 */
export function deliveryReliability(
  projects: readonly DeliveredProject[],
  onBudgetThreshold: number = DEFAULT_ON_BUDGET_THRESHOLD,
): DeliveryReliability {
  if (projects.length === 0) {
    return {
      onTimeDelivery: null,
      onBudgetDelivery: null,
      rebaselineIndex: null,
      deliveredCount: 0,
    };
  }
  if (!Number.isFinite(onBudgetThreshold) || onBudgetThreshold < 0) {
    throw new RangeError(`Umbral de desviación no válido: ${onBudgetThreshold}`);
  }

  let enFecha = 0;
  let enPresupuesto = 0;
  let rebaselines = 0;
  for (const project of projects) {
    if (project.scheduleDeviationDays <= 0) enFecha += 1;
    if (project.initialBacCents !== 0) {
      const desviacion =
        (project.actualCostCents - project.initialBacCents) / project.initialBacCents;
      if (desviacion <= onBudgetThreshold) enPresupuesto += 1;
    }
    rebaselines += project.rebaselineCount;
  }

  return {
    onTimeDelivery: enFecha / projects.length,
    onBudgetDelivery: enPresupuesto / projects.length,
    rebaselineIndex: rebaselines / projects.length,
    deliveredCount: projects.length,
  };
}

/** Coste real acumulado de un proyecto: horas, facturas y activos imputados. */
export interface ActualCostInput {
  readonly labourCents?: Cents;
  readonly invoicedCents?: Cents;
  readonly assetDepreciationCents?: Cents;
}

/** Suma de los tres componentes del coste real acumulado. */
export function actualCost(input: ActualCostInput): Cents {
  return addCents(
    input.labourCents ?? ZERO_CENTS,
    input.invoicedCents ?? ZERO_CENTS,
    input.assetDepreciationCents ?? ZERO_CENTS,
  );
}
