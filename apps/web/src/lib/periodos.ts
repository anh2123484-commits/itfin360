import type { CivilDate } from '@itfin360/finance-core';

/**
 * Periodos de gasto: el mes natural y sus fronteras (F2-05).
 *
 * Funciones puras sobre fechas civiles, sin `Date` en ningún sitio. Es la misma
 * regla que en el resto del proyecto y por el mismo motivo: `new Date('2026-03-01')`
 * en un servidor configurado al oeste de Greenwich devuelve el 28 de febrero, y
 * un periodo que empieza un día antes se lleva el gasto del mes anterior.
 */

/** Un mes natural, identificado por año y número de mes. */
export interface Mes {
  readonly anio: number;
  readonly mes: number;
}

/** Rango cerrado de fechas civiles. */
export interface Periodo {
  readonly desde: CivilDate;
  readonly hasta: CivilDate;
}

const NOMBRES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Si el año es bisiesto, con la regla completa (1900 no lo fue; 2000 sí). */
function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** Días que tiene un mes. */
export function diasDelMes({ anio, mes }: Mes): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** Si el mes existe. Sirve de guarda antes de fiarse de lo que viene en la URL. */
export function esMesValido({ anio, mes }: Mes): boolean {
  return (
    Number.isInteger(anio) &&
    Number.isInteger(mes) &&
    anio >= 1970 &&
    anio <= 9999 &&
    mes >= 1 &&
    mes <= 12
  );
}

/** Primer y último día del mes, ambos incluidos. */
export function periodoDelMes(mes: Mes): Periodo {
  return {
    desde: { year: mes.anio, month: mes.mes, day: 1 },
    hasta: { year: mes.anio, month: mes.mes, day: diasDelMes(mes) },
  };
}

/** El mes anterior, cruzando el año cuando toca. */
export function mesAnterior({ anio, mes }: Mes): Mes {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/** El mismo mes del año pasado, para comparar contra la referencia estacional. */
export function mismoMesAnoAnterior({ anio, mes }: Mes): Mes {
  return { anio: anio - 1, mes };
}

/** `2026-03`, que es como viaja en la URL. */
export function textoMes({ anio, mes }: Mes): string {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
}

/** Lee `2026-03`. Devuelve `null` si no es un mes, en vez de inventarse uno. */
export function parsearMes(texto: string): Mes | null {
  const partes = /^(\d{4})-(\d{1,2})$/.exec(texto.trim());
  if (partes === null) return null;
  const candidato = { anio: Number(partes[1]), mes: Number(partes[2]) };
  return esMesValido(candidato) ? candidato : null;
}

/** `marzo de 2026`. */
export function nombreMes({ anio, mes }: Mes): string {
  return `${NOMBRES[mes - 1] ?? ''} de ${anio}`;
}

/**
 * El mes al que pertenece un instante, leído en UTC.
 *
 * Se lee en UTC porque las fechas se persisten a medianoche UTC (ver
 * `lib/fechas.ts`). Leerlo en la hora local del servidor haría que el último día
 * del mes cayera en el mes anterior según dónde esté desplegado.
 */
export function mesDe(instante: Date): Mes {
  return { anio: instante.getUTCFullYear(), mes: instante.getUTCMonth() + 1 };
}
