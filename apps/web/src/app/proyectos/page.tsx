import { MilestoneStatus, ProgressMethod, ProjectStatus } from '@itfin360/db';
import { Button, Input } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { formatearFecha, formatearImporte } from '@/lib/formato';
import { formatearDuracion } from '@/lib/horas';
import { can } from '@/lib/permissions';
import {
  aprobarBaseline,
  cambiarHito,
  guardarPlanificacion,
  listarProyectos,
} from '@/lib/proyecto-query';
import {
  altaBaseline,
  altaProyecto,
  cambioHito,
  escribirPlanificacion,
  ETIQUETA_ESTADO_HITO,
  ETIQUETA_ESTADO_PROYECTO,
  ETIQUETA_METODO,
  formatearIndice,
  formatearPorcentaje,
  parsearPlanificacion,
  semaforo,
  type Semaforo,
} from '@/lib/proyectos';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Proyectos: presupuesto aprobado, avance declarado y desviación.
 *
 * Las dos reglas que gobiernan esta pantalla están en `proyectos.ts` y las dos
 * son del criterio de aceptación. Una: re-planificar escribe una baseline nueva
 * y conserva la anterior, porque una desviación sólo significa algo contra un
 * número que no se ha movido. Otra: los pesos de los hitos suman el proyecto
 * entero o no se guarda nada.
 *
 * El coste real todavía no entra: convertir horas en dinero necesita las tarifas
 * por puesto, y sumar facturas y activos imputados es la tarea siguiente. Por
 * eso el CPI sale «sin datos» en vez de salir perfecto. Un proyecto sin coste
 * medido no va bien: va sin medir, y el comité tiene que poder distinguirlo.
 */

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  invalid_input: 'Revisa los datos: hacen falta al menos el código y el nombre.',
  code_exists: 'Ya hay un proyecto con ese código.',
  forbidden: 'Tu rol no puede tocar proyectos.',
  fechas: 'La fecha de fin no puede ser anterior a la de inicio.',
  sin_proyecto: 'Ese proyecto ya no existe.',
  pesos: 'Los pesos de los hitos tienen que sumar 100 %. No se ha guardado nada.',
  linea: 'Hay una línea mal escrita en la planificación. No se ha guardado nada.',
  sin_hitos: 'Los pesos de los hitos tienen que sumar 100 %.',
};

const COLOR_SEMAFORO: Readonly<Record<Semaforo, string>> = {
  bien: 'text-emerald-700',
  atencion: 'text-amber-700',
  mal: 'text-red-700',
  sin_datos: 'text-muted-foreground',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

function campoDe(formData: FormData) {
  return (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };
}

async function crearProyecto(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/proyectos?error=forbidden');

  const datos = altaProyecto.safeParse({
    code: campo('code'),
    name: campo('name'),
    description: campo('description'),
    status: campo('status'),
    progressMethod: campo('progressMethod'),
    service: campo('service'),
    costCenter: campo('costCenter'),
    sponsor: campo('sponsor'),
  });
  if (!datos.success) redirect('/proyectos?error=invalid_input');

  const entrada = datos.data;

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const proyecto = await tx.project.create({
        data: {
          tenantId: principal.tenantId,
          code: entrada.code,
          name: entrada.name,
          description: entrada.description ?? null,
          status: entrada.status ?? 'PLANNED',
          progressMethod: entrada.progressMethod ?? 'WEIGHTED_MILESTONES',
          service: entrada.service ?? null,
          costCenter: entrada.costCenter ?? null,
          sponsor: entrada.sponsor ?? null,
        },
        select: { id: true, code: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'project.created',
          entity: 'project',
          entityId: proyecto.id,
          after: { code: proyecto.code },
        },
      });
    });
  } catch {
    redirect('/proyectos?error=code_exists');
  }

  redirect('/proyectos?alta=proyecto');
}

