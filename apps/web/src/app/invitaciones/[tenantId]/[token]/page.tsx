import { Button } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { acceptInvitation, acceptInvitationSchema } from '@/lib/invitations';
import { writeActiveTenantCookie } from '@/lib/tenant-context';

const MENSAJES: Record<string, string> = {
  invitation_not_found: 'La invitación no existe o ya se ha usado.',
  invitation_expired: 'La invitación ha caducado. Pide una nueva.',
  invitation_email_mismatch: 'Esta invitación es para otra cuenta. Entra con el correo invitado.',
  already_member: 'Ya perteneces a esta organización.',
};

async function aceptar(formData: FormData) {
  'use server';
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  const tenantId = String(formData.get('tenantId') ?? '');
  const token = String(formData.get('token') ?? '');
  if (!userId || !email) redirect(`/login?callbackUrl=/invitaciones/${tenantId}/${token}`);
  const parsed = acceptInvitationSchema.safeParse({ token });
  if (!parsed.success) redirect(`/invitaciones/${tenantId}/${token}?error=invitation_not_found`);
  try {
    const membership = await acceptInvitation({ userId, email }, tenantId, parsed.data.token);
    await writeActiveTenantCookie(membership.tenantId);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'invitation_not_found';
    redirect(`/invitaciones/${tenantId}/${token}?error=${code}`);
  }
  redirect('/');
}

export default async function AceptarInvitacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenantId, token } = await params;
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Aceptar invitación</h1>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {MENSAJES[error] ?? MENSAJES.invitation_not_found}
        </p>
      ) : null}
      <form action={aceptar} className="flex flex-col gap-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="token" value={token} />
        <Button type="submit">Unirme con mi cuenta actual</Button>
      </form>
    </main>
  );
}
