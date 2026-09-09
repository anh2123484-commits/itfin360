/**
 * Detección de facturas duplicadas (F2-03, `docs/01-prd.md` §M2).
 *
 * Pagar dos veces la misma factura es el error de departamento de compras más
 * caro y más silencioso: no rompe nada, sólo se va el dinero. En un
 * departamento IT llega por dos caminos, y aquí se cubren los dos:
 *
 * 1. **El mismo número de factura del mismo proveedor.** Un proveedor no puede
 *    emitir dos veces el mismo número, así que esto es un duplicado seguro.
 *    Suele venir de importar el mismo CSV dos veces, o de que la factura entre
 *    por correo y por el portal del proveedor.
 * 2. **Mismo proveedor, mismo importe, fechas cercanas.** Es el caso de la
 *    factura que se teclea a mano porque "no aparecía", y sí aparecía. Aquí el
 *    número no coincide (o falta), así que hay que mirar el importe.
 *
 * Este módulo **no borra nada y no decide nada**: devuelve candidatos con una
 * confianza y una explicación en español para que una persona confirme. Una
 * detección automática que se equivoque hace desaparecer una factura real, y
 * eso es peor que el duplicado.
 *
 * Sin I/O y sin `Date`: las fechas entran como ISO y se comparan con el
 * calendario civil de `dates.ts`.
 */

import type { Cents } from './money.js';
import { parseIsoDate, toEpochDay } from './dates.js';

/** Lo mínimo que hace falta de una factura para buscar duplicados. */
export interface InvoiceForDuplicates {
  readonly invoiceId: string;
  readonly supplierId: string;
  /** Número tal y como viene del proveedor. Puede venir vacío. */
  readonly invoiceNumber: string;
  /** Fecha de emisión, `YYYY-MM-DD`. */
  readonly issueDate: string;
  readonly totalCents: Cents;
}

/** Por qué dos facturas se parecen. */
export type DuplicateReason = 'SAME_INVOICE_NUMBER' | 'SAME_AMOUNT_AND_DATE';

/** Un candidato a duplicado, para que una persona lo confirme o lo descarte. */
export interface DuplicateMatch {
  /** La factura sospechosa: la que llegó después. */
  readonly invoiceId: string;
  /** La que ya estaba: la más antigua del par. */
  readonly duplicateOfId: string;
  readonly reason: DuplicateReason;
  /** 0..1. El número de factura da 1; el importe y la fecha, menos. */
  readonly confidence: number;
  /** Frase lista para enseñar en la interfaz. */
  readonly explanation: string;
}

/** Parámetros de la búsqueda por importe y fecha. */
export interface DuplicateConfig {
  /** Días de separación máxima entre dos facturas del mismo importe. */
  readonly dayWindow: number;
  /** Confianza cuando además coincide el día exacto. */
  readonly sameDayConfidence: number;
  /** Cuánta confianza se pierde por cada día de separación. */
  readonly confidenceDecayPerDay: number;
}

/**
 * Valores por defecto: ±5 días.
 *
 * La ventana es corta a propósito. Un servicio mensual del mismo importe genera
 * facturas cada 28-31 días; con ±5 días no se marcan entre sí, que es
 * exactamente lo que hay que evitar en un departamento lleno de suscripciones.
 */
export const DEFAULT_DUPLICATE_CONFIG: DuplicateConfig = {
  dayWindow: 5,
  sameDayConfidence: 0.9,
  confidenceDecayPerDay: 0.05,
};

/**
 * Normaliza un número de factura para poder compararlo.
 *
 * `F-2026/0001`, `f2026 0001` y `F 2026-0001` son el mismo número escrito por
 * tres personas distintas. Se pasa a mayúsculas y se quita todo lo que no sea
 * letra o dígito. Se conservan los acentos por si un proveedor numera con
 * palabras; `toUpperCase` ya los normaliza.
 */
export function normalizeInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-ZÁÉÍÓÚÜÑ]/gu, '');
}

/** Días de separación entre dos fechas ISO, siempre positivo. */
function daysApart(a: string, b: string): number {
  return Math.abs(toEpochDay(parseIsoDate(a)) - toEpochDay(parseIsoDate(b)));
}

/** Un par ordenado: cuál llegó antes y cuál es la sospechosa. */
interface ParOrdenado {
  readonly original: InvoiceForDuplicates;
  readonly sospechosa: InvoiceForDuplicates;
}

/**
 * Cuál de las dos es "la original": la más antigua.
 *
 * Con la misma fecha decide el id, para que el resultado no dependa del orden
 * en que vengan las filas del CSV. Una detección que cambia según cómo esté
 * ordenado el fichero no se puede auditar.
 */
function ordenar(a: InvoiceForDuplicates, b: InvoiceForDuplicates): ParOrdenado {
  const diaA = toEpochDay(parseIsoDate(a.issueDate));
  const diaB = toEpochDay(parseIsoDate(b.issueDate));
  if (diaA !== diaB) {
    return diaA < diaB ? { original: a, sospechosa: b } : { original: b, sospechosa: a };
  }
  return a.invoiceId <= b.invoiceId
    ? { original: a, sospechosa: b }
    : { original: b, sospechosa: a };
}

