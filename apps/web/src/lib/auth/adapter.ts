import type { IdentityOperations, IdentityUser } from '@itfin360/db';
import type { Adapter, AdapterUser } from 'next-auth/adapters';

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
      return identity.createVerificationToken(token);
    },
    async useVerificationToken({ identifier, token }) {
      return identity.useVerificationToken(identifier, token);
    },
  };
}
