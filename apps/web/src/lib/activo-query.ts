import type { TenantDb } from '@itfin360/db';

import { type ActivoParaCalcular, CAMPOS_ACTIVO, resumenActivos } from '@/lib/activos';

/** La consulta de inmovilizado. El reloj se lee aquí, no en la pantalla. */

export const LIMITE_POR_DEFECTO = 200;

export async function activosConResumen(tx: TenantDb, ahora: Date = new Date()) {
  const filas = await tx.asset.findMany({
    select: CAMPOS_ACTIVO,
    orderBy: [{ inServiceDate: 'desc' as const }, { name: 'asc' as const }],
    take: LIMITE_POR_DEFECTO,
  });

  const paraCalcular: ActivoParaCalcular[] = filas.map((fila) => ({
    id: fila.id,
    acquisitionCents: fila.acquisitionCents,
    residualCents: fila.residualCents,
    usefulLifeMonths: fila.usefulLifeMonths,
    inServiceDate: fila.inServiceDate,
    status: fila.status,
    catalogPriceCents: fila.catalogPriceCents,
    hasBudgetLine: fila.hasBudgetLine,
  }));

  const resumen = resumenActivos(paraCalcular, ahora);
  const porId = new Map(resumen.calculados.map((c) => [c.id, c]));

  return {
    filas: filas.map((fila) => ({ ...fila, calculo: porId.get(fila.id) ?? null })),
    resumen,
  };
}
