import { redirect } from 'next/navigation';

import { guardarInvitacion } from '@/lib/invitacion-cookie';

/**
 * La puerta del enlace de invitación.
 *
 * Sólo hace una cosa: coger el token de la URL, meterlo en una cookie y mandar
 * a una dirección limpia. A partir de ahí nadie vuelve a ver el token, ni el
 * historial del navegador, ni el login, ni las pantallas de error.
 *
 * Es pública a propósito, y es la única de `/invitacion` que lo es. Quien abre
 * el enlace todavía no tiene cuenta; si esto pidiera sesión, el middleware
 * redirigiría a `/login?callbackUrl=/invitacion/...` y el token acabaría en el
 * query string del login, que es de lo que veníamos huyendo.
 */
export default async function EnlaceInvitacionPage({
  params,
}: {
  readonly params: Promise<{ tenantId: string; token: string }>;
}) {
  const { tenantId, token } = await params;
  const guardada = await guardarInvitacion(tenantId, token);
  // Un enlace con mala pinta va al mismo sitio que uno caducado: la pantalla de
  // aceptar dirá que no vale. Decir aquí «el token está mal formado» sólo
  // ayudaría a quien esté probando enlaces.
  redirect(guardada ? '/invitacion/aceptar' : '/invitacion/aceptar?error=invalida');
}
