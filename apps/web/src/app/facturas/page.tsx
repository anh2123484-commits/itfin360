import { InvoiceStatus } from '@itfin360/db';
import { parseIsoDate } from '@itfin360/finance-core';
import { Button } from '@itfin360/ui';
import Link from 'next/link';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { esFechaIso } from '@/lib/fechas';
import { COLOR_ESTADO, ETIQUETA_ESTADO, formatearFecha, formatearImporte } from '@/lib/formato';
import {
  type FiltroFacturas,
  LIMITE_POR_DEFECTO,
  listarFacturas,
  totalesPorDivisa,
} from '@/lib/invoice-query';
import { requireAnyPermission } from '@/lib/tenant-context';

/**
 * Explorador de facturas (primera entrega de F2-05).
 *
 * Componente de servidor: la consulta ocurre dentro de `withTenant`, así que
 * RLS limita las filas antes de que salgan de la base. No hay `fetch` a la
 * propia API porque eso obligaría a reenviar la cookie de sesión desde el
 * servidor a sí mismo, con una vuelta de red y una forma más de equivocarse.
 *
 * Los filtros van por `GET` en la URL. Así una búsqueda se puede compartir, se
 * puede guardar en marcadores y el botón de atrás funciona.
 */

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? '';
  return valor ?? '';
}

function esEstado(valor: string): valor is keyof typeof InvoiceStatus {
  return Object.keys(InvoiceStatus).includes(valor);
}

/** Lo que hay escrito en la URL, sin juzgar todavía si es válido. */
interface Escrito {
  readonly estado: string;
  readonly numero: string;
  readonly desde: string;
  readonly hasta: string;
  readonly cursor: string;
}

function leer(parametros: Parametros): Escrito {
  return {
    estado: texto(parametros['estado']).trim(),
    numero: texto(parametros['numero']).trim(),
    desde: texto(parametros['desde']).trim(),
    hasta: texto(parametros['hasta']).trim(),
    cursor: texto(parametros['cursor']).trim(),
  };
}

/**
 * Filtro efectivo. Lo que no se entiende se ignora y se avisa; no se inventa.
 *
 * Aplicar a medias un filtro que alguien escribió mal enseña un gasto que no
 * es el real y no hay forma de notarlo, así que la pantalla dice en voz alta
 * qué ha descartado.
 */
function interpretar(escrito: Escrito): { filtro: FiltroFacturas; avisos: string[] } {
  const avisos: string[] = [];
  const filtro: {
    status?: FiltroFacturas['status'];
    numero?: string;
    desde?: FiltroFacturas['desde'];
    hasta?: FiltroFacturas['hasta'];
  } = {};

  if (escrito.estado !== '') {
    if (esEstado(escrito.estado)) filtro.status = escrito.estado;
    else avisos.push(`Estado desconocido: ${escrito.estado}`);
  }
  if (escrito.numero !== '') filtro.numero = escrito.numero;
  for (const [campo, valor] of [
    ['desde', escrito.desde],
    ['hasta', escrito.hasta],
  ] as const) {
    if (valor === '') continue;
    if (esFechaIso(valor)) filtro[campo] = parseIsoDate(valor);
    else avisos.push(`Fecha no válida en «${campo}»: ${valor}`);
  }

  return { filtro, avisos };
}

