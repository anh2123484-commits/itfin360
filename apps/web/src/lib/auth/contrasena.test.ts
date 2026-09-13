import { describe, expect, it } from 'vitest';

import {
  contrasenaSchema,
  establecerContrasena,
  type IdentidadContrasena,
} from '@/lib/auth/contrasena';
import { hashPassword } from '@/lib/auth/password';

/**
 * Esto es lo que sustituye al registro público, así que aquí se prueba sobre
 * todo lo que **no** deja hacer. Lo otro, que una contraseña buena se guarde,
 * se nota enseguida; que una comprobación se caiga no lo nota nadie hasta que
 * alguien entra donde no debe.
 */

const VERIFICADO = new Date('2026-01-01T00:00:00Z');

interface Estado {
  readonly guardados: string[];
  readonly identidad: IdentidadContrasena;
}

function identidadCon(
  usuario: { email: string; emailVerified: Date | null } | null,
  hash: string | null = null,
): Estado {
  const guardados: string[] = [];
  return {
    guardados,
    identidad: {
      findUserById: () => Promise.resolve(usuario),
      findPasswordHashByEmail: () => Promise.resolve(hash === null ? null : { hash }),
      updateUser: (_id, data) => {
        guardados.push(data.passwordHash);
        return Promise.resolve(undefined);
      },
    },
  };
}

describe('contrasenaSchema', () => {
  it('doce caracteres es el mínimo', () => {
    expect(contrasenaSchema.safeParse({ nueva: 'x'.repeat(11) }).success).toBe(false);
    expect(contrasenaSchema.safeParse({ nueva: 'x'.repeat(12) }).success).toBe(true);
  });

  it('la actual puede no venir, porque la primera vez no hay ninguna', () => {
    expect(contrasenaSchema.safeParse({ nueva: 'x'.repeat(12) }).success).toBe(true);
  });
});

describe('establecerContrasena', () => {
  it('la primera contraseña se guarda sin pedir la anterior', async () => {
    const estado = identidadCon({ email: 'anh@example.com', emailVerified: VERIFICADO });
    await establecerContrasena(estado.identidad, 'u1', { nueva: 'contraseña larga' });
    expect(estado.guardados).toHaveLength(1);
    // Lo que se guarda es el hash, nunca la contraseña.
    expect(estado.guardados[0]).not.toContain('contraseña larga');
    expect(estado.guardados[0]?.startsWith('scrypt$')).toBe(true);
  });

  it('con una contraseña ya puesta, hay que decir la anterior', async () => {
    const estado = identidadCon(
      { email: 'anh@example.com', emailVerified: VERIFICADO },
      await hashPassword('la de antes vale'),
    );
    await expect(
      establecerContrasena(estado.identidad, 'u1', { nueva: 'una contraseña nueva' }),
    ).rejects.toThrow(/contrasena_actual_no_coincide/);
    expect(estado.guardados).toHaveLength(0);
  });

  it('la anterior equivocada tampoco vale', async () => {
    const estado = identidadCon(
      { email: 'anh@example.com', emailVerified: VERIFICADO },
      await hashPassword('la de antes vale'),
    );
    await expect(
      establecerContrasena(estado.identidad, 'u1', {
        actual: 'la de antes no vale',
        nueva: 'una contraseña nueva',
      }),
    ).rejects.toThrow(/contrasena_actual_no_coincide/);
    expect(estado.guardados).toHaveLength(0);
  });

  it('con la anterior correcta se cambia', async () => {
    const estado = identidadCon(
      { email: 'anh@example.com', emailVerified: VERIFICADO },
      await hashPassword('la de antes vale'),
    );
    await establecerContrasena(estado.identidad, 'u1', {
      actual: 'la de antes vale',
      nueva: 'una contraseña nueva',
    });
    expect(estado.guardados).toHaveLength(1);
  });

  it('sin el correo verificado no se puede poner ninguna', async () => {
    // Es la misma regla que en el login. Si se pudiera poner contraseña sobre
    // un correo sin verificar, daría igual que el login la comprobara.
    const estado = identidadCon({ email: 'anh@example.com', emailVerified: null });
    await expect(
      establecerContrasena(estado.identidad, 'u1', { nueva: 'contraseña larga' }),
    ).rejects.toThrow(/correo_sin_verificar/);
    expect(estado.guardados).toHaveLength(0);
  });

  it('un usuario que ya no existe no cambia nada', async () => {
    const estado = identidadCon(null);
    await expect(
      establecerContrasena(estado.identidad, 'u1', { nueva: 'contraseña larga' }),
    ).rejects.toThrow(/sin_sesion/);
    expect(estado.guardados).toHaveLength(0);
  });
});
