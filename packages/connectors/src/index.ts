/**
 * Adaptadores de ingesta de ITFin360: ERP, cloud, licencias y extracción OCR.
 *
 * Las interfaces `Connector` y `DocumentExtractor` llegan en la fase 7;
 * aquí sólo queda establecido el paquete y sus scripts.
 */

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const CONNECTORS_PACKAGE = '@itfin360/connectors' as const;
