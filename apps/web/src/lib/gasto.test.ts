import type { TenantDb } from '@itfin360/db';
import { describe, expect, it } from 'vitest';

import {
  ESTADOS_QUE_CUENTAN,
  ETIQUETA_CATEGORIA,
  formatearVariacion,
  gastoDelPeriodo,
  variacion,
} from '@/lib/gasto';
import { periodoDelMes } from '@/lib/periodos';

const MARZO = periodoDelMes({ anio: 2026, mes: 3 });

/** Una línea tal y como la devuelve la consulta. */
interface LineaFalsa {
  readonly id: string;
  readonly description: string;
  readonly netCents: number;
  readonly concept: string;
  readonly invoice: {
    readonly id: string;
    readonly invoiceNumber: string;
    readonly currency: string;
    readonly vendor: { readonly id: string; readonly name: string };
  };
}

function linea(
  id: string,
  concepto: string,
  netCents: number,
  factura = 'f-1',
  proveedor = 'Amazon',
  divisa = 'EUR',
): LineaFalsa {
  return {
    id,
    description: `Línea ${id}`,
    netCents,
    concept: concepto,
    invoice: {
      id: factura,
      invoiceNumber: factura.toUpperCase(),
      currency: divisa,
      vendor: { id: proveedor.toLowerCase(), name: proveedor },
    },
  };
}

/** Doble que devuelve las líneas y recuerda con qué condición se le preguntó. */
function dbFalsa(lineas: readonly LineaFalsa[]): {
  tx: TenantDb;
  consultas: unknown[];
} {
  const consultas: unknown[] = [];
  const tx = {
    invoiceLine: {
      findMany: (argumentos: unknown) => {
        consultas.push(argumentos);
        return Promise.resolve(lineas);
      },
    },
  };
  return { tx: tx as unknown as TenantDb, consultas };
}

describe('qué facturas entran', () => {
  it('sólo las aprobadas y las contabilizadas', () => {
    // Un borrador es algo que alguien está tecleando y una factura en revisión
    // todavía puede rechazarse: contarlas daría una cifra que se mueve sola.
    expect([...ESTADOS_QUE_CUENTAN]).toEqual(['APPROVED', 'POSTED']);
  });

  it('la consulta filtra por estado y por devengo, no por emisión', async () => {
    const { tx, consultas } = dbFalsa([]);
    await gastoDelPeriodo(tx, MARZO);

    const donde = (consultas[0] as { where: { invoice: Record<string, unknown> } }).where.invoice;
    expect(donde['status']).toEqual({ in: ['APPROVED', 'POSTED'] });
    // El servicio de enero es gasto de enero aunque la factura llegue en
    // febrero: la fecha que cierra un periodo es el devengo.
    expect(donde['accrualDate']).toBeDefined();
    expect(donde['issueDate']).toBeUndefined();
  });
});

