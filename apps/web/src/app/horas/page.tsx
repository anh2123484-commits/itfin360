import { TimeActivity } from '@itfin360/db';
import { Button, Input } from '@itfin360/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { formatearFecha } from '@/lib/formato';
import {
  altaImputacion,
  ETIQUETA_ACTIVIDAD,
  formatearDuracion,
  formatearHora,
  validarImputacion,
} from '@/lib/horas';
import { imputacionesDelDia, semanaDeImputacion } from '@/lib/horas-query';
import { can } from '@/lib/permissions';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Imputación de horas, por semanas.
 *
 * Lo que se enseña arriba no es cuántas horas se han echado, sino cómo se
 * reparten: explotación contra proyecto, cuánto se ha repetido por retrabajo, y
 * sobre todo cuántas horas se pagan y no aparecen imputadas en ningún sitio.
 * Esa última cifra es la que nadie mide y la que suele explicar por qué un
 * departamento va siempre justo.
 */

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  invalid_input: 'Revisa los datos: hacen falta persona, fecha, duración y tipo de actividad.',
  solape: 'Esa hora se pisa con otra imputación del mismo día. Dos trabajos a la vez no existen.',
  excede_jornada:
    'Con esta imputación se pasa de la jornada de ese día. Si de verdad fueron horas extra, márcalo abajo.',
  forbidden: 'Tu rol no puede imputar horas.',
  sin_plantilla: 'Antes hace falta dar de alta a alguien en Plantilla.',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

function iso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

async function crear(formData: FormData): Promise<void> {
  'use server';
  const campo = (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };

  const principal = await requirePrincipal();
  if (!can(principal, 'time:log_own')) redirect('/horas?error=forbidden');

  const datos = altaImputacion.safeParse({
    employeeId: campo('employeeId'),
    entryDate: campo('entryDate'),
    minutes: campo('minutes'),
    startMinute: campo('startMinute'),
    activity: campo('activity'),
    service: campo('service'),
    description: campo('description'),
    isRework: formData.get('isRework') === 'on',
    isOvertime: formData.get('isOvertime') === 'on',
    isBillable: formData.get('isBillable') === 'on',
  });
  if (!datos.success) redirect('/horas?error=invalid_input');

  const entrada = datos.data;
  const fecha = new Date(`${entrada.entryDate}T00:00:00.000Z`);
  const semana = campo('semana') ?? '';
  const vuelta = semana === '' ? '' : `&semana=${semana}`;

  await db().withTenant(principal.tenantId, async (tx) => {
    const persona = await tx.employee.findUnique({
      where: { id: entrada.employeeId },
      select: { id: true, fteBp: true },
    });
    if (persona === null) redirect(`/horas?error=invalid_input${vuelta}`);

    // La validación se hace aquí, con las imputaciones que ya hay ese día, y no
    // en la pantalla: la pantalla no sabe lo que hay guardado y dos personas
    // rellenando el parte a la vez verían cada una su propia versión del día.
    const existentes = await imputacionesDelDia(tx, persona.id, fecha);
    const rechazo = validarImputacion(
      {
        minutes: entrada.minutes,
        startMinute: entrada.startMinute ?? null,
        isOvertime: entrada.isOvertime ?? false,
        activity: entrada.activity,
      },
      existentes,
      persona.fteBp,
    );
    if (rechazo !== null) redirect(`/horas?error=${rechazo.motivo}${vuelta}`);

    await tx.timeEntry.create({
      data: {
        tenantId: principal.tenantId,
        employeeId: persona.id,
        entryDate: fecha,
        minutes: entrada.minutes,
        startMinute: entrada.startMinute ?? null,
        activity: entrada.activity,
        service: entrada.service ?? null,
        description: entrada.description ?? null,
        isRework: entrada.isRework ?? false,
        isOvertime: entrada.isOvertime ?? false,
        isBillable: entrada.isBillable ?? false,
        createdById: principal.userId,
      },
      select: { id: true },
    });
  });

  redirect(`/horas?alta=ok${vuelta}`);
}

