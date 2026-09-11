import { Criticality } from '@itfin360/db';
import { Button } from '@itfin360/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';
import { can } from '@/lib/permissions';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';
import { listarProveedores } from '@/lib/vendor-query';
import {
  altaProveedor,
  CAMPOS_PROVEEDOR,
  textoOpcional,
  traduciendoConflictos,
} from '@/lib/vendors';

/**
 * Proveedores: lista y alta.
 *
 * El formulario es un `form` normal con una acción de servidor. Sin JavaScript
 * de cliente: el alta de un proveedor son seis campos y una escritura, y
 * hacerlo interactivo obligaría a mantener el mismo estado en dos sitios sin
 * ganar nada. El resultado vuelve en la URL, así que recargar no reenvía nada.
 */

const ETIQUETA_CRITICIDAD: Readonly<Record<keyof typeof Criticality, string>> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  vendor_name_exists: 'Ya hay un proveedor con ese nombre.',
  vendor_tax_id_exists: 'Ya hay un proveedor con ese NIF. Búscalo antes de crearlo otra vez.',
  vendor_exists: 'Ese proveedor ya existe.',
  invalid_input: 'Revisa los datos: el nombre es obligatorio y el país va en dos letras.',
  forbidden: 'Tu rol no puede dar de alta proveedores.',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/**
 * Alta desde el formulario.
 *
 * Usa el mismo esquema y la misma traducción de conflictos que
 * `POST /api/vendors`. Dos validaciones distintas para la misma tabla es como
 * se acaba teniendo una pantalla que acepta lo que la API rechaza.
 */
async function crear(formData: FormData): Promise<void> {
  'use server';
  /** Un campo vacío es «no hay dato», no una cadena vacía que validar. */
  const campo = (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };

  // `can` es puro y no lanza, así que el rechazo sale como mensaje en la
  // pantalla en vez de como página de error. El control sigue estando aquí, en
  // el servidor: esconder el formulario más abajo es sólo comodidad.
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/proveedores?error=forbidden');

  const datos = altaProveedor.safeParse({
    name: campo('name'),
    legalName: campo('legalName'),
    taxId: campo('taxId'),
    country: campo('country'),
    criticality: campo('criticality'),
  });
  if (!datos.success) redirect('/proveedores?error=invalid_input');

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const vendor = await traduciendoConflictos(() =>
        tx.vendor.create({
          data: {
            tenantId: principal.tenantId,
            name: datos.data.name,
            legalName: textoOpcional(datos.data.legalName),
            taxId: textoOpcional(datos.data.taxId),
            country: datos.data.country ?? null,
            criticality: datos.data.criticality ?? 'MEDIUM',
          },
          select: CAMPOS_PROVEEDOR,
        }),
      );
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'vendor.created',
          entity: 'vendor',
          entityId: vendor.id,
          after: { name: vendor.name, criticality: vendor.criticality },
        },
      });
    });
  } catch (error) {
    if (error instanceof HttpError) redirect(`/proveedores?error=${error.code}`);
    throw error;
  }

  redirect('/proveedores?alta=ok');
}

export default async function ProveedoresPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const busqueda = texto(parametros['q']).trim();
  const cursor = texto(parametros['cursor']).trim();
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']) === 'ok';

  const pagina = await db().withTenant(principal.tenantId, (tx) =>
    listarProveedores(tx, {
      busqueda,
      ...(cursor === '' ? {} : { cursor }),
    }),
  );

  const siguiente = new URLSearchParams();
  if (busqueda !== '') siguiente.set('q', busqueda);
  if (pagina.nextCursor !== null) siguiente.set('cursor', pagina.nextCursor);

  return (
    <Shell actual="/proveedores">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Proveedores</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido dar de alta el proveedor.'}
          </p>
        ) : null}
        {alta ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Proveedor dado de alta.
          </p>
        ) : null}

        <form method="get" className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Buscar por nombre
            <input name="q" defaultValue={busqueda} className="w-64 rounded border px-3 py-2" />
          </label>
          <Button type="submit" size="sm">
            Buscar
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/proveedores">Limpiar</Link>
          </Button>
        </form>

        {pagina.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {busqueda === ''
              ? 'Todavía no hay proveedores. Da de alta el primero abajo.'
              : 'Ningún proveedor con ese nombre.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Nombre</th>
                  <th className="p-2 font-medium">Razón social</th>
                  <th className="p-2 font-medium">NIF</th>
                  <th className="p-2 font-medium">País</th>
                  <th className="p-2 font-medium">Criticidad</th>
                </tr>
              </thead>
              <tbody>
                {pagina.items.map((proveedor) => (
                  <tr key={proveedor.id} className="border-b">
                    <td className="p-2">{proveedor.name}</td>
                    <td className="p-2">{proveedor.legalName ?? ''}</td>
                    <td className="p-2 font-mono text-xs">{proveedor.taxId ?? ''}</td>
                    <td className="p-2">{proveedor.country ?? ''}</td>
                    <td className="p-2">
                      {ETIQUETA_CRITICIDAD[proveedor.criticality] ?? proveedor.criticality}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagina.nextCursor !== null ? (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/proveedores?${siguiente.toString()}`}>Siguiente página</Link>
            </Button>
          </div>
        ) : null}

        {can(principal, 'invoices:create') ? (
          <section className="max-w-2xl rounded border p-4">
            <h2 className="mb-3 font-medium">Nuevo proveedor</h2>
            <form action={crear} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Nombre
                <input
                  name="name"
                  required
                  maxLength={200}
                  className="w-52 rounded border px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Razón social
                <input name="legalName" maxLength={200} className="w-52 rounded border px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                NIF
                <input name="taxId" maxLength={200} className="w-36 rounded border px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                País
                <input
                  name="country"
                  maxLength={2}
                  placeholder="ES"
                  className="w-20 rounded border px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Criticidad
                <select
                  name="criticality"
                  defaultValue="MEDIUM"
                  className="rounded border px-3 py-2"
                >
                  {Object.keys(Criticality).map((nivel) => (
                    <option key={nivel} value={nivel}>
                      {ETIQUETA_CRITICIDAD[nivel as keyof typeof Criticality]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm">
                Dar de alta
              </Button>
            </form>
            <p className="text-muted-foreground mt-3 text-xs">
              El NIF es único dentro de la organización. Es la primera barrera contra el mismo
              proveedor dado de alta dos veces con nombres distintos.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
