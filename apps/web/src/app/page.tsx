import { Button } from '@itfin360/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { can, grantedPermissions } from '@/lib/permissions';
import {
  pickActiveMembership,
  readActiveTenantCookie,
  requireUser,
  switchActiveTenant,
} from '@/lib/tenant-context';
import { puedeCrearTenant } from '@/lib/tenants';

async function cambiarTenant(formData: FormData) {
  'use server';
  await switchActiveTenant(String(formData.get('tenantId') ?? ''));
  redirect('/');
}

export default async function HomePage() {
  const { userId, memberships } = await requireUser();
  const puedeCrear = await puedeCrearTenant(userId);

  // Antes, a quien no pertenecía a ninguna organización se le mandaba a
  // crearse una. Con el alta cerrada eso ya no tiene sentido: lo que le pasa a
  // esa persona es que su invitación no está aceptada o se la revocaron, y lo
  // que necesita es que alguien se lo diga, no un formulario que le va a dar
  // un 403.
  if (memberships.length === 0) {
    if (puedeCrear) redirect('/tenants/nuevo');
    return (
      <Shell actual="/">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 className="font-medium">No perteneces a ninguna organización</h2>
          <p className="text-muted-foreground text-sm">
            Tu cuenta existe, pero todavía no está dentro de ninguna. Pide a quien administra la
            organización que te invite: te llegará un enlace al correo y con él entras.
          </p>
        </div>
      </Shell>
    );
  }

  const active = pickActiveMembership(memberships, await readActiveTenantCookie());

  return (
    <Shell actual="/">
      <div className="flex max-w-2xl flex-col gap-8">
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
          {puedeCrear ? (
            <Link className="text-sm underline" href="/tenants/nuevo">
              Crear otra organización
            </Link>
          ) : null}
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
      </div>
    </Shell>
  );
}
