import { EmploymentType } from '@itfin360/db';
import { Button, Input } from '@itfin360/ui';
import { redirect } from 'next/navigation';

import { Shell } from '@/components/shell';
import { db } from '@/lib/db';
import { formatearFecha } from '@/lib/formato';
import { can } from '@/lib/permissions';
import { altaEmpleado, altaPuesto, ETIQUETA_TIPO_CONTRATO, FTE_COMPLETO } from '@/lib/personal';
import { listarPuestos, plantillaConResumen } from '@/lib/personal-query';
import { requireAnyPermission, requirePrincipal } from '@/lib/tenant-context';

/**
 * Plantilla: quién trabaja, en qué puesto y con qué jornada.
 *
 * Aquí no hay sueldos. La retribución vive cifrada, aparte y auditada por
 * lectura, y es la tarea siguiente. Esta pantalla la puede ver cualquiera que
 * pueda ver facturas, y ésa es justo la razón de que las dos cosas no compartan
 * tabla.
 *
 * Las dos cifras que no coinciden casi nunca son las que importan: cuánta gente
 * ha pasado por el departamento este año y cuántas jornadas completas se pagan
 * de verdad. Un equipo que ha tenido dieciocho personas con doce jornadas
 * efectivas no cuesta lo que dieciocho, pero tampoco se gestiona como doce.
 */

const MENSAJE_ERROR: Readonly<Record<string, string>> = {
  invalid_input: 'Revisa los datos: hacen falta el nombre y la fecha de alta.',
  employee_code_exists: 'Ya hay alguien con ese código de empleado.',
  position_exists: 'Ya hay un puesto con ese nombre.',
  forbidden: 'Tu rol no puede dar de alta personas.',
};

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

function campoDe(formData: FormData) {
  return (nombre: string): string | undefined => {
    const valor = formData.get(nombre);
    return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
  };
}

async function crearPuesto(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/personal?error=forbidden');

  const datos = altaPuesto.safeParse({
    name: campo('name'),
    family: campo('family'),
    level: campo('level'),
  });
  if (!datos.success) redirect('/personal?error=invalid_input');

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const puesto = await tx.position.create({
        data: {
          tenantId: principal.tenantId,
          name: datos.data.name,
          family: datos.data.family ?? null,
          level: datos.data.level ?? null,
        },
        select: { id: true, name: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'position.created',
          entity: 'position',
          entityId: puesto.id,
          after: { name: puesto.name },
        },
      });
    });
  } catch {
    redirect('/personal?error=position_exists');
  }

  redirect('/personal?alta=puesto');
}

async function crearEmpleado(formData: FormData): Promise<void> {
  'use server';
  const campo = campoDe(formData);
  const principal = await requirePrincipal();
  if (!can(principal, 'invoices:create')) redirect('/personal?error=forbidden');

  const datos = altaEmpleado.safeParse({
    fullName: campo('fullName'),
    employeeCode: campo('employeeCode'),
    email: campo('email'),
    positionId: campo('positionId'),
    employmentType: campo('employmentType'),
    fteBp: campo('fte'),
    hireDate: campo('hireDate'),
    terminationDate: campo('terminationDate'),
    team: campo('team'),
    costCenter: campo('costCenter'),
  });
  if (!datos.success) redirect('/personal?error=invalid_input');

  const entrada = datos.data;

  try {
    await db().withTenant(principal.tenantId, async (tx) => {
      const persona = await tx.employee.create({
        data: {
          tenantId: principal.tenantId,
          fullName: entrada.fullName,
          employeeCode: entrada.employeeCode ?? null,
          email: entrada.email ?? null,
          positionId: entrada.positionId ?? null,
          employmentType: entrada.employmentType ?? 'PERMANENT',
          fteBp: entrada.fteBp ?? FTE_COMPLETO,
          hireDate: new Date(entrada.hireDate),
          terminationDate:
            entrada.terminationDate === undefined ? null : new Date(entrada.terminationDate),
          team: entrada.team ?? null,
          costCenter: entrada.costCenter ?? null,
        },
        select: { id: true, fteBp: true, hireDate: true },
      });
      // En el registro de auditoría no va el nombre: es un dato personal y el
      // log se guarda dos años y lo lee gente que no tiene por qué ver la lista
      // del departamento. Con el id se llega a la fila si hace falta.
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'employee.created',
          entity: 'employee',
          entityId: persona.id,
          after: { fteBp: persona.fteBp },
        },
      });
    });
  } catch {
    redirect('/personal?error=employee_code_exists');
  }

  redirect('/personal?alta=empleado');
}

