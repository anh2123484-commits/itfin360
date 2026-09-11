/**
 * Coherencia de una factura y sus líneas (F2-02).
 *
 * Una factura que no cuadra consigo misma envenena todo lo que viene después:
 * el gasto del periodo, el consumo de presupuesto, el coste de servicio y el
 * Viability Score. Por eso la comprobación vive aquí, en una función pura, y no
 * en el formulario: el alta manual, la importación de CSV y el conector de ERP
 * tienen que aplicar exactamente las mismas reglas, y sólo una de las tres pasa
 * por una pantalla.
 *
 * Devuelve la lista de problemas en vez de lanzar. Es la misma decisión que en
 * `validateLineConcept`: esto se ejecuta al teclear una factura y al importar
 * cinco mil filas, y ahí hace falta señalar la fila, no abortar la importación.
 */

import { type ConceptIssue, type ValidatableLine, validateLineConcept } from './concepts.js';
import { type CivilDate, compareDates } from './dates.js';
import { type Cents, cents, roundHalfUp } from './money.js';

/**
 * Qué puede estar mal en una factura.
 *
 * No aparecen aquí cosas que la base ya impide (unicidad de
 * `(tenant, proveedor, número)`) ni cosas que son decisión de una persona (el
 * duplicado difuso). Esto es sólo aritmética y coherencia interna.
 */
export type InvoiceIssueCode =
  | 'NO_LINES'
  | 'DUPLICATE_LINE_NUMBER'
  | 'INVALID_QUANTITY'
  | 'LINE_NET_MISMATCH'
  | 'NET_MISMATCH'
  | 'GROSS_MISMATCH'
  | 'VAT_SIGN_MISMATCH'
  | 'DUE_BEFORE_ISSUE'
  | 'SERVICE_PERIOD_REVERSED'
  | 'FX_RATE_MISSING'
  | 'FX_RATE_NOT_POSITIVE'
  | 'FX_RATE_ON_BASE_CURRENCY';

/** Un problema, con la línea en la que está si es de línea. */
export interface InvoiceIssue {
  readonly code: InvoiceIssueCode | ConceptIssue['code'];
  /** Número de línea, o `undefined` si el problema es de la cabecera. */
  readonly lineNumber?: number | undefined;
  readonly message: string;
}

/**
 * Lo que hace falta saber de una línea para comprobar que cuadra.
 *
 * Extiende `ValidatableLine` para que el concepto se valide con la misma
 * función que usa el resto del motor: una sola definición de qué encaja con qué.
 */
export interface ValidatableInvoiceLine extends ValidatableLine {
  readonly lineNumber: number;
  readonly quantity: number;
  readonly unitPriceCents: Cents;
  readonly netCents: Cents;
}

/** Lo que hace falta saber de la cabecera. */
export interface ValidatableInvoice {
  readonly netCents: Cents;
  readonly vatCents: Cents;
  readonly grossCents: Cents;
  /** ISO 4217 en mayúsculas, tal y como se persiste. */
  readonly currency: string;
  /** Tipo aplicado para llevar la factura a la divisa del tenant. */
  readonly fxRate?: number | undefined;
  readonly issueDate: CivilDate;
  readonly dueDate?: CivilDate | undefined;
  readonly serviceStart?: CivilDate | undefined;
  readonly serviceEnd?: CivilDate | undefined;
  readonly lines: readonly ValidatableInvoiceLine[];
}

/** Contexto del tenant que hace falta para juzgar la divisa. */
export interface InvoiceValidationOptions {
  /** Divisa de contabilización del tenant. Por defecto, euro. */
  readonly baseCurrency?: string | undefined;
}

/** Divisa de contabilización por defecto. */
export const DEFAULT_BASE_CURRENCY = 'EUR';

/**
 * Importe neto de una línea a partir de cantidad y precio unitario.
 *
 * El redondeo ocurre **una sola vez**, aquí, y no dentro del precio unitario.
 * Multiplicar precios ya redondeados por cantidades grandes es la forma
 * habitual de que una factura de mil líneas acabe descuadrada en euros.
 */
export function lineNetCents(quantity: number, unitPriceCents: Cents): Cents {
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`Cantidad no finita: ${quantity}`);
  }
  return roundHalfUp(quantity * unitPriceCents);
}

/** Suma de los netos de las líneas. */
export function linesNetCents(lines: readonly ValidatableInvoiceLine[]): Cents {
  return cents(lines.reduce<number>((total, line) => total + line.netCents, 0));
}

function issue(code: InvoiceIssue['code'], message: string, lineNumber?: number): InvoiceIssue {
  return lineNumber === undefined ? { code, message } : { code, lineNumber, message };
}

/** Signo de un importe: −1, 0 o 1. */
function signo(value: number): number {
  if (value === 0) return 0;
  return value < 0 ? -1 : 1;
}

