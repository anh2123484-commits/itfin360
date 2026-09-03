import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { requireUser, writeActiveTenantCookie } from '@/lib/tenant-context';
import { createTenant, createTenantSchema } from '@/lib/tenants';

async function crear(formData: FormData) {
  'use server';
  const { userId } = await requireUser();
  const input = createTenantSchema.safeParse({
    name: formData.get('name'),
    baseCurrency: formData.get('baseCurrency'),
  });
  if (!input.success) redirect('/tenants/nuevo?error=1');
  const tenantId = await createTenant(userId, input.data);
  await writeActiveTenantCookie(tenantId);
  redirect('/');
}

export default async function NuevoTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Crear organización</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Revisa el nombre y la moneda (código ISO de 3 letras).
        </p>
      ) : null}
      <form action={crear} className="flex flex-col gap-3">
        <input
          className="rounded border px-3 py-2"
          name="name"
          placeholder="Nombre de la organización"
          maxLength={120}
          required
        />
        <input
          className="rounded border px-3 py-2"
          name="baseCurrency"
          defaultValue="EUR"
          maxLength={3}
          required
        />
        <Button type="submit">Crear</Button>
      </form>
    </main>
  );
}