function jornada(fteBp: number): string {
  return `${(fteBp / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;
}

export default async function PersonalPage({
  searchParams,
}: {
  readonly searchParams: Promise<Parametros>;
}) {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const alta = texto(parametros['alta']);

  const { anio, filas, resumen } = await db().withTenant(principal.tenantId, (tx) =>
    plantillaConResumen(tx),
  );
  const puestos = await db().withTenant(principal.tenantId, (tx) => listarPuestos(tx));
  const numero = (valor: number): string =>
    valor.toLocaleString('es-ES', { maximumFractionDigits: 2 });

  return (
    <Shell actual="/personal">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Plantilla</h1>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE_ERROR[error] ?? 'No se ha podido guardar.'}
          </p>
        ) : null}
        {alta !== '' ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            {alta === 'puesto' ? 'Puesto dado de alta.' : 'Persona dada de alta.'}
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Han pasado en {anio}</p>
            <p className="text-2xl font-semibold">{resumen.personas}</p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">De alta ahora</p>
            <p className="text-2xl font-semibold">{resumen.personasAlCierre}</p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Jornadas contratadas</p>
            <p className="text-2xl font-semibold">{numero(resumen.fteContratado)}</p>
          </div>
          <div className="rounded border p-4">
            <p className="text-muted-foreground text-xs">Jornadas efectivas en {anio}</p>
            <p className="text-2xl font-semibold">{numero(resumen.fteEfectivo)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Lo que de verdad se paga, contando altas y bajas por días
            </p>
          </div>
        </section>

        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay nadie dado de alta. Empieza por crear un puesto y luego añade a las
            personas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Persona</th>
                  <th className="p-2 font-medium">Puesto</th>
                  <th className="p-2 font-medium">Equipo</th>
                  <th className="p-2 font-medium">Contrato</th>
                  <th className="p-2 text-right font-medium">Jornada</th>
                  <th className="p-2 font-medium">Alta</th>
                  <th className="p-2 font-medium">Baja</th>
                  <th className="p-2 text-right font-medium">FTE {anio}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} className="border-b">
                    <td className="p-2">
                      {fila.fullName}
                      {fila.employeeCode !== null ? (
                        <span className="text-muted-foreground ml-2 font-mono text-xs">
                          {fila.employeeCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2">{fila.position?.name ?? ''}</td>
                    <td className="p-2">{fila.team ?? ''}</td>
                    <td className="p-2">{ETIQUETA_TIPO_CONTRATO[fila.employmentType]}</td>
                    <td className="p-2 text-right tabular-nums">{jornada(fila.fteBp)}</td>
                    <td className="p-2">{formatearFecha(fila.hireDate.toISOString())}</td>
                    <td className="p-2">
                      {fila.terminationDate === null ? (
                        ''
                      ) : (
                        <span className="text-muted-foreground">
                          {formatearFecha(fila.terminationDate.toISOString())}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right tabular-nums">{numero(fila.fteEfectivo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {can(principal, 'invoices:create') ? (
          <>
            <section className="max-w-4xl rounded border p-4">
              <h2 className="mb-3 font-medium">Nueva persona</h2>
              <form action={crearEmpleado} className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Nombre y apellidos
                  <Input name="fullName" required maxLength={200} className="w-56" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Código de empleado
                  <Input name="employeeCode" maxLength={200} className="w-36" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Puesto
                  <select
                    name="positionId"
                    defaultValue=""
                    className="w-52 rounded border px-3 py-2"
                  >
                    <option value="">Sin puesto</option>
                    {puestos.map((puesto) => (
                      <option key={puesto.id} value={puesto.id}>
                        {puesto.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Tipo de contrato
                  <select
                    name="employmentType"
                    defaultValue="PERMANENT"
                    className="rounded border px-3 py-2"
                  >
                    {Object.keys(EmploymentType).map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {ETIQUETA_TIPO_CONTRATO[tipo as keyof typeof EmploymentType]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Jornada en %
                  <Input name="fte" defaultValue="100" inputMode="decimal" className="w-24" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Fecha de alta
                  <Input name="hireDate" type="date" required className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Fecha de baja
                  <Input name="terminationDate" type="date" className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Equipo
                  <Input name="team" maxLength={200} className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Centro de coste
                  <Input name="costCenter" maxLength={200} className="w-40" />
                </label>
                <Button type="submit" size="sm">
                  Dar de alta
                </Button>
              </form>
              <p className="text-muted-foreground mt-3 text-xs">
                La fecha de baja se puede poner desde el principio si ya se sabe. Es lo que hace que
                quien se va en junio no cuente como un año entero: el prorrateo va por días
                naturales, no por meses.
              </p>
            </section>

            <section className="max-w-2xl rounded border p-4">
              <h2 className="mb-3 font-medium">Nuevo puesto</h2>
              <form action={crearPuesto} className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Nombre del puesto
                  <Input name="name" required maxLength={200} className="w-56" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Familia
                  <Input name="family" maxLength={200} className="w-40" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Nivel
                  <Input name="level" maxLength={200} className="w-28" />
                </label>
                <Button type="submit" size="sm" variant="outline">
                  Crear puesto
                </Button>
              </form>
              <p className="text-muted-foreground mt-3 text-xs">
                El puesto existe aparte de la persona porque el coste por rol y las bandas
                retributivas se calculan por puesto, y porque un puesto sobrevive a quien lo ocupa.
              </p>
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
