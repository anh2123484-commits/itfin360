/**
 * Devengo de facturas (F1-02, `docs/02-modelo-financiero.md` §1.2).
 *
 * Una factura de soporte anual pagada en enero no es gasto de enero: es gasto
 * de doce meses. Sin este reparto, el coste por servicio de enero se dispara y
 * el de los once meses siguientes miente por defecto.
 */
import { monthKey, monthlyDayCounts, parseIsoDate } from './dates.js';
import { allocateByLargestRemainder, type Cents } from './money.js';

/** Periodo de prestación del servicio, ambos extremos incluidos. */
export interface ServicePeriod {
  /** `YYYY-MM-DD`. */
  readonly start: string;
  /** `YYYY-MM-DD`. */
  readonly end: string;
}

/** Factura a devengar. */
export interface AccrualInput {
  /** Base imponible en céntimos. Puede ser negativa en una rectificativa. */
  readonly totalCents: Cents;
  /** Fecha de devengo, `YYYY-MM-DD`. Decide el mes cuando no hay periodo. */
  readonly accrualDate: string;
  /** Si la factura cubre un periodo, el importe se reparte por días naturales. */
  readonly servicePeriod?: ServicePeriod;
}

/** Importe devengado en un mes. */
export interface AccrualEntry {
  /** `YYYY-MM`. */
  readonly period: string;
  readonly cents: Cents;
}

/**
 * Reparte el importe por días naturales entre los meses del periodo de
 * servicio. Sin periodo, todo devenga en el mes de `accrualDate`.
 *
 * La suma de los tramos es **exactamente** el importe de la factura: el reparto
 * usa el método del mayor resto, no un redondeo por mes.
 */
export function accrualSpread(input: AccrualInput): AccrualEntry[] {
  const accrualDate = parseIsoDate(input.accrualDate);

  if (input.servicePeriod === undefined) {
    return [{ period: monthKey(accrualDate), cents: input.totalCents }];
  }

  const start = parseIsoDate(input.servicePeriod.start);
  const end = parseIsoDate(input.servicePeriod.end);
  const tramos = monthlyDayCounts(start, end);
  const importes = allocateByLargestRemainder(
    input.totalCents,
    tramos.map((tramo) => tramo.days),
  );

  return tramos.map((tramo, index) => ({
    period: tramo.period,
    cents: importes[index] ?? (0 as Cents),
  }));
}

/** Total devengado en un mes concreto, sumando varias facturas ya repartidas. */
export function accruedInPeriod(entries: readonly AccrualEntry[], period: string): Cents {
  return entries
    .filter((entry) => entry.period === period)
    .reduce<Cents>((total, entry) => (total + entry.cents) as Cents, 0 as Cents);
}
