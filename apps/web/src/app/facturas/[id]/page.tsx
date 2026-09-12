import { canEditInvoice, type InvoiceAction } from '@itfin360/db';
import { CONCEPT_DEFINITIONS, countsAsDepartmentSpend } from '@itfin360/finance-core';
import { Button } from '@itfin360/ui';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { aIso } from '@/lib/fechas';
import { COLOR_ESTADO, ETIQUETA_ESTADO, formatearFecha, formatearImporte } from '@/lib/formato';
import {
  ACCIONES_CON_BOTON,
  ACCIONES_DESTRUCTIVAS,
  aplicarTransicion,
  botonesVisibles,
  ETIQUETA_ACCION,
} from '@/lib/invoice-transition';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Detalle de una factura y su flujo de aprobación (F2-02, primera entrega).
 *
 * Los botones que se ven salen de la máquina de estados, no de una lista
 * escrita a mano aquí. Y son comodidad, no control: la acción del servidor
 * vuelve a preguntar a la misma función pura antes de escribir nada. Una
 * pantalla que esconde un botón ahorra un clic que iba a acabar en 403; lo que
 * impide la transición es `requestTransition`.
 *
 * Debajo va el historial de auditoría, que es la mitad del valor de esta
 * pantalla: en una herramienta financiera importa tanto en qué estado está una
 * factura como quién la puso ahí y cuándo.
 */

const CAMPOS = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  accrualDate: true,
  dueDate: true,
  serviceStart: true,
  serviceEnd: true,
  netCents: true,
  vatCents: true,
  grossCents: true,
  currency: true,
  fxRate: true,
  status: true,
  source: true,
  duplicateOfId: true,
  vendor: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      lineNumber: true,
      description: true,
      quantity: true,
      unitPriceCents: true,
      netCents: true,
      concept: true,
    },
    orderBy: { lineNumber: 'asc' as const },
  },
} as const;

const MENSAJE: Readonly<Record<string, string>> = {
  forbidden: 'Tu rol no puede mover esta factura.',
  accion_desconocida: 'Esa acción no existe.',
  invoice_not_found: 'Esa factura ya no existe.',
};

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

function esAccionConBoton(valor: string): valor is InvoiceAction {
  return (ACCIONES_CON_BOTON as readonly string[]).includes(valor);
}

/**
 * Mueve la factura.
 *
 * Lo que llega del formulario se vuelve a validar entero: los botones que
 * pintó la pantalla son una sugerencia, y un `POST` armado a mano tiene que
 * estrellarse igual. El estado y el rol los comprueba `aplicarTransicion` con
 * la misma función pura que usa la API.
 */
async function mover(formData: FormData): Promise<void> {
  'use server';
  const principal = await requirePrincipal();

  const id = formData.get('id');
  const accion = formData.get('accion');
  if (typeof id !== 'string' || typeof accion !== 'string') notFound();
  if (!esAccionConBoton(accion)) redirect(`/facturas/${id}?error=accion_desconocida`);

  const resultado = await db().withTenant(principal.tenantId, (tx) =>
    aplicarTransicion(tx, principal, id, accion),
  );

  if (!resultado.ok) {
    // El mensaje de la máquina de estados es la mitad del valor («se esperaba
    // PENDING_REVIEW», «sólo OWNER, FINANCE»). No lleva datos de la factura ni
    // de nadie, sólo nombres de estados y de roles, así que puede viajar en la
    // URL sin romper la regla de cero PII.
    redirect(
      `/facturas/${id}?error=${resultado.motivo}&detalle=${encodeURIComponent(resultado.mensaje)}`,
    );
  }

  redirect(`/facturas/${id}?hecho=${resultado.to}`);
}

