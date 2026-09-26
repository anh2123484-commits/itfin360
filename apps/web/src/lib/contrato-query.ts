import type { TenantDb } from '@itfin360/db';

import { CAMPOS_CONTRATO, type ContratoParaCalcular, resumenContratos } from '@/lib/contratos';

/**
 * La consulta de contratos, en un solo sitio.
 *
 * El reloj se lee aquí y no en la pantalla, por la misma razón que en las
 * invitaciones: un componente que mira la hora deja de ser una función de sus
 * datos, y lo que hay que poder probar es el cálculo, no el renderizado.
 */

export const LIMITE_POR_DEFECTO = 100;

export async function contratosConResumen(tx: TenantDb, ahora: Date = new Date()) {
  const filas = await tx.contract.findMany({
    select: CAMPOS_CONTRATO,
    orderBy: [{ status: 'asc' as const }, { name: 'asc' as const }],
    take: LIMITE_POR_DEFECTO,
  });

  const paraCalcular: ContratoParaCalcular[] = filas.map((fila) => ({
    id: fila.id,
    name: fila.name,
    amountCents: fila.amountCents,
    periodicity: fila.periodicity,
    currency: fila.currency,
    status: fila.status,
    renewalDate: fila.renewalDate,
    noticeDays: fila.noticeDays,
    licensedSeats: fila.licensedSeats,
    activeSeats: fila.activeSeats,
    previousAmountCents: fila.previousAmountCents,
    previousPeriodicity: fila.previousPeriodicity,
  }));

  const resumen = resumenContratos(paraCalcular, ahora);
  const porId = new Map(resumen.normalizados.map((n) => [n.id, n]));

  return {
    filas: filas.map((fila) => ({ ...fila, calculo: porId.get(fila.id) ?? null })),
    resumen,
  };
}

/** Proveedores para el desplegable del alta. Sin paginar: son pocos y hay que elegir uno. */
export function proveedoresParaElegir(tx: TenantDb) {
  return tx.vendor.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' as const },
    take: 500,
  });
}
