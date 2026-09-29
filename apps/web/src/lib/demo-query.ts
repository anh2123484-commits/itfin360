import type { TenantDb } from '@itfin360/db';

import { generarDemo, PREFIJOS, tamanoDemo } from '@/lib/demo';

/**
 * Siembra y borrado de los datos de demostración.
 *
 * Todo pasa por `withTenant`, así que RLS acota cada escritura y cada borrado a
 * la organización activa. Aun así los filtros de borrado llevan la marca: lo que
 * impide tocar los datos de verdad no es un descuido menos, son dos.
 *
 * El orden de borrado no es opcional. Las claves ajenas obligan a vaciar primero
 * lo que apunta a otras tablas, y la que está de por medio es `time_entry`, que
 * apunta a la vez a empleado y a proyecto.
 */

/** Cuántas filas de demostración hay ahora mismo en la organización activa. */
export async function contarDemo(tx: TenantDb): Promise<number> {
  const [facturas, empleados, proyectos, horas, contratos, activos] = await Promise.all([
    tx.invoice.count({ where: { invoiceNumber: { startsWith: PREFIJOS.factura } } }),
    tx.employee.count({ where: { employeeCode: { startsWith: PREFIJOS.empleado } } }),
    tx.project.count({ where: { code: { startsWith: PREFIJOS.proyecto } } }),
    tx.timeEntry.count({ where: { externalKey: { startsWith: PREFIJOS.imputacion } } }),
    tx.contract.count({ where: { name: { startsWith: PREFIJOS.nombre } } }),
    tx.asset.count({ where: { serialNumber: { startsWith: PREFIJOS.serie } } }),
  ]);
  return facturas + empleados + proyectos + horas + contratos + activos;
}

export interface ResumenSiembra {
  readonly filas: number;
  readonly facturas: number;
  readonly empleados: number;
  readonly proyectos: number;
  readonly imputaciones: number;
}

/**
 * Escribe el departamento de demostración completo.
 *
 * Una fila por `createMany` y no una por `create`: son varios cientos, y
 * hacerlas de una en una convertiría la siembra en varios cientos de viajes a
 * la base. Todo va dentro de la misma transacción, así que o entra entero o no
 * entra nada; una siembra a medias sería peor que ninguna, porque nadie sabría
 * qué mirar.
 */
export async function sembrarDemo(
  tx: TenantDb,
  tenantId: string,
  hoy: Date = new Date(),
): Promise<ResumenSiembra> {
  const datos = generarDemo(tenantId, hoy);

  await tx.position.createMany({ data: [...datos.puestos] });
  await tx.employee.createMany({ data: [...datos.empleados] });
  await tx.vendor.createMany({ data: [...datos.proveedores] });
  await tx.invoice.createMany({ data: [...datos.facturas] });
  await tx.invoiceLine.createMany({ data: [...datos.lineas] });
  await tx.contract.createMany({ data: [...datos.contratos] });
  await tx.asset.createMany({ data: [...datos.activos] });
  await tx.project.createMany({ data: [...datos.proyectos] });
  await tx.projectBaseline.createMany({ data: [...datos.baselines] });
  await tx.milestone.createMany({ data: [...datos.hitos] });
  await tx.timeEntry.createMany({ data: [...datos.imputaciones] });

  return {
    filas: tamanoDemo(datos),
    facturas: datos.facturas.length,
    empleados: datos.empleados.length,
    proyectos: datos.proyectos.length,
    imputaciones: datos.imputaciones.length,
  };
}

/**
 * Borra todo lo sembrado y nada más.
 *
 * Las líneas de factura no aparecen: se van solas con su factura, por la clave
 * ajena en cascada. Los hitos y las baselines sí aparecen, y van antes que el
 * proyecto, porque su cascada no serviría de nada si el proyecto ya no existe
 * cuando se intenta borrar lo que cuelga de él.
 */
export async function borrarDemo(tx: TenantDb): Promise<number> {
  const proyectos = await tx.project.findMany({
    where: { code: { startsWith: PREFIJOS.proyecto } },
    select: { id: true },
  });
  const idsProyecto = proyectos.map((proyecto) => proyecto.id);

  let borradas = 0;
  const cuenta = (resultado: { count: number }): void => {
    borradas += resultado.count;
  };

  cuenta(
    await tx.timeEntry.deleteMany({ where: { externalKey: { startsWith: PREFIJOS.imputacion } } }),
  );
  cuenta(await tx.milestone.deleteMany({ where: { projectId: { in: idsProyecto } } }));
  cuenta(await tx.projectBaseline.deleteMany({ where: { projectId: { in: idsProyecto } } }));
  cuenta(await tx.project.deleteMany({ where: { id: { in: idsProyecto } } }));
  cuenta(await tx.asset.deleteMany({ where: { serialNumber: { startsWith: PREFIJOS.serie } } }));
  cuenta(
    await tx.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIJOS.factura } } }),
  );
  cuenta(await tx.contract.deleteMany({ where: { name: { startsWith: PREFIJOS.nombre } } }));
  cuenta(
    await tx.employee.deleteMany({ where: { employeeCode: { startsWith: PREFIJOS.empleado } } }),
  );
  cuenta(await tx.position.deleteMany({ where: { name: { startsWith: PREFIJOS.nombre } } }));
  cuenta(await tx.vendor.deleteMany({ where: { name: { startsWith: PREFIJOS.nombre } } }));

  return borradas;
}
