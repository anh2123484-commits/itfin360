import { AssetCategory } from '@itfin360/db';
import { Button, Input } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { activosConResumen } from '@/lib/activo-query';
import {
  altaActivo,
  ETIQUETA_CATEGORIA,
  ETIQUETA_ESTADO_ACTIVO,
  vidaUtilPorDefecto,
} from '@/lib/activos';
import { proveedoresParaElegir } from '@/lib/contrato-query';
import { db } from '@/lib/db';
import { formatearImporte } from '@/lib/formato';
import { can } from '@/lib/permissions';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Inmovilizado.
 *
 * Las dos cifras que importan de un parque no son cuántas máquinas hay, sino
 * cuánto vale hoy lo que se compró y cuánto costaría reponer lo que ya pasó de
 * su vida útil. La segunda es la deuda técnica, y suele ser la cifra que nadie
 * ha puesto nunca encima de la mesa en una reunión de presupuesto.
 *
 * Aparte va el riesgo de renovación: lo que vence en los próximos doce meses y
 * no tiene línea de presupuesto. Eso todavía se puede planificar; la deuda
 * técnica ya no.
 */

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  invalid_input:
    'Revisa los datos: hacen falta nombre, categoría, valor de compra, divisa y fecha de puesta en servicio.',
  asset_serial_exists: 'Ya hay un activo con ese número de serie.',
  forbidden: 'Tu rol no puede dar de alta activos.',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/** Cómo de cerca está el final de la vida útil, en palabras y en color. */
function estadoDeVida(mesesRestantes: number | null): { texto: string; clase: string } {
  if (mesesRestantes === null) return { texto: '', clase: '' };
  if (mesesRestantes <= 0)
    return { texto: `Vencido hace ${-mesesRestantes} m`, clase: 'text-red-700 font-medium' };
  if (mesesRestantes <= 12) return { texto: `${mesesRestantes} m`, clase: 'text-amber-700' };
  return { texto: `${mesesRestantes} m`, clase: 'text-muted-foreground' };
}

async function crear(formData: FormData): Promise<void> {
  'use server';
  const campo = (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };

  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/activos?error=forbidden');

  const datos = altaActivo.safeParse({
    name: campo('name'),
    category: campo('category'),
    vendorId: campo('vendorId'),
    serialNumber: campo('serialNumber'),
    acquisitionCents: campo('acquisition'),
    residualCents: campo('residual'),
    usefulLifeMonths: campo('usefulLifeMonths'),
    inServiceDate: campo('inServiceDate'),
    currency: campo('currency'),
    assignedTo: campo('assignedTo'),
    hasBudgetLine: formData.get('hasBudgetLine') === 'on',
  });
  if (!datos.success) redirect('/activos?error=invalid_input');

  const entrada = datos.data;
  // Sin vida útil escrita se usa la de la categoría. Es la tabla del motor de
  // cálculo, la misma que usa la amortización, así que no hay dos verdades.
  const vidaUtil = entrada.usefulLifeMonths ?? vidaUtilPorDefecto(entrada.category);

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const activo = await tx.asset.create({
        data: {
          tenantId: principal.tenantId,
          name: entrada.name,
          category: entrada.category,
          vendorId: entrada.vendorId ?? null,
          serialNumber: entrada.serialNumber ?? null,
          acquisitionCents: entrada.acquisitionCents,
          residualCents: entrada.residualCents ?? 0,
          usefulLifeMonths: vidaUtil,
          inServiceDate: new Date(entrada.inServiceDate),
          currency: entrada.currency,
          hasBudgetLine: entrada.hasBudgetLine ?? false,
          assignedTo: entrada.assignedTo ?? null,
        },
        select: { id: true, name: true, category: true, acquisitionCents: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'asset.created',
          entity: 'asset',
          entityId: activo.id,
          after: {
            name: activo.name,
            category: activo.category,
            acquisitionCents: activo.acquisitionCents,
          },
        },
      });
    });
  } catch {
    redirect('/activos?error=asset_serial_exists');
  }

  redirect('/activos?alta=ok');
}

