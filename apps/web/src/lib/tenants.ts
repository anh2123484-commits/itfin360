import { z } from 'zod';

import { db } from '@/lib/db';

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
 * Alta de tenant: delega en `provision_tenant` (SECURITY DEFINER, issue #68),
 * que crea tenant + membership OWNER + audit_log en una sola transacción sin
 * relajar el WITH CHECK de `tenant_isolation`. Devuelve el id del tenant.
 */
export function createTenant(ownerUserId: string, input: CreateTenantInput): Promise<string> {
  return db().identity.provisionTenant({ ...input, ownerUserId });
}
