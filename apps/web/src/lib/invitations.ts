import { createHash, randomBytes } from 'node:crypto';

import { Role, type UserMembership } from '@itfin360/db';
import { z } from 'zod';

import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';
import type { Principal } from '@/lib/permissions';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const createInvitationSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(Role),
  canViewCompensation: z.boolean().default(false),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** El token viaja en el enlace; en la tabla sólo queda su SHA-256. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export interface CreatedInvitation {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Crea la invitación dentro del tenant del principal. El rol y el permiso
 * salarial quedan fijados por quien invita (que ya pasó `members:invite`).
 * Devuelve el token en claro una única vez para componer el enlace.
 */
export async function createInvitation(
  principal: Principal,
  input: CreateInvitationInput,
  now: Date = new Date(),
): Promise<CreatedInvitation> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const id = await db().withTenant(principal.tenantId, async (tx) => {
    const created = await tx.invitation.create({
      data: {
        tenantId: principal.tenantId,
        email: input.email,
        role: input.role,
        canViewCompensation: input.canViewCompensation,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedById: principal.userId,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'invitation.created',
        entity: 'invitation',
        entityId: created.id,
        after: { role: input.role, canViewCompensation: input.canViewCompensation },
      },
    });
    return created.id;
  });
  return { id, token, expiresAt };
}

/**
 * Acepta una invitación: el email de la sesión debe coincidir con el invitado.
 * La invitación se borra al aceptarla (minimización: el email ya vive en
 * `user`); quedan la membership y la entrada de `audit_log`.
 *
 * RLS impide buscar la invitación sin contexto, así que el enlace lleva el
 * `tenantId` además del token y la búsqueda por `tokenHash` se hace dentro de
 * `withTenant(tenantId)`: un token de otro tenant simplemente no existe.
 */
export async function acceptInvitation(
  user: { userId: string; email: string },
  tenantId: string,
  token: string,
  now: Date = new Date(),
): Promise<UserMembership> {
  const tokenHash = hashInvitationToken(token);
  return db().withTenant(tenantId, async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      include: { tenant: { select: { name: true } } },
    });
    if (!invitation) throw new HttpError(404, 'invitation_not_found');
    if (invitation.expiresAt.getTime() <= now.getTime()) {
      throw new HttpError(410, 'invitation_expired');
    }
    if (invitation.email !== user.email.toLowerCase()) {
      throw new HttpError(403, 'invitation_email_mismatch');
    }
    const existing = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.userId } },
    });
    if (existing) throw new HttpError(409, 'already_member');

    const membership = await tx.membership.create({
      data: {
        tenantId,
        userId: user.userId,
        role: invitation.role,
        canViewCompensation: invitation.canViewCompensation,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: user.userId,
        action: 'invitation.accepted',
        entity: 'membership',
        entityId: membership.id,
        after: {
          invitationId: invitation.id,
          role: membership.role,
          canViewCompensation: membership.canViewCompensation,
        },
      },
    });
    await tx.invitation.delete({ where: { id: invitation.id } });
    return {
      tenantId,
      tenantName: invitation.tenant.name,
      role: membership.role,
      canViewCompensation: membership.canViewCompensation,
    };
  });
}
