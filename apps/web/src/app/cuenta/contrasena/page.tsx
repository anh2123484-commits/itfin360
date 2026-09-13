import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { auth } from '@/lib/auth';
import { contrasenaSchema, establecerContrasena } from '@/lib/auth/contrasena';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';

/**
 * Poner o cambiar la contraseña de la propia cuenta.
 *
 * Es el sustituto del registro público, que se ha quitado. La diferencia está
 * en quién puede llegar aquí: hace falta una sesión, y una sesión sólo se
 * consigue abriendo el enlace que llega al correo. Así la contraseña la pone
 * quien lee el buzón, no quien conoce la dirección.
 */

const MENSAJES: Record<string, string> = {
  datos: 'La contraseña nueva tiene que tener 12 caracteres o más.',
  contrasena_actual_no_coincide: 'La contraseña actual no es correcta.',
  correo_sin_verificar: 'Entra una vez con el enlace del correo y vuelve a intentarlo.',
  sin_sesion: 'La sesión ha caducado. Entra otra vez.',
};

async function guardar(formData: FormData) {
  'use server';
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) redirect('/login?callbackUrl=/cuenta/contrasena');

  const entrada = contrasenaSchema.safeParse({
    actual: String(formData.get('actual') ?? ''),
    nueva: String(formData.get('nueva') ?? ''),
  });
  if (!entrada.success) redirect('/cuenta/contrasena?error=datos');

  try {
    await establecerContrasena(db().identity, userId, entrada.data);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'datos';
    redirect(`/cuenta/contrasena?error=${code}`);
  }
  redirect('/cuenta/contrasena?guardada=1');
}

export default async function ContrasenaPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; guardada?: string }>;
}) {
  const { error, guardada } = await searchParams;

  return (
    <Shell actual="/cuenta/contrasena">
      <div className="flex max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Contraseña</h1>
          <p className="text-muted-foreground text-sm">
            Entrar con contraseña es más rápido que pedir un enlace cada vez. Si no pones ninguna,
            el enlace por correo sigue funcionando igual.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {MENSAJES[error] ?? MENSAJES['datos']}
          </p>
        ) : null}
        {guardada ? (
          <p role="status" className="text-sm text-emerald-700">
            Contraseña guardada.
          </p>
        ) : null}

        <form action={guardar} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Contraseña actual
            <input
              className="rounded border px-3 py-2"
              type="password"
              name="actual"
              autoComplete="current-password"
            />
            <span className="text-muted-foreground text-xs">
              Déjala vacía si todavía no tienes ninguna.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Contraseña nueva
            <input
              className="rounded border px-3 py-2"
              type="password"
              name="nueva"
              minLength={12}
              autoComplete="new-password"
              required
            />
            <span className="text-muted-foreground text-xs">
              Doce caracteres o más. Una frase que recuerdes vale más que ocho símbolos raros.
            </span>
          </label>

          <Button type="submit">Guardar</Button>
        </form>
      </div>
    </Shell>
  );
}
