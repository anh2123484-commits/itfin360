import { CostType, SpendConcept } from '@itfin360/db';
import {
  cents,
  DEFAULT_BASE_CURRENCY,
  parseIsoDate,
  type ValidatableInvoice,
  type ValidatableInvoiceLine,
} from '@itfin360/finance-core';
import { z } from 'zod';

import { esFechaIso } from '@/lib/fechas';

/** Esquemas de factura y el puente hacia el motor de cálculo. */

/** `YYYY-MM-DD` → fecha civil. El motor no conoce `Date`; esto tampoco. */
export const FECHA_CIVIL = z
  .string()
  .trim()
  .refine(esFechaIso, 'fecha civil YYYY-MM-DD no válida')
  .transform(parseIsoDate);

/** Céntimos enteros. El dinero nunca viaja como decimal (regla dura 1). */
const CENTIMOS = z.number().int();

/** ISO 4217. Se normaliza a mayúsculas: `eur` y `EUR` son la misma divisa. */
const DIVISA = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'ISO 4217')
  .transform((valor) => valor.toUpperCase());

const lineaFactura = z.object({
  /** Opcional: si no viene, se numeran por orden de llegada. */
  lineNumber: z.number().int().positive().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().finite(),
  unitPriceCents: CENTIMOS,
  netCents: CENTIMOS,
  costType: z.enum(CostType),
  concept: z.enum(SpendConcept),
});

/** Línea tal y como llega en el cuerpo de la petición. */
export type LineaEntrante = z.infer<typeof lineaFactura>;

/**
 * Alta de factura.
 *
 * El estado no se acepta del cliente: toda factura nace en `DRAFT` y se mueve
 * por el flujo de aprobación (`POST /api/invoices/[id]/transition`). Dejar que
 * el alta eligiera estado permitiría crear una factura ya aprobada sin que
 * nadie la aprobara y sin apunte de auditoría de esa aprobación.
 */
export const altaFactura = z.object({
  vendorId: z.uuid(),
  invoiceNumber: z.string().trim().min(1).max(100),
  issueDate: FECHA_CIVIL,
  accrualDate: FECHA_CIVIL,
  dueDate: FECHA_CIVIL.optional(),
  serviceStart: FECHA_CIVIL.optional(),
  serviceEnd: FECHA_CIVIL.optional(),
  netCents: CENTIMOS,
  vatCents: CENTIMOS.default(0),
  grossCents: CENTIMOS,
  currency: DIVISA.default(DEFAULT_BASE_CURRENCY),
  fxRate: z.number().positive().optional(),
  lines: z.array(lineaFactura).min(1).max(500),
});

/** Factura validada que llega del cliente. */
export type FacturaEntrante = z.infer<typeof altaFactura>;

/**
 * Numera las líneas que no traen número.
 *
 * Quien teclea una factura no piensa en números de línea; quien importa un CSV
 * de un ERP sí los trae y hay que respetarlos, porque es lo que permite
 * reconciliar la importación con el origen.
 */
export function conNumerosDeLinea(lines: readonly LineaEntrante[]): LineaNumerada[] {
  return lines.map((linea, indice) => ({
    lineNumber: linea.lineNumber ?? indice + 1,
    description: linea.description,
    quantity: linea.quantity,
    unitPriceCents: cents(linea.unitPriceCents),
    netCents: cents(linea.netCents),
    costType: linea.costType,
    concept: linea.concept,
  }));
}

/** Línea ya numerada: lo que valida el motor, más el texto que guarda la base. */
export type LineaNumerada = ValidatableInvoiceLine & { readonly description: string };

/**
 * Traduce la factura entrante a lo que el motor sabe comprobar.
 *
 * `accrualDate` no aparece: el motor no la juzga, porque el devengo anterior a
 * la emisión es lo normal (el servicio de enero se factura en febrero).
 */
export function paraValidar(
  datos: FacturaEntrante,
  lineas: readonly ValidatableInvoiceLine[],
): ValidatableInvoice {
  return {
    netCents: cents(datos.netCents),
    vatCents: cents(datos.vatCents),
    grossCents: cents(datos.grossCents),
    currency: datos.currency,
    ...(datos.fxRate === undefined ? {} : { fxRate: datos.fxRate }),
    issueDate: datos.issueDate,
    ...(datos.dueDate === undefined ? {} : { dueDate: datos.dueDate }),
    ...(datos.serviceStart === undefined ? {} : { serviceStart: datos.serviceStart }),
    ...(datos.serviceEnd === undefined ? {} : { serviceEnd: datos.serviceEnd }),
    lines: lineas,
  };
}
