import type { InvoiceStatus, TenantDb } from '@itfin360/db';
import type { CivilDate } from '@itfin360/finance-core';

import { aInstanteUtc, aIso } from '@/lib/fechas';

/**
 * La consulta de facturas, en un solo sitio.
 *
 * La usan la API y la pantalla. Si cada una armara sus filtros, el día que
 * cambie uno la lista y el total dejarían de decir lo mismo, y en una
 * herramienta financiera dos cifras que no cuadran valen menos que ninguna.
 */

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 100;

/** Filtros ya validados. Las fechas entran como fecha civil, no como instante. */
export interface FiltroFacturas {
  readonly status?: InvoiceStatus | undefined;
  readonly vendorId?: string | undefined;
  /** Rango sobre el **devengo**, que es la fecha que decide el periodo. */
  readonly desde?: CivilDate | undefined;
  readonly hasta?: CivilDate | undefined;
  readonly numero?: string | undefined;
}

/** Condición de Prisma correspondiente al filtro. */
export function whereDeFacturas(filtro: FiltroFacturas) {
  const rango = {
    ...(filtro.desde === undefined ? {} : { gte: aInstanteUtc(filtro.desde) }),
    ...(filtro.hasta === undefined ? {} : { lte: aInstanteUtc(filtro.hasta) }),
  };
  return {
    ...(filtro.status === undefined ? {} : { status: filtro.status }),
    ...(filtro.vendorId === undefined ? {} : { vendorId: filtro.vendorId }),
    ...(Object.keys(rango).length === 0 ? {} : { accrualDate: rango }),
    ...(filtro.numero === undefined || filtro.numero === ''
      ? {}
      : { invoiceNumber: { contains: filtro.numero, mode: 'insensitive' as const } }),
  };
}

/** Columnas de la lista. Ni líneas ni extracción: eso es el detalle. */
export const CAMPOS_LISTA = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  accrualDate: true,
  netCents: true,
  vatCents: true,
  grossCents: true,
  currency: true,
  status: true,
  vendor: { select: { id: true, name: true } },
} as const;

/** Página de facturas y el cursor de la siguiente, si la hay. */
export async function listarFacturas(
  tx: TenantDb,
  filtro: FiltroFacturas,
  opciones: { readonly limite: number; readonly cursor?: string | undefined },
) {
  const encontradas = await tx.invoice.findMany({
    where: whereDeFacturas(filtro),
    select: CAMPOS_LISTA,
    // Por devengo descendente, que es como se mira el gasto; el `id` desempata
    // para que el orden sea total y el cursor no salte filas cuando varias
    // facturas comparten día.
    orderBy: [{ accrualDate: 'desc' as const }, { id: 'desc' as const }],
    take: opciones.limite + 1,
    ...(opciones.cursor === undefined ? {} : { cursor: { id: opciones.cursor }, skip: 1 }),
  });

  const hayMas = encontradas.length > opciones.limite;
  const pagina = hayMas ? encontradas.slice(0, opciones.limite) : encontradas;
  return {
    items: pagina.map((factura) => ({
      ...factura,
      issueDate: aIso(factura.issueDate),
      accrualDate: aIso(factura.accrualDate),
    })),
    nextCursor: hayMas ? (pagina.at(-1)?.id ?? null) : null,
  };
}

/**
 * Totales del filtro completo, **agrupados por divisa**.
 *
 * Nunca una sola cifra: sumar euros con dólares da un número que no significa
 * nada y que además parece correcto. Si el tenant tiene facturas en dos
 * divisas, salen dos líneas. La conversión a la divisa de contabilización usa
 * el tipo persistido de cada factura y es otra pregunta, de F6.
 *
 * El total es del filtro entero, no de la página: si sólo sumara lo que se ve,
 * cambiar de página cambiaría el total y nadie sabría cuál es el bueno.
 */
export async function totalesPorDivisa(tx: TenantDb, filtro: FiltroFacturas) {
  const grupos = await tx.invoice.groupBy({
    by: ['currency'],
    where: whereDeFacturas(filtro),
    _sum: { netCents: true, vatCents: true, grossCents: true },
    _count: { _all: true },
  });

  return grupos
    .map((grupo) => ({
      currency: grupo.currency,
      facturas: grupo._count._all,
      netCents: grupo._sum.netCents ?? 0,
      vatCents: grupo._sum.vatCents ?? 0,
      grossCents: grupo._sum.grossCents ?? 0,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
