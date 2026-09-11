import { canEditInvoice } from '@itfin360/db';
import { cents, validateInvoice } from '@itfin360/finance-core';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { aFechaCivil, aInstanteUtc, aIso } from '@/lib/fechas';
import { HttpError, parseJson, route } from '@/lib/http';
import {
  conNumerosDeLinea,
  edicionFactura,
  facturaResultante,
  type FacturaGuardada,
  type LineaNumerada,
} from '@/lib/invoices';
import { requireAnyPermission, requirePermission } from '@/lib/tenant-context';

/**
 * Detalle y edición de una factura (F2-02).
 *
 * Sólo se edita en `DRAFT` y en `REJECTED`, que es lo que dice `canEditInvoice`.
 * Bajo revisión no: quien revisa tiene que estar mirando lo mismo que se le
 * mandó, y una factura que cambia mientras alguien la aprueba hace que esa
 * aprobación no signifique nada. Para corregir hay que rechazarla o devolverla
 * a borrador, y eso queda auditado.
 */

const CAMPOS = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  accrualDate: true,
  dueDate: true,
  serviceStart: true,
  serviceEnd: true,
  netCents: true,
  vatCents: true,
  grossCents: true,
  currency: true,
  fxRate: true,
  status: true,
  source: true,
  duplicateOfId: true,
  createdById: true,
  vendor: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      lineNumber: true,
      description: true,
      quantity: true,
      unitPriceCents: true,
      netCents: true,
      costType: true,
      concept: true,
    },
    orderBy: { lineNumber: 'asc' as const },
  },
} as const;

const CAMPOS_FECHA = ['issueDate', 'accrualDate', 'dueDate', 'serviceStart', 'serviceEnd'];

/**
 * `Decimal` de Prisma → número.
 *
 * `quantity` y `fxRate` son decimales porque una cantidad puede ser 2,5 horas y
 * un tipo de cambio tiene ocho decimales. El dinero no pasa por aquí: eso son
 * enteros de céntimos y lo seguirá siendo.
 */
function aNumero(valor: unknown): number {
  return Number(valor);
}

/** La factura guardada, en los términos en que el motor sabe razonar. */
function comoGuardada(fila: {
  netCents: number;
  vatCents: number;
  grossCents: number;
  currency: string;
  fxRate: unknown;
  issueDate: Date;
  dueDate: Date | null;
  serviceStart: Date | null;
  serviceEnd: Date | null;
  lines: readonly {
    lineNumber: number;
    description: string;
    quantity: unknown;
    unitPriceCents: number;
    netCents: number;
    costType: LineaNumerada['costType'];
    concept: LineaNumerada['concept'];
  }[];
}): FacturaGuardada {
  return {
    netCents: fila.netCents,
    vatCents: fila.vatCents,
    grossCents: fila.grossCents,
    currency: fila.currency,
    fxRate: fila.fxRate === null ? null : aNumero(fila.fxRate),
    issueDate: aFechaCivil(fila.issueDate),
    dueDate: fila.dueDate === null ? null : aFechaCivil(fila.dueDate),
    serviceStart: fila.serviceStart === null ? null : aFechaCivil(fila.serviceStart),
    serviceEnd: fila.serviceEnd === null ? null : aFechaCivil(fila.serviceEnd),
    lines: fila.lines.map((linea) => ({
      lineNumber: linea.lineNumber,
      description: linea.description,
      quantity: aNumero(linea.quantity),
      unitPriceCents: cents(linea.unitPriceCents),
      netCents: cents(linea.netCents),
      costType: linea.costType,
      concept: linea.concept,
    })),
  };
}

/** Las fechas salen como `YYYY-MM-DD`, nunca como instante con hora. */
function paraRespuesta(fila: object): Record<string, unknown> {
  const salida = { ...fila } as Record<string, unknown>;
  for (const campo of CAMPOS_FECHA) {
    const valor = salida[campo];
    salida[campo] = valor instanceof Date ? aIso(valor) : null;
  }
  const lineas = salida['lines'];
  if (Array.isArray(lineas)) {
    salida['lines'] = lineas.map((linea: Record<string, unknown>) => ({
      ...linea,
      quantity: aNumero(linea['quantity']),
    }));
  }
  return salida;
}

/**
 * Lo que puede ir en el apunte de auditoría, que es una columna JSON.
 *
 * Una fecha se lee mejor como día que como instante, y un `Decimal` de Prisma
 * no es JSON: se guarda su representación textual, que es exacta.
 */
type ValorAuditable = string | number | boolean | null;

function valorAuditable(valor: unknown): ValorAuditable {
  if (valor instanceof Date) return aIso(valor);
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return valor;
  }
  return String(valor);
}

