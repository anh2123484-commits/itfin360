/**
 * Gate de vulnerabilidades (F0-09).
 *
 * Envuelve `pnpm audit --json`. La función es pura para poder testear el
 * umbral sin depender de la base de datos de avisos, que cambia cada día.
 */

/** Severidades ordenadas de menor a mayor. */
export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Avisos que igualan o superan el umbral.
 *
 * Acepta las dos formas que ha usado `pnpm audit --json`: un mapa `advisories`
 * y/o el recuento en `metadata.vulnerabilities`.
 *
 * @param {{ advisories?: Record<string, { module_name?: string, severity?: string, title?: string }>, metadata?: { vulnerabilities?: Record<string, number> } }} report
 * @param {string} [level] severidad mínima que hace fallar el gate
 */
/**
 * Un informe sólo es utilizable si trae la forma que esperamos. Si `pnpm audit`
 * no pudo consultar el servicio devuelve `{ error: ... }` con código de salida 0,
 * y tratar eso como "sin vulnerabilidades" haría que el gate fallase **abierto**:
 * la red caída se leería como árbol limpio.
 */
function esUtilizable(report) {
  if (report === null || typeof report !== 'object') return false;
  if (report.error !== undefined) return false;
  return report.advisories !== undefined || report.metadata?.vulnerabilities !== undefined;
}
export function auditFailures(report, level = 'high') {
  const minimo = SEVERITIES.indexOf(level);
  if (minimo < 0) throw new Error(`Severidad desconocida: ${level}`);
  if (!esUtilizable(report)) {
    const motivo =
      report?.error?.message ?? 'no contiene ni advisories ni metadata.vulnerabilities';
    throw new Error(
      `Informe de auditoría no utilizable: ${motivo}. El gate falla cerrado: sin informe no se ` +
        'puede afirmar que no haya vulnerabilidades.',
    );
  }

  const avisos = Object.values(report?.advisories ?? {});
  if (avisos.length > 0) {
    return avisos
      .filter((aviso) => SEVERITIES.indexOf(aviso.severity ?? 'info') >= minimo)
      .map((aviso) => ({
        module: aviso.module_name ?? '?',
        severity: aviso.severity ?? 'info',
        title: aviso.title ?? '',
      }));
  }

  const recuento = report?.metadata?.vulnerabilities ?? {};
  return SEVERITIES.slice(minimo)
    .filter((severidad) => (recuento[severidad] ?? 0) > 0)
    .map((severidad) => ({
      module: `${recuento[severidad]} paquete(s)`,
      severity: severidad,
      title: 'ver `pnpm audit`',
    }));
}

/** Informe legible para la salida de CI. */
export function formatAuditFailures(fallos) {
  return fallos
    .map(({ module, severity, title }) => `- ${severity} · ${module} · ${title}`)
    .join('\n');
}
