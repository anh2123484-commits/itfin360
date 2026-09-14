import { Button, Input } from '@itfin360/ui';

import { signIn } from '@/lib/auth';

/**
 * Entrada a la aplicación, con dos caminos que no son alternativos sino
 * consecutivos.
 *
 * Arriba, el enlace por correo: es por donde se entra la primera vez, cuando
 * acabas de recibir una invitación y todavía no tienes contraseña. Abajo, el
 * correo y la contraseña, que es por donde se entra a partir de entonces.
 *
 * Los dos bloques llevan campo de correo, y eso ya se prestó a confusión una
 * vez: con los recuadros casi invisibles, el segundo campo del bloque de abajo
 * no se veía y la contraseña acababa escrita en la casilla del correo. De ahí
 * que cada campo lleve su etiqueta encima, que el orden sea el de la vida real
 * (primero entrar, después volver a entrar) y que el botón principal sea el de
 * arriba.
 */

async function magicLink(formData: FormData) {
  'use server';
  await signIn('nodemailer', {
    email: String(formData.get('email') ?? ''),
    redirectTo: String(formData.get('callbackUrl') ?? '/'),
  });
}

async function password(formData: FormData) {
  'use server';
  await signIn('credentials', {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    redirectTo: String(formData.get('callbackUrl') ?? '/'),
  });
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = '/', error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 p-6">
      <h1 className="text-2xl font-semibold">Entrar en ITFin360</h1>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border bg-red-50 p-3 text-sm"
        >
          No se ha podido entrar. Comprueba el correo y la contraseña, y recuerda que son dos
          casillas distintas.
        </p>
      ) : null}

      <section className="flex flex-col gap-3" id="entrar-con-enlace">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Primera vez, o si no tienes contraseña</h2>
          <p className="text-muted-foreground text-sm">
            Te mandamos un enlace al correo y entras con él. Es lo que hay que hacer cuando acabas
            de recibir una invitación.
          </p>
        </div>
        <form action={magicLink} className="flex flex-col gap-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="correo-enlace">
            Correo
            <Input
              id="correo-enlace"
              type="email"
              name="email"
              placeholder="tu@empresa.example"
              autoComplete="email"
              required
            />
          </label>
          <Button type="submit">Enviarme un enlace</Button>
        </form>
      </section>

      <hr className="border-t" />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Ya tengo contraseña</h2>
          <p className="text-muted-foreground text-sm">
            La contraseña se pone desde dentro de la cuenta, en «Cuenta», después de haber entrado
            alguna vez con el enlace.
          </p>
        </div>
        <form action={password} className="flex flex-col gap-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="correo-contrasena">
            Correo
            <Input
              id="correo-contrasena"
              type="email"
              name="email"
              placeholder="tu@empresa.example"
              autoComplete="email"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="contrasena">
            Contraseña
            <Input
              id="contrasena"
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <Button type="submit" variant="outline">
            Entrar
          </Button>
        </form>
        {/*
          El camino para recuperar el acceso ya existía y estaba escondido: se
          pide un enlace arriba, se entra con él y se cambia la contraseña desde
          «Cuenta». Nadie lo deducía, porque la pantalla no lo decía y la gente
          busca el «he olvidado mi contraseña» de siempre. Es un enlace al
          bloque de arriba, no un procedimiento nuevo: dos formas distintas de
          recuperar el acceso serían dos formas distintas de equivocarse, y una
          de las dos acabaría siendo la más débil.
        */}
        <p className="text-muted-foreground text-sm">
          <a className="underline" href="#entrar-con-enlace">
            He olvidado la contraseña
          </a>{' '}
          · pide un enlace arriba, entra con él y ponte una nueva desde «Cuenta».
        </p>
      </section>

      <p className="text-muted-foreground text-sm">
        ITFin360 funciona por invitación. Si tu departamento ya lo usa, pide a quien lo administra
        que te invite y te llegará el enlace al correo.
      </p>
    </main>
  );
}
