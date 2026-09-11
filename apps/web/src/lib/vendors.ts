import { Criticality, isUniqueConstraintViolation, uniqueConstraintFields } from '@itfin360/db';
import { z } from 'zod';

import { HttpError } from '@/lib/http';

/** Esquemas y traducción de errores de proveedor, compartidos por sus rutas. */

const TEXTO = z.string().trim().max(200);

export const NOMBRE_PROVEEDOR = TEXTO.min(1);

/** ISO 3166-1 alfa-2. Se normaliza a mayúsculas: `es` y `ES` son el mismo país. */
export const PAIS_ISO = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'ISO 3166-1 alfa-2')
  .transform((valor) => valor.toUpperCase());

/** Del enum del esquema, para que las dos listas no puedan separarse. */
export const CRITICIDAD = z.enum(Criticality);

/** Alta de proveedor. */
export const altaProveedor = z.object({
  name: NOMBRE_PROVEEDOR,
  legalName: TEXTO.optional(),
  taxId: TEXTO.optional(),
  country: PAIS_ISO.optional(),
  criticality: CRITICIDAD.optional(),
});

/**
 * Edición. Todos los campos son opcionales, pero el cuerpo vacío se rechaza:
 * un PATCH que no cambia nada dejaría un apunte de auditoría mintiendo.
 */
export const edicionProveedor = z
  .object({
    name: NOMBRE_PROVEEDOR.optional(),
    legalName: TEXTO.optional(),
    taxId: TEXTO.optional(),
    country: PAIS_ISO.optional(),
    criticality: CRITICIDAD.optional(),
  })
  .refine((valor) => Object.keys(valor).length > 0, { message: 'sin cambios' });

/** Campos que se devuelven. Nunca `tenantId`: ya está implícito en la sesión. */
export const CAMPOS_PROVEEDOR = {
  id: true,
  name: true,
  legalName: true,
  taxId: true,
  country: true,
  criticality: true,
} as const;

/** Una cadena vacía es «no hay dato», no un dato vacío. */
export function textoOpcional(valor: string | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  return valor === '' ? null : valor;
}

/**
 * Traduce el rechazo del índice único a un 409 que dice **qué** está repetido.
 *
 * El esquema tiene dos índices sobre proveedor: `(tenant, nombre)` y
 * `(tenant, NIF)`. Un «ya existe» a secas obliga a quien lo recibe a adivinar
 * cuál de los dos ha chocado, y el NIF repetido es justo el caso interesante:
 * el mismo proveedor dado de alta dos veces con nombres distintos es como
 * empiezan los duplicados de factura que F2-03 tiene que cazar después.
 */
export function conflictoDeProveedor(error: unknown): HttpError | null {
  if (!isUniqueConstraintViolation(error)) return null;
  const campos = uniqueConstraintFields(error);
  if (campos.includes('tax_id')) return new HttpError(409, 'vendor_tax_id_exists');
  if (campos.includes('name')) return new HttpError(409, 'vendor_name_exists');
  return new HttpError(409, 'vendor_exists');
}

/** Ejecuta la escritura convirtiendo el choque de unicidad en 409. */
export async function traduciendoConflictos<T>(escribir: () => Promise<T>): Promise<T> {
  try {
    return await escribir();
  } catch (error) {
    const conflicto = conflictoDeProveedor(error);
    if (conflicto) throw conflicto;
    throw error;
  }
}
