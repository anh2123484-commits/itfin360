import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { auth, signIn, signOut } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { borrarInvitacion, leerInvitacion } from '@/lib/invitacion-cookie';
import { acceptInvitation, correoInvitado, invitacionDelToken } from '@/lib/invitations';
import { ETIQUETA_ROL } from '@/lib/permissions';
import { writeActiveTenantCookie } from '@/lib/tenant-context';

/**
 * Aceptar una invitación.
 *
 * La pantalla tiene tres estados y los tres se resuelven aquí, sin que la
 * persona tenga que entender en cuál está:
 *
 * 1. Sin sesión: se le manda el enlace de entrada al correo de la invitación.
 *    No se le pide que lo escriba, entre otras cosas porque el servidor ya lo
 *    sabe y así nadie puede poner otro.
 * 2. Con sesión del correo invitado: un botón para entrar en la organización.
 * 3. Con sesión de otra cuenta: se dice, y se ofrece salir.
 *
 * En ningún caso aparece el token en la dirección: viene de la cookie que
 * dejó el enlace.
 */

const MENSAJES: Record<string, string> = {
  invalida: 'El enlace no es válido. Pide uno nuevo a quien te invitó.',
  invitation_not_found: 'La invitación no existe, ya se ha usado o se ha revocado.',
  invitation_expired: 'La invitación ha caducado. Pide una nueva.',
  invitation_email_mismatch: 'Esta invitación es para otra cuenta.',
  already_member: 'Ya perteneces a esta organización.',
  sin_invitacion: 'Abre otra vez el enlace que te llegó por correo.',
};

async function enviarEnlace() {
  'use server';
  const invitacion = await leerInvitacion();
  if (invitacion === null) redirect('/invitacion/aceptar?error=sin_invitacion');
  const correo = await correoInvitado(invitacion.tenantId, invitacion.token);
  if (correo === null) redirect('/invitacion/aceptar?error=invitation_not_found');
  // La dirección sale de la invitación, no de un campo del formulario: así el
  // enlace sólo puede ir al buzón al que se invitó.
  await signIn('nodemailer', { email: correo, redirectTo: '/invitacion/aceptar' });
}

async function aceptar() {
  'use server';
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (userId === undefined || !email) redirect('/invitacion/aceptar?error=sin_invitacion');

  const invitacion = await leerInvitacion();
  if (invitacion === null) redirect('/invitacion/aceptar?error=sin_invitacion');

  try {
    const membership = await acceptInvitation(
      { userId, email },
      invitacion.tenantId,
      invitacion.token,
    );
    await writeActiveTenantCookie(membership.tenantId);
    await borrarInvitacion();
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'invitation_not_found';
    redirect(`/invitacion/aceptar?error=${code}`);
  }
  redirect('/');
}

async function salir() {
  'use server';
  await signOut({ redirectTo: '/invitacion/aceptar' });
}

export default async function AceptarInvitacionPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const invitacion = await leerInvitacion();
  const vista =
    invitacion === null ? null : await invitacionDelToken(invitacion.tenantId, invitacion.token);
  const session = await auth();
  const correoSesion = session?.user?.email?.toLowerCase() ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Invitación</h1>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border bg-red-50 p-3 text-sm"
        >
          {MENSAJES[error] ?? MENSAJES['invitation_not_found']}
        </p>
      ) : null}

      {vista === null ? (
        <p className="text-muted-foreground text-sm">
          No hay ninguna invitación abierta. Abre el enlace que te llegó por correo; vale durante
          media hora desde que lo abres.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-md border p-4 text-sm">
            <p>
              Te han invitado a <strong>{vista.tenantName}</strong> como{' '}
              <strong>{ETIQUETA_ROL[vista.role]}</strong>.
            </p>
            <p className="text-muted-foreground">
              La invitación es para {vista.correoOculto}.
              {vista.canViewCompensation ? ' Incluye ver la retribución individual.' : ''}
            </p>
          </div>

          {correoSesion === null ? (
            <form action={enviarEnlace} className="flex flex-col gap-3">
              <p className="text-sm">
                Para aceptarla hay que comprobar que ese buzón es tuyo. Te mandamos un enlace y, al
                abrirlo, vuelves aquí.
              </p>
              <Button type="submit">Enviarme el enlace a {vista.correoOculto}</Button>
            </form>
          ) : (
            <form action={aceptar} className="flex flex-col gap-3">
              <p className="text-sm">
                Has entrado como <strong>{correoSesion}</strong>.
              </p>
              <Button type="submit">Entrar en {vista.tenantName}</Button>
            </form>
          )}

          {correoSesion !== null ? (
            <form action={salir}>
              <Button type="submit" variant="ghost" size="sm">
                No soy yo, salir de esta cuenta
              </Button>
            </form>
          ) : null}
        </>
      )}
    </main>
  );
}
