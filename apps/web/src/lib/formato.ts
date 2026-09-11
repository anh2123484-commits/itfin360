import type { InvoiceStatus } from '@itfin360/db';

/**
 * Formato para pantalla.
 *
 * Vive fuera del motor a propósito: `finance-core` calcula en céntimos enteros
 * y no sabe nada de idiomas, ni de puntos y comas, ni de cómo se llama en
 * castellano un estado del flujo de aprobación. Mezclar las dos cosas obliga a
 * tocar el motor cada vez que cambia una etiqueta.
 */

const LOCALE = 'es-ES';

/**
 * Céntimos a importe con divisa.
 *
 * Aquí sí se divide entre 100 y aparece un flotante, que es el único sitio
 * donde eso es aceptable: el resultado se pinta y se tira. Ningún cálculo parte
 * de este número.
 */
export function formatearImporte(centimos: number, divisa: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: divisa,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimos / 100);
}

/**
 * `YYYY-MM-DD` a `31/03/2026`.
 *
 * Sin `Date` y sin `Intl.DateTimeFormat`: los dos interpretan zona horaria, y
 * una fecha civil no la tiene. Con `new Date('2026-03-31')` en un navegador al
 * oeste de Greenwich, esta función devolvería el 30.
 */
export function formatearFecha(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/**
 * Nombre de cada estado en castellano.
 *
 * `Record<InvoiceStatus, string>` obliga a que estén todos: si el esquema gana
 * un estado, esto deja de compilar en vez de enseñar el enum crudo en pantalla.
 */
export const ETIQUETA_ESTADO: Readonly<Record<InvoiceStatus, string>> = {
  DRAFT: 'Borrador',
  PENDING_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  POSTED: 'Contabilizada',
  REJECTED: 'Rechazada',
  DUPLICATE: 'Duplicada',
};

/** Clases del distintivo de estado. El color dice en qué punto está el dinero. */
export const COLOR_ESTADO: Readonly<Record<InvoiceStatus, string>> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_REVIEW: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-sky-100 text-sky-900',
  POSTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-red-100 text-red-900',
  DUPLICATE: 'bg-zinc-200 text-zinc-700',
};
