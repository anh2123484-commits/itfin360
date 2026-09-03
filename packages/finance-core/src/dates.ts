/**
 * Aritmética de fechas civiles, sin husos horarios y sin `Date.now()`.
 *
 * El devengo se reparte por días naturales, así que la cuenta tiene que ser
 * exacta y reproducible: un `new Date('2026-01-15')` interpretado en otro huso
 * mueve un día el reparto y descuadra el mes.
 */

/** Fecha civil, tal cual se escribe. */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MESES_DE_30 = new Set([4, 6, 9, 11]);

/** Año bisiesto según el calendario gregoriano. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Días del mes indicado (1–12). */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Mes fuera de rango: ${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MESES_DE_30.has(month) ? 30 : 31;
}

/** Interpreta una fecha `YYYY-MM-DD` y comprueba que exista en el calendario. */
export function parseIsoDate(value: string): CivilDate {
  const match = ISO_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError(`Fecha no válida, se espera YYYY-MM-DD: ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new RangeError(`Mes fuera de rango en ${value}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Día fuera de rango en ${value}`);
  }
  return { year, month, day };
}

/**
 * Días transcurridos desde el 1970-01-01, con el algoritmo de Howard Hinnant.
 * Es entero puro: sin `Date`, sin husos y sin sorpresas en los cambios de hora.
 */
export function toEpochDay(date: CivilDate): number {
  const year = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const shifted = date.month + (date.month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shifted + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Orden cronológico: negativo, cero o positivo. */
export function compareDates(a: CivilDate, b: CivilDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** Clave de periodo mensual, `YYYY-MM`. */
export function monthKey(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}`;
}

/** Primer día del mes siguiente. */
export function startOfNextMonth(date: CivilDate): CivilDate {
  return date.month === 12
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: date.month + 1, day: 1 };
}

/**
 * Días naturales de cada mes que caen dentro de `[start, end]`, ambos incluidos.
 * Devuelve un tramo por mes tocado, en orden cronológico.
 */
export function monthlyDayCounts(
  start: CivilDate,
  end: CivilDate,
): { readonly period: string; readonly days: number }[] {
  if (compareDates(start, end) > 0) {
    throw new RangeError('El periodo de servicio termina antes de empezar.');
  }
  const tramos: { period: string; days: number }[] = [];
  let cursor: CivilDate = start;
  const lastDay = toEpochDay(end);

  while (toEpochDay(cursor) <= lastDay) {
    const monthEndDay = daysInMonth(cursor.year, cursor.month);
    const monthEnd: CivilDate = { year: cursor.year, month: cursor.month, day: monthEndDay };
    const tramoEnd = compareDates(monthEnd, end) <= 0 ? monthEnd : end;
    tramos.push({
      period: monthKey(cursor),
      days: toEpochDay(tramoEnd) - toEpochDay(cursor) + 1,
    });
    cursor = startOfNextMonth(cursor);
  }
  return tramos;
}

/** Suma meses a una fecha civil, recortando el día al último del mes destino. */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/**
 * Meses **completos** transcurridos entre dos fechas. Del 15/03 al 14/04 hay 0
 * meses; del 15/03 al 15/04, uno. Es la edad que decide si un activo ha vencido.
 */
export function monthsBetween(from: CivilDate, to: CivilDate): number {
  const brutos = (to.year - from.year) * 12 + (to.month - from.month);
  return to.day < from.day ? brutos - 1 : brutos;
}
