/**
 * Motor de cálculo puro de ITFin360 (`docs/02-modelo-financiero.md`).
 *
 * Este paquete no hace I/O: sin Prisma, sin `fetch` y sin `Date.now()`;
 * la fecha de cálculo siempre entra como parámetro.
 */

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const FINANCE_CORE_PACKAGE = '@itfin360/finance-core' as const;
