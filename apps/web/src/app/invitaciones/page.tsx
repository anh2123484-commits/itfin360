import { Button } from '@itfin360/ui';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { Shell } from '@/components/shell';
import { invitacionesPendientes, revocarInvitacion } from '@/lib/invitations';
import { ETIQUETA_ROL } from '@/lib/permissions';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Invitaciones pendientes, con el botón de revocar.
 *
 * Existe porque antes no había ninguna forma de deshacer. Un enlace mandado a
 * quien no era, o pegado en un chat que no tocaba, seguía sirviendo siete días
 * y lo único que se podía hacer era esperar a que caducara.
 *
 * No se enseña el enlace de ninguna invitación ya creada, y no es un olvido: en
 * la base sólo está el hash del token, así que no se puede recuperar ni
 * queriendo. Si alguien pierde el enlace, se revoca esta invitación y se crea
 * otra.
 */

function fecha(valor: Date): string {
  return valor.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function revocar(formData: FormData) {
  'use server';
  const principal = await requirePermission('members:invite');
  await revocarInvitacion(principal, String(formData.get('id') ?? ''));
  revalidatePath('/invitaciones');
}

export default async function InvitacionesPage() {
  const principal = await requirePermission('members:invite');
  const pendientes = await invitacionesPendientes(principal);
  const ahora = Date.now();

  return (
    <Shell actual="/invitaciones">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Invitaciones</h1>
            <p className="text-muted-foreground text-sm">
              Entrar en ITFin360 sólo se puede por invitación. Quien la recibe abre el enlace,
              comprueba su correo y queda dentro con el rol que le hayas puesto.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/invitaciones/nueva">Invitar a alguien</Link>
          </Button>
        </div>

        {pendientes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay ninguna invitación pendiente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Correo</th>
                  <th className="p-2 font-medium">Rol</th>
                  <th className="p-2 font-medium">Enviada</th>
                  <th className="p-2 font-medium">Caduca</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {pendientes.map((invitacion) => {
                  const caducada = invitacion.expiresAt.getTime() <= ahora;
                  return (
                    <tr key={invitacion.id} className="border-b">
                      <td className="p-2">{invitacion.email}</td>
                      <td className="p-2">
                        {ETIQUETA_ROL[invitacion.role]}
                        {invitacion.canViewCompensation ? ' · ve retribución' : ''}
                      </td>
                      <td className="text-muted-foreground p-2">{fecha(invitacion.createdAt)}</td>
                      <td className="p-2">
                        {caducada ? (
                          <span className="text-muted-foreground">
                            caducada el {fecha(invitacion.expiresAt)}
                          </span>
                        ) : (
                          fecha(invitacion.expiresAt)
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <form action={revocar}>
                          <input type="hidden" name="id" value={invitacion.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Revocar
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <section className="text-muted-foreground flex flex-col gap-1 rounded border p-4 text-sm">
          <h2 className="text-foreground font-medium">Cómo funciona</h2>
          <p>
            El enlace se enseña una sola vez, al crear la invitación. De la base de datos no se
            puede sacar: sólo guarda una huella del token, no el token.
          </p>
          <p>
            Revocar borra la invitación y el enlace deja de servir en ese momento. Queda registrado
            en la auditoría quién la revocó y cuándo.
          </p>
        </section>
      </div>
    </Shell>
  );
}
