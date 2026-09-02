import { Button } from '@itfin360/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/lib/auth';
import { can, grantedPermissions } from '@/lib/permissions';
import {
  pickActiveMembership,
  readActiveTenantCookie,
  requireUser,
  switchActiveTenant,
} from '@/lib/tenant-context';

async function cambiarTenant(formData: FormData) {
  'use server';
  await switchActiveTenant(String(formData.get('tenantId') ?? ''));
  redirect('/');
}

async function salir() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

export default async function HomePage() {
  const { memberships } = await requireUser();
  if (memberships.length === 0) redirect('/tenants/nuevo');
  const active = pickActiveMembership(memberships, await readActiveTenantCookie());

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">ITFin360</h1>
        <form action={salir}>
          <Button type="submit" variant="outline" size="sm">
            Salir
          </Button>
        </form>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Tenant activo</h2>
        {active ? (
          <p className="text-sm">
            <strong>{active.tenantName}</strong> · rol {active.role}
            {active.canViewCompensation ? ' · ve retribución individual' : ''}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Elige un tenant.</p>
        )}
        <form action={cambiarTenant} className="flex gap-2">
          <select
            name="tenantId"
            className="rounded border px-3 py-2"
            defaultValue={active?.tenantId}
          >
            {memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.tenantName} ({m.role})
              </option>
            ))}
          </select>
          <Button type="submit" size="sm">
            Cambiar
          </Button>
        </form>
        <Link className="text-sm underline" href="/tenants/nuevo">
          Crear otro tenant
        </Link>
      </section>

      {active ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Permisos en este tenant</h2>
          <ul className="text-muted-foreground grid grid-cols-2 gap-1 text-sm">
            {grantedPermissions(active).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {can(active, 'members:invite') ? (
            <Link className="text-sm underline" href="/invitaciones/nueva">
              Invitar a alguien
            </Link>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
