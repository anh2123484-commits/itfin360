import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('hash de contraseña (scrypt)', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('contraseña-de-prueba-larga');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('contraseña-de-prueba-larga');
    expect(await verifyPassword('contraseña-de-prueba-larga', hash)).toBe(true);
    expect(await verifyPassword('otra', hash)).toBe(false);
  });

  it('dos hashes de la misma contraseña difieren (sal aleatoria)', async () => {
    expect(await hashPassword('igual-igual-igual')).not.toBe(
      await hashPassword('igual-igual-igual'),
    );
  });

  it('un hash malformado equivale a contraseña incorrecta, sin lanzar', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$10$abc$def')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$abc$def')).toBe(false);
  });
});
