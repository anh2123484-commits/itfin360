import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { altaDeFactura, esRechazo } from '@/lib/invoice-ops';
import { altaFactura } from '@/lib/invoices';
import { can } from '@/lib/permissions';
import { requirePrincipal } from '@/lib/tenant-context';
import { listarProveedores } from '@/lib/vendor-query';

import { FormularioFactura } from './formulario';

/**
 * Alta de factura.
 *
 * La página carga los proveedores y la acción guarda. El alta en sí vive en
 * `@/lib/invoice-ops`, la misma que usa `POST /api/invoices`: dos altas
 * distintas para la misma tabla acabarían aceptando cosas distintas, y la que
 * se quedaría corta sería siempre la que nadie mira.
 */

const MENSAJE: Readonly<Record<string, string>> = {
  forbidden: 'Tu rol no puede registrar facturas.',
  invalid_input: 'Faltan datos o alguno no tiene el formato esperado.',
  incoherente: 'La factura no cuadra: revisa la base, el IVA y el total.',
  proveedor_desconocido: 'Ese proveedor ya no existe.',
  duplicada: 'Ya hay una factura de ese proveedor con ese número.',
};

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

async function guardar(formData: FormData): Promise<void> {
  'use server';
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/facturas/nueva?error=forbidden');

  const crudo = formData.get('payload');
  if (typeof crudo !== 'string') redirect('/facturas/nueva?error=invalid_input');

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    redirect('/facturas/nueva?error=invalid_input');
  }

  // El mismo esquema que la API. Lo que llega del navegador se vuelve a validar
  // entero: lo que hace el formulario mientras se teclea es comodidad, no un
  // control, y un cuerpo tocado a mano tiene que estrellarse igual.
  const datos = altaFactura.safeParse(cuerpo);
  if (!datos.success) redirect('/facturas/nueva?error=invalid_input');

  const resultado = await db().withTenant(principal.tenantId, (tx) =>
    altaDeFactura(tx, principal, datos.data),
  );

  if (esRechazo(resultado)) redirect(`/facturas/nueva?error=${resultado.motivo}`);
  redirect(`/facturas?alta=${resultado.invoiceNumber}`);
}

export default async function NuevaFacturaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) {
    return (
      <Shell actual="/facturas">
        <p className="text-sm">{MENSAJE['forbidden']}</p>
      </Shell>
    );
  }

  const error = texto((await searchParams)['error']);
  const proveedores = await db().withTenant(principal.tenantId, (tx) =>
    listarProveedores(tx, { limite: 100 }),
  );

  return (
    <Shell actual="/facturas">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Nueva factura</h1>

        {proveedores.items.length === 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            No hay proveedores todavía. Una factura necesita uno:{' '}
            <Link className="underline" href="/proveedores">
              da de alta el primero
            </Link>
            .
          </p>
        ) : (
          <FormularioFactura
            proveedores={proveedores.items.map((p) => ({ id: p.id, name: p.name }))}
            accion={guardar}
            error={error === '' ? undefined : (MENSAJE[error] ?? 'No se ha podido guardar.')}
          />
        )}
      </div>
    </Shell>
  );
}
