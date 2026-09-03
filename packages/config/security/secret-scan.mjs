/**
 * Gate de secretos (F0-09).
 *
 * Regla dura 9 de `AGENTS.md`: ningún secreto entra en el repositorio. GitHub
 * ofrece secret scanning con push protection, pero sólo reconoce patrones de
 * proveedores conocidos y no ve una credencial escrita a mano. Este gate cubre
 * ese hueco y, sobre todo, corre en la PR.
 *
 * La función es pura: recibe el contenido ya leído. El acceso a disco y a git
 * vive en `secret-scan.cli.mjs`.
 */

/** Hosts que nunca alojan un secreto real: desarrollo, contenedores y dominios reservados. */
const HOSTS_LOCALES = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)$/i;
const DOMINIOS_RESERVADOS = /\.(local|test|invalid|example|example\.com|example\.org)$/i;

/** Interpolaciones: `${VAR}`, `{{ var }}`, `%s`, `<placeholder>`. */
const INTERPOLACION = /\$\{|\{\{|%s|<[^>]+>/;

/** Contraseñas que son claramente un hueco a rellenar, no una credencial. */
const RELLENO =
  /^(pass|password|passwd|secret|token|changeme|change_me|xxx+|\*+|your[_-]?\w*|tu[_-]?\w*|dummy|fake|test)$/i;

/**
 * Una URL con credenciales sólo es un hallazgo si apunta a un host real y la
 * contraseña no es un marcador. Sin esto el gate marca cada cadena de conexión
 * de desarrollo del repositorio, y un gate ruidoso acaba desactivado.
 */
function urlConCredencialesReales(match) {
  if (INTERPOLACION.test(match)) return false;
  const partes = /^[a-z][a-z0-9+.-]*:\/\/([^\s/:@]+):([^\s/@]+)@([^\s/:]+)/i.exec(match);
  if (partes === null) return false;
  const [, , contrasena, host] = partes;
  if (RELLENO.test(contrasena)) return false;
  if (HOSTS_LOCALES.test(host) || DOMINIOS_RESERVADOS.test(host)) return false;
  // Un host sin punto es un nombre de servicio de docker compose, no un dominio.
  return host.includes('.');
}

/** Patrones que se consideran secreto. El nombre sale en el informe de CI. */
export const SECRET_PATTERNS = [
  { name: 'token de GitHub', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'token fine-grained de GitHub', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'clave de API estilo OpenAI/Anthropic', pattern: /\bsk-[A-Za-z0-9-]{20,}/g },
  { name: 'clave de acceso de AWS', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'clave privada PEM', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { name: 'JSON de cuenta de servicio de Google', pattern: /"type"\s*:\s*"service_account"/g },
  {
    name: 'URL con credenciales',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi,
    esSecreto: urlConCredencialesReales,
  },
];

/**
 * Marca de excepción para un falso positivo. Debe ir en la misma línea y
 * llevar motivo, para que la exención se lea junto al código que la causa.
 */
const ALLOW = /allow-secret:\s*\S+/;

/** Un hallazgo, con lo justo para localizarlo sin volcar el secreto en el log. */
function finding(file, line, name, match) {
  return { file, line, name, preview: `${match.slice(0, 4)}…${match.length} caracteres` };
}

/**
 * Busca secretos en las fuentes indicadas.
 *
 * @param {ReadonlyArray<{ file: string, content: string }>} sources
 * @returns {Array<{ file: string, line: number, name: string, preview: string }>}
 */
export function findSecrets(sources) {
  const hallazgos = [];
  for (const { file, content } of sources) {
    for (const [indice, texto] of content.split('\n').entries()) {
      if (ALLOW.test(texto)) continue;
      for (const { name, pattern, esSecreto } of SECRET_PATTERNS) {
        for (const match of texto.matchAll(pattern)) {
          if (esSecreto !== undefined && !esSecreto(match[0])) continue;
          hallazgos.push(finding(file, indice + 1, name, match[0]));
        }
      }
    }
  }
  return hallazgos;
}

/** Informe legible para la salida de CI. Nunca imprime el secreto entero. */
export function formatSecretFindings(hallazgos) {
  return hallazgos
    .map(({ file, line, name, preview }) => `- ${file}:${line} · ${name} (${preview})`)
    .join('\n');
}
