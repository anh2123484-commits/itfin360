import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { currentUserId } from '@/lib/auth';
import { registerSchema, registerWithPassword } from '@/lib/auth/register';

async function registrar(formData: FormData) {
  'use server';
  const input = registerSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    password: formData.get('password'),
  });
  if (!input.success) redirect('/registro?error=1');
  try {
    await registerWithPassword(input.data, await currentUserId());
  } catch {
    redirect('/registro?error=1');
  }
  redirect('/login');
}

export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Crear cuenta</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          No se ha podido crear la cuenta. Comprueba los datos (contraseña de 12 caracteres o más).
        </p>
      ) : null}
      <form action={registrar} className="flex flex-col gap-3">
        <input className="rounded border px-3 py-2" name="name" placeholder="Nombre" required />
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
          minLength={12}
          autoComplete="new-password"
          required
        />
        <Button type="submit">Crear cuenta</Button>
      </form>
    </main>
  );
}
