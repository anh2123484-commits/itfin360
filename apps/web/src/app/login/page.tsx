import { Button } from '@itfin360/ui';
import Link from 'next/link';

import { signIn } from '@/lib/auth';

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
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = '/', error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 p-6">
      <h1 className="text-2xl font-semibold">Entrar en ITFin360</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          No se ha podido iniciar sesión. Revisa los datos e inténtalo de nuevo.
        </p>
      ) : null}

      <form action={magicLink} className="flex flex-col gap-3">
        <h2 className="font-medium">Enlace por correo</h2>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <input
          className="rounded border px-3 py-2"
          type="email"
          name="email"
          placeholder="tu@empresa.example"
          autoComplete="email"
          required
        />
        <Button type="submit">Enviarme un enlace</Button>
      </form>

      <form action={password} className="flex flex-col gap-3">
        <h2 className="font-medium">Contraseña</h2>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <input
          className="rounded border px-3 py-2"
          type="email"
          name="email"
          placeholder="tu@empresa.example"
          autoComplete="email"
          required
        />
        <input
          className="rounded border px-3 py-2"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="outline">
          Entrar
        </Button>
        <Link className="text-muted-foreground text-sm underline" href="/registro">
          Crear cuenta con contraseña
        </Link>
      </form>
    </main>
  );
}
