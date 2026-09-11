import { type CivilDate, parseIsoDate } from '@itfin360/finance-core';

/**
 * Fechas civiles guardadas en columnas `DateTime`.
 *
 * Una factura no ocurre en un instante: ocurre **un día**. El esquema las
 * guarda como `DateTime` porque Prisma no expone el `date` de PostgreSQL como
 * tipo propio, así que hay que elegir a qué hora de ese día apuntan, y la
 * elección no es inocente: `new Date('2026-03-31')` en un servidor configurado
 * en Madrid guarda el 30 a las 23:00 UTC, con lo que la factura del último día
 * de marzo cae en el gasto de febrero. Un descuadre de mes que sólo aparece en
 * los cierres y que nadie relaciona nunca con la zona horaria del servidor.
 *
 * Aquí se fija siempre la **medianoche UTC**, y la conversión vive en un solo
 * sitio. `finance-core` no toca `Date` en absoluto: la fecha civil entra y sale
 * como `YYYY-MM-DD` y el motor calcula con el algoritmo civil de Hinnant.
 */

/** Fecha civil → instante persistible. Medianoche UTC, sin excepción. */
export function aInstanteUtc(fecha: CivilDate): Date {
  return new Date(Date.UTC(fecha.year, fecha.month - 1, fecha.day));
}

/** Instante persistido → fecha civil. Se lee en UTC, igual que se escribió. */
export function aFechaCivil(instante: Date): CivilDate {
  return {
    year: instante.getUTCFullYear(),
    month: instante.getUTCMonth() + 1,
    day: instante.getUTCDate(),
  };
}

/** Instante persistido → `YYYY-MM-DD`, que es como viaja en las respuestas. */
export function aIso(instante: Date): string {
  const { year, month, day } = aFechaCivil(instante);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Si la cadena es una fecha civil válida. No lanza: sirve de guarda en zod. */
export function esFechaIso(valor: string): boolean {
  try {
    parseIsoDate(valor);
    return true;
  } catch {
    return false;
  }
}