export default async function HorasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['time:log_own', 'invoices:read']);
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']) === 'ok';
  const semanaPedida = texto(parametros['semana']);

  const desdeParametro = /^\d{4}-\d{2}-\d{2}$/.test(semanaPedida)
    ? new Date(`${semanaPedida}T00:00:00.000Z`)
    : undefined;

  const { desde, hasta, laborables, filas, plantilla, resumen } = await db().withTenant(
    principal.tenantId,
    (tx) => semanaDeImputacion(tx, undefined, desdeParametro),
  );

  const DIA_MS = 24 * 60 * 60 * 1000;
  const semanaAnterior = iso(new Date(desde.getTime() - 7 * DIA_MS));
  const semanaSiguiente = iso(new Date(desde.getTime() + 7 * DIA_MS));
  const porcentaje = (valor: number | null): string =>
    valor === null ? '—' : `${Math.round(valor * 100)} %`;

  return (
    <Shell actual="/horas">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Horas</h1>
          <div className="flex items-center gap-2 text-sm">
            <Button asChild variant="outline" size="sm">
              <Link href={`/horas?semana=${semanaAnterior}`}>Semana anterior</Link>
            </Button>
            <span className="text-muted-foreground">
              {formatearFecha(desde.toISOString())} – {formatearFecha(hasta.toISOString())} ·{' '}
              {laborables} días laborables
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href={`/horas?semana=${semanaSiguiente}`}>Semana siguiente</Link>
            </Button>
          </div>
        </div>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido guardar la imputación.'}
          </p>
        ) : null}
        {alta ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Horas imputadas.
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Imputado</p>
            <p className="text-2xl font-semibold">{formatearDuracion(resumen.totalMinutos)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {porcentaje(resumen.reparto.utilization)} de las horas disponibles
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Explotación · Proyecto</p>
            <p className="text-2xl font-semibold">
              {porcentaje(resumen.reparto.runShare)} · {porcentaje(resumen.reparto.changeShare)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {formatearDuracion(resumen.runMinutos)} contra{' '}
              {formatearDuracion(resumen.changeMinutos)}
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Retrabajo</p>
            <p className="text-2xl font-semibold">{formatearDuracion(resumen.retrabajoMinutos)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Horas gastadas en repetir algo que ya estaba hecho
            </p>
          </div>
          <div className="rounded border border-amber-300 bg-amber-50 p-4">
            <p className="text-xs text-amber-900">Horas pagadas sin imputar</p>
            <p className="text-2xl font-semibold text-amber-900">
              {Math.round(resumen.reparto.unbookedHours)} h
            </p>
            <p className="mt-1 text-xs text-amber-900">
              {resumen.extraMinutos > 0
                ? `Y ${formatearDuracion(resumen.extraMinutos)} marcadas como extra`
                : 'Sin horas extra esta semana'}
            </p>
          </div>
        </section>

        <p className="text-muted-foreground text-xs">
          Las horas disponibles son la jornada de cada persona por los días laborables de la semana.
          Todavía no descuentan festivos ni vacaciones, así que una semana con un festivo dentro
          sale con utilización baja. Eso llega con el calendario del tenant.
        </p>

        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Esta semana no hay nada imputado. Añade la primera abajo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Día</th>
                  <th className="p-2 font-medium">Persona</th>
                  <th className="p-2 font-medium">Hora</th>
                  <th className="p-2 text-right font-medium">Duración</th>
                  <th className="p-2 font-medium">Actividad</th>
                  <th className="p-2 font-medium">Servicio</th>
                  <th className="p-2 font-medium">Marcas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} className="border-b">
                    <td className="p-2">{formatearFecha(fila.entryDate.toISOString())}</td>
                    <td className="p-2">{fila.employee.fullName}</td>
                    <td className="p-2 tabular-nums">{formatearHora(fila.startMinute)}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearDuracion(fila.minutes)}
                    </td>
                    <td className="p-2">{ETIQUETA_ACTIVIDAD[fila.activity]}</td>
                    <td className="p-2">{fila.service ?? ''}</td>
                    <td className="p-2 text-xs">
                      {fila.isOvertime ? (
                        <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                          extra
                        </span>
                      ) : null}
                      {fila.isRework ? (
                        <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 text-red-900">
                          retrabajo
                        </span>
                      ) : null}
                      {fila.isBillable ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                          facturable
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {can(principal, 'time:log_own') ? (
          <section className="max-w-4xl rounded border p-4">
            <h2 className="mb-3 font-medium">Imputar horas</h2>
            {plantilla.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Antes hace falta dar de alta a alguien en Plantilla. Las horas cuelgan de una
                persona.
              </p>
            ) : (
              <form action={crear} className="flex flex-wrap items-end gap-4">
                <input type="hidden" name="semana" value={iso(desde)} />
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Persona
                  <select name="employeeId" required className="w-52 rounded border px-3 py-2">
                    {plantilla.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {persona.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Día
                  <Input
                    name="entryDate"
                    type="date"
                    required
                    defaultValue={iso(desde)}
                    className="w-40"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Hora de inicio
                  <Input name="startMinute" type="time" className="w-32" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Duración
                  <Input name="minutes" required placeholder="1,5" className="w-28" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Actividad
                  <select name="activity" defaultValue="RUN" className="rounded border px-3 py-2">
                    {Object.keys(TimeActivity).map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {ETIQUETA_ACTIVIDAD[tipo as keyof typeof TimeActivity]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Servicio o proyecto
                  <Input name="service" maxLength={200} className="w-48" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Descripción
                  <Input name="description" maxLength={200} className="w-56" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isOvertime" className="size-4" />
                  Horas extra
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isRework" className="size-4" />
                  Retrabajo
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isBillable" className="size-4" />
                  Facturable
                </label>
                <Button type="submit" size="sm">
                  Imputar
                </Button>
              </form>
            )}
            <p className="text-muted-foreground mt-3 text-xs">
              La duración se escribe en horas (`1,5`) o en minutos con una eme al final (`90m`). La
              hora de inicio es opcional; si la pones, se comprueba que no se pise con otra
              imputación del mismo día. Y si un día se pasa de la jornada, hay que marcarlo como
              extra: no se bloquea, se cuenta.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
