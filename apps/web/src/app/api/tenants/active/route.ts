import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, route } from '@/lib/http';
import { switchActiveTenant } from '@/lib/tenant-context';

const schema = z.object({ tenantId: z.uuid() });

/** Cambio de tenant activo. 403 `not_a_member` si el usuario no pertenece a él. */
export const PUT = route(async (request: Request) => {
  const { tenantId } = await parseJson(request, schema);
  const membership = await switchActiveTenant(tenantId);
  return NextResponse.json({ active: membership });
});
