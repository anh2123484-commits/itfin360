/**
 * Operaciones globales de identidad y aprovisionamiento (F0-06).
 *
 * Son las únicas consultas de la aplicación que no viven dentro de
 * `withTenant`, porque ocurren antes de que exista un tenant activo:
 *
 * - `user` y `verification_token` son tablas globales sin RLS (una persona
 *   pertenece a varios tenants; el magic link se consume antes del login).
 * - `provisionTenant` y `userMemberships` llaman a las dos funciones
 *   `SECURITY DEFINER` de la migración de F0-06: la primera crea el tenant con
 *   su OWNER y su entrada de auditoría sin relajar `tenant_isolation` (issue
 *   #68); la segunda devuelve las pertenencias del usuario para elegir tenant.
 *
 * Nada de aquí devuelve datos de otro usuario ni de un tenant ajeno.
 */

import type { PrismaClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import type { Role } from './generated/prisma/enums.js';
import { assertTenantId } from './tenant-context.js';

/** Datos de identidad que la aplicación necesita del usuario. */
export interface IdentityUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: Date | null;
}

const IDENTITY_SELECT = { id: true, email: true, name: true, emailVerified: true } as const;

/** Pertenencia de un usuario a un tenant, tal y como la devuelve `user_memberships`. */
export interface UserMembership {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: Role;
  readonly canViewCompensation: boolean;
}

/** Contrato de `provision_tenant`. */
export interface ProvisionTenantInput {
  readonly name: string;
  /** ISO 4217 en mayúsculas. */
  readonly baseCurrency: string;
  readonly ownerUserId: string;
}

/** Token de magic link (Auth.js). */
export interface VerificationTokenRecord {
  readonly identifier: string;
  readonly token: string;
  readonly expires: Date;
}

type IdentityClient = PrismaClient | Prisma.TransactionClient;

/** Alta de tenant a través de `provision_tenant`; devuelve el id del tenant creado. */
export async function provisionTenant(
  client: IdentityClient,
  input: ProvisionTenantInput,
): Promise<string> {
  const rows = await client.$queryRaw<{ tenant_id: string }[]>`
    SELECT provision_tenant(${input.name}, ${input.baseCurrency}::char(3), ${input.ownerUserId}::uuid) AS tenant_id
  `;
  const tenantId = rows[0]?.tenant_id;
  if (tenantId === undefined) throw new Error('provision_tenant no devolvió ningún id.');
  return assertTenantId(tenantId);
}

/** Pertenencias del usuario a través de todos sus tenants (`user_memberships`). */
export async function userMemberships(
  client: IdentityClient,
  userId: string,
): Promise<UserMembership[]> {
  const rows = await client.$queryRaw<
    { tenant_id: string; tenant_name: string; role: Role; can_view_compensation: boolean }[]
  >`SELECT tenant_id, tenant_name, role, can_view_compensation FROM user_memberships(${userId}::uuid)`;
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role,
    canViewCompensation: row.can_view_compensation,
  }));
}

/** Operaciones sobre `user` y `verification_token` que necesita Auth.js. */
export function identityOperations(client: IdentityClient) {
  return {
    findUserById: (id: string): Promise<IdentityUser | null> =>
      client.user.findUnique({ where: { id }, select: IDENTITY_SELECT }),

    findUserByEmail: (email: string): Promise<IdentityUser | null> =>
      client.user.findUnique({ where: { email }, select: IDENTITY_SELECT }),

    /** El hash sólo se lee aquí, para compararlo; nunca sale del servidor. */
    findPasswordHashByEmail: async (
      email: string,
    ): Promise<{ id: string; hash: string } | null> => {
      const user = await client.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      if (!user?.passwordHash) return null;
      return { id: user.id, hash: user.passwordHash };
    },

    createUser: (data: {
      email: string;
      name: string;
      emailVerified?: Date | null;
      passwordHash?: string | null;
    }): Promise<IdentityUser> => client.user.create({ data, select: IDENTITY_SELECT }),

    updateUser: (
      id: string,
      data: { name?: string; emailVerified?: Date | null; passwordHash?: string | null },
    ): Promise<IdentityUser> =>
      client.user.update({ where: { id }, data, select: IDENTITY_SELECT }),

    createVerificationToken: (data: VerificationTokenRecord): Promise<VerificationTokenRecord> =>
      client.verificationToken.create({ data }),

    /** Borra y devuelve el token si existe (Auth.js lo consume una sola vez). */
    useVerificationToken: async (
      identifier: string,
      token: string,
    ): Promise<VerificationTokenRecord | null> => {
      const found = await client.verificationToken.findUnique({
        where: { identifier_token: { identifier, token } },
      });
      if (!found) return null;
      const deleted = await client.verificationToken.deleteMany({ where: { identifier, token } });
      return deleted.count === 0 ? null : found;
    },

    provisionTenant: (input: ProvisionTenantInput) => provisionTenant(client, input),
    userMemberships: (userId: string) => userMemberships(client, userId),
  };
}

/** Superficie de identidad expuesta por el cliente de la aplicación. */
export type IdentityOperations = ReturnType<typeof identityOperations>;
