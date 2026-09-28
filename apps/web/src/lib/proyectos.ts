import { MilestoneStatus, ProgressMethod, ProjectStatus } from '@itfin360/db';
import {
  cents,
  type Evm,
  evm,
  projectProgress,
  valueOfProgress,
  type ProjectMilestone,
} from '@itfin360/finance-core';
import { z } from 'zod';

import { FECHA, IMPORTE } from '@/lib/contratos';

/**
 * Proyectos, baselines e hitos: validación, pesos y el puente con el motor EVM.
 *
 * Aquí se deciden dos cosas, y las dos son del criterio de aceptación de F5-01.
 *
 * La primera: **una re-baseline conserva la versión anterior**. Re-planificar no
 * edita el presupuesto, escribe una versión nueva. La desviación de un proyecto
 * sólo significa algo contra un número que no se ha movido; si la baseline se
 * pudiera sobrescribir, cualquier proyecto se podría dejar a cero de desviación
 * reescribiendo el objetivo, y el cuadro de mando diría que todo va bien justo
 * cuando ya no va bien.
 *
 * La segunda: **los pesos de los hitos suman uno o el guardado falla**. En
 * puntos básicos, 10000 exacto. No es una manía de validación: el avance del
 * proyecto es la suma ponderada de sus hitos, y unos pesos que suman 0,9 dan un
 * avance máximo del 90 % que nunca llega al final, mientras que unos que suman
 * 1,1 dan un proyecto terminado al 110 %. En los dos casos el EVM sale mal y
 * nadie sabe por qué.
 *
 * El avance **nunca** se deduce de horas consumidas ni de coste imputado. Eso
 * mide consumo, no avance, y es el error que hace que un proyecto parezca ir
 * bien hasta el día antes de la entrega.
 */

const TEXTO = z.string().trim().max(200);

export const ESTADO_PROYECTO = z.enum(ProjectStatus);
export const METODO_AVANCE = z.enum(ProgressMethod);
export const ESTADO_HITO = z.enum(MilestoneStatus);

/** El proyecto entero, en puntos básicos. */
export const PESO_TOTAL = 10_000;

/** Código de proyecto: corto, en mayúsculas, sin espacios. */
export const CODIGO = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/, 'código')
  .transform((valor) => valor.toUpperCase());

const FORMATO_PORCENTAJE = /^\d{1,3}([.,]\d{1,2})?$/;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `33,33` → `3333` puntos básicos. `null` si no es un porcentaje.
 *
 * Suelta y no envuelta en zod porque la usan dos sitios: el esquema del
 * formulario y el parseo de la planificación escrita a mano. Tener la conversión
 * en un solo sitio es lo que evita que un día el formulario redondee distinto
 * que el importador.
 */
export function porcentajeABp(texto: string): number | null {
  const limpio = texto.trim();
  if (!FORMATO_PORCENTAJE.test(limpio)) return null;
  return Math.round(Number(limpio.replace(',', '.')) * 100);
}

/** Porcentaje escrito por una persona (`33,33`) convertido a puntos básicos. */
export const PORCENTAJE = z
  .string()
  .trim()
  .regex(FORMATO_PORCENTAJE, 'porcentaje')
  .transform((valor) => Math.round(Number(valor.replace(',', '.')) * 100));

export const altaProyecto = z.object({
  code: CODIGO,
  name: TEXTO.min(1),
  description: z.string().trim().max(2000).optional(),
  status: ESTADO_PROYECTO.optional(),
  progressMethod: METODO_AVANCE.optional(),
  service: TEXTO.optional(),
  costCenter: TEXTO.optional(),
  sponsor: TEXTO.optional(),
  managerId: z.uuid().optional(),
});

export const altaBaseline = z.object({
  projectId: z.uuid(),
  bacCents: IMPORTE,
  startDate: FECHA,
  endDate: FECHA,
  reason: z.string().trim().min(1).max(500),
  approvedBy: TEXTO.min(1),
});

