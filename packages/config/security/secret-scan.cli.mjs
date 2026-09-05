#!/usr/bin/env node
/**
 * Gate de CI: busca secretos en los ficheros versionados (o en los que cambia
 * la PR, si se le pasa un rango de git) y falla si encuentra alguno.
 *
 * Uso:
 *   node security/secret-scan.cli.mjs            # todos los ficheros versionados
 *   node security/secret-scan.cli.mjs origin/main # sólo lo que cambia respecto a esa ref
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

import { findSecrets, formatSecretFindings } from './secret-scan.mjs';

const IGNORADOS =
  /(^|\/)(node_modules|dist|\.next|coverage|\.turbo)\/|(^|\/)pnpm-lock\.yaml$|\.(png|jpe?g|gif|ico|svg|woff2?|pdf)$/;
const MAX_BYTES = 512 * 1024;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
}

function ficheros() {
  const base = process.argv[2];
  if (base === undefined) return git(['ls-files']);
  const fusion = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
  return git(['diff', '--name-only', '--diff-filter=ACMR', `${fusion}...HEAD`]);
}

const fuentes = [];
for (const file of ficheros()) {
  if (IGNORADOS.test(file)) continue;
  let tamano;
  try {
    tamano = statSync(file).size;
  } catch {
    continue; // borrado entre el diff y la lectura
  }
  if (tamano > MAX_BYTES) continue;
  fuentes.push({ file, content: readFileSync(file, 'utf8') });
}

const hallazgos = findSecrets(fuentes);
if (hallazgos.length > 0) {
  console.error(
    `Secretos: ${hallazgos.length} hallazgo(s) en ${fuentes.length} fichero(s) revisados:\n${formatSecretFindings(hallazgos)}\n\n` +
      'Si es un falso positivo, añade `allow-secret: <motivo>` en la misma línea.',
  );
  process.exit(1);
}

console.log(`Secretos: ${fuentes.length} fichero(s) revisados, ninguno contiene credenciales.`);
