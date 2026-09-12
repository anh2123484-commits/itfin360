import type { TenantDb } from '@itfin360/db';
import { describe, expect, it } from 'vitest';

import type { FacturaImportada } from '@/lib/importacion';
import { ImportacionRechazada, importarADatos, MAXIMO_FACTURAS } from '@/lib/importacion-alta';
import type { Principal } from '@/lib/permissions';

const PRINCIPAL: Principal = {
  userId: 'bbbbbbb5-0000-4000-8000-000000000002',
  tenantId: 'ccccccc5-0000-4000-8000-000000000003',
  role: 'FINANCE',
  canViewCompensation: false,
};

function factura(proveedor: string, numero: string, neto = 10_000): FacturaImportada {
  return {
    proveedor,
    invoiceNumber: numero,
    issueDate: { year: 2026, month: 1, day: 15 },
    accrualDate: { year: 2026, month: 1, day: 15 },
    netCents: neto,
    vatCents: 0,
    grossCents: neto,
    currency: 'EUR',
    lines: [
      {
        lineNumber: 1,
        description: 'Algo',
        quantity: 1,
        unitPriceCents: neto,
        netCents: neto,
        costType: 'OPEX_ONE_OFF',
        concept: 'CONSUMABLES',
      },
    ],
    filas: [2],
  };
}

/**
 * Doble de `TenantDb` que recuerda lo que se le ha pedido escribir.
 *
 * `existentes` son los proveedores que ya están dados de alta, y `duplicadas`
 * los números de factura que la base ya tiene para ese proveedor.
 */
function dbFalsa(
  existentes: readonly string[] = [],
  duplicadas: readonly string[] = [],
): { tx: TenantDb; escrituras: { tabla: string; datos: unknown }[] } {
  const escrituras: { tabla: string; datos: unknown }[] = [];
  let siguiente = 0;

  const tx = {
    vendor: {
      findMany: () =>
        Promise.resolve(existentes.map((name, indice) => ({ id: `v-${indice}`, name }))),
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }),
      create: ({ data }: { data: { name: string } }) => {
        escrituras.push({ tabla: 'vendor', datos: data });
        siguiente += 1;
        return Promise.resolve({ id: `nuevo-${siguiente}` });
      },
    },
    invoice: {
      findFirst: ({ where }: { where: { invoiceNumber: string } }) =>
        Promise.resolve(
          duplicadas.includes(where.invoiceNumber) ? { id: 'ya-existe', status: 'POSTED' } : null,
        ),
      create: ({ data }: { data: { invoiceNumber: string } }) => {
        escrituras.push({ tabla: 'invoice', datos: data });
        return Promise.resolve({
          id: `f-${data.invoiceNumber}`,
          invoiceNumber: data.invoiceNumber,
          status: 'DRAFT',
          grossCents: 10_000,
          currency: 'EUR',
        });
      },
    },
    auditLog: {
      create: ({ data }: { data: unknown }) => {
        escrituras.push({ tabla: 'auditLog', datos: data });
        return Promise.resolve({});
      },
    },
  };

  return { tx: tx as unknown as TenantDb, escrituras };
}

describe('importarADatos · proveedores', () => {
  it('crea los que no existen y reutiliza los que sí', async () => {
    const { tx, escrituras } = dbFalsa(['Amazon']);
    const resumen = await importarADatos(tx, PRINCIPAL, [
      factura('Amazon', 'A-1'),
      factura('Dell', 'D-1'),
    ]);

    expect(resumen.proveedoresNuevos).toEqual(['Dell']);
    expect(escrituras.filter((e) => e.tabla === 'vendor')).toHaveLength(1);
  });

  it('no duplica un proveedor por mayúsculas, acentos o espacios', async () => {
    // Tres fichas del mismo proveedor repartirían su gasto entre tres, y el
    // día que alguien mire el gasto por proveedor no cuadrará con nada.
    const { tx, escrituras } = dbFalsa(['Telefónica']);
    const resumen = await importarADatos(tx, PRINCIPAL, [
      factura('TELEFONICA', 'T-1'),
      factura('  telefónica ', 'T-2'),
    ]);

    expect(resumen.proveedoresNuevos).toEqual([]);
    expect(escrituras.filter((e) => e.tabla === 'vendor')).toHaveLength(0);
  });

  it('el proveedor nuevo se crea una sola vez aunque venga en varias facturas', async () => {
    const { tx, escrituras } = dbFalsa();
    await importarADatos(tx, PRINCIPAL, [factura('Nuevo', 'N-1'), factura('Nuevo', 'N-2')]);
    expect(escrituras.filter((e) => e.tabla === 'vendor')).toHaveLength(1);
  });

  it('crear un proveedor deja apunte de auditoría', async () => {
    const { tx, escrituras } = dbFalsa();
    await importarADatos(tx, PRINCIPAL, [factura('Nuevo', 'N-1')]);
    const apuntes = escrituras.filter((e) => e.tabla === 'auditLog');
    expect(apuntes.some((a) => (a.datos as { action: string }).action === 'vendor.created')).toBe(
      true,
    );
  });
});

