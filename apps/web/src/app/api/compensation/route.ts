import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { route } from '@/lib/http';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Acceso a retribución individual. Exige `compensation:read_individual`, que
 * sólo concede `canViewCompensation` (independiente del rol): sin él, 403 del
 * servidor. Cada acceso deja entrada en `audit_log` (regla dura 5).
 *
 * `CompensationRecord` llega en F1: hasta entonces la lista está vacía, pero
 * la comprobación de permiso y la auditoría ya son las definitivas.
 */
export const GET = route(async () => {
  const principal = await requirePermission('compensation:read_individual');
  await db().withTenant(principal.tenantId, (tx) =>
    tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'compensation.viewed',
        entity: 'compensation_record',
        entityId: '*',
      },
    }),
  );
  return NextResponse.json({ items: [] });
});
