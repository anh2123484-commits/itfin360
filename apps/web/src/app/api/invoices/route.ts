import { InvoiceStatus } from '@itfin360/db';
import { type CivilDate, parseIsoDate } from '@itfin360/finance-core';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { esFechaIso } from '@/lib/fechas';
import { HttpError, parseJson, route } from '@/lib/http';
import {
  type FiltroFacturas,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  listarFacturas,
} from '@/lib/invoice-query';
import { altaDeFactura, esRechazo } from '@/lib/invoice-ops';
import { altaFactura } from '@/lib/invoices';
import { requireAnyPermission, requirePermission } from '@/lib/tenant-context';

/**
 * Alta y listado de facturas (F2-02).
 *
 * El alta no acepta el estado: toda factura nace en `DRAFT` y se mueve por
 * `POST /api/invoices/[id]/transition`. Si el cuerpo pudiera traer el estado,
 * se podría crear una factura ya aprobada sin que nadie la aprobara y sin el
 * apunte de auditoría de esa aprobación, que es justo lo que F2-02 exige.
 */

const filtros = z.object({
  status: z.enum(InvoiceStatus).optional(),
  vendorId: z.uuid().optional(),
  /** Rango sobre la fecha de **devengo**, que es la que manda para el periodo. */
  desde: z.string().optional(),
  hasta: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().positive().max(LIMITE_MAXIMO).optional(),
});

export const GET = route(async (request: Request) => {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = new URL(request.url).searchParams;
  const f = filtros.parse(Object.fromEntries(parametros));

  // La consulta vive en `@/lib/invoice-query`, compartida con la pantalla de
  // facturas. Si cada una armara sus filtros, la lista y el total dejarían de
  // decir lo mismo el día que cambie uno.
  const filtro: FiltroFacturas = {
    ...(f.status === undefined ? {} : { status: f.status }),
    ...(f.vendorId === undefined ? {} : { vendorId: f.vendorId }),
    ...(f.desde === undefined ? {} : { desde: fechaFiltro(f.desde, 'desde') }),
    ...(f.hasta === undefined ? {} : { hasta: fechaFiltro(f.hasta, 'hasta') }),
    ...(f.q === undefined ? {} : { numero: f.q }),
  };

  return db().withTenant(principal.tenantId, async (tx) =>
    NextResponse.json(
      await listarFacturas(tx, filtro, {
        limite: f.limit ?? LIMITE_POR_DEFECTO,
        ...(f.cursor === undefined ? {} : { cursor: f.cursor }),
      }),
    ),
  );
});

/**
 * Fecha de un filtro. Mal escrita es un 400, no un filtro ignorado: filtrar de
 * menos enseña un gasto que no es el real, y eso en una herramienta financiera
 * es peor que un error.
 */
function fechaFiltro(valor: string, nombre: string): CivilDate {
  if (!esFechaIso(valor)) throw new HttpError(400, `invalid_${nombre}`);
  return parseIsoDate(valor);
}

export const POST = route(async (request: Request) => {
  const principal = await requirePermission('invoices:create');
  const datos = await parseJson(request, altaFactura);

  return db().withTenant(principal.tenantId, async (tx) => {
    const resultado = await altaDeFactura(tx, principal, datos);

    if (esRechazo(resultado)) {
      // 422 y no 400 en el descuadre: el JSON está bien formado y bien tipado;
      // lo que no cuadra es la aritmética. Son dos errores distintos para quien
      // consume la API, y quien importa un CSV necesita distinguirlos.
      if (resultado.motivo === 'incoherente') {
        return NextResponse.json(
          { error: 'incoherent_invoice', issues: resultado.problemas },
          { status: 422 },
        );
      }
      if (resultado.motivo === 'proveedor_desconocido') {
        throw new HttpError(404, 'vendor_not_found');
      }
      return NextResponse.json(
        {
          error: 'invoice_duplicate',
          existingInvoiceId: resultado.existente.id,
          existingStatus: resultado.existente.status,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        id: resultado.id,
        invoiceNumber: resultado.invoiceNumber,
        status: resultado.status,
        grossCents: resultado.grossCents,
        currency: resultado.currency,
        lines: resultado.lineas,
      },
      { status: 201 },
    );
  });
});