async function crearBaseline(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/proyectos?error=forbidden');

  const datos = altaBaseline.safeParse({
    projectId: campo('projectId'),
    bacCents: campo('bac'),
    startDate: campo('startDate'),
    endDate: campo('endDate'),
    reason: campo('reason'),
    approvedBy: campo('approvedBy'),
  });
  if (!datos.success) redirect('/proyectos?error=invalid_input');

  const entrada = datos.data;

  const fallo = await db().withTenant(principal.tenantId, async (tx) => {
    const error = await aprobarBaseline(tx, principal.tenantId, {
      projectId: entrada.projectId,
      bacCents: entrada.bacCents,
      startDate: new Date(`${entrada.startDate}T00:00:00.000Z`),
      endDate: new Date(`${entrada.endDate}T00:00:00.000Z`),
      reason: entrada.reason,
      approvedBy: entrada.approvedBy,
      createdById: principal.userId,
    });
    if (error !== null) return error;

    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'project.baseline.approved',
        entity: 'project',
        entityId: entrada.projectId,
        after: { bacCents: entrada.bacCents, approvedBy: entrada.approvedBy },
      },
    });
    return null;
  });

  if (fallo !== null) redirect(`/proyectos?error=${fallo}`);
  redirect('/proyectos?alta=baseline');
}

async function guardarHitos(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/proyectos?error=forbidden');

  const projectId = campo('projectId');
  if (projectId === undefined) redirect('/proyectos?error=invalid_input');

  // Se valida antes de abrir la transacción: si los pesos no suman el proyecto
  // entero, no se escribe una sola fila. Es el criterio de aceptación.
  const plan = parsearPlanificacion(formData.get('plan')?.toString() ?? '');
  if (!plan.ok) redirect(`/proyectos?error=${plan.motivo === 'linea' ? 'linea' : 'pesos'}`);

  const fallo = await db().withTenant(principal.tenantId, (tx) =>
    guardarPlanificacion(tx, principal.tenantId, projectId, plan.hitos),
  );
  if (fallo !== null) redirect('/proyectos?error=pesos');

  redirect('/proyectos?alta=hitos');
}

async function actualizarHito(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/proyectos?error=forbidden');

  const datos = cambioHito.safeParse({
    milestoneId: campo('milestoneId'),
    status: campo('status'),
    progressBp: campo('progress'),
  });
  if (!datos.success) redirect('/proyectos?error=invalid_input');

  await db().withTenant(principal.tenantId, (tx) =>
    cambiarHito(tx, datos.data.milestoneId, datos.data.status, datos.data.progressBp ?? null),
  );

  redirect('/proyectos?alta=hito');
}

