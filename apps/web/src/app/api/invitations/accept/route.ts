import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { parseJson, route, unauthorized } from '@/lib/http';
import { acceptInvitation, acceptInvitationSchema } from '@/lib/invitations';
import { writeActiveTenantCookie } from '@/lib/tenant-context';

const schema = acceptInvitationSchema.extend({ tenantId: z.uuid() });

/** Acepta una invitación con la sesión actual; el tenant pasa a ser el activo. */
export const POST = route(async (request: Request) => {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) throw unauthorized();
  const input = await parseJson(request, schema);
  const membership = await acceptInvitation({ userId, email }, input.tenantId, input.token);
  await writeActiveTenantCookie(membership.tenantId);
  return NextResponse.json({ membership });
});
