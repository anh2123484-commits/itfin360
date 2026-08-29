/**
 * Acceso a datos de ITFin360: esquema Prisma, migraciones y cliente con RLS.
 *
 * El esquema y el helper `withTenant` llegan en F0-04 y F0-05; aquí sólo
 * queda establecido el paquete y sus scripts.
 */

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const DB_PACKAGE = '@itfin360/db' as const;