/** Comparación de cadenas por punto de código, sin depender de la configuración regional. */
function compararIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Cómo se lee la separación entre dos fechas en la explicación. */
function separacion(dias: number): string {
  if (dias === 0) return 'el mismo día';
  if (dias === 1) return 'con un día de diferencia';
  return `con ${dias} días de diferencia`;
}

function claveDePar(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function validarConfig(config: DuplicateConfig): void {
  if (!Number.isInteger(config.dayWindow) || config.dayWindow < 0) {
    throw new RangeError(`Ventana de días no válida: ${config.dayWindow}`);
  }
  if (config.sameDayConfidence <= 0 || config.sameDayConfidence > 1) {
    throw new RangeError(`Confianza no válida: ${config.sameDayConfidence}`);
  }
  if (config.confidenceDecayPerDay < 0) {
    throw new RangeError(`Decaimiento no válido: ${config.confidenceDecayPerDay}`);
  }
}

/**
 * Busca candidatos a duplicado dentro de un conjunto de facturas.
 *
 * Sólo compara facturas del mismo proveedor: dos importes idénticos de
 * proveedores distintos no son un duplicado, son una coincidencia.
 *
 * Cada par se reporta **una sola vez**, y el número de factura gana al importe:
 * si dos facturas comparten número, no se vuelven a marcar por importe y fecha.
 * Así la lista que ve una persona tiene tantas filas como decisiones que tomar.
 *
 * El resultado sale ordenado por confianza descendente y, a igualdad, por id,
 * para que sea estable entre ejecuciones.
 */
export function findDuplicates(
  invoices: readonly InvoiceForDuplicates[],
  config: DuplicateConfig = DEFAULT_DUPLICATE_CONFIG,
): DuplicateMatch[] {
  validarConfig(config);

  const porProveedor = new Map<string, InvoiceForDuplicates[]>();
  for (const factura of invoices) {
    const lista = porProveedor.get(factura.supplierId);
    if (lista === undefined) {
      porProveedor.set(factura.supplierId, [factura]);
    } else {
      lista.push(factura);
    }
  }

  const resultados: DuplicateMatch[] = [];
  const yaVistos = new Set<string>();

  for (const lista of porProveedor.values()) {
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const a = lista[i];
        const b = lista[j];
        if (a === undefined || b === undefined) continue;
        if (a.invoiceId === b.invoiceId) continue;

        const clave = claveDePar(a.invoiceId, b.invoiceId);
        if (yaVistos.has(clave)) continue;

        const coincidencia = comparar(a, b, config);
        if (coincidencia === null) continue;

        yaVistos.add(clave);
        resultados.push(coincidencia);
      }
    }
  }

  return resultados.sort(porRelevancia);
}

/** Primero lo seguro, y a igualdad de confianza por id, para que sea estable. */
function porRelevancia(x: DuplicateMatch, y: DuplicateMatch): number {
  if (x.confidence !== y.confidence) return y.confidence - x.confidence;
  const porSospechosa = compararIds(x.invoiceId, y.invoiceId);
  if (porSospechosa !== 0) return porSospechosa;
  return compararIds(x.duplicateOfId, y.duplicateOfId);
}

function comparar(
  a: InvoiceForDuplicates,
  b: InvoiceForDuplicates,
  config: DuplicateConfig,
): DuplicateMatch | null {
  const { original, sospechosa } = ordenar(a, b);

  const numeroA = normalizeInvoiceNumber(a.invoiceNumber);
  const numeroB = normalizeInvoiceNumber(b.invoiceNumber);

  // Un número vacío no prueba nada: media importación de CSV viene sin número.
  if (numeroA !== '' && numeroA === numeroB) {
    return {
      invoiceId: sospechosa.invoiceId,
      duplicateOfId: original.invoiceId,
      reason: 'SAME_INVOICE_NUMBER',
      confidence: 1,
      explanation: `El proveedor ya tiene la factura ${original.invoiceNumber} registrada. Un número de factura no se repite.`,
    };
  }

  if (a.totalCents !== b.totalCents) return null;

  const dias = daysApart(a.issueDate, b.issueDate);
  if (dias > config.dayWindow) return null;

  const bruta = config.sameDayConfidence - config.confidenceDecayPerDay * dias;
  const confianza = Math.max(0, Math.min(1, bruta));
  if (confianza <= 0) return null;

  return {
    invoiceId: sospechosa.invoiceId,
    duplicateOfId: original.invoiceId,
    reason: 'SAME_AMOUNT_AND_DATE',
    confidence: confianza,
    explanation: `Mismo proveedor y mismo importe ${separacion(dias)}. Los números de factura no coinciden, conviene revisarlo.`,
  };
}

/**
 * Los ids de las facturas señaladas como posible copia, sin las originales.
 *
 * Útil para pintar el aviso en una tabla sin recorrer los pares a mano. No
 * significa que haya que borrarlas: significa que hay que mirarlas.
 */
export function flaggedInvoiceIds(matches: readonly DuplicateMatch[]): string[] {
  return [...new Set(matches.map((m) => m.invoiceId))].sort();
}