describe('gastoDelPeriodo', () => {
  it('reparte por categoría presupuestaria y el desglose suma el total', async () => {
    const { tx } = dbFalsa([
      linea('l1', 'SAAS_SUBSCRIPTION', 120_000),
      linea('l2', 'CLOUD_INFRASTRUCTURE', 350_000),
      linea('l3', 'TELECOM', 80_000),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);

    expect(gasto.reparto.totalCents).toBe(550_000);
    expect(gasto.reparto.byBudgetCategory.SOFTWARE_AND_SERVICES).toBe(120_000);
    expect(gasto.reparto.byBudgetCategory.INFRASTRUCTURE).toBe(350_000);
    const suma = Object.values(gasto.reparto.byBudgetCategory).reduce((a, b) => a + b, 0);
    expect(suma).toBe(gasto.reparto.totalCents);
  });

  it('el material de reventa no suma en el gasto, pero se ve aparte', async () => {
    const { tx } = dbFalsa([
      linea('l1', 'SAAS_SUBSCRIPTION', 120_000),
      linea('l2', 'RESALE_GOODS', 450_000),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);

    expect(gasto.reparto.totalCents).toBe(120_000);
    expect(gasto.reparto.excludedCents).toBe(450_000);
  });

  it('el gasto por proveedor se cuenta con la misma regla que el total', async () => {
    // Si la tabla de proveedores contase la reventa y la cifra de arriba no,
    // las dos no cuadrarían y no habría forma de saber cuál mira uno.
    const { tx } = dbFalsa([
      linea('l1', 'SAAS_SUBSCRIPTION', 100_000, 'f-1', 'Microsoft'),
      linea('l2', 'RESALE_GOODS', 450_000, 'f-2', 'Dell'),
      linea('l3', 'TELECOM', 60_000, 'f-3', 'Telefónica'),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);

    expect(gasto.porProveedor.map((p) => p.nombre)).toEqual(['Microsoft', 'Telefónica']);
    const suma = gasto.porProveedor.reduce((total, p) => total + p.cents, 0);
    expect(suma).toBe(gasto.reparto.totalCents);
  });

  it('los proveedores salen de mayor a menor', async () => {
    const { tx } = dbFalsa([
      linea('l1', 'TELECOM', 60_000, 'f-1', 'Telefónica'),
      linea('l2', 'SAAS_SUBSCRIPTION', 100_000, 'f-2', 'Microsoft'),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);
    expect(gasto.porProveedor.map((p) => p.cents)).toEqual([100_000, 60_000]);
  });

  it('varias líneas del mismo proveedor se juntan', async () => {
    const { tx } = dbFalsa([
      linea('l1', 'TELECOM', 60_000, 'f-1', 'Telefónica'),
      linea('l2', 'TELECOM', 40_000, 'f-2', 'Telefónica'),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);
    expect(gasto.porProveedor).toHaveLength(1);
    expect(gasto.porProveedor[0]?.cents).toBe(100_000);
  });

  it('cuenta facturas, no líneas', async () => {
    const { tx } = dbFalsa([
      linea('l1', 'TELECOM', 10_000, 'f-1'),
      linea('l2', 'TELECOM', 10_000, 'f-1'),
      linea('l3', 'TELECOM', 10_000, 'f-2'),
    ]);
    expect((await gastoDelPeriodo(tx, MARZO)).facturas).toBe(2);
  });

  it('marca las compras que deberían estar dadas de alta como activo', async () => {
    // Cuentan como gasto (el dinero ha salido) pero salen señaladas: el día que
    // se dé de alta el activo, el importe se mueve a amortización y no se
    // duplica. Sin la marca, ese cambio pasaría inadvertido.
    const { tx } = dbFalsa([
      linea('l1', 'SAAS_SUBSCRIPTION', 100_000),
      linea('l2', 'HARDWARE_SERVER', 1_200_000, 'f-9'),
    ]);
    const gasto = await gastoDelPeriodo(tx, MARZO);

    expect(gasto.reparto.totalCents).toBe(1_300_000);
    expect(gasto.pendientes).toHaveLength(1);
    expect(gasto.pendientes[0]?.invoiceNumber).toBe('F-9');
    expect(gasto.pendientes[0]?.cents).toBe(1_200_000);
  });

  it('avisa cuando en el periodo hay más de una divisa', async () => {
    // Sumar euros con dólares daría un número que no significa nada, así que la
    // pantalla tiene que poder decirlo en vez de enseñar una cifra falsa.
    const { tx } = dbFalsa([
      linea('l1', 'TELECOM', 10_000, 'f-1', 'Telefónica', 'EUR'),
      linea('l2', 'TELECOM', 10_000, 'f-2', 'Twilio', 'USD'),
    ]);
    expect((await gastoDelPeriodo(tx, MARZO)).variasDivisas).toBe(true);
  });

  it('un periodo sin facturas da cero, no un error', async () => {
    const { tx } = dbFalsa([]);
    const gasto = await gastoDelPeriodo(tx, MARZO);
    expect(gasto.reparto.totalCents).toBe(0);
    expect(gasto.facturas).toBe(0);
    expect(gasto.porProveedor).toEqual([]);
    expect(gasto.variasDivisas).toBe(false);
    expect(gasto.divisa).toBe('EUR');
  });
});

describe('variacion', () => {
  it('calcula la diferencia relativa', () => {
    expect(variacion(110, 100)).toBeCloseTo(0.1, 10);
    expect(variacion(80, 100)).toBeCloseTo(-0.2, 10);
  });

  it('sin mes anterior no hay porcentaje', () => {
    // Con el anterior a cero, cualquier gasto es un aumento infinito. Decir
    // «+∞ %» no informa; mejor enseñar las dos cifras y ya.
    expect(variacion(500, 0)).toBeNull();
  });

  it('se formatea con el signo delante', () => {
    expect(formatearVariacion(0.124)).toBe('+12,4 %');
    expect(formatearVariacion(-0.081)).toBe('-8,1 %');
    expect(formatearVariacion(null)).toBe('—');
  });
});

describe('etiquetas de categoría', () => {
  it('todas las categorías tienen nombre en castellano', () => {
    for (const nombre of Object.values(ETIQUETA_CATEGORIA)) {
      expect(nombre.length).toBeGreaterThan(0);
    }
  });

  it('ninguna etiqueta se repite', () => {
    const nombres = Object.values(ETIQUETA_CATEGORIA);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
