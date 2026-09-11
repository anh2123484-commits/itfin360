import { CostType, SpendConcept } from '@itfin360/db';
import {
  cents,
  type CivilDate,
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
 * Edición de factura.
 *
 * Todo opcional, pero el cuerpo vacío se rechaza: un PATCH que no cambia nada
 * dejaría un apunte de auditoría mintiendo. `null` en un campo opcional lo
 * borra, que es distinto de no mandarlo; sin esa distinción no habría forma de
 * quitar un vencimiento puesto por error.
 *
 * `lines` se reemplaza entero, no se parchea línea a línea. Parchear líneas
 * sueltas obliga a que el cliente lleve la cuenta de los identificadores y
 * abre la puerta a dejar la factura descuadrada a mitad de camino; aquí entra
 * el juego completo y se valida el resultado antes de escribir nada.
 */
export const edicionFactura = z
  .object({
    vendorId: z.uuid().optional(),
    invoiceNumber: z.string().trim().min(1).max(100).optional(),
    issueDate: FECHA_CIVIL.optional(),
    accrualDate: FECHA_CIVIL.optional(),
    dueDate: FECHA_CIVIL.nullable().optional(),
    serviceStart: FECHA_CIVIL.nullable().optional(),
    serviceEnd: FECHA_CIVIL.nullable().optional(),
    netCents: CENTIMOS.optional(),
    vatCents: CENTIMOS.optional(),
    grossCents: CENTIMOS.optional(),
    currency: DIVISA.optional(),
    fxRate: z.number().positive().nullable().optional(),
    lines: z.array(lineaFactura).min(1).max(500).optional(),
  })
  .refine((valor) => Object.keys(valor).length > 0, { message: 'sin cambios' });

/** Cambios validados que llegan del cliente. */
export type CambiosFactura = z.infer<typeof edicionFactura>;

/** La factura como está guardada, en los términos del motor. */
export interface FacturaGuardada {
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
  readonly currency: string;
  readonly fxRate: number | null;
  readonly issueDate: CivilDate;
  readonly dueDate: CivilDate | null;
  readonly serviceStart: CivilDate | null;
  readonly serviceEnd: CivilDate | null;
  readonly lines: readonly LineaNumerada[];
}

/** `null` borra, `undefined` deja como estaba. */
function resuelve<T>(cambio: T | null | undefined, actual: T | null): T | undefined {
  if (cambio === undefined) return actual ?? undefined;
  return cambio ?? undefined;
}

/**
 * La factura **tal y como quedaría** tras aplicar los cambios.
 *
 * Se valida el resultado, no el parche: cambiar sólo el IVA puede descuadrar
 * una factura que estaba bien, y eso hay que verlo antes de escribir.
 */
export function facturaResultante(
  actual: FacturaGuardada,
  cambios: CambiosFactura,
  lineas: readonly LineaNumerada[],
): ValidatableInvoice {
  const fx = resuelve(cambios.fxRate, actual.fxRate);
  const vence = resuelve(cambios.dueDate, actual.dueDate);
  const desde = resuelve(cambios.serviceStart, actual.serviceStart);
  const hasta = resuelve(cambios.serviceEnd, actual.serviceEnd);

  return {
    netCents: cents(cambios.netCents ?? actual.netCents),
    vatCents: cents(cambios.vatCents ?? actual.vatCents),
    grossCents: cents(cambios.grossCents ?? actual.grossCents),
    currency: cambios.currency ?? actual.currency,
    ...(fx === undefined ? {} : { fxRate: fx }),
    issueDate: cambios.issueDate ?? actual.issueDate,
    ...(vence === undefined ? {} : { dueDate: vence }),
    ...(desde === undefined ? {} : { serviceStart: desde }),
    ...(hasta === undefined ? {} : { serviceEnd: hasta }),
    lines: lineas,
  };
}

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
