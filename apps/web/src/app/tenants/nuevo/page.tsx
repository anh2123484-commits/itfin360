import { Button, Input } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { requireUser, writeActiveTenantCookie } from '@/lib/tenant-context';
import { createTenant, createTenantSchema, puedeCrearTenant } from '@/lib/tenants';

async function crear(formData: FormData) {
  'use server';
  const { userId } = await requireUser();
  const input = createTenantSchema.safeParse({
    name: formData.get('name'),
    baseCurrency: formData.get('baseCurrency'),
  });
  if (!input.success) redirect('/tenants/nuevo?error=1');
  // `createTenant` vuelve a comprobar la autorización. Aquí no se comprueba
  // nada: lo que decide es el servidor, no esta pantalla.
  const tenantId = await createTenant(userId, input.data);
  await writeActiveTenantCookie(tenantId);
  redirect('/');
}

export default async function NuevoTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { userId } = await requireUser();
  const autorizado = await puedeCrearTenant(userId);
  const { error } = await searchParams;

  if (!autorizado) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Aquí no se dan de alta organizaciones</h1>
        <p className="text-muted-foreground text-sm">
          Las organizaciones de ITFin360 las da de alta NovaEra Nexus. Si necesitas una, escríbeles
          y te la crean con tu cuenta ya dentro.
        </p>
        <p className="text-muted-foreground text-sm">
          Si lo que quieres es entrar en una organización que ya existe, pide a quien la administra
          que te invite: te llegará un enlace al correo.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Crear organización</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Revisa el nombre y la moneda (código ISO de 3 letras).
        </p>
      ) : null}
      <form action={crear} className="flex flex-col gap-4">
        {/*
          Los dos campos llevaban el texto dentro y ninguna etiqueta, que es el
          mismo fallo que se arregló en el login: el texto de ejemplo desaparece
          al escribir y ya nadie sabe qué había ahí. Y el de la moneda no tenía
          ni eso, sólo `EUR` puesto, sin decir qué era.
        */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="name">
            Nombre de la organización
          </label>
          <Input id="name" name="name" maxLength={120} required autoComplete="organization" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="baseCurrency">
            Moneda base
          </label>
          <Input
            id="baseCurrency"
            name="baseCurrency"
            defaultValue="EUR"
            maxLength={3}
            required
            aria-describedby="moneda-ayuda"
          />
          <p id="moneda-ayuda" className="text-muted-foreground text-xs">
            La moneda en la que se consolidan todos los importes de esta organización. Código de
            tres letras: EUR, USD, GBP. Se puede cambiar después, pero rehacer los cálculos cuesta.
          </p>
        </div>

        <Button type="submit">Crear</Button>
      </form>
    </main>
  );
}
