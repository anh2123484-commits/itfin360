import type { TenantDb } from '@itfin360/db';

import {
  CAMPOS_EMPLEADO,
  CAMPOS_PUESTO,
  type EmpleadoParaCalcular,
  fteEfectivo,
  resumenPlantilla,
} from '@/lib/personal';

/**
 * La consulta de plantilla. El año se lee aquí y no en la pantalla, por lo de
 * siempre: un componente que mira el calendario deja de ser una función de sus
 * datos y no se puede probar sin esperar a enero.
 */

export const LIMITE_POR_DEFECTO = 500;

export async function plantillaConResumen(tx: TenantDb, ahora: Date = new Date()) {
  const anio = ahora.getUTCFullYear();
  const filas = await tx.employee.findMany({
    select: CAMPOS_EMPLEADO,
    orderBy: [{ terminationDate: 'asc' as const }, { fullName: 'asc' as const }],
    take: LIMITE_POR_DEFECTO,
  });

  const paraCalcular: EmpleadoParaCalcular[] = filas.map((fila) => ({
    id: fila.id,
    fteBp: fila.fteBp,
    hireDate: fila.hireDate,
    terminationDate: fila.terminationDate,
  }));

  return {
    anio,
    filas: filas.map((fila, i) => ({
      ...fila,
      fteEfectivo: fteEfectivo(paraCalcular[i] as EmpleadoParaCalcular, anio),
    })),
    resumen: resumenPlantilla(paraCalcular, anio),
  };
}

/** Puestos para el desplegable y para la lista. Son pocos y hay que elegir uno. */
export function listarPuestos(tx: TenantDb) {
  return tx.position.findMany({
    select: CAMPOS_PUESTO,
    orderBy: { name: 'asc' as const },
    take: 200,
  });
}
