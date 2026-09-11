import { Button } from '@itfin360/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/lib/auth';
import { can, type Permission } from '@/lib/permissions';
import { pickActiveMembership, readActiveTenantCookie, requireUser } from '@/lib/tenant-context';

/**
 * Marco de la aplicación: cabecera, secciones y tenant activo.
 *
 * Las secciones se filtran por permiso, pero eso es comodidad, no control: cada
 * ruta vuelve a comprobarlo en el servidor. Esconder un enlace ahorra un clic
 * que iba a acabar en 403; lo que impide de verdad el acceso está en la ruta y
 * en RLS.
 */

async function salir(): Promise<void> {
  'use server';
  await signOut({ redirectTo: '/login' });
}

interface Seccion {
  readonly href: string;
  readonly texto: string;
  /** Basta con tener uno de ellos. Vacío quiere decir que la ve cualquiera. */
  readonly permisos: readonly Permission[];
}

const SECCIONES: readonly Seccion[] = [
  { href: '/', texto: 'Inicio', permisos: [] },
  { href: '/facturas', texto: 'Facturas', permisos: ['invoices:read', 'invoices:create'] },
  { href: '/proveedores', texto: 'Proveedores', permisos: ['invoices:read', 'invoices:create'] },
];

export async function Shell({
  actual,
  children,
}: {
  readonly actual: string;
  readonly children: ReactNode;
}) {
  const { memberships } = await requireUser();
  const activo = pickActiveMembership(memberships, await readActiveTenantCookie());
  const visibles = SECCIONES.filter(
    (seccion) =>
      seccion.permisos.length === 0 ||
      (activo !== null && seccion.permisos.some((permiso) => can(activo, permiso))),
  );

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 p-4">
          <Link href="/" className="text-lg font-semibold">
            ITFin360
          </Link>
          <nav className="flex gap-1">
            {visibles.map((seccion) => (
              <Link
                key={seccion.href}
                href={seccion.href}
                aria-current={seccion.href === actual ? 'page' : undefined}
                className={
                  seccion.href === actual
                    ? 'bg-accent rounded-md px-3 py-1.5 text-sm font-medium'
                    : 'text-muted-foreground hover:bg-accent rounded-md px-3 py-1.5 text-sm'
                }
              >
                {seccion.texto}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {activo ? (
              <span className="text-muted-foreground text-sm">
                {activo.tenantName} · {activo.role}
              </span>
            ) : null}
            <form action={salir}>
              <Button type="submit" variant="outline" size="sm">
                Salir
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
