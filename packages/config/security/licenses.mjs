/**
 * Gate de licencias (F0-09).
 *
 * Una dependencia con licencia copyleft fuerte obligaría a publicar el código
 * de un producto que es privativo. El gate corre en CI y falla si aparece una
 * licencia fuera de la lista permitida, o una que no se puede determinar.
 *
 * Función pura: recibe la salida ya parseada de `pnpm licenses list --json`.
 */

/** Licencias permitidas: permisivas y débiles de fichero. */
export const ALLOWED_LICENSES = [
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
];

/** Paquetes eximidos por revisión manual: nombre → motivo. */
export const LICENSE_EXCEPTIONS = Object.freeze({});

const NORMALIZA = /^\(|\)$/g;

/** Una expresión SPDX con OR pasa si alguna de sus partes está permitida. */
function permitida(licencia, permitidas) {
  const limpia = String(licencia).replace(NORMALIZA, '').trim();
  if (permitidas.includes(limpia)) return true;
  if (limpia.includes(' OR ')) {
    return limpia.split(' OR ').some((parte) => permitida(parte, permitidas));
  }
  return false;
}

/**
 * Devuelve los paquetes cuya licencia no está permitida.
 *
 * @param {Record<string, ReadonlyArray<{ name: string, versions?: string[] }>>} porLicencia
 * @param {{ allowed?: string[], exceptions?: Record<string, string> }} [politica]
 */
export function disallowedLicenses(porLicencia, politica = {}) {
  const permitidas = politica.allowed ?? ALLOWED_LICENSES;
  const excepciones = politica.exceptions ?? LICENSE_EXCEPTIONS;
  const fuera = [];
  for (const [licencia, paquetes] of Object.entries(porLicencia)) {
    if (permitida(licencia, permitidas)) continue;
    for (const paquete of paquetes) {
      if (Object.hasOwn(excepciones, paquete.name)) continue;
      fuera.push({
        name: paquete.name,
        license: licencia,
        versions: paquete.versions ?? [],
      });
    }
  }
  return fuera.sort((a, b) => a.name.localeCompare(b.name));
}

/** Informe legible para la salida de CI. */
export function formatLicenseViolations(violaciones) {
  return violaciones
    .map(({ name, license, versions }) => `- ${name}@${versions.join(', ') || '?'} · ${license}`)
    .join('\n');
}