export default async function ProyectosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']);

  const { divisa, proyectos } = await db().withTenant(principal.tenantId, (tx) =>
    listarProyectos(tx),
  );
  const editable = can(principal, 'invoices:create');

  return (
    <Shell actual="/proyectos">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Proyectos</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido guardar.'}
          </p>
        ) : null}
        {alta !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            {alta === 'baseline'
              ? 'Baseline aprobada. La anterior se conserva en el historial.'
              : alta === 'hitos'
                ? 'Planificación guardada.'
                : alta === 'hito'
                  ? 'Hito actualizado.'
                  : 'Proyecto creado.'}
          </p>
        ) : null}

        {proyectos.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay proyectos. Crea el primero abajo y luego apruébale un presupuesto: sin
            baseline no hay contra qué medir la desviación.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Código</th>
                  <th className="p-2 font-medium">Proyecto</th>
                  <th className="p-2 font-medium">Estado</th>
                  <th className="p-2 text-right font-medium">Presupuesto</th>
                  <th className="p-2 text-right font-medium">Avance</th>
                  <th className="p-2 text-right font-medium">Previsto</th>
                  <th className="p-2 text-right font-medium">SPI</th>
                  <th className="p-2 text-right font-medium">CPI</th>
                  <th className="p-2 text-right font-medium">Horas</th>
                  <th className="p-2 text-right font-medium">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {proyectos.map((proyecto) => (
                  <tr key={proyecto.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{proyecto.code}</td>
                    <td className="p-2">
                      {proyecto.name}
                      <span className="text-muted-foreground ml-2 text-xs">
                        {proyecto.milestones.length} hitos ·{' '}
                        {ETIQUETA_METODO[proyecto.progressMethod]}
                      </span>
                    </td>
                    <td className="p-2">{ETIQUETA_ESTADO_PROYECTO[proyecto.status]}</td>
                    <td className="p-2 text-right tabular-nums">
                      {proyecto.vigente === null
                        ? '—'
                        : formatearImporte(proyecto.vigente.bacCents, divisa)}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearPorcentaje(proyecto.cuadro?.avanceReal ?? null)}
                    </td>
                    <td className="p-2 text-muted-foreground text-right tabular-nums">
                      {proyecto.cuadro === null
                        ? '—'
                        : formatearPorcentaje(proyecto.cuadro.avancePlanificado)}
                    </td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        COLOR_SEMAFORO[semaforo(proyecto.cuadro?.evm.spi ?? null)]
                      }`}
                    >
                      {formatearIndice(proyecto.cuadro?.evm.spi ?? null)}
                    </td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        COLOR_SEMAFORO[semaforo(proyecto.cuadro?.evm.cpi ?? null)]
                      }`}
                    >
                      {formatearIndice(proyecto.cuadro?.evm.cpi ?? null)}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {proyecto.minutosImputados === 0
                        ? '—'
                        : formatearDuracion(proyecto.minutosImputados)}
                    </td>
                    <td className="text-muted-foreground p-2 text-right text-xs tabular-nums">
                      {proyecto.vigente === null
                        ? 'sin aprobar'
                        : `v${proyecto.vigente.version} · ${formatearFecha(
                            proyecto.vigente.endDate.toISOString(),
                          )}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          El CPI sale «—» a propósito: el coste real de un proyecto necesita las tarifas por puesto
          y la imputación de facturas y activos, que es la tarea siguiente. Mientras tanto se
          enseñan las horas imputadas, que es de donde saldrá. El avance previsto es lineal entre el
          inicio y el fin de la baseline; el reparto mensual del presupuesto llega con el
          presupuesto anual.
        </p>

        {proyectos.map((proyecto) => (
          <section key={proyecto.id} className="rounded border p-4">
            <h2 className="mb-1 font-medium">
              <span className="font-mono text-xs">{proyecto.code}</span> · {proyecto.name}
            </h2>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-medium">
                  Historial de baselines
                </h3>
                {proyecto.baselines.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Sin presupuesto aprobado todavía.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {proyecto.baselines.map((baseline) => (
                        <tr key={baseline.id} className="border-b">
                          <td className="py-1 pr-2 font-mono text-xs">v{baseline.version}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {formatearImporte(baseline.bacCents, divisa)}
                          </td>
                          <td className="text-muted-foreground py-1 pr-2 text-xs">
                            {formatearFecha(baseline.startDate.toISOString())} –{' '}
                            {formatearFecha(baseline.endDate.toISOString())}
                          </td>
                          <td className="py-1 pr-2 text-xs">{baseline.reason}</td>
                          <td className="text-muted-foreground py-1 text-xs">
                            {baseline.approvedBy}
                            {baseline.isCurrent ? (
                              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                                vigente
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {editable ? (
                  <form action={crearBaseline} className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="projectId" value={proyecto.id} />
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Presupuesto
                      <Input name="bac" required placeholder="150000" className="w-32" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Inicio
                      <Input name="startDate" type="date" required className="w-36" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Fin
                      <Input name="endDate" type="date" required className="w-36" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Motivo
                      <Input name="reason" required maxLength={500} className="w-48" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Aprobado por
                      <Input name="approvedBy" required maxLength={200} className="w-40" />
                    </label>
                    <Button type="submit" size="sm" variant="outline">
                      Aprobar baseline
                    </Button>
                  </form>
                ) : null}
              </div>

              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-medium">Hitos</h3>
                {proyecto.milestones.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Sin planificar.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {proyecto.milestones.map((hito) => (
                        <tr key={hito.id} className="border-b">
                          <td className="py-1 pr-2">{hito.name}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {formatearPorcentaje(hito.weightBp / 10_000, 0)}
                          </td>
                          <td className="py-1 pr-2 text-xs">
                            {editable ? (
                              <form action={actualizarHito} className="flex items-center gap-1">
                                <input type="hidden" name="milestoneId" value={hito.id} />
                                <select
                                  name="status"
                                  defaultValue={hito.status}
                                  className="rounded border px-1 py-0.5 text-xs"
                                >
                                  {Object.keys(MilestoneStatus).map((estado) => (
                                    <option key={estado} value={estado}>
                                      {ETIQUETA_ESTADO_HITO[estado as keyof typeof MilestoneStatus]}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  name="progress"
                                  defaultValue={
                                    hito.progressBp === null ? '' : String(hito.progressBp / 100)
                                  }
                                  placeholder="%"
                                  className="w-12 rounded border px-1 py-0.5 text-xs"
                                />
                                <Button type="submit" size="sm" variant="outline">
                                  Ok
                                </Button>
                              </form>
                            ) : (
                              ETIQUETA_ESTADO_HITO[hito.status]
                            )}
                          </td>
                          <td className="text-muted-foreground py-1 text-xs">
                            {hito.plannedDate === null
                              ? ''
                              : formatearFecha(hito.plannedDate.toISOString())}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {editable ? (
                  <form action={guardarHitos} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={proyecto.id} />
                    <textarea
                      name="plan"
                      rows={5}
                      defaultValue={escribirPlanificacion(proyecto.milestones)}
                      placeholder={'Análisis | 20 | 2026-02-28\nDesarrollo | 50\nEntrega | 30'}
                      className="w-full rounded border px-3 py-2 font-mono text-xs"
                    />
                    <div className="flex items-center gap-3">
                      <Button type="submit" size="sm" variant="outline">
                        Guardar planificación
                      </Button>
                      <span className="text-muted-foreground text-xs">
                        Un hito por línea: nombre | peso % | fecha. Los pesos tienen que sumar 100
                        %.
                      </span>
                    </div>
                  </form>
                ) : null}
              </div>
            </div>
          </section>
        ))}

        {editable ? (
          <section className="max-w-4xl rounded border p-4">
            <h2 className="mb-3 font-medium">Nuevo proyecto</h2>
            <form action={crearProyecto} className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Código
                <Input
                  name="code"
                  required
                  maxLength={32}
                  placeholder="ERP-2026"
                  className="w-36"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nombre
                <Input name="name" required maxLength={200} className="w-64" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Estado
                <select name="status" defaultValue="PLANNED" className="rounded border px-3 py-2">
                  {Object.keys(ProjectStatus).map((estado) => (
                    <option key={estado} value={estado}>
                      {ETIQUETA_ESTADO_PROYECTO[estado as keyof typeof ProjectStatus]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Método de avance
                <select
                  name="progressMethod"
                  defaultValue="WEIGHTED_MILESTONES"
                  className="rounded border px-3 py-2"
                >
                  {Object.keys(ProgressMethod).map((metodo) => (
                    <option key={metodo} value={metodo}>
                      {ETIQUETA_METODO[metodo as keyof typeof ProgressMethod]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Servicio
                <Input name="service" maxLength={200} className="w-40" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Centro de coste
                <Input name="costCenter" maxLength={200} className="w-40" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Patrocinador
                <Input name="sponsor" maxLength={200} className="w-40" />
              </label>
              <Button type="submit" size="sm">
                Crear proyecto
              </Button>
            </form>
            <p className="text-muted-foreground mt-3 text-xs">
              El avance por hitos ponderados usa el avance declarado de cada hito. La regla 0/50/100
              lo ignora y cuenta 0, 0,5 o 1 según el estado: es más burda y más difícil de discutir,
              que en un comité suele ser una ventaja. El avance nunca se deduce del gasto.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
