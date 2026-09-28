import { TimeActivity } from '@itfin360/db';
import { cents, utilization, type Utilization } from '@itfin360/finance-core';
import { z } from 'zod';

import { FECHA } from '@/lib/contratos';
import { FTE_COMPLETO } from '@/lib/personal';

/**
 * Imputación de horas: validación, solapes y reparto del tiempo.
 *
 * Una imputación es media hora de la vida de alguien convertida en un número.
 * De aquí salen la utilización, el ratio run/change y el coste de lo que no se
 * imputa, así que lo que se valida aquí decide si esos números significan algo.
 *
 * Todo en minutos enteros. Media hora es 30, no 0,5: con horas decimales,
 * veinte minutos son 0,333… y un mes de partes de trabajo acaba desviado lo
 * suficiente como para que alguien tenga que explicar el descuadre.
 */

const TEXTO = z.string().trim().max(200);

export const ACTIVIDAD = z.enum(TimeActivity);

/** Jornada diaria completa de referencia, en minutos. Ocho horas. */
export const JORNADA_DIARIA_MINUTOS = 480;

/** Duración escrita por una persona: `7,5`, `7.5` o `450m`. */
export const DURACION = z
  .string()
  .trim()
  .regex(/^(\d{1,2}([.,]\d{1,2})?|\d{1,4}m)$/i, 'duración')
  .transform((valor) =>
    valor.toLowerCase().endsWith('m')
      ? Number(valor.slice(0, -1))
      : Math.round(Number(valor.replace(',', '.')) * 60),
  );

/** Hora del día `HH:MM`, convertida a minutos desde medianoche. */
export const HORA = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
  .transform((valor) => {
    const [h, m] = valor.split(':');
    return Number(h) * 60 + Number(m);
  });

export const altaImputacion = z.object({
  employeeId: z.uuid(),
  projectId: z.uuid().optional(),
  entryDate: FECHA,
  minutes: DURACION,
  startMinute: HORA.optional(),
  activity: ACTIVIDAD,
  service: TEXTO.optional(),
  description: TEXTO.optional(),
  isRework: z.boolean().optional(),
  isOvertime: z.boolean().optional(),
  isBillable: z.boolean().optional(),
});

export const CAMPOS_IMPUTACION = {
  id: true,
  entryDate: true,
  minutes: true,
  startMinute: true,
  activity: true,
  service: true,
  description: true,
  isRework: true,
  isOvertime: true,
  isBillable: true,
  employee: { select: { id: true, fullName: true, fteBp: true } },
  project: { select: { id: true, code: true } },
} as const;

export const ETIQUETA_ACTIVIDAD: Readonly<Record<keyof typeof TimeActivity, string>> = {
  RUN: 'Explotación',
  CHANGE: 'Proyecto',
  INTERNAL: 'Interno',
  ABSENCE: 'Ausencia',
};

/** Una imputación, con lo mínimo para validarla contra las demás del día. */
export interface ImputacionParaValidar {
  readonly id?: string;
  readonly minutes: number;
  readonly startMinute: number | null;
  readonly isOvertime: boolean;
  readonly activity: keyof typeof TimeActivity;
}

/** Minutos de jornada diaria de quien tiene esta jornada contratada. */
export function jornadaDiaria(fteBp: number): number {
  return Math.round((JORNADA_DIARIA_MINUTOS * fteBp) / FTE_COMPLETO);
}

/**
 * ¿Se pisan dos imputaciones?
 *
 * Sólo se puede saber cuando las dos llevan hora de inicio. Si a una le falta,
 * la respuesta es que no se sabe, y esto devuelve `false`: inventarse un solape
 * sobre un dato que no existe haría que la pantalla rechazara partes correctos,
 * y el resultado sería que nadie los rellena.
 *
 * El final de una y el principio de la siguiente pueden coincidir: de nueve a
 * once y de once a doce no se pisan.
 */
export function solapan(a: ImputacionParaValidar, b: ImputacionParaValidar): boolean {
  if (a.startMinute === null || b.startMinute === null) return false;
  const finA = a.startMinute + a.minutes;
  const finB = b.startMinute + b.minutes;
  return a.startMinute < finB && b.startMinute < finA;
}

/** Minutos que cuentan como jornada. Una ausencia no es trabajo imputado. */
export function cuentaComoJornada(entrada: ImputacionParaValidar): boolean {
  return entrada.activity !== 'ABSENCE';
}

export type MotivoRechazo = 'solape' | 'excede_jornada';

