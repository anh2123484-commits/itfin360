import { InvoiceStatus } from '@itfin360/db';
import { type CivilDate, parseIsoDate, validateInvoice } from '@itfin360/finance-core';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { aInstanteUtc, esFechaIso } from '@/lib/fechas';
import { HttpError, parseJson, route } from '@/lib/http';
import {
  type FiltroFacturas,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  listarFacturas,
} from '@/lib/invoice-query';
import { altaFactura, conNumerosDeLinea, paraValidar } from '@/lib/invoices';
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
  const lineas = conNumerosDeLinea(datos.lines);

  // El motor decide si la factura cuadra. 422 y no 400: el JSON está bien
  // formado y bien tipado; lo que no cuadra es la aritmética.
  const problemas = validateInvoice(paraValidar(datos, lineas));
  if (problemas.length > 0) {
    return NextResponse.json({ error: 'incoherent_invoice', issues: problemas }, { status: 422 });
  }

  return db().withTenant(principal.tenantId, async (tx) => {
    // RLS hace que un proveedor de otro tenant no se vea: sin esta consulta, la
    // clave ajena reventaría la transacción y saldría un 500 en vez de un 404.
    const vendor = await tx.vendor.findUnique({
      where: { id: datos.vendorId },
      select: { id: true },
    });
    if (!vendor) throw new HttpError(404, 'vendor_not_found');

    // Duplicado exacto (F2-03): mismo proveedor y mismo número. Se comprueba
    // antes de insertar para poder decir **cuál** es la factura que ya existe;
    // dejar que saltara el índice único abortaría la transacción y el 409 no
    // podría llevar la referencia.
    const existente = await tx.invoice.findFirst({
      where: { vendorId: datos.vendorId, invoiceNumber: datos.invoiceNumber },
      select: { id: true, status: true },
    });
    if (existente) {
      return NextResponse.json(
        {
          error: 'invoice_duplicate',
          existingInvoiceId: existente.id,
          existingStatus: existente.status,
        },
        { status: 409 },
      );
    }

    const factura = await tx.invoice.create({
      data: {
        tenantId: principal.tenantId,
        vendorId: datos.vendorId,
        invoiceNumber: datos.invoiceNumber,
        issueDate: aInstanteUtc(datos.issueDate),
        accrualDate: aInstanteUtc(datos.accrualDate),
        dueDate: datos.dueDate === undefined ? null : aInstanteUtc(datos.dueDate),
        serviceStart: datos.serviceStart === undefined ? null : aInstanteUtc(datos.serviceStart),
        serviceEnd: datos.serviceEnd === undefined ? null : aInstanteUtc(datos.serviceEnd),
        netCents: datos.netCents,
        vatCents: datos.vatCents,
        grossCents: datos.grossCents,
        currency: datos.currency,
        fxRate: datos.fxRate ?? null,
        status: 'DRAFT',
        source: 'MANUAL',
        createdById: principal.userId,
        lines: {
          create: lineas.map((linea) => ({
            tenantId: principal.tenantId,
            lineNumber: linea.lineNumber,
            description: linea.description,
            quantity: linea.quantity,
            unitPriceCents: linea.unitPriceCents,
            netCents: linea.netCents,
            costType: linea.costType,
            concept: linea.concept,
          })),
        },
      },
      select: { id: true, invoiceNumber: true, status: true, grossCents: true, currency: true },
    });

    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'invoice.created',
        entity: 'invoice',
        entityId: factura.id,
        after: {
          status: factura.status,
          invoiceNumber: factura.invoiceNumber,
          grossCents: factura.grossCents,
          currency: factura.currency,
          lines: lineas.length,
        },
      },
    });

    return NextResponse.json({ ...factura, lines: lineas.length }, { status: 201 });
  });
});
