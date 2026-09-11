import type { TenantDb } from '@itfin360/db';

import { CAMPOS_PROVEEDOR } from '@/lib/vendors';

/**
 * La consulta de proveedores, en un solo sitio.
 *
 * Misma razón que en `invoice-query`: la usan la API y la pantalla, y si cada
 * una armara la suya acabarían enseñando listas distintas.
 */

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 100;

/**
 * Condición de Prisma para buscar proveedores por nombre.
 *
 * La búsqueda y el cursor caen los dos sobre `name`, así que van dentro del
 * mismo objeto. Escritos como dos claves separadas, la segunda pisa a la
 * primera en silencio: pasar de página dejaría de filtrar por texto y la lista
 * enseñaría proveedores que no cumplen lo que hay escrito en la búsqueda.
 */
export function whereDeProveedores(busqueda: string, cursor: string | undefined) {
  const nombre = {
    ...(busqueda === '' ? {} : { contains: busqueda, mode: 'insensitive' as const }),
    ...(cursor === undefined ? {} : { gt: cursor }),
  };
  return Object.keys(nombre).length === 0 ? {} : { name: nombre };
}

/**
 * Página de proveedores por orden alfabético.
 *
 * El cursor es el nombre, que es único dentro del tenant. Por desplazamiento
 * (`skip`), dar de alta un proveedor mientras alguien recorre la lista le haría
 * saltarse una fila sin enterarse.
 */
export async function listarProveedores(
  tx: TenantDb,
  opciones: {
    readonly busqueda?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limite?: number | undefined;
  } = {},
) {
  const limite = opciones.limite ?? LIMITE_POR_DEFECTO;
  const encontrados = await tx.vendor.findMany({
    where: whereDeProveedores(opciones.busqueda ?? '', opciones.cursor),
    select: CAMPOS_PROVEEDOR,
    orderBy: { name: 'asc' as const },
    take: limite + 1,
  });

  const hayMas = encontrados.length > limite;
  const items = hayMas ? encontrados.slice(0, limite) : encontrados;
  return { items, nextCursor: hayMas ? (items.at(-1)?.name ?? null) : null };
}
