import { Shell } from '@/components/shell';
import { env } from '@/lib/env';
import { createInvitation, createInvitationSchema, enlaceDeInvitacion } from '@/lib/invitations';
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
  return {
    url: enlaceDeInvitacion(env().APP_URL, principal.tenantId, invitation.token),
    email: input.data.email,
  };
}

export default async function NuevaInvitacionPage() {
  await requirePermission('members:invite');
  return (
    <Shell actual="/invitaciones">
      <div className="flex max-w-lg flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Invitar a la organización</h1>
          <p className="text-muted-foreground text-sm">
            El rol lo decides aquí y no se puede cambiar desde el enlace. Quien lo abra tendrá que
            demostrar que ese correo es suyo antes de entrar.
          </p>
        </div>
        <InvitacionForm action={invitar} />
      </div>
    </Shell>
  );
}
