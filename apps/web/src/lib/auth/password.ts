import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
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
