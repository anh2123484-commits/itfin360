import { InvoiceSource, type TenantDb } from '@itfin360/db';
import { type InvoiceIssue, validateInvoice } from '@itfin360/finance-core';

import { aInstanteUtc } from '@/lib/fechas';
import { conNumerosDeLinea, type FacturaEntrante, paraValidar } from '@/lib/invoices';
import type { Principal } from '@/lib/permissions';

/**
 * El alta de una factura, en un solo sitio.
 *
 * La usan `POST /api/invoices` y el formulario de la pantalla. Con el alta
 * escrita dos veces, una de las dos acabaría aceptando lo que la otra rechaza,
 * y la que se quedaría corta sería siempre la que nadie mira.
 *
 * Devuelve el rechazo en vez de lanzarlo: quien llama decide si eso es un 422 o
 * un mensaje en rojo debajo del formulario.
 *
 * El origen entra por parámetro porque la misma función da de alta lo que se
 * teclea y lo que se importa de un fichero, y al auditar una factura importa
 * saber por dónde entró: una factura que nadie tecleó se revisa de otra manera.
 */

/**
 * Por dónde entró la factura.
 *
 * El tipo se deriva del enum del esquema en vez de escribir la unión a mano:
 * así no puede quedarse atrás cuando se añada un origen nuevo, y el conector de
 * ERP no tendrá que acordarse de tocar este fichero.
 */
export type OrigenFactura = (typeof InvoiceSource)[keyof typeof InvoiceSource];

/** Por qué no se ha dado de alta. */
export type RechazoAlta =
  | { readonly motivo: 'incoherente'; readonly problemas: readonly InvoiceIssue[] }
  | { readonly motivo: 'proveedor_desconocido' }
  | {
      readonly motivo: 'duplicada';
      readonly existente: { readonly id: string; readonly status: string };
    };

/** Lo que ha quedado guardado. */
export interface FacturaCreada {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly status: string;
  readonly grossCents: number;
  readonly currency: string;
  readonly lineas: number;
}

/** Si el resultado es un rechazo. */
export function esRechazo(resultado: FacturaCreada | RechazoAlta): resultado is RechazoAlta {
  return 'motivo' in resultado;
}

export async function altaDeFactura(
  tx: TenantDb,
  principal: Principal,
  datos: FacturaEntrante,
  origen: OrigenFactura = 'MANUAL',
): Promise<FacturaCreada | RechazoAlta> {
  const lineas = conNumerosDeLinea(datos.lines);

  // El motor decide si la factura cuadra, antes de tocar nada.
  const problemas = validateInvoice(paraValidar(datos, lineas));
  if (problemas.length > 0) return { motivo: 'incoherente', problemas };

  // RLS hace que un proveedor de otro tenant no se vea: sin esta consulta, la
  // clave ajena reventaría la transacción y saldría un 500 en vez de un 404.
  const vendor = await tx.vendor.findUnique({
    where: { id: datos.vendorId },
    select: { id: true },
  });
  if (!vendor) return { motivo: 'proveedor_desconocido' };

  // Duplicado exacto (F2-03): mismo proveedor y mismo número. Se comprueba
  // antes de insertar para poder decir **cuál** es la factura que ya existe;
  // dejar que saltara el índice único abortaría la transacción y entonces el
  // rechazo no podría llevar la referencia.
  const existente = await tx.invoice.findFirst({
    where: { vendorId: datos.vendorId, invoiceNumber: datos.invoiceNumber },
    select: { id: true, status: true },
  });
  if (existente) return { motivo: 'duplicada', existente };

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
      // El estado no se acepta de fuera: toda factura nace en borrador y se
      // mueve por el flujo de aprobación, que es lo que deja el rastro.
      status: 'DRAFT',
      source: origen,
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
        source: origen,
        invoiceNumber: factura.invoiceNumber,
        grossCents: factura.grossCents,
        currency: factura.currency,
        lines: lineas.length,
      },
    },
  });

  return { ...factura, lineas: lineas.length };
}
