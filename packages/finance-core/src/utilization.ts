/**
 * Utilización, run/change y coste invisible (F1-05), según
 * `docs/02-modelo-financiero.md` §3.3.
 *
 * Todos los ratios devuelven `null` cuando su denominador es cero, nunca
 * `Infinity` ni `NaN`: un empleado de baja el año entero no tiene una
 * utilización infinita, tiene una utilización que no se puede calcular, y el
 * cuadro de mando debe poder distinguir "cero" de "no hay dato".
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, multiplyCents } from './money.js';
import { MIN_EMPLOYEES_FOR_AGGREGATE } from './personnel.js';

/** Horas de un empleado en el periodo y su tarifa interna. */
export interface UtilizationInput {
  /** Horas disponibles del periodo (ya descontadas vacaciones, festivos y bajas). */
  readonly availableHours: number;
  /** Horas imputadas a servicios en explotación. */
  readonly runHours: number;
  /** Horas imputadas a proyectos. */
  readonly changeHours: number;
  /** Tarifa horaria interna del empleado. */
  readonly hourlyRateCents: Cents;
}

/** Reparto del tiempo de un empleado y su traducción a euros. */
export interface Utilization {
  readonly bookedHours: number;
  /** Horas disponibles no imputadas. Negativo si se ha imputado por encima de la jornada. */
  readonly unbookedHours: number;
  /** Horas imputadas sobre disponibles. `null` si no hay horas disponibles. */
  readonly utilization: number | null;
  /** Proporción de run sobre lo imputado. `null` si no se ha imputado nada. */
  readonly runShare: number | null;
  /** Proporción de change sobre lo imputado. `null` si no se ha imputado nada. */
  readonly changeShare: number | null;
  readonly runCostCents: Cents;
  readonly changeCostCents: Cents;
  /** Coste de las horas no imputadas: el "coste invisible". */
  readonly unbookedCostCents: Cents;
}

