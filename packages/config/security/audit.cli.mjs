#!/usr/bin/env node
/**
 * Gate de CI: `pnpm audit` con umbral de severidad.
 *
 * Uso: node security/audit.cli.mjs [severidad]   (por defecto `high`)
 */
import { execFileSync } from 'node:child_process';

import { auditFailures, formatAuditFailures } from './audit.mjs';

const nivel = process.argv[2] ?? 'high';
/** `pnpm audit` sale con código distinto de 0 cuando hay avisos: eso no es un error del gate. */
function informe() {
  try {
    return execFileSync('pnpm', ['audit', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim() !== '') return error.stdout;
    throw error;
  }
}

let reporte;
try {
  reporte = JSON.parse(informe());
} catch (error) {
  console.error(`Auditoría: no se pudo obtener el informe (${error.message}).`);
  process.exit(1);
}

const fallos = auditFailures(reporte, nivel);
if (fallos.length > 0) {
  console.error(
    `Auditoría: ${fallos.length} aviso(s) de severidad ${nivel} o superior:\n${formatAuditFailures(fallos)}`,
  );
  process.exit(1);
}

console.log(`Auditoría: sin avisos de severidad ${nivel} o superior.`);
