import { CONCEPT_DEFINITIONS, SPEND_CONCEPTS } from '@itfin360/finance-core';

import { escribirCsv } from '@/lib/csv';
import { COLUMNAS } from '@/lib/importacion';

/**
 * La plantilla de importación que se descarga (F2-04).
 *
 * Se genera, no se guarda como fichero suelto: las columnas salen de `COLUMNAS`
 * y los conceptos de ejemplo del propio plan de conceptos, así que el día que
 * se añade un concepto o se renombra una columna, la plantilla ya está al día.
 * Una plantilla estática desfasada es peor que no tenerla, porque la gente la
 * rellena entera antes de descubrir que no vale.
 */

/** Cabeceras, en el orden en el que se leen mejor. */
export const CABECERAS_PLANTILLA: readonly string[] = [
  COLUMNAS.proveedor,
  COLUMNAS.numero,
  COLUMNAS.emision,
  COLUMNAS.devengo,
  COLUMNAS.vencimiento,
  COLUMNAS.descripcion,
  COLUMNAS.concepto,
  COLUMNAS.cantidad,
  COLUMNAS.precio,
  COLUMNAS.importe,
  COLUMNAS.iva,
  COLUMNAS.divisa,
];

/**
 * Filas de ejemplo. La segunda y la tercera comparten número de factura a
 * propósito: es la forma de enseñar, sin leer ninguna instrucción, que una
 * factura de dos partidas se escribe en dos filas.
 */
const EJEMPLOS: readonly (readonly string[])[] = [
  [
    'Microsoft',
    'INV-2026-0041',
    '2026-01-31',
    '2026-01-31',
    '2026-02-28',
    'Microsoft 365 Business, 25 licencias',
    CONCEPT_DEFINITIONS.SAAS_SUBSCRIPTION.label,
    '25',
    '12,60',
    '',
    '66,15',
    'EUR',
  ],
  [
    'Dell',
    'F-100',
    '2026-02-10',
    '2026-02-10',
    '',
    'Servidor de virtualización',
    CONCEPT_DEFINITIONS.HARDWARE_SERVER.label,
    '1',
    '3.200,00',
    '',
    '882,00',
    'EUR',
  ],
  [
    'Dell',
    'F-100',
    '2026-02-10',
    '2026-02-10',
    '',
    'Discos de repuesto',
    CONCEPT_DEFINITIONS.HARDWARE_STORAGE.label,
    '4',
    '250,00',
    '',
    '882,00',
    'EUR',
  ],
];

/**
 * El CSV de ejemplo, listo para descargar.
 *
 * Empieza por la marca de orden de bytes. Sin ella, Excel en Windows abre el
 * fichero como ANSI y los acentos salen rotos, y la primera reacción de
 * cualquiera al ver «Suscripci?n SaaS» es pensar que la plantilla está mal.
 * `parsearCsv` la quita al leer, así que el fichero se puede rellenar y
 * devolver tal cual.
 */
export function plantillaCsv(): string {
  return `\uFEFF${escribirCsv([CABECERAS_PLANTILLA, ...EJEMPLOS])}\r\n`;
}

/** Los conceptos válidos, con su etiqueta, para enseñarlos en la pantalla. */
export function conceptosParaAyuda(): readonly { codigo: string; etiqueta: string }[] {
  return SPEND_CONCEPTS.map((concepto) => ({
    codigo: concepto,
    etiqueta: CONCEPT_DEFINITIONS[concepto].label,
  }));
}
