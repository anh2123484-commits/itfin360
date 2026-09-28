import type { TenantDb } from '@itfin360/db';

import {
  baselineVigente,
  CAMPOS_BASELINE,
  CAMPOS_HITO,
  CAMPOS_PROYECTO,
  cuadroProyecto,
  siguienteVersion,
  validarPesos,
} from '@/lib/proyectos';

/**
 * Consultas de proyectos. La fecha de corte se calcula aquí y no en la
 * pantalla: un componente que mira el calendario no se puede probar.
 *
 * El coste real todavía no entra en el cuadro. Las horas ya se pueden imputar a
 * un proyecto, pero convertirlas en dinero necesita las tarifas por puesto
 * (F4-03) y sumar facturas y activos imputados (F5-02). Hasta entonces el AC es
 * cero y el CPI sale `null`, que la pantalla enseña como «sin datos». Inventar
 * una tarifa media para que el número no salga vacío sería exactamente la clase
 * de dato que luego nadie sabe de dónde salió.
 */

export const LIMITE_POR_DEFECTO = 200;

/** Los proyectos con su baseline vigente, su avance y su cuadro EVM. */
export async function listarProyectos(tx: TenantDb, ahora: Date = new Date()) {
  const proyectos = await tx.project.findMany({
    select: {
      ...CAMPOS_PROYECTO,
      baselines: { select: CAMPOS_BASELINE, orderBy: { version: 'desc' as const } },
      milestones: { select: CAMPOS_HITO, orderBy: { position: 'asc' as const } },
    },
    orderBy: [{ status: 'asc' as const }, { code: 'asc' as const }],
    take: LIMITE_POR_DEFECTO,
  });

  // Suma en memoria y no con `groupBy`: son como mucho las imputaciones de los
  // proyectos del tenant, y así no hay una segunda forma de consultar lo mismo.
  const imputado = await tx.timeEntry.findMany({
    where: { projectId: { not: null } },
    select: { projectId: true, minutes: true },
    take: 20_000,
  });
  const minutosPorProyecto = new Map<string, number>();
  for (const fila of imputado) {
    if (fila.projectId === null) continue;
    minutosPorProyecto.set(
      fila.projectId,
      (minutosPorProyecto.get(fila.projectId) ?? 0) + fila.minutes,
    );
  }

  // La divisa del proyecto es la base del tenant: el EVM compara presupuesto y
  // gasto, y eso sólo significa algo en una sola moneda. RLS hace que esta
  // consulta devuelva exactamente la organización activa.
  const tenant = await tx.tenant.findFirst({ select: { baseCurrency: true } });

  return {
    divisa: tenant?.baseCurrency ?? 'EUR',
    proyectos: proyectos.map((proyecto) => {
      const vigente = baselineVigente(proyecto.baselines);
      return {
        ...proyecto,
        vigente,
        cuadro:
          vigente === null
            ? null
            : cuadroProyecto(vigente, proyecto.milestones, 0, ahora, proyecto.progressMethod),
        minutosImputados: minutosPorProyecto.get(proyecto.id) ?? 0,
      };
    }),
  };
}

/** Un proyecto con todo su historial de baselines y sus hitos. */
export async function proyectoConDetalle(tx: TenantDb, id: string, ahora: Date = new Date()) {
  const proyecto = await tx.project.findUnique({
    where: { id },
    select: {
      ...CAMPOS_PROYECTO,
      description: true,
      baselines: { select: CAMPOS_BASELINE, orderBy: { version: 'desc' as const } },
      milestones: { select: CAMPOS_HITO, orderBy: { position: 'asc' as const } },
    },
  });
  if (proyecto === null) return null;

  const vigente = baselineVigente(proyecto.baselines);
  return {
    ...proyecto,
    vigente,
    cuadro:
      vigente === null
        ? null
        : cuadroProyecto(vigente, proyecto.milestones, 0, ahora, proyecto.progressMethod),
  };
}

