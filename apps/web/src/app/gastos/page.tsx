import type { BudgetCategory } from '@itfin360/finance-core';
import { Button } from '@itfin360/ui';
import Link from 'next/link';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { formatearImporte } from '@/lib/formato';
import {
  ETIQUETA_CATEGORIA,
  formatearVariacion,
  gastoDelPeriodo,
  type GastoDelPeriodo,
  variacion,
} from '@/lib/gasto';
import {
  type Mes,
  mesAnterior,
  mesDe,
  nombreMes,
  parsearMes,
  periodoDelMes,
  textoMes,
} from '@/lib/periodos';
import { requireAnyPermission } from '@/lib/tenant-context';

/**
 * Estado del gasto del departamento (F2-05).
 *
 * Es la pantalla que convierte facturas en una cifra que se puede enseñar. Todo
 * lo que sale aquí viene de una sola consulta por periodo y del mismo motor que
 * valida las facturas, así que el total, el desglose y la tabla de proveedores
 * no pueden discrepar entre sí.
 *
 * Se enseña también lo que **no** cuenta, y por qué: lo que capitaliza y entra
 * por amortización, y el material que se revende a un cliente. Esconderlo daría
 * una cifra más limpia y dejaría a quien la mira sin poder cuadrarla contra la
 * suma de las facturas del mes.
 */

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/**
 * Categorías con importe, de mayor a menor.
 *
 * El desglose es parcial: sólo trae las categorías en las que ha habido gasto,
 * así que las entradas sin importe se descartan en vez de pintarse a cero.
 */
function categoriasDe(gasto: GastoDelPeriodo): readonly (readonly [BudgetCategory, number])[] {
  const entradas: (readonly [BudgetCategory, number])[] = [];
  for (const [categoria, importe] of Object.entries(gasto.reparto.byBudgetCategory)) {
    if (importe !== undefined) entradas.push([categoria as BudgetCategory, importe] as const);
  }
  return entradas.sort((a, b) => b[1] - a[1]);
}

/**
 * Porcentaje que representa un importe sobre el total.
 *
 * Con el total a cero se devuelve guion en vez de `NaN`. Puede pasar: un mes
 * con una factura y su abono suma cero y sigue teniendo categorías.
 */
