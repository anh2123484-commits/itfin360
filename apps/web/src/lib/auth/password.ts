import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

import { semaforo } from '@/lib/concurrencia';

/**
 * Cuántas derivaciones de contraseña se permiten a la vez, y cuánto se espera
 * turno antes de rendirse.
 *
 * Cada una reserva unos 32 MB por los parámetros de scrypt de más abajo. Cuatro
 * a la vez son 128 MB, que caben de sobra. Sin tope, unas decenas de peticiones
 * simultáneas dejan sin memoria al proceso, y para eso no hace falta acertar
 * ninguna contraseña: basta con mandar intentos.
 *
 * Cuatro segundos de espera porque pasado ese punto vale más decir que no que
 * dejar la petición colgada mientras se acumulan las siguientes.
 */
const MAXIMO_A_LA_VEZ = 4;
const ESPERA_MAXIMA_MS = 4_000;

const turnoScrypt = semaforo(MAXIMO_A_LA_VEZ, ESPERA_MAXIMA_MS);

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return turnoScrypt.ejecutar(
    () =>
      new Promise((resolve, reject) => {
        scryptCallback(password, salt, keyLength, options, (error, derived) =>
          error ? reject(error) : resolve(derived),
        );
      }),
  );
}

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const FORMAT = 'scrypt';

/** Hash de contraseña: `scrypt$N$salt$hash` en base64url. Nunca se guarda la contraseña. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return [FORMAT, SCRYPT_PARAMS.N, salt.toString('base64url'), derived.toString('base64url')].join(
    '$',
  );
}

/** Compara en tiempo constante; un hash malformado equivale a contraseña incorrecta. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [format, n, salt, hash] = stored.split('$');
  if (format !== FORMAT || !n || !salt || !hash) return false;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20) return false;
  const expected = Buffer.from(hash, 'base64url');
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    ...SCRYPT_PARAMS,
    N,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
