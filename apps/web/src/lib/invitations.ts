import { createHash, randomBytes } from 'node:crypto';

import { Role, type UserMembership } from '@itfin360/db';
import { z } from 'zod';

import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';
import { leerInvitacion } from '@/lib/invitacion-cookie';
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

/**
 * El enlace que se manda a quien se invita.
 *
 * Vive en `/invitacion`, fuera de `/invitaciones`, por dos razones. Una: esa
 * ruta tiene que ser pública, porque quien la abre todavía no tiene cuenta, y
 * `/invitaciones` es donde se crean y se revocan, que no puede serlo. Dos: al
 * abrirla, el token pasa a una cookie y la dirección se queda limpia, así que
 * el token no llega ni al login ni a las pantallas de error.
 */
export function enlaceDeInvitacion(base: string, tenantId: string, token: string): string {
  return new URL(`/invitacion/${tenantId}/${token}`, base).toString();
}

/** Lo que se puede enseñar de una invitación a quien trae el token. */
export interface InvitacionVista {
  readonly id: string;
  readonly tenantName: string;
  readonly role: Role;
  readonly canViewCompensation: boolean;
  /** Correo enmascarado: quien trae el token no tiene por qué ver la dirección entera. */
  readonly correoOculto: string;
  readonly expiresAt: Date;
}

/**
 * Tapa el correo dejando lo justo para reconocerlo.
 *
 * Quien abre el enlace ya demuestra que lo tiene, pero no que sea el invitado.
 * Enseñar `a***@empresa.com` deja a la persona comprobar que la invitación es
 * para ella sin regalar la dirección a quien haya podido interceptarla.
 */
export function ocultarCorreo(email: string): string {
  const arroba = email.lastIndexOf('@');
  if (arroba <= 0) return '***';
  const nombre = email.slice(0, arroba);
  const dominio = email.slice(arroba);
  const visible = nombre.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(nombre.length - 1, 1))}${dominio}`;
}

/**
 * Lee la invitación que hay detrás de un token, sin aceptarla.
 *
 * Sirve para la pantalla de aceptación: enseña de qué organización es y con qué
 * rol, antes de pedir nada. Devuelve `null` cuando el token no existe o ha
 * caducado, sin distinguir entre las dos cosas.
 */
export async function invitacionDelToken(
  tenantId: string,
  token: string,
  now: Date = new Date(),
): Promise<InvitacionVista | null> {
  const tokenHash = hashInvitationToken(token);
  return db().withTenant(tenantId, async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      include: { tenant: { select: { name: true } } },
    });
    if (!invitation) return null;
    if (invitation.expiresAt.getTime() <= now.getTime()) return null;
    return {
      id: invitation.id,
      tenantName: invitation.tenant.name,
      role: invitation.role,
      canViewCompensation: invitation.canViewCompensation,
      correoOculto: ocultarCorreo(invitation.email),
      expiresAt: invitation.expiresAt,
    };
  });
}

/**
 * El correo al que va la invitación, para mandarle el enlace de entrada.
 *
 * No sale de aquí hacia ninguna pantalla: lo usa el servidor para decidir a
 * qué dirección manda el enlace mágico, que es justo lo que evita que la
 * persona tenga que teclearla y que alguien teclee otra.
 */
export async function correoInvitado(
  tenantId: string,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const tokenHash = hashInvitationToken(token);
  return db().withTenant(tenantId, async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!invitation) return null;
    if (invitation.expiresAt.getTime() <= now.getTime()) return null;
    return invitation.email;
  });
}

/**
 * Si la invitación que hay abierta en el navegador es para esta dirección.
 *
 * Es lo que permite mandar el enlace de entrada a alguien que todavía no tiene
 * cuenta, sin dejar abierto el formulario de login para mandárselo a cualquiera.
 * La comprobación se hace dentro del tenant de la invitación, así que no hace
 * falta buscar por correo entre organizaciones.
 */
export async function invitacionEnCursoPara(
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const enCurso = await leerInvitacion();
  if (enCurso === null) return false;
  const correo = await correoInvitado(enCurso.tenantId, enCurso.token, now);
  return correo !== null && correo.toLowerCase() === email.trim().toLowerCase();
}

/** Una invitación pendiente, tal y como la ve quien administra la organización. */
export interface InvitacionPendiente {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly canViewCompensation: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /**
   * Si ya no vale. Se calcula aquí y no en la pantalla a propósito: mirar el
   * reloj mientras se pinta deja una pantalla cuyo resultado depende del
   * momento exacto en que se dibuja, y el linter de React lo prohíbe.
   */
  readonly caducada: boolean;
}

/** Las invitaciones sin aceptar del tenant, de la más reciente a la más vieja. */
export async function invitacionesPendientes(
  principal: Principal,
  now: Date = new Date(),
): Promise<readonly InvitacionPendiente[]> {
  return db().withTenant(principal.tenantId, async (tx) => {
    const filas = await tx.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        canViewCompensation: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    return filas.map((fila) => ({ ...fila, caducada: fila.expiresAt.getTime() <= now.getTime() }));
  });
}

/**
 * Revoca una invitación que todavía no se ha usado.
 *
 * Hasta ahora no había forma: un enlace repartido por error seguía valiendo
 * siete días y no se podía hacer nada. Se borra la fila, que es lo que hace
 * inservible al token, y queda la entrada de auditoría con quién la revocó.
 */
export async function revocarInvitacion(principal: Principal, invitationId: string): Promise<void> {
  await db().withTenant(principal.tenantId, async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new HttpError(404, 'invitation_not_found');
    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'invitation.revoked',
        entity: 'invitation',
        entityId: invitation.id,
        before: { role: invitation.role, canViewCompensation: invitation.canViewCompensation },
      },
    });
    await tx.invitation.delete({ where: { id: invitation.id } });
  });
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
