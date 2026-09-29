import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { MESES_DE_HISTORIA, SEMANAS_DE_HORAS } from '@/lib/demo';
import { borrarDemo, contarDemo, sembrarDemo } from '@/lib/demo-query';
import { can } from '@/lib/permissions';
import { requirePermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Datos de demostración: cargar y borrar.
 *
 * Existe porque la aplicación vacía no se puede juzgar, y porque teclear seis
 * meses de facturas para averiguar si el reparto run/change funciona no es una
 * forma razonable de probar nada.
 *
 * Lo que entra aquí no se disfraza de real: cada fila lleva `DEMO` delante y por
 * eso se puede quitar entera. Y lo hace sólo quien administra la organización,
 * porque escribe varios cientos de filas en datos que pueden ser de verdad.
 */

// La siembra escribe unas seiscientas filas en una sola transacción. Con el
// tiempo por defecto de una función se queda a medias y deshace el trabajo.
export const maxDuration = 60;

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  forbidden: 'Sólo quien administra la organización puede tocar los datos de demostración.',
  ya_existen: 'Ya hay datos de demostración cargados. Bórralos antes de volver a cargarlos.',
  fallo: 'No se ha podido escribir. No ha entrado nada: la siembra es una sola transacción.',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

async function cargar(): Promise<void> {
  'use server';
  const principal = await requirePrincipal();
  if (!can(principal, 'tenant:manage')) redirect('/demo?error=forbidden');

  let resumen: { filas: number } | null = null;
  try {
    resumen = await db().withTenant(principal.tenantId, async (tx) => {
      // Sembrar dos veces chocaría en las claves únicas, porque el conjunto es
      // el mismo para la misma organización. Vale más decirlo que dejar que
      // reviente a mitad.
      if ((await contarDemo(tx)) > 0) return null;
      const escrito = await sembrarDemo(tx, principal.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'demo.seeded',
          entity: 'tenant',
          entityId: principal.tenantId,
          after: { filas: escrito.filas },
        },
      });
      return escrito;
    });
  } catch {
    redirect('/demo?error=fallo');
  }

  if (resumen === null) redirect('/demo?error=ya_existen');
  redirect(`/demo?hecho=cargado&filas=${resumen.filas}`);
}

async function borrar(): Promise<void> {
  'use server';
  const principal = await requirePrincipal();
  if (!can(principal, 'tenant:manage')) redirect('/demo?error=forbidden');

  const borradas = await db().withTenant(principal.tenantId, async (tx) => {
    const cuantas = await borrarDemo(tx);
    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'demo.removed',
        entity: 'tenant',
        entityId: principal.tenantId,
        after: { filas: cuantas },
      },
    });
    return cuantas;
  });

  redirect(`/demo?hecho=borrado&filas=${borradas}`);
}

export default async function DemoPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requirePermission('tenant:manage');
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const hecho = texto(parametros['hecho']);
  const filas = texto(parametros['filas']);

  const cargados = await db().withTenant(principal.tenantId, (tx) => contarDemo(tx));

  return (
    <Shell actual="/demo">
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-2xl font-semibold">Datos de demostración</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido completar.'}
          </p>
        ) : null}
        {hecho !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            {hecho === 'cargado'
              ? `Cargadas ${filas} filas. Ya puedes mirar Gasto mensual, Contratos, Inmovilizado, Plantilla, Horas y Proyectos.`
              : `Borradas ${filas} filas. No queda nada de la demostración.`}
          </p>
        ) : null}

        <p className="text-sm">
          Carga un departamento de IT ficticio y completo para poder probar las pantallas sin
          teclear nada: {MESES_DE_HISTORIA} meses de facturas de ocho proveedores, diez personas con
          sus puestos y jornadas, seis contratos recurrentes, veinticuatro activos, cinco proyectos
          con su presupuesto y sus hitos, y {SEMANAS_DE_HORAS} semanas de partes de trabajo.
        </p>

        <div className="rounded border p-4 text-sm">
          <p className="mb-2 font-medium">Lo que conviene saber antes de darle</p>
          <p className="text-muted-foreground">
            Todas las filas llevan <span className="font-mono">DEMO</span> delante, en el nombre, el
            número de factura, el código de empleado o el número de serie según la tabla. Por eso se
            pueden borrar todas y no queda ni una suelta, y por eso no se confunden con las de
            verdad. Los proveedores son inventados: ninguna factura de este conjunto lleva el nombre
            de una empresa que exista.
          </p>
          <p className="text-muted-foreground mt-2">
            Se escribe dentro de esta organización, junto a tus datos reales si los tienes. Nada de
            lo tuyo se toca ni se borra.
          </p>
        </div>

        <div className="rounded border p-4">
          <p className="mb-3 text-sm">
            {cargados === 0
              ? 'Ahora mismo no hay datos de demostración cargados.'
              : `Ahora mismo hay datos de demostración cargados (${cargados} registros principales).`}
          </p>
          <div className="flex flex-wrap gap-3">
            <form action={cargar}>
              <Button type="submit" size="sm" disabled={cargados > 0}>
                Cargar datos de demostración
              </Button>
            </form>
            <form action={borrar}>
              <Button type="submit" size="sm" variant="outline" disabled={cargados === 0}>
                Borrar datos de demostración
              </Button>
            </form>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            La carga y el borrado quedan en el registro de auditoría con quién los hizo y cuántas
            filas movieron.
          </p>
        </div>
      </div>
    </Shell>
  );
}
