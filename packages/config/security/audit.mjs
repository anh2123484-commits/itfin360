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
export function auditFailures(report, level = 'high') {
  const minimo = SEVERITIES.indexOf(level);
  if (minimo < 0) throw new Error(`Severidad desconocida: ${level}`);

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
      title: 'ver \`pnpm audit\`',
    }));
}

/** Informe legible para la salida de CI. */
export function formatAuditFailures(fallos) {
  return fallos
    .map(({ module, severity, title }) => `- ${severity} · ${module} · ${title}`)
    .join('\n');
}
