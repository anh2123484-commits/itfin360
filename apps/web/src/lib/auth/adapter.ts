import type { IdentityOperations, IdentityUser } from '@itfin360/db';
import type { Adapter, AdapterUser } from 'next-auth/adapters';

import { purgador } from '@/lib/retencion';

function toAdapterUser(user: IdentityUser): AdapterUser {
  return { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified };
}

/**
 * Adaptador de Auth.js sobre la superficie `identity` de `@itfin360/db`.
 *
 * Sólo implementa lo que usan el magic link y la sesión JWT: usuario y token
 * de verificación. No hay tablas `account` ni `session` (minimización, regla
 * dura 11): no se guarda ningún dato de proveedor externo ni de dispositivo.
 */
export function identityAdapter(identity: IdentityOperations): Adapter {
  // Aprovecha el momento en que se escribe en `verification_token` para barrer
  // lo caducado. Ver `lib/retencion.ts`.
  const purga = purgador({
    borrarTokensCaducados: (limite) => identity.deleteExpiredVerificationTokens(limite),
  });

  return {
    async createUser(user) {
      // El magic link sólo aporta el email; el nombre lo rellena el usuario después.
      const created = await identity.createUser({
        email: user.email,
        name: user.name ?? '',
        emailVerified: user.emailVerified,
      });
      return toAdapterUser(created);
    },
    async getUser(id) {
      const user = await identity.findUserById(id);
      return user ? toAdapterUser(user) : null;
    },
    async getUserByEmail(email) {
      const user = await identity.findUserByEmail(email);
      return user ? toAdapterUser(user) : null;
    },
    async getUserByAccount() {
      return null;
    },
    async updateUser(user) {
      const updated = await identity.updateUser(user.id, {
        ...(user.name !== undefined && user.name !== null ? { name: user.name } : {}),
        ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
      });
      return toAdapterUser(updated);
    },
    async linkAccount() {
      return undefined;
    },
    async createVerificationToken(token) {
      const creado = await identity.createVerificationToken(token);
      // Después de crear, no antes: si la purga falla, el enlace ya está hecho.
      await purga.quizaPurgar(new Date());
      return creado;
    },
    async useVerificationToken({ identifier, token }) {
      return identity.useVerificationToken(identifier, token);
    },
  };
}