export default async function ActivosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']) === 'ok';

  const { filas, resumen } = await db().withTenant(principal.tenantId, (tx) =>
    activosConResumen(tx),
  );
  const proveedores = await db().withTenant(principal.tenantId, (tx) => proveedoresParaElegir(tx));
  const divisa = filas[0]?.currency ?? 'EUR';

  return (
    <Shell actual="/activos">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Inmovilizado</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido dar de alta el activo.'}
          </p>
        ) : null}
        {alta ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Activo dado de alta.
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Valor de compra</p>
            <p className="text-2xl font-semibold">
              {formatearImporte(resumen.valorAdquisicionCents, divisa)}
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Valor neto contable</p>
            <p className="text-2xl font-semibold">
              {formatearImporte(resumen.valorNetoCents, divisa)}
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Amortización al mes</p>
            <p className="text-2xl font-semibold">
              {formatearImporte(resumen.amortizacionMensualCents, divisa)}
            </p>
          </div>
          <div className="rounded border border-red-300 bg-red-50 p-4">
            <p className="text-xs text-red-900">Deuda técnica</p>
            <p className="text-2xl font-semibold text-red-900">
              {formatearImporte(resumen.deuda.totalCents, divisa)}
            </p>
            <p className="mt-1 text-xs text-red-900">
              {resumen.deuda.expiredAssetIds.length} activos en uso pasados de vida útil
            </p>
          </div>
        </section>

        {resumen.deuda.unbudgetedRenewalAssetIds.length > 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{formatearImporte(resumen.deuda.unbudgetedRenewalCents, divisa)}</strong> vencen
            en los próximos doce meses sin línea de presupuesto (
            {resumen.deuda.unbudgetedRenewalAssetIds.length} activos). Esto todavía se puede
            planificar.
          </p>
        ) : null}

        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay activos. Da de alta el primero abajo y verás aquí el valor neto contable,
            la amortización mensual y el coste de reponer lo que ya está vencido.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Activo</th>
                  <th className="p-2 font-medium">Categoría</th>
                  <th className="p-2 font-medium">Asignado a</th>
                  <th className="p-2 text-right font-medium">Compra</th>
                  <th className="p-2 text-right font-medium">Valor neto</th>
                  <th className="p-2 text-right font-medium">Cuota mes</th>
                  <th className="p-2 font-medium">Vida restante</th>
                  <th className="p-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const vida = estadoDeVida(fila.calculo?.mesesRestantes ?? null);
                  return (
                    <tr key={fila.id} className="border-b">
                      <td className="p-2">{fila.name}</td>
                      <td className="p-2">{ETIQUETA_CATEGORIA[fila.category]}</td>
                      <td className="p-2">{fila.assignedTo ?? ''}</td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.acquisitionCents, fila.currency)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.calculo?.netBookValueCents ?? 0, fila.currency)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.calculo?.monthlyChargeCents ?? 0, fila.currency)}
                      </td>
                      <td className={`p-2 ${vida.clase}`}>{vida.texto}</td>
                      <td className="p-2">{ETIQUETA_ESTADO_ACTIVO[fila.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {can(principal, 'invoices:create') ? (
          <section className="max-w-4xl rounded border p-4">
            <h2 className="mb-3 font-medium">Nuevo activo</h2>
            <form action={crear} className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nombre
                <Input name="name" required maxLength={200} className="w-56" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Categoría
                <select
                  name="category"
                  defaultValue="LAPTOP"
                  className="w-52 rounded border px-3 py-2"
                >
                  {Object.keys(AssetCategory).map((categoria) => (
                    <option key={categoria} value={categoria}>
                      {ETIQUETA_CATEGORIA[categoria as keyof typeof AssetCategory]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Proveedor
                <select name="vendorId" defaultValue="" className="w-52 rounded border px-3 py-2">
                  <option value="">Sin proveedor</option>
                  {proveedores.map((proveedor) => (
                    <option key={proveedor.id} value={proveedor.id}>
                      {proveedor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Número de serie
                <Input name="serialNumber" maxLength={200} className="w-44" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Valor de compra
                <Input name="acquisition" required inputMode="decimal" className="w-32" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Valor residual
                <Input name="residual" inputMode="decimal" className="w-32" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Divisa
                <Input name="currency" required defaultValue="EUR" maxLength={3} className="w-20" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Puesta en servicio
                <Input name="inServiceDate" type="date" required className="w-40" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Vida útil en meses
                <Input name="usefulLifeMonths" inputMode="numeric" className="w-32" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Asignado a
                <Input name="assignedTo" maxLength={200} className="w-44" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hasBudgetLine" className="size-4" />
                Su renovación ya está presupuestada
              </label>
              <Button type="submit" size="sm">
                Dar de alta
              </Button>
            </form>
            <p className="text-muted-foreground mt-3 text-xs">
              Si dejas la vida útil en blanco se usa la de la categoría: 48 meses un portátil, 60 un
              servidor, 84 electrónica de red. Es la misma tabla que usa la amortización, así que no
              hay dos verdades.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
