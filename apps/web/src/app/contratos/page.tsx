import { Periodicity, SpendConcept } from '@itfin360/db';
import { Button, Input } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { contratosConResumen, proveedoresParaElegir } from '@/lib/contrato-query';
import { altaContrato, ETIQUETA_ESTADO_CONTRATO, ETIQUETA_PERIODICIDAD } from '@/lib/contratos';
import { db } from '@/lib/db';
import { formatearFecha, formatearImporte } from '@/lib/formato';
import { can } from '@/lib/permissions';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Contratos recurrentes.
 *
 * La tabla no enseña sólo lo que pone el contrato, sino lo que cuesta de verdad
 * al mes. Un anual de 12.000 € y un mensual de 900 € no se pueden comparar de un
 * vistazo hasta que los dos hablan en coste mensual, y compararlos es todo el
 * trabajo de revisar una cartera.
 *
 * La cuenta atrás es hasta el **preaviso**, no hasta la renovación. Con noventa
 * días de preaviso, un contrato que renueva en enero hay que cancelarlo en
 * octubre: enseñar enero es enseñar una fecha que ya no sirve para decidir.
 */

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  invalid_input:
    'Revisa los datos: hacen falta proveedor, nombre, importe, divisa, periodicidad y fecha de inicio.',
  contract_exists: 'Ese proveedor ya tiene un contrato con ese nombre.',
  forbidden: 'Tu rol no puede dar de alta contratos.',
};

const COLOR_AVISO: Readonly<Record<string, string>> = {
  INFO: 'border-slate-300 bg-slate-50 text-slate-900',
  WARNING: 'border-amber-300 bg-amber-50 text-amber-900',
  CRITICAL: 'border-red-300 bg-red-50 text-red-900',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/** Cómo de urgente es el preaviso, en palabras y en color. */
function avisoDePreaviso(dias: number | null): { texto: string; clase: string } | null {
  if (dias === null) return null;
  if (dias < 0)
    return { texto: `Fuera de plazo hace ${-dias} d`, clase: 'text-red-700 font-medium' };
  if (dias <= 30) return { texto: `Preavisar en ${dias} d`, clase: 'text-red-700 font-medium' };
  if (dias <= 90) return { texto: `Preavisar en ${dias} d`, clase: 'text-amber-700' };
  return { texto: `${dias} d`, clase: 'text-muted-foreground' };
}

async function crear(formData: FormData): Promise<void> {
  'use server';
  const campo = (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };

  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/contratos?error=forbidden');

  const datos = altaContrato.safeParse({
    vendorId: campo('vendorId'),
    name: campo('name'),
    concept: campo('concept'),
    amountCents: campo('amount'),
    currency: campo('currency'),
    periodicity: campo('periodicity'),
    startDate: campo('startDate'),
    renewalDate: campo('renewalDate'),
    noticeDays: campo('noticeDays'),
    licensedSeats: campo('licensedSeats'),
    activeSeats: campo('activeSeats'),
    previousAmountCents: campo('previousAmount'),
    autoRenew: formData.get('autoRenew') === 'on',
  });
  if (!datos.success) redirect('/contratos?error=invalid_input');

  const entrada = datos.data;
  const opcional = <T,>(valor: T | undefined): T | null => valor ?? null;

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const contrato = await tx.contract.create({
        data: {
          tenantId: principal.tenantId,
          vendorId: entrada.vendorId,
          name: entrada.name,
          concept: entrada.concept,
          amountCents: entrada.amountCents,
          currency: entrada.currency,
          periodicity: entrada.periodicity,
          startDate: new Date(entrada.startDate),
          renewalDate: entrada.renewalDate === undefined ? null : new Date(entrada.renewalDate),
          noticeDays: opcional(entrada.noticeDays),
          autoRenew: entrada.autoRenew ?? false,
          licensedSeats: opcional(entrada.licensedSeats),
          activeSeats: opcional(entrada.activeSeats),
          previousAmountCents: opcional(entrada.previousAmountCents),
          // Si hay importe anterior y nadie dice lo contrario, la periodicidad
          // anterior es la misma: comparar un anual contra un mensual sin querer
          // daría una subida del 1.100 % y un aviso que nadie se cree.
          previousPeriodicity:
            entrada.previousAmountCents === undefined ? null : entrada.periodicity,
        },
        select: { id: true, name: true, amountCents: true, periodicity: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'contract.created',
          entity: 'contract',
          entityId: contrato.id,
          after: {
            name: contrato.name,
            amountCents: contrato.amountCents,
            periodicity: contrato.periodicity,
          },
        },
      });
    });
  } catch {
    redirect('/contratos?error=contract_exists');
  }

  redirect('/contratos?alta=ok');
}

