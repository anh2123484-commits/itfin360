import { EmploymentType } from '@itfin360/db';
import { z } from 'zod';

import { ENTERO_NO_NEGATIVO, FECHA } from '@/lib/contratos';

/**
 * Plantilla: validación y el prorrateo por vigencia.
 *
 * Lo que decide esta pieza es una sola cosa, y es la que rompe todos los
 * cálculos anuales cuando está mal: cuánto cuenta una persona en un año. Quien
 * entra en septiembre no cuenta como un año entero, quien se va en junio
 * tampoco, y quien está a media jornada cuenta la mitad de lo que esté.
 *
 * Aquí no hay retribución. Eso va en su propia tabla, cifrada y auditada
 * (F4-02). Consultar la plantilla no puede obligar a pasar por el permiso
 * salarial, porque entonces la utilización, el reparto de costes y la mitad del
 * producto serían consultas de datos retributivos.
 */

const TEXTO = z.string().trim().max(200);

export const TIPO_CONTRATO = z.enum(EmploymentType);

/** Jornada completa en puntos básicos. */
export const FTE_COMPLETO = 10_000;

/** Jornada escrita como porcentaje: `100`, `50`, `37,5`. */
export const JORNADA = z
  .string()
  .trim()
  .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'porcentaje')
  .transform((valor) => Math.round(Number(valor.replace(',', '.')) * 100));

export const altaEmpleado = z.object({
  fullName: TEXTO.min(1),
  employeeCode: TEXTO.optional(),
  email: TEXTO.optional(),
  positionId: z.uuid().optional(),
  employmentType: TIPO_CONTRATO.optional(),
  fteBp: JORNADA.optional(),
  hireDate: FECHA,
  terminationDate: FECHA.optional(),
  team: TEXTO.optional(),
  costCenter: TEXTO.optional(),
});

export const altaPuesto = z.object({
  name: TEXTO.min(1),
  family: TEXTO.optional(),
  level: TEXTO.optional(),
  description: z.string().trim().max(2000).optional(),
});

export const CAMPOS_EMPLEADO = {
  id: true,
  fullName: true,
  employeeCode: true,
  email: true,
  employmentType: true,
  fteBp: true,
  hireDate: true,
  terminationDate: true,
  team: true,
  costCenter: true,
  position: { select: { id: true, name: true } },
} as const;

export const CAMPOS_PUESTO = {
  id: true,
  name: true,
  family: true,
  level: true,
} as const;

export const ETIQUETA_TIPO_CONTRATO: Readonly<Record<keyof typeof EmploymentType, string>> = {
  PERMANENT: 'Indefinido',
  TEMPORARY: 'Temporal',
  INTERN: 'Prácticas',
  CONTRACTOR: 'Externo',
};

/** Lo que hace falta de una persona para saber cuánto cuenta. */
export interface EmpleadoParaCalcular {
  readonly id: string;
  readonly fteBp: number;
  readonly hireDate: Date;
  readonly terminationDate: Date | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Primer y último día del año, en UTC. */
function limitesDelAnio(anio: number): { inicio: Date; fin: Date } {
  return {
    inicio: new Date(Date.UTC(anio, 0, 1)),
    fin: new Date(Date.UTC(anio, 11, 31)),
  };
}

/** Días naturales del año, contando el bisiesto. */
export function diasDelAnio(anio: number): number {
  const { inicio, fin } = limitesDelAnio(anio);
  return Math.round((fin.getTime() - inicio.getTime()) / DIA_MS) + 1;
}

/**
 * Días del año en los que esta persona estuvo de alta.
 *
 * Los dos extremos cuentan: quien entra el 1 de enero y se va el 31 de
 * diciembre ha estado el año entero, no el año menos un día. Y quien entra y se
 * va el mismo día ha estado un día, no cero, porque ese día se le paga.
 */
export function diasActivosEn(empleado: EmpleadoParaCalcular, anio: number): number {
  const { inicio, fin } = limitesDelAnio(anio);
  const desde = empleado.hireDate > inicio ? empleado.hireDate : inicio;
  const hasta =
    empleado.terminationDate !== null && empleado.terminationDate < fin
      ? empleado.terminationDate
      : fin;
  if (hasta < desde) return 0;
  return Math.round((hasta.getTime() - desde.getTime()) / DIA_MS) + 1;
}

/**
 * Proporción del año que esta persona ha estado de alta, entre 0 y 1.
 *
 * Por días naturales y no por meses: quien se va el 2 de julio y quien se va el
 * 30 de julio no han costado lo mismo, y redondear a meses es exactamente la
 * clase de aproximación que hace que el coste de personal no cuadre con la
 * nómina y que nadie se fíe del resto de las cifras.
 */
export function proporcionDelAnio(empleado: EmpleadoParaCalcular, anio: number): number {
  return diasActivosEn(empleado, anio) / diasDelAnio(anio);
}

/**
 * Jornada efectiva en el año: la jornada contratada por el tiempo que ha
 * estado. Es el número que multiplica el coste empresa.
 */
export function fteEfectivo(empleado: EmpleadoParaCalcular, anio: number): number {
  return (empleado.fteBp / FTE_COMPLETO) * proporcionDelAnio(empleado, anio);
}

/** ¿Estaba de alta en algún momento del año? */
export function activoEn(empleado: EmpleadoParaCalcular, anio: number): boolean {
  return diasActivosEn(empleado, anio) > 0;
}

export interface ResumenPlantilla {
  /** Personas que han estado de alta en algún momento del año. */
  readonly personas: number;
  /** Personas de alta a fecha de hoy, o al cierre del año si ya pasó. */
  readonly personasAlCierre: number;
  /** Suma de jornadas contratadas de quien sigue de alta. */
  readonly fteContratado: number;
  /** Suma de jornadas efectivas del año: lo que de verdad se paga. */
  readonly fteEfectivo: number;
}

/**
 * La plantilla del año en cuatro cifras.
 *
 * `personas` y `fteEfectivo` casi nunca coinciden, y esa diferencia es el punto:
 * un departamento que ha tenido dieciocho personas distintas a lo largo del año
 * con doce jornadas efectivas no cuesta lo que dieciocho, pero tampoco se
 * gestiona como doce.
 */
export function resumenPlantilla(
  empleados: readonly EmpleadoParaCalcular[],
  anio: number,
): ResumenPlantilla {
  const delAnio = empleados.filter((empleado) => activoEn(empleado, anio));
  const alCierre = delAnio.filter(
    (empleado) =>
      empleado.terminationDate === null ||
      empleado.terminationDate >= new Date(Date.UTC(anio, 11, 31)),
  );

  return {
    personas: delAnio.length,
    personasAlCierre: alCierre.length,
    fteContratado: alCierre.reduce((total, e) => total + e.fteBp / FTE_COMPLETO, 0),
    fteEfectivo: delAnio.reduce((total, e) => total + fteEfectivo(e, anio), 0),
  };
}