describe('importarADatos · lo que da de alta', () => {
  it('cuenta facturas, líneas y total', async () => {
    const { tx } = dbFalsa(['Amazon']);
    const resumen = await importarADatos(tx, PRINCIPAL, [
      factura('Amazon', 'A-1'),
      factura('Amazon', 'A-2'),
    ]);
    expect(resumen.facturas).toBe(2);
    expect(resumen.lineas).toBe(2);
    expect(resumen.totalCents).toBe(20_000);
  });

  it('marca el origen para que se vea que nadie las tecleó', async () => {
    // En una auditoría importa distinguir lo que alguien escribió a mano de lo
    // que entró en bloque desde un fichero.
    const { tx, escrituras } = dbFalsa(['Amazon']);
    await importarADatos(tx, PRINCIPAL, [factura('Amazon', 'A-1')]);
    const alta = escrituras.find((e) => e.tabla === 'invoice');
    expect((alta?.datos as { source: string }).source).toBe('CSV_IMPORT');
  });

  it('todo nace en borrador, nunca aprobado', async () => {
    const { tx, escrituras } = dbFalsa(['Amazon']);
    await importarADatos(tx, PRINCIPAL, [factura('Amazon', 'A-1')]);
    const alta = escrituras.find((e) => e.tabla === 'invoice');
    expect((alta?.datos as { status: string }).status).toBe('DRAFT');
  });
});

describe('importarADatos · lo que rechaza', () => {
  it('un fichero sin facturas', async () => {
    const { tx } = dbFalsa();
    await expect(importarADatos(tx, PRINCIPAL, [])).rejects.toThrow(ImportacionRechazada);
  });

  it('más facturas de las que caben en una tanda', async () => {
    // El tope no es capricho: todo corre en una transacción, y una transacción
    // que dura demasiado la corta la base antes de que termine.
    const { tx } = dbFalsa();
    const muchas = Array.from({ length: MAXIMO_FACTURAS + 1 }, (_, i) =>
      factura('Amazon', `A-${i}`),
    );
    await expect(importarADatos(tx, PRINCIPAL, muchas)).rejects.toThrow(/máximo por tanda/);
  });

  it('la misma factura dos veces dentro del propio fichero', async () => {
    // El índice único lo cazaría, pero en el segundo insert, con la transacción
    // ya abortada y sin poder decir cuáles chocan.
    const { tx } = dbFalsa();
    await expect(
      importarADatos(tx, PRINCIPAL, [factura('Amazon', 'A-1'), factura('AMAZON', 'a-1')]),
    ).rejects.toThrow(/dos veces en el fichero/);
  });

  it('una factura que ya existe en la base corta la importación entera', async () => {
    const { tx } = dbFalsa(['Amazon'], ['A-2']);
    await expect(
      importarADatos(tx, PRINCIPAL, [factura('Amazon', 'A-1'), factura('Amazon', 'A-2')]),
    ).rejects.toThrow(/ya existe una factura/);
  });

  it('el rechazo dice de qué filas del fichero sale la factura', async () => {
    // Sin las filas, «la factura A-2 ya existe» obliga a buscarla a mano en un
    // Excel de mil filas.
    const { tx } = dbFalsa(['Amazon'], ['A-2']);
    await expect(
      importarADatos(tx, PRINCIPAL, [{ ...factura('Amazon', 'A-2'), filas: [7, 8] }]),
    ).rejects.toThrow(/filas 7, 8/);
  });
});