export const cambioHito = z.object({
  milestoneId: z.uuid(),
  status: ESTADO_HITO,
  progressBp: PORCENTAJE.optional(),
});

export const CAMPOS_PROYECTO = {
  id: true,
  code: true,
  name: true,
  status: true,
  progressMethod: true,
  service: true,
  costCenter: true,
  sponsor: true,
  manager: { select: { id: true, fullName: true } },
} as const;

export const CAMPOS_BASELINE = {
  id: true,
  version: true,
  bacCents: true,
  startDate: true,
  endDate: true,
  reason: true,
  approvedBy: true,
  approvedAt: true,
  isCurrent: true,
} as const;

export const CAMPOS_HITO = {
  id: true,
  name: true,
  weightBp: true,
  status: true,
  progressBp: true,
  plannedDate: true,
  actualDate: true,
  position: true,
} as const;

export const ETIQUETA_ESTADO_PROYECTO: Readonly<Record<keyof typeof ProjectStatus, string>> = {
  PLANNED: 'Planificado',
  ACTIVE: 'En curso',
  ON_HOLD: 'Parado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export const ETIQUETA_ESTADO_HITO: Readonly<Record<keyof typeof MilestoneStatus, string>> = {
  NOT_STARTED: 'Sin empezar',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Terminado',
};

export const ETIQUETA_METODO: Readonly<Record<keyof typeof ProgressMethod, string>> = {
  WEIGHTED_MILESTONES: 'Hitos ponderados',
  ZERO_FIFTY_HUNDRED: 'Regla 0/50/100',
};

/** Un hito, con lo mínimo para calcular el avance del proyecto. */
export interface HitoParaCalcular {
  readonly id: string;
  readonly weightBp: number;
  readonly status: keyof typeof MilestoneStatus;
  readonly progressBp: number | null;
}

/** Una baseline, con lo mínimo para situar el proyecto en el tiempo. */
export interface BaselineParaCalcular {
  readonly bacCents: number;
  readonly startDate: Date;
  readonly endDate: Date;
}

export type MotivoRechazoPesos = 'sin_hitos' | 'no_suman_uno';

export interface RechazoPesos {
  readonly motivo: MotivoRechazoPesos;
  /** Suma de los pesos, en puntos básicos. */
  readonly suma: number;
}

/**
 * ¿Se puede guardar este conjunto de hitos?
 *
 * La regla es que sumen 10000 puntos básicos exactos, ni uno más ni uno menos.
 * Tres hitos de un tercio son 3334 + 3333 + 3333: en puntos básicos eso suma
 * 10000 clavado, que es justo lo que no se consigue con `0.3333` repetido.
 *
 * Un proyecto **sin** hitos es legítimo —acaba de crearse y aún no se ha
 * planificado—, y por eso `sinHitosEsValido` existe: guardar cero hitos es
 * borrar la planificación, que es una acción distinta de guardar una mal hecha.
 */
export function validarPesos(
  hitos: readonly { readonly weightBp: number }[],
  sinHitosEsValido = false,
): RechazoPesos | null {
  const suma = hitos.reduce((total, hito) => total + hito.weightBp, 0);
  if (hitos.length === 0) {
    return sinHitosEsValido ? null : { motivo: 'sin_hitos', suma: 0 };
  }
  return suma === PESO_TOTAL ? null : { motivo: 'no_suman_uno', suma };
}

/** Lo que le falta o le sobra al conjunto para sumar el proyecto entero. */
export function pesoRestante(hitos: readonly { readonly weightBp: number }[]): number {
  return PESO_TOTAL - hitos.reduce((total, hito) => total + hito.weightBp, 0);
}

/** Un hito tal y como lo escribe quien planifica. */
export interface HitoEscrito {
  readonly name: string;
  readonly weightBp: number;
  readonly plannedDate: string | null;
}

