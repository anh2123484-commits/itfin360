'use client';

import { Button } from '@itfin360/ui';
import { useActionState } from 'react';

export type InvitacionResultado = { url: string } | { error: string } | null;

const ROLES = ['OWNER', 'FINANCE', 'IT_MANAGER', 'PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER'];

export function InvitacionForm({
  action,
}: {
  action: (previous: InvitacionResultado, formData: FormData) => Promise<InvitacionResultado>;
}) {
  const [resultado, enviar, pendiente] = useActionState(action, null);
  return (
    <form action={enviar} className="flex flex-col gap-3">
      <input
        className="rounded border px-3 py-2"
        type="email"
        name="email"
        placeholder="persona@empresa.example"
        required
      />
      <select name="role" className="rounded border px-3 py-2" defaultValue="VIEWER">
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="canViewCompensation" />
        Puede ver retribución individual
      </label>
      <Button type="submit" disabled={pendiente}>
        Generar enlace de invitación
      </Button>
      {resultado && 'url' in resultado ? (
        <p className="break-all text-sm">
          Enlace (se muestra una sola vez, caduca en 7 días): <code>{resultado.url}</code>
        </p>
      ) : null}
      {resultado && 'error' in resultado ? (
        <p role="alert" className="text-destructive text-sm">
          No se ha podido crear la invitación. Revisa el correo y el rol.
        </p>
      ) : null}
    </form>
  );
}
