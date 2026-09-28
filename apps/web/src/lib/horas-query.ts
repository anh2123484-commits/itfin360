import type { TenantDb } from '@itfin360/db';

import {
  CAMPOS_IMPUTACION,
  type ImputacionParaValidar,
  jornadaDiaria,
  resumenHoras,
} from '@/lib/horas';

/**
 * Consultas de imputación. La semana se calcula aquí y no en la pantalla, por
 * lo de siempre: un componente que mira el calendario no se puede probar.
 */

export const LIMITE_POR_DEFECTO = 500;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Lunes de la semana de esa fecha, en UTC. */
export function lunesDe(fecha: Date): Date {
  const dia = fecha.getUTCDay();
  const desplazamiento = dia === 0 ? 6 : dia - 1;
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - desplazamiento),
  );
}

/** Días de lunes a viernes entre dos fechas, los dos extremos incluidos. */
export function laborablesEntre(desde: Date, hasta: Date): number {
  let dias = 0;
  for (let t = desde.getTime(); t <= hasta.getTime(); t += DIA_MS) {
    const dia = new Date(t).getUTCDay();
    if (dia !== 0 && dia !== 6) dias += 1;
  }
  return dias;
}

/** Las imputaciones de un empleado en un día, para validar una nueva. */
export async function imputacionesDelDia(
  tx: TenantDb,
  employeeId: string,
  fecha: Date,
): Promise<ImputacionParaValidar[]> {
  const filas = await tx.timeEntry.findMany({
    where: { employeeId, entryDate: fecha },
    select: { id: true, minutes: true, startMinute: true, isOvertime: true, activity: true },
  });
  return filas.map((fila) => ({
    id: fila.id,
    minutes: fila.minutes,
    startMinute: fila.startMinute,
    isOvertime: fila.isOvertime,
    activity: fila.activity,
  }));
}

/**
 * La semana de imputación con su resumen.
 *
 * Las horas disponibles son la jornada de cada persona por los días laborables
 * de la semana. No descuenta festivos ni vacaciones: eso necesita el calendario
 * del tenant, que es F4-03. Mientras tanto la utilización de una semana con un
 * festivo dentro sale baja, y es mejor que salga baja y se sepa por qué que
 * inventarse un calendario.
 */
export async function semanaDeImputacion(
  tx: TenantDb,
  ahora: Date = new Date(),
  desdeParametro?: Date,
) {
  const desde = desdeParametro ?? lunesDe(ahora);
  const hasta = new Date(desde.getTime() + 6 * DIA_MS);

  const filas = await tx.timeEntry.findMany({
    where: { entryDate: { gte: desde, lte: hasta } },
    select: CAMPOS_IMPUTACION,
    orderBy: [{ entryDate: 'asc' as const }, { startMinute: 'asc' as const }],
    take: LIMITE_POR_DEFECTO,
  });

  const plantilla = await tx.employee.findMany({
    where: { OR: [{ terminationDate: null }, { terminationDate: { gte: desde } }] },
    select: { id: true, fullName: true, fteBp: true },
    orderBy: { fullName: 'asc' as const },
    take: 500,
  });

  const laborables = laborablesEntre(desde, hasta);
  const minutosDisponibles = plantilla.reduce(
    (total, persona) => total + jornadaDiaria(persona.fteBp) * laborables,
    0,
  );

  const entradas = filas.map((fila) => ({
    minutes: fila.minutes,
    startMinute: fila.startMinute,
    isOvertime: fila.isOvertime,
    activity: fila.activity,
    isRework: fila.isRework,
    isBillable: fila.isBillable,
  }));

  return {
    desde,
    hasta,
    laborables,
    filas,
    plantilla,
    resumen: resumenHoras(entradas, minutosDisponibles / 60),
  };
}