export default async function FacturasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const escrito = leer(parametros);
  const alta = texto(parametros['alta']).trim();
  const importadas = texto(parametros['importadas']).trim();
  const lineasImportadas = texto(parametros['lineas']).trim();
  const proveedoresNuevos = texto(parametros['proveedores']).trim();
  const { filtro, avisos } = interpretar(escrito);

  const { pagina, totales } = await db().withTenant(principal.tenantId, async (tx) => ({
    pagina: await listarFacturas(tx, filtro, {
      limite: LIMITE_POR_DEFECTO,
      ...(escrito.cursor === '' ? {} : { cursor: escrito.cursor }),
    }),
    totales: await totalesPorDivisa(tx, filtro),
  }));

  const siguiente = new URLSearchParams();
  for (const [clave, valor] of Object.entries(escrito)) {
    if (clave !== 'cursor' && valor !== '') siguiente.set(clave, valor);
  }
  if (pagina.nextCursor !== null) siguiente.set('cursor', pagina.nextCursor);

  return (
    <Shell actual="/facturas">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Facturas</h1>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/facturas/importar">Importar</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/facturas/nueva">Nueva factura</Link>
            </Button>
          </div>
        </div>

        {alta !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Factura {alta} guardada en borrador. Para que cuente como gasto hay que mandarla a
            revisión y aprobarla.
          </p>
        ) : null}

        {importadas !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Importadas {importadas} facturas con {lineasImportadas} líneas, todas en borrador.
            {proveedoresNuevos === '' ? null : (
              <span className="block pt-1">
                Proveedores creados por la importación: {proveedoresNuevos}. Conviene abrirlos y
                completarles el nombre fiscal y el NIF.
              </span>
            )}
          </p>
        ) : null}

        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Número
            <input
              name="numero"
              defaultValue={escrito.numero}
              className="w-40 rounded border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Estado
            <select
              name="estado"
              defaultValue={escrito.estado}
              className="rounded border px-3 py-2"
            >
              <option value="">Todos</option>
              {Object.keys(InvoiceStatus).map((estado) => (
                <option key={estado} value={estado}>
                  {ETIQUETA_ESTADO[estado as keyof typeof ETIQUETA_ESTADO]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Devengo desde
            <input
              name="desde"
              type="date"
              defaultValue={escrito.desde}
              className="rounded border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            hasta
            <input
              name="hasta"
              type="date"
              defaultValue={escrito.hasta}
              className="rounded border px-3 py-2"
            />
          </label>
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/facturas">Limpiar</Link>
          </Button>
        </form>

        {avisos.length > 0 ? (
          <ul className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {avisos.map((aviso) => (
              <li key={aviso}>{aviso} (filtro ignorado)</li>
            ))}
          </ul>
        ) : null}

        {totales.length > 0 ? (
          <section className="flex flex-wrap gap-4">
            {totales.map((total) => (
              <div key={total.currency} className="rounded border p-3">
                <p className="text-muted-foreground text-xs">
                  {total.facturas} factura{total.facturas === 1 ? '' : 's'} en {total.currency}
                </p>
                <p className="text-lg font-semibold">
                  {formatearImporte(total.grossCents, total.currency)}
                </p>
                <p className="text-muted-foreground text-xs">
                  Base {formatearImporte(total.netCents, total.currency)} · IVA{' '}
                  {formatearImporte(total.vatCents, total.currency)}
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {pagina.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay facturas que cumplan el filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Número</th>
                  <th className="p-2 font-medium">Proveedor</th>
                  <th className="p-2 font-medium">Devengo</th>
                  <th className="p-2 text-right font-medium">Base</th>
                  <th className="p-2 text-right font-medium">Total</th>
                  <th className="p-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {pagina.items.map((factura) => (
                  <tr key={factura.id} className="border-b">
                    <td className="p-2 font-mono text-xs">
                      <Link className="underline" href={`/facturas/${factura.id}`}>
                        {factura.invoiceNumber}
                      </Link>
                    </td>
                    <td className="p-2">{factura.vendor.name}</td>
                    <td className="p-2">{formatearFecha(factura.accrualDate)}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearImporte(factura.netCents, factura.currency)}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearImporte(factura.grossCents, factura.currency)}
                    </td>
                    <td className="p-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[factura.status]}`}
                      >
                        {ETIQUETA_ESTADO[factura.status]}
                      </span>
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
              <Link href={`/facturas?${siguiente.toString()}`}>Siguiente página</Link>
            </Button>
          </div>
        ) : null}

        <p className="text-muted-foreground text-xs">
          Los totales son del filtro completo, no de esta página. No se suman divisas distintas.
        </p>
      </div>
    </Shell>
  );
}
