import { assertTenantId, type UserMembership } from '@itfin360/db';
import { cookies } from 'next/headers';

import { currentUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { forbidden, HttpError, unauthorized } from '@/lib/http';
import { can, type Permission, type Principal } from '@/lib/permissions';

/** Cookie httpOnly con el tenant activo. Sólo es una preferencia: se valida contra `membership` siempre. */
export const ACTIVE_TENANT_COOKIE = 'itfin360_tenant';

export async function readActiveTenantCookie(): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  if (!value) return null;
  try {
    return assertTenantId(value);
  } catch {
    return null;
  }
}

export async function writeActiveTenantCookie(tenantId: string): Promise<void> {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, assertTenantId(tenantId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Sesión + pertenencias del usuario, sin tenant aún elegido. */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly memberships: readonly UserMembership[];
}

/** 401 si no hay sesión. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const userId = await currentUserId();
  if (!userId) throw unauthorized();
  const memberships = await db().identity.userMemberships(userId);
  return { userId, memberships };
}

/**
 * Elige el tenant activo: el de la cookie si el usuario pertenece a él; si no,
 * el único que tenga; si no, ninguno. Nunca un tenant del que no sea miembro.
 */
export function pickActiveMembership(
  memberships: readonly UserMembership[],
  preferredTenantId: string | null,
): UserMembership | null {
  if (preferredTenantId) {
    const preferred = memberships.find((m) => m.tenantId === preferredTenantId);
    if (preferred) return preferred;
  }
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

/**
 * Resuelve el principal de la petición (usuario, tenant activo, rol y
 * `canViewCompensation`). 401 sin sesión, 403 `no_active_tenant` si no hay
 * tenant activo válido.
 */
export async function requirePrincipal(): Promise<Principal> {
  const { userId, memberships } = await requireUser();
  const membership = pickActiveMembership(memberships, await readActiveTenantCookie());
  if (!membership) throw forbidden('no_active_tenant');
  return {
    userId,
    tenantId: membership.tenantId,
    role: membership.role,
    canViewCompensation: membership.canViewCompensation,
  };
}

/** Principal con el permiso exigido; 403 `forbidden` si no lo tiene. */
export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!can(principal, permission)) throw forbidden();
  return principal;
}

/** Cambia el tenant activo tras comprobar la pertenencia. */
export async function switchActiveTenant(tenantId: string): Promise<UserMembership> {
  const { memberships } = await requireUser();
  const membership = memberships.find((m) => m.tenantId === tenantId);
  if (!membership) throw new HttpError(403, 'not_a_member');
  await writeActiveTenantCookie(membership.tenantId);
  return membership;
}