function validarLineas(lines: readonly ValidatableInvoiceLine[]): InvoiceIssue[] {
  const problemas: InvoiceIssue[] = [];
  const vistos = new Set<number>();

  for (const line of lines) {
    if (vistos.has(line.lineNumber)) {
      problemas.push(
        issue(
          'DUPLICATE_LINE_NUMBER',
          `El número de línea ${line.lineNumber} está repetido.`,
          line.lineNumber,
        ),
      );
    }
    vistos.add(line.lineNumber);

    if (!Number.isFinite(line.quantity) || line.quantity === 0) {
      problemas.push(
        issue(
          'INVALID_QUANTITY',
          `La cantidad de la línea ${line.lineNumber} tiene que ser un número distinto de cero.`,
          line.lineNumber,
        ),
      );
    } else {
      const esperado = lineNetCents(line.quantity, line.unitPriceCents);
      if (esperado !== line.netCents) {
        problemas.push(
          issue(
            'LINE_NET_MISMATCH',
            `La línea ${line.lineNumber} declara ${line.netCents} céntimos, pero cantidad × precio son ${esperado}.`,
            line.lineNumber,
          ),
        );
      }
    }

    for (const problema of validateLineConcept(line)) {
      problemas.push(issue(problema.code, problema.message, line.lineNumber));
    }
  }

  return problemas;
}

function validarImportes(invoice: ValidatableInvoice): InvoiceIssue[] {
  const problemas: InvoiceIssue[] = [];

  const suma = linesNetCents(invoice.lines);
  if (invoice.lines.length > 0 && suma !== invoice.netCents) {
    problemas.push(
      issue(
        'NET_MISMATCH',
        `La cabecera declara ${invoice.netCents} céntimos de base, pero las líneas suman ${suma}.`,
      ),
    );
  }

  const bruto = invoice.netCents + invoice.vatCents;
  if (bruto !== invoice.grossCents) {
    problemas.push(
      issue(
        'GROSS_MISMATCH',
        `Base ${invoice.netCents} más IVA ${invoice.vatCents} son ${bruto}, no ${invoice.grossCents}.`,
      ),
    );
  }

  // Un abono lleva base e IVA negativos; una factura, los dos positivos. El IVA
  // a cero es válido en ambos casos (exento, inversión del sujeto pasivo,
  // intracomunitario), así que sólo molesta el signo contrario.
  if (invoice.vatCents !== 0 && signo(invoice.vatCents) !== signo(invoice.netCents)) {
    problemas.push(
      issue(
        'VAT_SIGN_MISMATCH',
        'La base y el IVA tienen signos contrarios: o es factura, o es abono.',
      ),
    );
  }

  return problemas;
}

function validarFechas(invoice: ValidatableInvoice): InvoiceIssue[] {
  const problemas: InvoiceIssue[] = [];

  // La fecha de devengo **sí** puede ser anterior a la de emisión: el servicio
  // de enero se factura en febrero. Eso es lo normal, no un error.
  if (invoice.dueDate !== undefined && compareDates(invoice.dueDate, invoice.issueDate) < 0) {
    problemas.push(issue('DUE_BEFORE_ISSUE', 'El vencimiento es anterior a la fecha de emisión.'));
  }

  if (
    invoice.serviceStart !== undefined &&
    invoice.serviceEnd !== undefined &&
    compareDates(invoice.serviceEnd, invoice.serviceStart) < 0
  ) {
    problemas.push(
      issue('SERVICE_PERIOD_REVERSED', 'El periodo de servicio termina antes de empezar.'),
    );
  }

  return problemas;
}

function validarDivisa(invoice: ValidatableInvoice, base: string): InvoiceIssue[] {
  const problemas: InvoiceIssue[] = [];
  const esBase = invoice.currency === base;

  if (!esBase && invoice.fxRate === undefined) {
    problemas.push(
      issue(
        'FX_RATE_MISSING',
        `Una factura en ${invoice.currency} necesita el tipo de cambio con el que se lleva a ${base}.`,
      ),
    );
  }

  if (invoice.fxRate !== undefined && (!Number.isFinite(invoice.fxRate) || invoice.fxRate <= 0)) {
    problemas.push(issue('FX_RATE_NOT_POSITIVE', `Tipo de cambio no válido: ${invoice.fxRate}.`));
  } else if (esBase && invoice.fxRate !== undefined && invoice.fxRate !== 1) {
    // Guardar un tipo distinto de 1 sobre la divisa propia es la forma de que
    // la misma factura valga dos importes distintos según quién la lea.
    problemas.push(
      issue('FX_RATE_ON_BASE_CURRENCY', `Una factura en ${base} no lleva tipo de cambio.`),
    );
  }

  return problemas;
}

/**
 * Comprueba que una factura cuadra consigo misma.
 *
 * El orden de los problemas es estable —cabecera, fechas, divisa, líneas por
 * orden de aparición— para que la pantalla pueda pintarlos sin reordenar y para
 * que los tests no dependan del orden de un `Set`.
 */
export function validateInvoice(
  invoice: ValidatableInvoice,
  options: InvoiceValidationOptions = {},
): InvoiceIssue[] {
  const base = options.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const problemas: InvoiceIssue[] = [];

  if (invoice.lines.length === 0) {
    // Sin líneas no hay concepto, y sin concepto el importe no entra en ningún
    // presupuesto ni en el «% de gasto gobernado».
    problemas.push(issue('NO_LINES', 'Una factura sin líneas no se puede imputar a nada.'));
  }

  problemas.push(...validarImportes(invoice));
  problemas.push(...validarFechas(invoice));
  problemas.push(...validarDivisa(invoice, base));
  problemas.push(...validarLineas(invoice.lines));

  return problemas;
}

/** Si la factura cuadra y puede seguir adelante en el flujo. */
export function isCoherentInvoice(
  invoice: ValidatableInvoice,
  options: InvoiceValidationOptions = {},
): boolean {
  return validateInvoice(invoice, options).length === 0;
}
