import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { parseJson, route } from '@/lib/http';
import { createInvitation, createInvitationSchema } from '@/lib/invitations';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Crea una invitación (`members:invite`, sólo OWNER). Devuelve el enlace una
 * única vez; el envío por correo del enlace queda en manos del OWNER hasta que
 * haya plantilla de correo (F1). Sólo quien invita ve el enlace.
 */
export const POST = route(async (request: Request) => {
  const principal = await requirePermission('members:invite');
  const input = await parseJson(request, createInvitationSchema);
  const invitation = await createInvitation(principal, input);
  const url = new URL(`/invitaciones/${principal.tenantId}/${invitation.token}`, env().APP_URL);
  return NextResponse.json(
    { invitationId: invitation.id, url: url.toString(), expiresAt: invitation.expiresAt },
    { status: 201 },
  );
});
