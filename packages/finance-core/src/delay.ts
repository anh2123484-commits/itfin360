/**
 * Coste del retraso (F1-08), según `docs/02-modelo-financiero.md` §5.2.
 *
 * Es el núcleo diferencial del producto: el sobrecoste de un proyecto que llega
 * tarde no aparece en ninguna factura, así que si no se calcula, no existe.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, allocateByLargestRemainder, cents, roundHalfUp } from './money.js';

/** Días del año usados para repartir el beneficio esperado (`config`). */
export const DEFAULT_DAYS_IN_YEAR = 365;

/** Días del mes usados para repartir el coste del legacy (`config`). */
export const DEFAULT_DAYS_IN_MONTH = 30;

/** Horas de jornada por defecto (`config`). */
export const DEFAULT_WORKDAY_HOURS = 8;

/** Causas tipificadas de retraso (`enum`, ampliable por el tenant). */
export const DELAY_CAUSES = [
  'SCOPE_CHANGE',
  'RESOURCE_UNAVAILABLE',
  'VENDOR_DELAY',
  'DEPENDENCY_BLOCKED',
  'QUALITY_REWORK',
  'APPROVAL_DELAY',
  'ESTIMATION_ERROR',
  'EXTERNAL',
] as const;

/** Causa de retraso. */
export type DelayCause = (typeof DELAY_CAUSES)[number];

/** Una persona retenida en el proyecto un día concreto. */
export interface RetainedTeamMember {
  readonly employeeId: string;
  /** Fracción de jornada asignada al proyecto ese día. */
  readonly fteAssigned: number;
  readonly hourlyRateCents: Cents;
}

/** Parámetros de reparto (`config` del tenant). */
export interface DelayConfig {
  readonly daysInYear?: number;
  readonly daysInMonth?: number;
  readonly workdayHours?: number;
}

/** Un día de retraso, con la composición real del equipo ese día. */
export interface DelayDay {
  /** Fecha del día de retraso, `YYYY-MM-DD`. Sólo para trazabilidad. */
  readonly date: string;
  readonly team: readonly RetainedTeamMember[];
  /** Beneficio o ahorro anual esperado que el proyecto todavía no entrega. */
  readonly expectedAnnualBenefitCents?: Cents;
  /** Penalización contractual por día según cláusula SLA. Cero si no aplica. */
  readonly contractualPenaltyPerDayCents?: Cents;
  /** Coste mensual del sistema legacy que el proyecto sustituye. */
  readonly legacyMonthlyCostCents?: Cents;
  readonly cause?: DelayCause;
}

/** Desglose del coste de un día de retraso. */
export interface DelayCostBreakdown {
  readonly retainedTeamCents: Cents;
  readonly opportunityCents: Cents;
  readonly contractualPenaltyCents: Cents;
  readonly bridgeCents: Cents;
  readonly reworkCents: Cents;
  readonly totalCents: Cents;
}

/** Coste del retraso acumulado, con su desglose y su reparto por causa. */
export interface CostOfDelay {
  readonly perDay: readonly (DelayCostBreakdown & { readonly date: string })[];
  readonly breakdown: DelayCostBreakdown;
  readonly totalCents: Cents;
  readonly delayDays: number;
  /** Coste acumulado por causa: lo que dice dónde actuar. */
  readonly byCause: Readonly<Partial<Record<DelayCause, Cents>>>;
}

function resolveConfig(config: DelayConfig): Required<DelayConfig> {
  const daysInYear = config.daysInYear ?? DEFAULT_DAYS_IN_YEAR;
  const daysInMonth = config.daysInMonth ?? DEFAULT_DAYS_IN_MONTH;
  const workdayHours = config.workdayHours ?? DEFAULT_WORKDAY_HOURS;
  for (const [nombre, valor] of [
    ['días del año', daysInYear],
    ['días del mes', daysInMonth],
    ['horas de jornada', workdayHours],
  ] as const) {
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new RangeError(`Los ${nombre} deben ser un número positivo: ${valor}`);
    }
  }
  return { daysInYear, daysInMonth, workdayHours };
}

/** Coste del equipo retenido un día: `Σ (FTE × tarifa × horas de jornada)`. */
export function retainedTeamCost(
  team: readonly RetainedTeamMember[],
  workdayHours: number = DEFAULT_WORKDAY_HOURS,
): Cents {
  if (!Number.isFinite(workdayHours) || workdayHours <= 0) {
    throw new RangeError(`Las horas de jornada deben ser positivas: ${workdayHours}`);
  }
  let total = 0;
  for (const member of team) {
    if (!Number.isFinite(member.fteAssigned) || member.fteAssigned < 0) {
      throw new RangeError(`FTE asignado no válido: ${member.fteAssigned}`);
    }
    total += member.hourlyRateCents * member.fteAssigned * workdayHours;
  }
  return roundHalfUp(total);
}

/**
 * Coste de un día de retraso.
 *
 * Cada componente se redondea al céntimo por separado y luego se suman, que es
 * como lo presenta el documento: el desglose que se enseña tiene que sumar el
 * total que se enseña, sin un céntimo de diferencia que nadie sepa explicar.
 */
