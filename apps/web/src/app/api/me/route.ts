import { NextResponse } from 'next/server';

import { route } from '@/lib/http';
import { grantedPermissions } from '@/lib/permissions';
import { requirePrincipal } from '@/lib/tenant-context';

/** Principal de la petición: tenant activo, rol y permisos efectivos. */
export const GET = route(async () => {
  const principal = await requirePrincipal();
  return NextResponse.json({
    userId: principal.userId,
    tenantId: principal.tenantId,
    role: principal.role,
    canViewCompensation: principal.canViewCompensation,
    permissions: grantedPermissions(principal),
  });
});
