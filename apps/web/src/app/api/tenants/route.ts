import { NextResponse } from 'next/server';

import { parseJson, route } from '@/lib/http';
import { requireUser, writeActiveTenantCookie } from '@/lib/tenant-context';
import { createTenant, createTenantSchema } from '@/lib/tenants';

/** Alta de tenant: el usuario autenticado pasa a ser OWNER y el tenant queda activo. */
export const POST = route(async (request: Request) => {
  const { userId } = await requireUser();
  const input = await parseJson(request, createTenantSchema);
  const tenantId = await createTenant(userId, input);
  await writeActiveTenantCookie(tenantId);
  return NextResponse.json({ tenantId }, { status: 201 });
});

/** Tenants a los que pertenece el usuario, para el selector de tenant. */
export const GET = route(async () => {
  const { memberships } = await requireUser();
  return NextResponse.json({ tenants: memberships });
});