export interface PlanificacionValida {
  readonly ok: true;
  readonly hitos: readonly HitoEscrito[];
}

export interface PlanificacionInvalida {
  readonly ok: false;
  readonly motivo: 'linea' | MotivoRechazoPesos;
  /** Número de línea con el problema, empezando en 1. Sólo para `linea`. */
  readonly linea?: number;
  readonly suma?: number;
}

const SEPARADOR = '|';

/**
 * La planificación entera, escrita de una vez.
 *
 * Un hito por línea: `Nombre | peso % | fecha`, con la fecha opcional. Se guarda
 * el conjunto completo y no hito a hito, y esa decisión es la que hace que el
 * criterio de aceptación se pueda cumplir sin volver loco a nadie: si los hitos
 * se añadieran de uno en uno, el primero al 40 % ya rompería la regla de que
 * sumen uno y habría que aceptar estados intermedios inválidos. Guardando el
 * conjunto, o cuadra y entra, o no cuadra y no entra.
 */
export function parsearPlanificacion(texto: string): PlanificacionValida | PlanificacionInvalida {
  const lineas = texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '');

  const hitos: HitoEscrito[] = [];
  for (const [indice, linea] of lineas.entries()) {
    const partes = linea.split(SEPARADOR).map((parte) => parte.trim());
    const nombre = partes[0] ?? '';
    const peso = porcentajeABp(partes[1] ?? '');
    const fecha = partes[2] === undefined || partes[2] === '' ? null : partes[2];

    if (nombre === '' || nombre.length > 200 || peso === null || peso <= 0) {
      return { ok: false, motivo: 'linea', linea: indice + 1 };
    }
    if (fecha !== null && !FORMATO_FECHA.test(fecha)) {
      return { ok: false, motivo: 'linea', linea: indice + 1 };
    }

    hitos.push({ name: nombre, weightBp: peso, plannedDate: fecha });
  }

  const rechazo = validarPesos(hitos, true);
  if (rechazo !== null) return { ok: false, motivo: rechazo.motivo, suma: rechazo.suma };

  return { ok: true, hitos };
}

/** La planificación de vuelta a texto, para volver a editarla. */
export function escribirPlanificacion(
  hitos: readonly {
    readonly name: string;
    readonly weightBp: number;
    readonly plannedDate: Date | null;
  }[],
): string {
  return hitos
    .map((hito) => {
      const peso = (hito.weightBp / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 });
      const fecha = hito.plannedDate === null ? '' : hito.plannedDate.toISOString().slice(0, 10);
      return fecha === '' ? `${hito.name} | ${peso}` : `${hito.name} | ${peso} | ${fecha}`;
    })
    .join('\n');
}

function aMilestone(hito: HitoParaCalcular): ProjectMilestone {
  return {
    id: hito.id,
    weight: hito.weightBp,
    status: hito.status,
    ...(hito.progressBp === null ? {} : { progress: hito.progressBp / PESO_TOTAL }),
  };
}

/**
 * Avance real del proyecto, de 0 a 1. `null` si no hay hitos.
 *
 * Se lo pregunta al motor: `projectProgress` ya sabe ponderar y aplicar la regla
 * 0/50/100. Aquí sólo se traduce la fila de la base a lo que el motor espera,
 * para que no haya una segunda versión de la fórmula en la aplicación.
 */
