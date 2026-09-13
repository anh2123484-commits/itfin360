'use client';

import { Button, Input } from '@itfin360/ui';
import { useActionState } from 'react';

import { ETIQUETA_ROL } from '@/lib/permissions';

export type InvitacionResultado = { url: string; email: string } | { error: string } | null;

const ROLES = [
  'VIEWER',
  'CONTRIBUTOR',
  'PROJECT_MANAGER',
  'IT_MANAGER',
  'FINANCE',
  'OWNER',
] as const;

/**
 * Alta de invitación.
 *
 * Los roles salen de menos a más permisos y con el nombre en castellano. El
 * desplegable empieza en «Consulta» a propósito: si alguien no lo toca, la
 * invitación sale con el rol que menos deja hacer, no con el que más.
 */
export function InvitacionForm({
  action,
}: {
  readonly action: (
    previous: InvitacionResultado,
    formData: FormData,
  ) => Promise<InvitacionResultado>;
}) {
  const [resultado, enviar, pendiente] = useActionState(action, null);

  return (
    <div className="flex flex-col gap-4">
      <form action={enviar} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="email">
          Correo de la persona
          <Input
            id="email"
            type="email"
            name="email"
            placeholder="persona@empresa.example"
            autoComplete="off"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="role">
          Rol
          <select
            id="role"
            name="role"
            className="border-input bg-background h-10 rounded-md border-2 px-3 text-sm"
            defaultValue="VIEWER"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ETIQUETA_ROL[role]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="canViewCompensation" className="mt-1" />
          <span>
            Puede ver la retribución individual
            <span className="text-muted-foreground block text-xs font-normal">
              Va aparte del rol. Sin esto se ven bandas salariales, no importes por persona.
            </span>
          </span>
        </label>

        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Creando…' : 'Crear invitación'}
        </Button>
      </form>

      {resultado && 'url' in resultado ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p className="font-medium">Invitación creada para {resultado.email}</p>
          <p>
            Cópiale este enlace y mándaselo. Se enseña una sola vez: de la base de datos no se puede
            recuperar, porque allí sólo queda una huella del token.
          </p>
          <code className="bg-background rounded border p-2 break-all">{resultado.url}</code>
          <p className="text-muted-foreground">
            Caduca en siete días. Si te equivocas de persona, revócala desde la lista y el enlace
            deja de valer en ese momento.
          </p>
        </div>
      ) : null}

      {resultado && 'error' in resultado ? (
        <p role="alert" className="text-destructive text-sm">
          No se ha podido crear la invitación. Revisa el correo y el rol.
        </p>
      ) : null}
    </div>
  );
}