export interface Rechazo {
  readonly motivo: MotivoRechazo;
  /** Minutos imputados ese día contando la nueva entrada. */
  readonly totalMinutos: number;
  readonly disponibles: number;
}

/**
 * ¿Se puede guardar esta imputación?
 *
 * Dos comprobaciones, las dos del criterio de aceptación de F4-04.
 *
 * La primera, el solape: dos trabajos a la vez no existen, y si el parte dice
 * que sí, una de las dos horas está mal apuntada.
 *
 * La segunda, el exceso de jornada. Y aquí la palabra que importa es «sin»: no
 * se pueden imputar más horas de las disponibles **sin marcarlo como extra**.
 * Las horas extra existen. Un sistema que las rechaza de plano consigue que se
 * apunten repartidas por otros días, que es la única forma segura de perderlas
 * de vista. Se dejan pasar, marcadas, para que se puedan contar y para que
 * alguien pueda mirar a fin de mes cuántas hubo.
 */
export function validarImputacion(
  nueva: ImputacionParaValidar,
  existentesDelDia: readonly ImputacionParaValidar[],
  fteBp: number,
): Rechazo | null {
  const otras = existentesDelDia.filter((e) => e.id === undefined || e.id !== nueva.id);

  const disponibles = jornadaDiaria(fteBp);
  const totalMinutos =
    (cuentaComoJornada(nueva) ? nueva.minutes : 0) +
    otras.filter(cuentaComoJornada).reduce((total, e) => total + e.minutes, 0);

  for (const otra of otras) {
    if (solapan(nueva, otra)) return { motivo: 'solape', totalMinutos, disponibles };
  }

  if (!nueva.isOvertime && totalMinutos > disponibles) {
    return { motivo: 'excede_jornada', totalMinutos, disponibles };
  }

  return null;
}

export interface ResumenHoras {
  readonly totalMinutos: number;
  readonly runMinutos: number;
  readonly changeMinutos: number;
  readonly internoMinutos: number;
  readonly ausenciaMinutos: number;
  readonly retrabajoMinutos: number;
  readonly extraMinutos: number;
  readonly facturableMinutos: number;
  /** Reparto del tiempo según `finance-core`, con las horas disponibles dadas. */
  readonly reparto: Utilization;
}

const MINUTOS_POR_HORA = 60;

/**
 * El periodo en cifras.
 *
 * Las horas disponibles entran por parámetro porque dependen del calendario y
 * de las vacaciones, que son de otra tarea. Aquí sólo se suma lo imputado y se
 * le pasa al motor, que es quien sabe traducirlo a utilización y a coste
 * invisible.
 */
export function resumenHoras(
  entradas: readonly (ImputacionParaValidar & { isRework: boolean; isBillable: boolean })[],
  horasDisponibles: number,
  tarifaHorariaCents = 0,
): ResumenHoras {
  const suma = (predicado: (e: (typeof entradas)[number]) => boolean): number =>
    entradas.filter(predicado).reduce((total, e) => total + e.minutes, 0);

  const runMinutos = suma((e) => e.activity === 'RUN');
  const changeMinutos = suma((e) => e.activity === 'CHANGE');

  return {
    totalMinutos: suma(cuentaComoJornada),
    runMinutos,
    changeMinutos,
    internoMinutos: suma((e) => e.activity === 'INTERNAL'),
    ausenciaMinutos: suma((e) => e.activity === 'ABSENCE'),
    retrabajoMinutos: suma((e) => e.isRework),
    extraMinutos: suma((e) => e.isOvertime),
    facturableMinutos: suma((e) => e.isBillable),
    reparto: utilization({
      availableHours: horasDisponibles,
      runHours: runMinutos / MINUTOS_POR_HORA,
      changeHours: changeMinutos / MINUTOS_POR_HORA,
      hourlyRateCents: cents(tarifaHorariaCents),
    }),
  };
}

/** `450` → `7 h 30 min`. Para pantalla, nunca para calcular. */
export function formatearDuracion(minutos: number): string {
  const horas = Math.floor(minutos / MINUTOS_POR_HORA);
  const resto = minutos % MINUTOS_POR_HORA;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** `540` → `09:00`. */
export function formatearHora(minutoDelDia: number | null): string {
  if (minutoDelDia === null) return '';
  const h = String(Math.floor(minutoDelDia / MINUTOS_POR_HORA)).padStart(2, '0');
  const m = String(minutoDelDia % MINUTOS_POR_HORA).padStart(2, '0');
  return `${h}:${m}`;
}