export function avanceReal(
  hitos: readonly HitoParaCalcular[],
  metodo: keyof typeof ProgressMethod = 'WEIGHTED_MILESTONES',
): number | null {
  return projectProgress(hitos.map(aMilestone), metodo);
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Avance planificado a una fecha, de 0 a 1, lineal entre el inicio y el fin de
 * la baseline.
 *
 * Lineal es una simplificación y conviene decirlo: un proyecto con el grueso del
 * gasto al final tiene una curva de valor planificado que no es una recta. La
 * alternativa —pedir el reparto mensual del presupuesto— es F6-03, y hasta
 * entonces la recta es la aproximación honesta: se entiende, no inventa una
 * curva y se puede sustituir sin tocar el resto.
 */
export function avancePlanificado(baseline: BaselineParaCalcular, aFecha: Date): number {
  const inicio = baseline.startDate.getTime();
  const fin = baseline.endDate.getTime();
  const corte = aFecha.getTime();
  if (corte <= inicio) return 0;
  if (corte >= fin) return 1;
  const total = fin - inicio;
  return total === 0 ? 1 : (corte - inicio) / total;
}

/** Días naturales de la baseline, los dos extremos incluidos. */
export function duracionEnDias(baseline: BaselineParaCalcular): number {
  return Math.round((baseline.endDate.getTime() - baseline.startDate.getTime()) / DIA_MS) + 1;
}

export interface CuadroProyecto {
  readonly avanceReal: number | null;
  readonly avancePlanificado: number;
  readonly evm: Evm;
}

/**
 * El cuadro EVM del proyecto a una fecha.
 *
 * `EV = BAC × avance real` y `PV = BAC × avance planificado`. Sin hitos no hay
 * avance real, y entonces el valor ganado es cero: un proyecto del que nadie ha
 * declarado qué lleva hecho no tiene valor ganado que enseñar, y el CPI sale
 * malo a propósito. Es preferible a suponer que va al ritmo previsto.
 */
export function cuadroProyecto(
  baseline: BaselineParaCalcular,
  hitos: readonly HitoParaCalcular[],
  costeRealCents: number,
  aFecha: Date,
  metodo: keyof typeof ProgressMethod = 'WEIGHTED_MILESTONES',
): CuadroProyecto {
  const real = avanceReal(hitos, metodo);
  const planificado = avancePlanificado(baseline, aFecha);
  const bac = cents(baseline.bacCents);

  return {
    avanceReal: real,
    avancePlanificado: planificado,
    evm: evm({
      bacCents: bac,
      evCents: valueOfProgress(bac, real ?? 0),
      acCents: cents(costeRealCents),
      pvCents: valueOfProgress(bac, planificado),
    }),
  };
}

/** La versión que le toca a la baseline siguiente. */
export function siguienteVersion(baselines: readonly { readonly version: number }[]): number {
  return baselines.reduce((mayor, b) => (b.version > mayor ? b.version : mayor), 0) + 1;
}

/** La baseline vigente, o `null` si el proyecto todavía no tiene ninguna. */
export function baselineVigente<T extends { readonly isCurrent: boolean }>(
  baselines: readonly T[],
): T | null {
  return baselines.find((b) => b.isCurrent) ?? null;
}

export type Semaforo = 'bien' | 'atencion' | 'mal' | 'sin_datos';

/** Umbrales por defecto de CPI y SPI. Configurables por tenant es F5-03. */
export const UMBRAL_ATENCION = 0.95;
export const UMBRAL_MALO = 0.85;

/**
 * El semáforo de un índice.
 *
 * `null` es `sin_datos`, no verde: un proyecto sin coste real todavía no tiene
 * un CPI perfecto, tiene un CPI que aún no se puede calcular, y el comité debe
 * poder distinguirlo. Pintarlo verde es la forma más rápida de que nadie mire un
 * proyecto que nadie ha empezado a medir.
 */
export function semaforo(indice: number | null): Semaforo {
  if (indice === null) return 'sin_datos';
  if (indice < UMBRAL_MALO) return 'mal';
  if (indice < UMBRAL_ATENCION) return 'atencion';
  return 'bien';
}

/** `0.3333` → `33,3 %`. Para pantalla, nunca para calcular. */
export function formatearPorcentaje(proporcion: number | null, decimales = 1): string {
  if (proporcion === null) return '—';
  return `${(proporcion * 100).toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} %`;
}

/** `9500` → `0,95`. Para pantalla. */
export function formatearIndice(indice: number | null): string {
  return indice === null ? '—' : indice.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