function porcentaje(importe: number, total: number): string {
  if (total === 0) return '—';
  return `${((importe / total) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}

export default async function GastosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'dashboards:showback']);
  const parametros = await searchParams;

  // Lo que venga en la URL lo escribe cualquiera. Si no es un mes se usa el
  // actual y se dice; corregirlo en silencio enseñaría el gasto de otro mes.
  const escrito = texto(parametros['mes']).trim();
  const pedido = escrito === '' ? null : parsearMes(escrito);
  const mes: Mes = pedido ?? mesDe(new Date());
  const mesNoValido = escrito !== '' && pedido === null;
  const anterior = mesAnterior(mes);

  const { actual, previo } = await db().withTenant(principal.tenantId, async (tx) => ({
    actual: await gastoDelPeriodo(tx, periodoDelMes(mes)),
    previo: await gastoDelPeriodo(tx, periodoDelMes(anterior)),
  }));

  const divisa = actual.divisa;
  const categorias = categoriasDe(actual);
  const cambio = variacion(actual.reparto.totalCents, previo.reparto.totalCents);

  return (
    <Shell actual="/gastos">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Gasto del departamento</h1>
            <p className="text-muted-foreground text-sm">{nombreMes(mes)}</p>
          </div>
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Mes
              <input
                type="month"
                name="mes"
                defaultValue={textoMes(mes)}
                className="rounded border px-3 py-2"
              />
            </label>
            <Button type="submit" size="sm">
              Ver
            </Button>
          </form>
        </div>

        {mesNoValido ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            No he entendido el mes «{escrito}», así que enseño {nombreMes(mes)}.
          </p>
        ) : null}

        {actual.variasDivisas ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            En este mes hay facturas en más de una divisa. Las cifras de abajo las suman como si
            fueran la misma, así que no son fiables hasta que haya tipo de cambio. Está anotado como
            pendiente.
          </p>
        ) : null}

        <section className="flex flex-wrap gap-4">
          <div className="min-w-64 rounded border p-4">
            <p className="text-muted-foreground text-xs">Gasto del mes</p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatearImporte(actual.reparto.totalCents, divisa)}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatearVariacion(cambio)} respecto a {nombreMes(anterior)} (
              {formatearImporte(previo.reparto.totalCents, divisa)})
            </p>
          </div>

          <Tarjeta
            titulo="Facturas"
            valor={String(actual.facturas)}
            nota="aprobadas o contabilizadas"
          />
          <Tarjeta
            titulo="Capitalizado"
            valor={formatearImporte(actual.reparto.capitalisedCents, divisa)}
            nota="entra por amortización, no aquí"
          />
          <Tarjeta
            titulo="Material para reventa"
            valor={formatearImporte(actual.reparto.excludedCents, divisa)}
            nota="no es gasto del departamento"
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Por categoría presupuestaria</h2>
          {categorias.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Este mes no hay gasto aprobado. Las facturas en borrador o en revisión no cuentan
              hasta que se aprueban.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b">
                    <th className="p-2 font-medium">Categoría</th>
                    <th className="p-2 text-right font-medium">Importe</th>
                    <th className="p-2 text-right font-medium">% del mes</th>
                    <th className="p-2 text-right font-medium">{nombreMes(anterior)}</th>
                    <th className="p-2 text-right font-medium">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {categorias.map(([categoria, importe]) => {
                    const antes = previo.reparto.byBudgetCategory[categoria] ?? 0;
                    return (
                      <tr key={categoria} className="border-b">
                        <td className="p-2">{ETIQUETA_CATEGORIA[categoria]}</td>
                        <td className="p-2 text-right tabular-nums">
                          {formatearImporte(importe, divisa)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {porcentaje(importe, actual.reparto.totalCents)}
                        </td>
                        <td className="text-muted-foreground p-2 text-right tabular-nums">
                          {formatearImporte(antes, divisa)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {formatearVariacion(variacion(importe, antes))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatearImporte(actual.reparto.totalCents, divisa)}
                    </td>
                    <td className="p-2 text-right tabular-nums">100 %</td>
                    <td className="text-muted-foreground p-2 text-right tabular-nums">
                      {formatearImporte(previo.reparto.totalCents, divisa)}
                    </td>
                    <td className="p-2 text-right tabular-nums">{formatearVariacion(cambio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {actual.porProveedor.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Por proveedor</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b">
                    <th className="p-2 font-medium">Proveedor</th>
                    <th className="p-2 text-right font-medium">Importe</th>
                    <th className="p-2 text-right font-medium">% del mes</th>
                  </tr>
                </thead>
                <tbody>
                  {actual.porProveedor.map((proveedor) => (
                    <tr key={proveedor.vendorId} className="border-b">
                      <td className="p-2">{proveedor.nombre}</td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(proveedor.cents, divisa)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {porcentaje(proveedor.cents, actual.reparto.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {actual.pendientes.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Compras que deberían ser inmovilizado</h2>
            <p className="text-muted-foreground text-sm">
              Estas líneas cuentan como gasto del mes porque el dinero ha salido, pero por su
              concepto tendrían que estar dadas de alta como activo y repartirse en cuotas de
              amortización. El día que se den de alta, el importe se moverá; no se contará dos
              veces.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b">
                    <th className="p-2 font-medium">Factura</th>
                    <th className="p-2 font-medium">Línea</th>
                    <th className="p-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {actual.pendientes.map((pendiente) => (
                    <tr
                      key={`${pendiente.invoiceId}-${pendiente.descripcion}`}
                      className="border-b"
                    >
                      <td className="p-2">
                        <Link
                          className="font-mono text-xs underline"
                          href={`/facturas/${pendiente.invoiceId}`}
                        >
                          {pendiente.invoiceNumber}
                        </Link>
                      </td>
                      <td className="p-2">{pendiente.descripcion}</td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(pendiente.cents, divisa)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="text-muted-foreground flex flex-col gap-1 rounded border p-4 text-sm">
          <h2 className="text-foreground font-medium">Cómo se cuenta</h2>
          <p>
            Sólo entran las facturas aprobadas o contabilizadas. Un borrador es algo que alguien
            está tecleando y una factura en revisión todavía puede rechazarse: contarlas daría una
            cifra que se mueve sola.
          </p>
          <p>
            El mes lo decide la fecha de devengo, no la de emisión ni la de pago. El servicio de
            enero es gasto de enero aunque la factura llegue en febrero.
          </p>
          <p>
            Lo que capitaliza y el material comprado para revender salen aparte, arriba, y no suman
            en el total.
          </p>
        </section>
      </div>
    </Shell>
  );
}

function Tarjeta({
  titulo,
  valor,
  nota,
}: {
  readonly titulo: string;
  readonly valor: string;
  readonly nota: string;
}) {
  return (
    <div className="min-w-48 rounded border p-4">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
      <p className="text-muted-foreground text-xs">{nota}</p>
    </div>
  );
}