export default async function ContratosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']) === 'ok';

  const { filas, resumen } = await db().withTenant(principal.tenantId, (tx) =>
    contratosConResumen(tx),
  );
  const proveedores = await db().withTenant(principal.tenantId, (tx) => proveedoresParaElegir(tx));
  const divisa = filas[0]?.currency ?? 'EUR';
  const nombrePorId = new Map(filas.map((fila) => [fila.id, fila.name]));

  return (
    <Shell actual="/contratos">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Contratos y suscripciones</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido dar de alta el contrato.'}
          </p>
        ) : null}
        {alta ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Contrato dado de alta.
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Coste mensual de la cartera</p>
            <p className="text-2xl font-semibold">
              {formatearImporte(resumen.monthlyCents, divisa)}
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Coste anualizado</p>
            <p className="text-2xl font-semibold">
              {formatearImporte(resumen.annualCents, divisa)}
            </p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Contratos vivos</p>
            <p className="text-2xl font-semibold">
              {filas.filter((f) => f.status === 'ACTIVE' || f.status === 'NOTICE_GIVEN').length}
            </p>
          </div>
        </section>

        {resumen.avisos.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Dinero en juego</h2>
            {resumen.avisos.map((aviso) => (
              <p
                key={`${aviso.contractId}-${aviso.type}`}
                className={`rounded border p-3 text-sm ${COLOR_AVISO[aviso.severity] ?? ''}`}
              >
                <strong>{nombrePorId.get(aviso.contractId) ?? aviso.contractId}</strong>:{' '}
                {aviso.message}
              </p>
            ))}
          </section>
        ) : null}

        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay contratos. Da de alta el primero abajo y verás aquí lo que cuesta al mes,
            cuándo hay que preavisar y cuántos puestos se pagan sin usar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Contrato</th>
                  <th className="p-2 font-medium">Proveedor</th>
                  <th className="p-2 font-medium">Periodicidad</th>
                  <th className="p-2 text-right font-medium">Importe</th>
                  <th className="p-2 text-right font-medium">Al mes</th>
                  <th className="p-2 text-right font-medium">Al año</th>
                  <th className="p-2 text-right font-medium">Puestos sin usar</th>
                  <th className="p-2 font-medium">Preaviso</th>
                  <th className="p-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const preaviso = avisoDePreaviso(fila.calculo?.diasHastaPreaviso ?? null);
                  return (
                    <tr key={fila.id} className="border-b">
                      <td className="p-2">{fila.name}</td>
                      <td className="p-2">{fila.vendor.name}</td>
                      <td className="p-2">{ETIQUETA_PERIODICIDAD[fila.periodicity]}</td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.amountCents, fila.currency)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.calculo?.monthlyCents ?? 0, fila.currency)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(fila.calculo?.annualCents ?? 0, fila.currency)}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {fila.calculo?.puestosSinUsar ?? ''}
                      </td>
                      <td className={`p-2 ${preaviso?.clase ?? ''}`}>
                        {preaviso?.texto ?? formatearFecha(null)}
                      </td>
                      <td className="p-2">{ETIQUETA_ESTADO_CONTRATO[fila.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {can(principal, 'invoices:create') ? (
          <section className="max-w-4xl rounded border p-4">
            <h2 className="mb-3 font-medium">Nuevo contrato</h2>
            {proveedores.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Antes hace falta al menos un proveedor. Los contratos cuelgan de quien los factura.
              </p>
            ) : (
              <form action={crear} className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Proveedor
                  <select name="vendorId" required className="w-52 rounded border px-3 py-2">
                    {proveedores.map((proveedor) => (
                      <option key={proveedor.id} value={proveedor.id}>
                        {proveedor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Nombre del contrato
                  <Input name="name" required maxLength={200} className="w-56" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Concepto
                  <select
                    name="concept"
                    defaultValue="SAAS_SUBSCRIPTION"
                    className="w-52 rounded border px-3 py-2"
                  >
                    {Object.keys(SpendConcept).map((concepto) => (
                      <option key={concepto} value={concepto}>
                        {concepto}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Importe del periodo
                  <Input name="amount" required inputMode="decimal" className="w-32" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Divisa
                  <Input
                    name="currency"
                    required
                    defaultValue="EUR"
                    maxLength={3}
                    className="w-20"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Periodicidad
                  <select
                    name="periodicity"
                    defaultValue="ANNUAL"
                    className="rounded border px-3 py-2"
                  >
                    {Object.keys(Periodicity).map((p) => (
                      <option key={p} value={p}>
                        {ETIQUETA_PERIODICIDAD[p as keyof typeof Periodicity]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Inicio
                  <Input name="startDate" type="date" required className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Renovación
                  <Input name="renewalDate" type="date" className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Días de preaviso
                  <Input name="noticeDays" inputMode="numeric" className="w-28" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Puestos contratados
                  <Input name="licensedSeats" inputMode="numeric" className="w-28" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Puestos activos
                  <Input name="activeSeats" inputMode="numeric" className="w-28" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Importe del periodo anterior
                  <Input name="previousAmount" inputMode="decimal" className="w-40" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoRenew" className="size-4" />
                  Se renueva solo
                </label>
                <Button type="submit" size="sm">
                  Dar de alta
                </Button>
              </form>
            )}
            <p className="text-muted-foreground mt-3 text-xs">
              El importe es lo que se paga en cada periodo, no al mes: si el contrato es anual,
              escribe el precio anual. Los puestos y el importe anterior son opcionales, pero son
              justo lo que hace falta para avisar de licencias sin usar y de subidas de precio.
            </p>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
