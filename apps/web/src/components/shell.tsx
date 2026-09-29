import { Button } from '@itfin360/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/lib/auth';
import { can, type Permission } from '@/lib/permissions';
import { pickActiveMembership, readActiveTenantCookie, requireUser } from '@/lib/tenant-context';

/**
 * Marco de la aplicación: cabecera, barra lateral y tenant activo.
 *
 * La navegación es vertical y agrupada. En horizontal no cabía: cada fase del
 * backlog añade una sección y la barra crecía hasta salirse de la pantalla, así
 * que el sitio donde se añaden secciones tiene que ser el que no se llena.
 *
 * Los grupos se pliegan con `<details>`, que es HTML y no JavaScript. Esto es un
 * componente de servidor: convertirlo en cliente para abrir y cerrar un menú
 * arrastraría toda la barra al navegador y con ella el cálculo de permisos.
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

interface Grupo {
  readonly titulo: string;
  readonly secciones: readonly Seccion[];
}

const LECTURA: readonly Permission[] = ['invoices:read', 'invoices:create'];

/**
 * Los grupos siguen la pregunta que responde cada pantalla, no la fase del
 * backlog en la que se construyó: en qué se va el dinero, a qué estamos atados,
 * quién lo hace y qué estamos entregando.
 */
const GRUPOS: readonly Grupo[] = [
  {
    titulo: 'Gasto',
    secciones: [
      {
        href: '/gastos',
        texto: 'Gasto mensual',
        permisos: ['invoices:read', 'dashboards:showback'],
      },
      { href: '/facturas', texto: 'Facturas', permisos: LECTURA },
      { href: '/proveedores', texto: 'Proveedores', permisos: LECTURA },
    ],
  },
  {
    titulo: 'Compromisos',
    secciones: [
      { href: '/contratos', texto: 'Contratos', permisos: LECTURA },
      { href: '/activos', texto: 'Inmovilizado', permisos: LECTURA },
    ],
  },
  {
    titulo: 'Equipo',
    secciones: [
      { href: '/personal', texto: 'Plantilla', permisos: LECTURA },
      { href: '/horas', texto: 'Horas', permisos: ['time:log_own', 'invoices:read'] },
    ],
  },
  {
    titulo: 'Entrega',
    secciones: [{ href: '/proyectos', texto: 'Proyectos', permisos: LECTURA }],
  },
  {
    titulo: 'Administración',
    secciones: [
      { href: '/invitaciones', texto: 'Invitaciones', permisos: ['members:invite'] },
      { href: '/cuenta/contrasena', texto: 'Cuenta', permisos: [] },
    ],
  },
];

const CLASE_ENLACE = 'block rounded-md px-3 py-1.5 text-sm';
const CLASE_ACTIVO = `${CLASE_ENLACE} bg-accent font-medium`;
const CLASE_NORMAL = `${CLASE_ENLACE} text-muted-foreground hover:bg-accent`;

export async function Shell({
  actual,
  children,
}: {
  readonly actual: string;
  readonly children: ReactNode;
}) {
  const { memberships } = await requireUser();
  const activo = pickActiveMembership(memberships, await readActiveTenantCookie());

  const puede = (seccion: Seccion): boolean =>
    seccion.permisos.length === 0 ||
    (activo !== null && seccion.permisos.some((permiso) => can(activo, permiso)));

  const visibles = GRUPOS.map((grupo) => ({
    ...grupo,
    secciones: grupo.secciones.filter(puede),
  })).filter((grupo) => grupo.secciones.length > 0);

  const navegacion = (
    <nav className="flex flex-col gap-1">
      <Link
        href="/"
        aria-current={actual === '/' ? 'page' : undefined}
        className={actual === '/' ? CLASE_ACTIVO : CLASE_NORMAL}
      >
        Inicio
      </Link>
      {visibles.map((grupo) => {
        // Abierto si la pantalla que se está viendo cuelga de este grupo: al
        // navegar, el grupo en el que estás no se cierra en la cara.
        const dentro = grupo.secciones.some((seccion) => seccion.href === actual);
        return (
          <details key={grupo.titulo} open={dentro} className="mt-2">
            <summary className="text-muted-foreground cursor-pointer px-3 py-1 text-xs font-medium tracking-wide uppercase">
              {grupo.titulo}
            </summary>
            <div className="mt-1 flex flex-col gap-0.5">
              {grupo.secciones.map((seccion) => (
                <Link
                  key={seccion.href}
                  href={seccion.href}
                  aria-current={seccion.href === actual ? 'page' : undefined}
                  className={seccion.href === actual ? CLASE_ACTIVO : CLASE_NORMAL}
                >
                  {seccion.texto}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 p-4">
          <Link href="/" className="text-lg font-semibold">
            ITFin360
          </Link>
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

      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:flex-row">
        {/* En pantalla ancha la barra está siempre a la vista; en móvil se pliega
            entera detrás de un desplegable para no comerse la primera pantalla. */}
        <aside className="hidden w-52 shrink-0 lg:block">{navegacion}</aside>
        <details className="lg:hidden">
          <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium">
            Secciones
          </summary>
          <div className="mt-2">{navegacion}</div>
        </details>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
