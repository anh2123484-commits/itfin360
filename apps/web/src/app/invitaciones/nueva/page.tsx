import { env } from '@/lib/env';
import { createInvitation, createInvitationSchema } from '@/lib/invitations';
import { requirePermission } from '@/lib/tenant-context';

import { InvitacionForm, type InvitacionResultado } from './invitacion-form';

async function invitar(
  _previous: InvitacionResultado,
  formData: FormData,
): Promise<InvitacionResultado> {
  'use server';
  const principal = await requirePermission('members:invite');
  const input = createInvitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    canViewCompensation: formData.get('canViewCompensation') === 'on',
  });
  if (!input.success) return { error: 'invalid_input' };
  const invitation = await createInvitation(principal, input.data);
  const url = new URL(`/invitaciones/${principal.tenantId}/${invitation.token}`, env().APP_URL);
  return { url: url.toString() };
}

export default async function NuevaInvitacionPage() {
  await requirePermission('members:invite');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Invitar a la organización</h1>
      <InvitacionForm action={invitar} />
    </main>
  );
}