export default async function FacturaPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const { id } = await params;
  const parametros = await searchParams;

  const { factura, historial } = await db().withTenant(principal.tenantId, async (tx) => ({
    factura: await tx.invoice.findUnique({ where: { id }, select: CAMPOS }),
    historial: await tx.auditLog.findMany({
      where: { entity: 'invoice', entityId: id },
      select: { id: true, action: true, at: true },
      orderBy: { at: 'desc' as const },
      take: 20,
    }),
  }));

  // RLS deja fuera las facturas de otros tenants: aquí llegan como inexistentes,
  // y eso es lo correcto. Un 403 confirmaría que la factura existe en algún sitio.
  if (!factura) notFound();

  const error = texto(parametros['error']);
  const detalle = texto(parametros['detalle']);
  const hecho = texto(parametros['hecho']);
  const acciones = botonesVisibles(factura.status, principal.role);
  const editable = canEditInvoice(factura.status);

  return (
    <Shell actual="/facturas">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Link href="/facturas" className="text-muted-foreground text-sm underline">
              Volver a facturas
            </Link>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              <span className="font-mono">{factura.invoiceNumber}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[factura.status]}`}>
                {ETIQUETA_ESTADO[factura.status]}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm">{factura.vendor.name}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {formatearImporte(factura.grossCents, factura.currency)}
            </p>
            <p className="text-muted-foreground text-xs">
              Base {formatearImporte(factura.netCents, factura.currency)} · IVA{' '}
              {formatearImporte(factura.vatCents, factura.currency)}
            </p>
          </div>
        </div>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE[error] ?? 'No se ha podido mover la factura.'}
            {detalle === '' ? null : <span className="block text-xs">{detalle}</span>}
          </p>
        ) : null}

        {hecho !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Factura en {ETIQUETA_ESTADO[factura.status]}.
          </p>
        ) : null}

        {factura.duplicateOfId !== null ? (
          <p className="rounded border border-zinc-300 bg-zinc-50 p-3 text-sm">
            Marcada como copia de{' '}
            <Link className="underline" href={`/facturas/${factura.duplicateOfId}`}>
              otra factura
            </Link>
            .
          </p>
        ) : null}

        {acciones.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {acciones.map((accion) => (
              <form key={accion} action={mover}>
                <input type="hidden" name="id" value={factura.id} />
                <input type="hidden" name="accion" value={accion} />
                <Button
                  type="submit"
                  size="sm"
                  variant={ACCIONES_DESTRUCTIVAS.includes(accion) ? 'outline' : 'default'}
                >
                  {ETIQUETA_ACCION[accion]}
                </Button>
              </form>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No hay ninguna acción disponible para tu rol en este estado.
          </p>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Emisión" valor={formatearFecha(aIso(factura.issueDate))} />
          <Dato titulo="Devengo" valor={formatearFecha(aIso(factura.accrualDate))} />
          <Dato
            titulo="Vencimiento"
            valor={factura.dueDate === null ? '—' : formatearFecha(aIso(factura.dueDate))}
          />
          <Dato titulo="Origen" valor={factura.source} />
          <Dato
            titulo="Periodo de servicio"
            valor={
              factura.serviceStart === null || factura.serviceEnd === null
                ? '—'
                : `${formatearFecha(aIso(factura.serviceStart))} – ${formatearFecha(aIso(factura.serviceEnd))}`
            }
          />
          <Dato
            titulo="Tipo de cambio"
            valor={factura.fxRate === null ? '—' : String(factura.fxRate)}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Líneas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">#</th>
                  <th className="p-2 font-medium">Descripción</th>
                  <th className="p-2 font-medium">Concepto</th>
                  <th className="p-2 text-right font-medium">Cantidad</th>
                  <th className="p-2 text-right font-medium">Precio</th>
                  <th className="p-2 text-right font-medium">Importe</th>
                </tr>
              </thead>
              <tbody>
                {factura.lines.map((linea) => (
                  <tr key={linea.id} className="border-b">
                    <td className="p-2 tabular-nums">{linea.lineNumber}</td>
                    <td className="p-2">{linea.description}</td>
                    {/* Lo que no es gasto del departamento se marca en la línea,
                        no en una nota al pie: quien audita la factura tiene que
                        ver en la propia fila por qué ese importe no aparece en
                        el presupuesto. */}
                    <td className="p-2">
                      {CONCEPT_DEFINITIONS[linea.concept].label}
                      {countsAsDepartmentSpend(linea.concept) ? null : (
                        <span className="text-muted-foreground block text-xs">
                          No consume presupuesto del departamento
                        </span>
                      )}
                    </td>
                    {/* `quantity` es Decimal(18,4), no un número: React no lo sabe pintar y
                        TypeScript lo rechaza. Se pasa por número para que 2.0000 salga como 2. */}
                    <td className="p-2 text-right tabular-nums">
                      {Number(linea.quantity).toLocaleString('es-ES')}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearImporte(linea.unitPriceCents, factura.currency)}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearImporte(linea.netCents, factura.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable ? null : (
            <p className="text-muted-foreground text-xs">
              En {ETIQUETA_ESTADO[factura.status]} el contenido no se edita. Quien revisa tiene que
              estar mirando lo mismo que se le mandó; para corregir algo hay que rechazarla o
              devolverla a borrador, y eso queda auditado.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Historial</h2>
          {historial.length === 0 ? (
            <p className="text-muted-foreground text-sm">Todavía no hay movimientos.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {historial.map((apunte) => (
                <li key={apunte.id} className="flex flex-wrap gap-2 border-b py-1">
                  <span className="text-muted-foreground font-mono text-xs">
                    {apunte.at.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                  <span>{apunte.action}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Dato({ titulo, valor }: { readonly titulo: string; readonly valor: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className="text-sm">{valor}</p>
    </div>
  );
}