function validateHours(value: number, nombre: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Las ${nombre} deben ser un número no negativo: ${value}`);
  }
  return value;
}

/**
 * Utilización de un empleado y coste de lo que no se imputa.
 *
 * Si se imputan más horas de las disponibles (horas extra, o una imputación mal
 * hecha), `unbookedHours` sale negativo y el coste invisible con él. No se
 * recorta a cero a propósito: un coste invisible negativo es la señal de que
 * alguien está trabajando por encima de su jornada, y esconderla sería peor que
 * enseñarla.
 */
export function utilization(input: UtilizationInput): Utilization {
  const available = validateHours(input.availableHours, 'horas disponibles');
  const run = validateHours(input.runHours, 'horas de run');
  const change = validateHours(input.changeHours, 'horas de change');

  const booked = run + change;
  const unbooked = available - booked;

  return {
    bookedHours: booked,
    unbookedHours: unbooked,
    utilization: available > 0 ? booked / available : null,
    runShare: booked > 0 ? run / booked : null,
    changeShare: booked > 0 ? change / booked : null,
    runCostCents: multiplyCents(input.hourlyRateCents, run),
    changeCostCents: multiplyCents(input.hourlyRateCents, change),
    unbookedCostCents: multiplyCents(input.hourlyRateCents, unbooked),
  };
}

/** Bandas del ratio de recuperación (`config`). */
export interface RecoveryBands {
  /** Por debajo de este ratio, deficitario. Por defecto, 0,8. */
  readonly deficitBelow: number;
  /** Por encima de este ratio, genera margen. Por defecto, 1,1. */
  readonly marginAbove: number;
}

/** Bandas de arranque (`docs/02-modelo-financiero.md` §3.3). */
export const DEFAULT_RECOVERY_BANDS: RecoveryBands = { deficitBelow: 0.8, marginAbove: 1.1 };

/** Banda en la que cae el ratio de recuperación. */
export type RecoveryBand = 'DEFICIT' | 'BREAK_EVEN' | 'MARGIN';

/** Entradas del ratio de recuperación de un puesto. */
export interface RecoveryRatioInput {
  /** Horas imputadas en el periodo. */
  readonly bookedHours: number;
  /** Tarifa de referencia: de mercado para el rol, o precio de venta si se factura. */
  readonly referenceRateCents: Cents;
  /** Coste empresa del empleado en el mismo periodo. */
  readonly employerCostCents: Cents;
  readonly bands?: RecoveryBands;
}

/** Ratio de recuperación de un puesto. */
export interface RecoveryRatio {
  readonly bookedValueCents: Cents;
  /** Valor imputado sobre coste empresa. `null` si el coste es cero. */
  readonly ratio: number | null;
  readonly band: RecoveryBand | null;
}

function bandOf(ratio: number, bands: RecoveryBands): RecoveryBand {
  if (ratio < bands.deficitBelow) return 'DEFICIT';
  return ratio > bands.marginAbove ? 'MARGIN' : 'BREAK_EVEN';
}

/**
 * Ratio de recuperación: cuánto valor devuelve el puesto frente a lo que cuesta.
 *
 * Mide la recuperación económica del **puesto**, no el desempeño de la persona.
 * El documento 02 lo marca como decisión de producto y no como matiz cosmético:
 * la interfaz lo etiqueta así y no permite ordenar empleados por él en vistas
 * compartidas.
 */
export function recoveryRatio(input: RecoveryRatioInput): RecoveryRatio {
  const hours = validateHours(input.bookedHours, 'horas imputadas');
  const bands = input.bands ?? DEFAULT_RECOVERY_BANDS;
  if (bands.deficitBelow > bands.marginAbove) {
    throw new RangeError('La banda de déficit no puede estar por encima de la de margen.');
  }

  const value = multiplyCents(input.referenceRateCents, hours);
  if (input.employerCostCents === 0) {
    return { bookedValueCents: value, ratio: null, band: null };
  }

  const ratio = value / input.employerCostCents;
  return { bookedValueCents: value, ratio, band: bandOf(ratio, bands) };
}

/** Un empleado dentro de un agregado de recuperación por rol o equipo. */
export interface RecoveryMember {
  readonly employeeId: string;
  readonly bookedValueCents: Cents;
  readonly employerCostCents: Cents;
}

/** Ratio de recuperación agregado, con supresión por privacidad. */
export type AggregateRecovery =
  | {
      readonly status: 'OK';
      readonly bookedValueCents: Cents;
      readonly employerCostCents: Cents;
      readonly ratio: number | null;
      readonly band: RecoveryBand | null;
      readonly employeeCount: number;
    }
  | {
      readonly status: 'SUPPRESSED';
      readonly employeeCount: number;
      readonly reason: 'MIN_HEADCOUNT';
    };

/**
 * Ratio de recuperación de un rol o equipo.
 *
 * Es un agregado construido sobre coste empresa, así que sigue la misma regla
 * que la tarifa por rol: por debajo de `MIN_EMPLOYEES_FOR_AGGREGATE` se suprime.
 * Se agrega **valor total entre coste total**, no la media de los ratios: la
 * media aritmética daría el mismo peso a un becario a media jornada que a un
 * arquitecto, y el ratio dejaría de ser una cifra económica.
 */
export function aggregateRecovery(
  members: readonly RecoveryMember[],
  bands: RecoveryBands = DEFAULT_RECOVERY_BANDS,
): AggregateRecovery {
  if (members.length < MIN_EMPLOYEES_FOR_AGGREGATE) {
    return { status: 'SUPPRESSED', employeeCount: members.length, reason: 'MIN_HEADCOUNT' };
  }

  let value = ZERO_CENTS;
  let cost = ZERO_CENTS;
  for (const member of members) {
    value = addCents(value, member.bookedValueCents);
    cost = addCents(cost, member.employerCostCents);
  }

  if (cost === 0) {
    return {
      status: 'OK',
      bookedValueCents: value,
      employerCostCents: cost,
      ratio: null,
      band: null,
      employeeCount: members.length,
    };
  }

  const ratio = value / cost;
  return {
    status: 'OK',
    bookedValueCents: value,
    employerCostCents: cost,
    ratio,
    band: bandOf(ratio, bands),
    employeeCount: members.length,
  };
}

/** Coste invisible del departamento: suma de las horas no imputadas valoradas. */
export function unbookedCostTotal(entries: readonly Utilization[]): Cents {
  return addCents(...entries.map((entry) => entry.unbookedCostCents));
}