export const GET = route(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);

    return db().withTenant(principal.tenantId, async (tx) => {
      const factura = await tx.invoice.findUnique({ where: { id }, select: CAMPOS });
      if (!factura) throw new HttpError(404, 'invoice_not_found');
      return NextResponse.json(paraRespuesta(factura));
    });
  },
);

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const principal = await requirePermission('invoices:create');
    const cambios = await parseJson(request, edicionFactura);

    return db().withTenant(principal.tenantId, async (tx) => {
      const actual = await tx.invoice.findUnique({ where: { id }, select: CAMPOS });
      if (!actual) throw new HttpError(404, 'invoice_not_found');

      if (!canEditInvoice(actual.status)) {
        return NextResponse.json(
          {
            error: 'invoice_not_editable',
            message: `Una factura en ${actual.status} no se edita. Sólo en borrador o tras un rechazo.`,
          },
          { status: 409 },
        );
      }

      const guardada = comoGuardada(actual);
      const lineas =
        cambios.lines === undefined ? guardada.lines : conNumerosDeLinea(cambios.lines);

      // Se valida el resultado, no el parche: cambiar sólo el IVA descuadra una
      // factura que estaba bien, y eso hay que verlo antes de escribir.
      const problemas = validateInvoice(facturaResultante(guardada, cambios, lineas));
      if (problemas.length > 0) {
        return NextResponse.json(
          { error: 'incoherent_invoice', issues: problemas },
          { status: 422 },
        );
      }

      if (cambios.vendorId !== undefined && cambios.vendorId !== actual.vendor.id) {
        const vendor = await tx.vendor.findUnique({
          where: { id: cambios.vendorId },
          select: { id: true },
        });
        if (!vendor) throw new HttpError(404, 'vendor_not_found');
      }

      // El número o el proveedor pueden haber cambiado hacia una pareja que ya
      // existe. Se mira antes de escribir, por lo mismo que en el alta: dejar
      // saltar el índice único abortaría la transacción y el 409 no podría
      // llevar la referencia a la factura que ya estaba.
      const vendorId = cambios.vendorId ?? actual.vendor.id;
      const invoiceNumber = cambios.invoiceNumber ?? actual.invoiceNumber;
      if (vendorId !== actual.vendor.id || invoiceNumber !== actual.invoiceNumber) {
        const choque = await tx.invoice.findFirst({
          where: { vendorId, invoiceNumber, NOT: { id } },
          select: { id: true, status: true },
        });
        if (choque) {
          return NextResponse.json(
            {
              error: 'invoice_duplicate',
              existingInvoiceId: choque.id,
              existingStatus: choque.status,
            },
            { status: 409 },
          );
        }
      }

      const data = {
        ...(cambios.vendorId === undefined ? {} : { vendorId: cambios.vendorId }),
        ...(cambios.invoiceNumber === undefined ? {} : { invoiceNumber: cambios.invoiceNumber }),
        ...(cambios.issueDate === undefined ? {} : { issueDate: aInstanteUtc(cambios.issueDate) }),
        ...(cambios.accrualDate === undefined
          ? {}
          : { accrualDate: aInstanteUtc(cambios.accrualDate) }),
        ...(cambios.dueDate === undefined
          ? {}
          : { dueDate: cambios.dueDate === null ? null : aInstanteUtc(cambios.dueDate) }),
        ...(cambios.serviceStart === undefined
          ? {}
          : {
              serviceStart:
                cambios.serviceStart === null ? null : aInstanteUtc(cambios.serviceStart),
            }),
        ...(cambios.serviceEnd === undefined
          ? {}
          : { serviceEnd: cambios.serviceEnd === null ? null : aInstanteUtc(cambios.serviceEnd) }),
        ...(cambios.netCents === undefined ? {} : { netCents: cambios.netCents }),
        ...(cambios.vatCents === undefined ? {} : { vatCents: cambios.vatCents }),
        ...(cambios.grossCents === undefined ? {} : { grossCents: cambios.grossCents }),
        ...(cambios.currency === undefined ? {} : { currency: cambios.currency }),
        ...(cambios.fxRate === undefined ? {} : { fxRate: cambios.fxRate }),
        // Las líneas se reemplazan enteras dentro de la misma transacción: en
        // ningún momento existe una factura con parte de las líneas nuevas y
        // parte de las viejas.
        ...(cambios.lines === undefined
          ? {}
          : {
              lines: {
                deleteMany: {},
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
            }),
      };

      const despues = await tx.invoice.update({ where: { id }, data, select: CAMPOS });

      // En la auditoría van los campos de cabecera que cambian, con su valor
      // anterior; de las líneas, cuántas había y cuántas hay. Volcar las líneas
      // enteras haría ilegible el historial de una factura de cien líneas.
      const previa = actual as unknown as Record<string, unknown>;
      const nueva = despues as unknown as Record<string, unknown>;
      const antes: Record<string, ValorAuditable> = {};
      const ahora: Record<string, ValorAuditable> = {};
      for (const campo of Object.keys(data)) {
        if (campo === 'lines') continue;
        antes[campo] = valorAuditable(previa[campo]);
        ahora[campo] = valorAuditable(nueva[campo]);
      }
      if (cambios.lines !== undefined) {
        antes['lines'] = actual.lines.length;
        ahora['lines'] = lineas.length;
      }

      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'invoice.updated',
          entity: 'invoice',
          entityId: id,
          before: antes,
          after: ahora,
        },
      });

      return NextResponse.json(paraRespuesta(despues));
    });
  },
);