export function delayCostForDay(
  day: DelayDay,
  reworkForDayCents: Cents = ZERO_CENTS,
  config: DelayConfig = {},
): DelayCostBreakdown {
  const { daysInYear, daysInMonth, workdayHours } = resolveConfig(config);

  const retainedTeamCents = retainedTeamCost(day.team, workdayHours);
  const opportunityCents = roundHalfUp((day.expectedAnnualBenefitCents ?? 0) / daysInYear);
  const contractualPenaltyCents = day.contractualPenaltyPerDayCents ?? ZERO_CENTS;
  const bridgeCents = roundHalfUp((day.legacyMonthlyCostCents ?? 0) / daysInMonth);

  return {
    retainedTeamCents,
    opportunityCents,
    contractualPenaltyCents,
    bridgeCents,
    reworkCents: reworkForDayCents,
    totalCents: addCents(
      retainedTeamCents,
      opportunityCents,
      contractualPenaltyCents,
      bridgeCents,
      reworkForDayCents,
    ),
  };
}

/**
 * Coste del retraso acumulado día a día.
 *
 * Se acumula con la **composición real del equipo de cada día**, no con una media:
 * un proyecto del que se van retirando personas tiene un coste decreciente, y
 * promediarlo lo repartiría al revés de como ocurrió.
 *
 * El retrabajo es un importe total del retraso, no diario, así que se reparte
 * entre los días con el método del mayor resto: la suma de los días es
 * exactamente el retrabajo, sin descuadre.
 */
export function costOfDelay(
  days: readonly DelayDay[],
  totalReworkCents: Cents = ZERO_CENTS,
  config: DelayConfig = {},
): CostOfDelay {
  if (days.length === 0) {
    const vacio: DelayCostBreakdown = {
      retainedTeamCents: ZERO_CENTS,
      opportunityCents: ZERO_CENTS,
      contractualPenaltyCents: ZERO_CENTS,
      bridgeCents: ZERO_CENTS,
      reworkCents: ZERO_CENTS,
      totalCents: ZERO_CENTS,
    };
    return { perDay: [], breakdown: vacio, totalCents: ZERO_CENTS, delayDays: 0, byCause: {} };
  }

  const retrabajoPorDia = allocateByLargestRemainder(
    totalReworkCents,
    days.map(() => 1),
  );

  const perDay = days.map((day, index) => ({
    date: day.date,
    ...delayCostForDay(day, retrabajoPorDia[index] ?? ZERO_CENTS, config),
  }));

  const byCause: Partial<Record<DelayCause, Cents>> = {};
  for (const [index, day] of days.entries()) {
    const cause = day.cause;
    const coste = perDay[index]?.totalCents ?? ZERO_CENTS;
    if (cause !== undefined) {
      byCause[cause] = addCents(byCause[cause] ?? ZERO_CENTS, coste);
    }
  }

  const suma = (elegir: (entrada: DelayCostBreakdown) => Cents): Cents =>
    addCents(...perDay.map(elegir));

  return {
    perDay,
    breakdown: {
      retainedTeamCents: suma((e) => e.retainedTeamCents),
      opportunityCents: suma((e) => e.opportunityCents),
      contractualPenaltyCents: suma((e) => e.contractualPenaltyCents),
      bridgeCents: suma((e) => e.bridgeCents),
      reworkCents: suma((e) => e.reworkCents),
      totalCents: suma((e) => e.totalCents),
    },
    totalCents: suma((e) => e.totalCents),
    delayDays: days.length,
    byCause,
  };
}

/**
 * Atajo para el caso habitual: mismo equipo y mismos parámetros todos los días.
 *
 * Genera los días a partir de una plantilla. Cuando la composición cambia —que es
 * lo normal en un retraso largo— hay que usar `costOfDelay` con la lista real.
 */
export function costOfDelayForUniformDays(
  day: Omit<DelayDay, 'date'>,
  delayDays: number,
  totalReworkCents: Cents = ZERO_CENTS,
  config: DelayConfig = {},
): CostOfDelay {
  if (!Number.isInteger(delayDays) || delayDays < 0) {
    throw new RangeError(`Los días de retraso deben ser un entero no negativo: ${delayDays}`);
  }
  const days = Array.from({ length: delayDays }, (_, index) => ({
    ...day,
    date: `dia-${index + 1}`,
  }));
  return costOfDelay(days, totalReworkCents, config);
}

/**
 * Sobrecoste invisible del retraso sobre el presupuesto del proyecto.
 *
 * `null` si el proyecto no tiene presupuesto baseline: sin denominador no hay
 * porcentaje, y un 0 % ahí sería mentira.
 */
export function delayOverrunRatio(totalDelayCents: Cents, bacCents: Cents): number | null {
  return bacCents === 0 ? null : totalDelayCents / bacCents;
}

/** Coste del retrabajo: horas de retrabajo valoradas a su tarifa. */
export function reworkCost(hours: number, hourlyRateCents: Cents): Cents {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new RangeError(`Las horas de retrabajo deben ser no negativas: ${hours}`);
  }
  return cents(roundHalfUp(hourlyRateCents * hours));
}
