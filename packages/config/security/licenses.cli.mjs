#!/usr/bin/env node
/**
 * Gate de CI: comprueba las licencias de las dependencias de producción.
 *
 * Uso: node security/licenses.cli.mjs
 */
import { execFileSync } from 'node:child_process';

import { ALLOWED_LICENSES, disallowedLicenses, formatLicenseViolations } from './licenses.mjs';

function listado() {
  const salida = execFileSync('pnpm', ['licenses', 'list', '--prod', '--recursive', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(salida);
}

let porLicencia;
try {
  porLicencia = listado();
} catch (error) {
  console.error(`Licencias: no se pudo obtener el listado (${error.message}).`);
  process.exit(1);
}

const violaciones = disallowedLicenses(porLicencia);
if (violaciones.length > 0) {
  console.error(
    `Licencias: ${violaciones.length} paquete(s) con licencia no permitida:\n${formatLicenseViolations(violaciones)}\n\n` +
      `Permitidas: ${ALLOWED_LICENSES.join(', ')}.\n` +
      'Para eximir uno, añádelo a LICENSE_EXCEPTIONS con su motivo y justifícalo en la PR.',
  );
  process.exit(1);
}

const total = Object.values(porLicencia).reduce((suma, paquetes) => suma + paquetes.length, 0);
console.log(`Licencias: ${total} paquete(s) de producción, todas permitidas.`);
