import { z } from 'zod';

import { puedeCrearOrganizacion } from '@/lib/altas';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { forbidden } from '@/lib/http';

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * ¿Está este usuario autorizado a dar de alta una organización?
 *
 * El correo se lee de la base de datos con el id de la sesión, no de la propia
 * sesión. Es el mismo dato casi siempre, pero para una decisión de permisos
 * manda el que está guardado, no el que viaja en el token.
 */
export async function puedeCrearTenant(userId: string): Promise<boolean> {
  const user = await db().identity.findUserById(userId);
  return puedeCrearOrganizacion(env().ALTAS_ORGANIZACION, user?.email ?? null);
}

/**
 * Alta de tenant: delega en `provision_tenant` (SECURITY DEFINER, issue #68),
 * que crea tenant + membership OWNER + audit_log en una sola transacción sin
 * relajar el WITH CHECK de `tenant_isolation`. Devuelve el id del tenant.
 *
 * La autorización se comprueba aquí y no sólo en la pantalla. Una pantalla que
 * esconde un botón no impide nada: la llamada sigue estando ahí para quien sepa
 * hacerla, y quien entra por una invitación sabe hacerla.
 */
export async function createTenant(ownerUserId: string, input: CreateTenantInput): Promise<string> {
  if (!(await puedeCrearTenant(ownerUserId))) throw forbidden('tenant_create_not_allowed');
  return db().identity.provisionTenant({ ...input, ownerUserId });
}
