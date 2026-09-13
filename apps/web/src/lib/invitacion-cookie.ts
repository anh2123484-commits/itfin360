import { cookies } from 'next/headers';

import {
  deserializarInvitacion,
  esInvitacionValida,
  type InvitacionEnCurso,
  serializarInvitacion,
} from '@/lib/invitacion-token';

/**
 * La invitación en curso, guardada en una cookie en vez de en la URL.
 *
 * El formato y la validación están en `lib/invitacion-token.ts`; aquí sólo se
 * lee y se escribe la cookie.
 *
 * Media hora de vida. Es tiempo de sobra para abrir el correo y aceptar, y poco
 * para que se quede olvidada en un ordenador compartido.
 */

export const COOKIE_INVITACION = 'itfin360_invitacion';

const VIDA_SEGUNDOS = 30 * 60;

/** Guarda la invitación en curso. Devuelve `false` si el enlace no vale. */
export async function guardarInvitacion(tenantId: string, token: string): Promise<boolean> {
  if (!esInvitacionValida(tenantId, token)) return false;
  (await cookies()).set(COOKIE_INVITACION, serializarInvitacion({ tenantId, token }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIDA_SEGUNDOS,
  });
  return true;
}

/** La invitación en curso, si hay alguna. */
export async function leerInvitacion(): Promise<InvitacionEnCurso | null> {
  return deserializarInvitacion((await cookies()).get(COOKIE_INVITACION)?.value);
}

/** Borra la cookie. Se llama al aceptar. */
export async function borrarInvitacion(): Promise<void> {
  (await cookies()).delete(COOKIE_INVITACION);
}