/** Los proyectos a los que se pueden imputar horas. */
export function proyectosImputables(tx: TenantDb) {
  return tx.project.findMany({
    where: { status: { in: ['PLANNED', 'ACTIVE', 'ON_HOLD'] } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' as const },
    take: LIMITE_POR_DEFECTO,
  });
}

export type ErrorBaseline = 'sin_proyecto' | 'fechas';

/**
 * Aprueba una baseline nueva conservando la anterior.
 *
 * El orden importa y no es casual: primero se apaga el `isCurrent` de las
 * anteriores y después se escribe la nueva. Al revés, el índice único parcial
 * de la base rechazaría el `INSERT` por haber dos vigentes a la vez —que es
 * justamente lo que ese índice está para impedir.
 *
 * Nada se sobrescribe ni se borra: la versión anterior se queda en la tabla con
 * su motivo, su aprobador y su fecha. Es lo que permite responder a «¿esto se
 * desvió, o se cambió el objetivo?» seis meses después.
 */
export async function aprobarBaseline(
  tx: TenantDb,
  tenantId: string,
  entrada: {
    readonly projectId: string;
    readonly bacCents: number;
    readonly startDate: Date;
    readonly endDate: Date;
    readonly reason: string;
    readonly approvedBy: string;
    readonly createdById: string | null;
  },
): Promise<ErrorBaseline | null> {
  if (entrada.endDate < entrada.startDate) return 'fechas';

  const proyecto = await tx.project.findUnique({
    where: { id: entrada.projectId },
    select: { id: true, baselines: { select: { version: true } } },
  });
  if (proyecto === null) return 'sin_proyecto';

  await tx.projectBaseline.updateMany({
    where: { projectId: entrada.projectId, isCurrent: true },
    data: { isCurrent: false },
  });

  await tx.projectBaseline.create({
    data: {
      tenantId,
      projectId: entrada.projectId,
      version: siguienteVersion(proyecto.baselines),
      bacCents: entrada.bacCents,
      startDate: entrada.startDate,
      endDate: entrada.endDate,
      reason: entrada.reason,
      approvedBy: entrada.approvedBy,
      isCurrent: true,
      createdById: entrada.createdById,
    },
    select: { id: true },
  });

  return null;
}

/**
 * Guarda la planificación entera del proyecto.
 *
 * Se valida antes de tocar nada: si los pesos no suman el proyecto entero, no se
 * escribe una sola fila. Ése es el criterio de aceptación —«los pesos deben
 * sumar 1 o el guardado falla»— y por eso la comprobación está aquí, en el
 * servidor, y no sólo en el formulario.
 *
 * Reemplaza el conjunto de hitos, pero **conserva el estado y el avance** de los
 * que se llaman igual. Replanificar suele ser mover fechas y repartir pesos, no
 * declarar que lo terminado ha dejado de estarlo; perder el estado en cada
 * edición haría que nadie se atreviera a tocar la planificación.
 */
export async function guardarPlanificacion(
  tx: TenantDb,
  tenantId: string,
  projectId: string,
  hitos: readonly {
    readonly name: string;
    readonly weightBp: number;
    readonly plannedDate: string | null;
  }[],
): Promise<'pesos' | null> {
  if (validarPesos(hitos, true) !== null) return 'pesos';

  const anteriores = await tx.milestone.findMany({
    where: { projectId },
    select: { name: true, status: true, progressBp: true, actualDate: true },
  });
  const porNombre = new Map(anteriores.map((hito) => [hito.name, hito]));

  await tx.milestone.deleteMany({ where: { projectId } });

  for (const [indice, hito] of hitos.entries()) {
    const anterior = porNombre.get(hito.name);
    await tx.milestone.create({
      data: {
        tenantId,
        projectId,
        name: hito.name,
        weightBp: hito.weightBp,
        plannedDate: hito.plannedDate === null ? null : new Date(hito.plannedDate),
        position: indice,
        status: anterior?.status ?? 'NOT_STARTED',
        progressBp: anterior?.progressBp ?? null,
        actualDate: anterior?.actualDate ?? null,
      },
      select: { id: true },
    });
  }

  return null;
}

/**
 * Cambia el estado y el avance declarado de un hito.
 *
 * `actualDate` se pone y se quita con el estado: un hito terminado tiene fecha
 * real y uno que deja de estarlo la pierde. La base lo exige con un `CHECK`, y
 * aquí se cumple en vez de esquivarlo.
 *
 * Un hito terminado no guarda avance declarado: está al 100 % por estar
 * terminado, y dejar un 80 % viejo conviviendo con «terminado» es una
 * contradicción que tarde o temprano alguien acaba leyendo como si fuera un dato.
 */
export async function cambiarHito(
  tx: TenantDb,
  milestoneId: string,
  estado: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED',
  avanceBp: number | null,
  ahora: Date = new Date(),
): Promise<void> {
  await tx.milestone.updateMany({
    where: { id: milestoneId },
    data: {
      status: estado,
      progressBp: estado === 'IN_PROGRESS' ? avanceBp : null,
      actualDate: estado === 'COMPLETED' ? ahora : null,
    },
  });
}
