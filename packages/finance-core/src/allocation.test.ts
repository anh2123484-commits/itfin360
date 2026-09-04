import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  ALLOCATION_DRIVERS,
  AllocationCycleError,
  allocate,
  serviceTco,
  unitEconomics,
  type AllocationRule,
} from './allocation.js';

const suma = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);

describe('serviceTco', () => {
  it('suma los cuatro componentes del documento', () => {
    const t = serviceTco({
      serviceId: 'correo',
      directOpexCents: cents(1_200_000),
      capexDepreciationCents: cents(300_000),
      personnelCents: cents(2_500_000),
      allocatedOverheadCents: cents(450_000),
    });
    expect(t.totalCents).toBe(4_450_000);
    expect(
      t.directOpexCents + t.capexDepreciationCents + t.personnelCents + t.allocatedOverheadCents,
    ).toBe(t.totalCents);
  });

  it('un servicio sin componentes vale cero, no falla', () => {
    expect(serviceTco({ serviceId: 'nuevo' }).totalCents).toBe(0);
  });
});

describe('allocate · reparto simple', () => {
  it('reparte por peso del driver y conserva el importe al céntimo', () => {
    const reglas: AllocationRule[] = [
      {
        id: 'r1',
        from: 'overhead-it',
        driver: 'HEADCOUNT',
        targets: [
          { id: 'ventas', driverValue: 50 },
          { id: 'operaciones', driverValue: 30 },
          { id: 'finanzas', driverValue: 20 },
        ],
      },
    ];
    const r = allocate({ 'overhead-it': cents(1_000_001) }, reglas);

    expect(r.balances['ventas']).toBe(500_001);
    expect(r.balances['operaciones']).toBe(300_000);
    expect(r.balances['finanzas']).toBe(200_000);
    expect(r.balances['overhead-it']).toBe(0);
    expect(suma(Object.values(r.balances))).toBe(1_000_001);
    expect(r.totalCents).toBe(1_000_001);
  });

  it('la traza explica cada euro repartido', () => {
    const reglas: AllocationRule[] = [
      {
        id: 'r1',
        from: 'overhead-it',
        driver: 'DEVICES',
        targets: [
          { id: 'ventas', driverValue: 3 },
          { id: 'operaciones', driverValue: 1 },
        ],
      },
    ];
    const r = allocate({ 'overhead-it': cents(400_000) }, reglas);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]?.ruleId).toBe('r1');
    expect(r.trace[0]?.driver).toBe('DEVICES');
    expect(r.trace[0]?.amountCents).toBe(400_000);
    expect(suma((r.trace[0]?.toEach ?? []).map((t) => t.amountCents))).toBe(400_000);
  });

  it('recoge los ocho drivers del documento', () => {
    expect(ALLOCATION_DRIVERS).toHaveLength(8);
    expect(ALLOCATION_DRIVERS).toContain('FIXED_PERCENT');
    expect(ALLOCATION_DRIVERS).toContain('STORAGE_GB');
  });
});

describe('allocate · cascada', () => {
  const cascada: AllocationRule[] = [
    {
      id: 'infra-a-servicios',
      from: 'infraestructura',
      driver: 'COMPUTE_UNITS',
      targets: [
        { id: 'correo', driverValue: 1 },
        { id: 'erp', driverValue: 3 },
      ],
    },
    {
      id: 'correo-a-bu',
      from: 'correo',
      driver: 'ACTIVE_USERS',
      targets: [
        { id: 'ventas', driverValue: 1 },
        { id: 'operaciones', driverValue: 1 },
      ],
    },
    {
      id: 'erp-a-bu',
      from: 'erp',
      driver: 'ACTIVE_USERS',
      targets: [
        { id: 'ventas', driverValue: 1 },
        { id: 'operaciones', driverValue: 3 },
      ],
    },
  ];

  it('reparte de arriba abajo: una bolsa recibe antes de repartir', () => {
    const r = allocate({ infraestructura: cents(4_000_000) }, cascada);

    // Infra → correo 1.000.000, erp 3.000.000. Correo → 500k/500k. ERP → 750k/2.250k.
    expect(r.balances['ventas']).toBe(1_250_000);
    expect(r.balances['operaciones']).toBe(2_750_000);
    expect(r.balances['infraestructura']).toBe(0);
    expect(r.balances['correo']).toBe(0);
    expect(r.balances['erp']).toBe(0);
    expect(suma(Object.values(r.balances))).toBe(4_000_000);
  });

  it('una bolsa intermedia con coste propio también se reparte entero', () => {
    const r = allocate({ infraestructura: cents(4_000_000), correo: cents(1_000_000) }, cascada);
    expect(suma(Object.values(r.balances))).toBe(5_000_000);
    expect(r.balances['correo']).toBe(0);
    // Correo reparte su millón propio más el millón que le llega de infra.
    expect(r.balances['ventas']).toBe(1_750_000);
  });

  it('conserva el total con importes que no se dividen bien', () => {
    const r = allocate({ infraestructura: cents(1_000_003) }, cascada);
    expect(suma(Object.values(r.balances))).toBe(1_000_003);
  });

  it('el orden de las reglas en la lista no cambia el resultado', () => {
    const alReves = [...cascada].reverse();
    const a = allocate({ infraestructura: cents(4_000_000) }, cascada);
    const b = allocate({ infraestructura: cents(4_000_000) }, alReves);
    expect(b.balances['ventas']).toBe(a.balances['ventas']);
    expect(b.balances['operaciones']).toBe(a.balances['operaciones']);
  });
});

describe('allocate · detección de ciclos', () => {
  it('un ciclo lanza AllocationCycleError nombrando las reglas implicadas', () => {
    const ciclicas: AllocationRule[] = [
      { id: 'a-b', from: 'a', driver: 'HEADCOUNT', targets: [{ id: 'b', driverValue: 1 }] },
      { id: 'b-c', from: 'b', driver: 'HEADCOUNT', targets: [{ id: 'c', driverValue: 1 }] },
      { id: 'c-a', from: 'c', driver: 'HEADCOUNT', targets: [{ id: 'a', driverValue: 1 }] },
    ];

    expect(() => allocate({ a: cents(100) }, ciclicas)).toThrow(AllocationCycleError);

    try {
      allocate({ a: cents(100) }, ciclicas);
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(AllocationCycleError);
      if (!(error instanceof AllocationCycleError)) return;
      expect(error.ruleIds).toEqual(['a-b', 'b-c', 'c-a']);
      expect(error.nodeIds).toEqual(['a', 'b', 'c', 'a']);
      expect(error.message).toContain('a-b');
      expect(error.name).toBe('AllocationCycleError');
    }
  });

  it('detecta también un ciclo de dos', () => {
    const ciclicas: AllocationRule[] = [
      { id: 'ida', from: 'x', driver: 'TICKETS', targets: [{ id: 'y', driverValue: 1 }] },
      { id: 'vuelta', from: 'y', driver: 'TICKETS', targets: [{ id: 'x', driverValue: 1 }] },
    ];
    try {
      allocate({ x: cents(100) }, ciclicas);
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(AllocationCycleError);
      if (!(error instanceof AllocationCycleError)) return;
      expect(error.nodeIds).toEqual(['x', 'y', 'x']);
    }
  });

  it('una regla que se reparte a sí misma se rechaza antes de recorrer el grafo', () => {
    expect(() =>
      allocate({ a: cents(100) }, [
        { id: 'auto', from: 'a', driver: 'HEADCOUNT', targets: [{ id: 'a', driverValue: 1 }] },
      ]),
    ).toThrow(RangeError);
  });

  it('un grafo en rombo no es un ciclo', () => {
    const rombo: AllocationRule[] = [
      {
        id: 'raiz',
        from: 'raiz',
        driver: 'HEADCOUNT',
        targets: [
          { id: 'izq', driverValue: 1 },
          { id: 'der', driverValue: 1 },
        ],
      },
      { id: 'izq', from: 'izq', driver: 'HEADCOUNT', targets: [{ id: 'hoja', driverValue: 1 }] },
      { id: 'der', from: 'der', driver: 'HEADCOUNT', targets: [{ id: 'hoja', driverValue: 1 }] },
    ];
    const r = allocate({ raiz: cents(1_000_000) }, rombo);
    expect(r.balances['hoja']).toBe(1_000_000);
  });
});

describe('allocate · configuración inválida', () => {
  it('rechaza dos reglas sobre la misma bolsa', () => {
    expect(() =>
      allocate({ a: cents(100) }, [
        { id: 'r1', from: 'a', driver: 'HEADCOUNT', targets: [{ id: 'b', driverValue: 1 }] },
        { id: 'r2', from: 'a', driver: 'DEVICES', targets: [{ id: 'c', driverValue: 1 }] },
      ]),
    ).toThrow(RangeError);
  });

  it('rechaza dos reglas con el mismo id', () => {
    expect(() =>
      allocate({ a: cents(100) }, [
        { id: 'r1', from: 'a', driver: 'HEADCOUNT', targets: [{ id: 'b', driverValue: 1 }] },
        { id: 'r1', from: 'x', driver: 'DEVICES', targets: [{ id: 'c', driverValue: 1 }] },
      ]),
    ).toThrow(RangeError);
  });

  it('rechaza una regla sin destinos o con todos los drivers a cero', () => {
    expect(() =>
      allocate({ a: cents(100) }, [{ id: 'r1', from: 'a', driver: 'HEADCOUNT', targets: [] }]),
    ).toThrow(RangeError);
    expect(() =>
      allocate({ a: cents(100) }, [
        {
          id: 'r1',
          from: 'a',
          driver: 'HEADCOUNT',
          targets: [
            { id: 'b', driverValue: 0 },
            { id: 'c', driverValue: 0 },
          ],
        },
      ]),
    ).toThrow(RangeError);
  });

  it('FIXED_PERCENT exige que los porcentajes sumen 100', () => {
    const conPorcentaje = (b: number, c: number): AllocationRule[] => [
      {
        id: 'r1',
        from: 'a',
        driver: 'FIXED_PERCENT',
        targets: [
          { id: 'b', driverValue: b },
          { id: 'c', driverValue: c },
        ],
      },
    ];
    expect(() => allocate({ a: cents(100) }, conPorcentaje(60, 30))).toThrow(RangeError);
    const r = allocate({ a: cents(1_000_000) }, conPorcentaje(60, 40));
    expect(r.balances['b']).toBe(600_000);
    expect(r.balances['c']).toBe(400_000);
  });

  it('rechaza valores de driver negativos', () => {
    expect(() =>
      allocate({ a: cents(100) }, [
        {
          id: 'r1',
          from: 'a',
          driver: 'HEADCOUNT',
          targets: [
            { id: 'b', driverValue: -1 },
            { id: 'c', driverValue: 2 },
          ],
        },
      ]),
    ).toThrow(RangeError);
  });
});

describe('unitEconomics', () => {
  const base = {
    tcoTotalCents: cents(120_000_000),
    activeUsers: 800,
    managedDevices: 1_200,
    resolvedTickets: 4_000,
    runCostCents: cents(30_000_000),
    supportOpexCents: cents(6_000_000),
    companyRevenueCents: cents(6_000_000_000),
  };

  it('calcula los cuatro indicadores del documento', () => {
    const u = unitEconomics(base);
    expect(u.costPerUserCents).toBe(150_000); // 1.200.000 € / 800 = 1.500 €
    expect(u.costPerDeviceCents).toBe(100_000); // / 1.200 = 1.000 €
    expect(u.costPerTicketCents).toBe(9_000); // 360.000 € / 4.000 = 90 €
    expect(u.itSpendRatio).toBeCloseTo(0.02, 12); // 1,2 M€ sobre 60 M€
  });

  it('un denominador a cero o ausente da null, no cero', () => {
    const u = unitEconomics({ ...base, resolvedTickets: 0, companyRevenueCents: cents(0) });
    expect(u.costPerTicketCents).toBeNull();
    expect(u.itSpendRatio).toBeNull();

    const sinDatos = unitEconomics({ tcoTotalCents: cents(120_000_000) });
    expect(sinDatos.costPerUserCents).toBeNull();
    expect(sinDatos.costPerDeviceCents).toBeNull();
    expect(sinDatos.costPerTicketCents).toBeNull();
    expect(sinDatos.itSpendRatio).toBeNull();
  });

  it('redondea al céntimo una sola vez', () => {
    expect(unitEconomics({ tcoTotalCents: cents(1_000), activeUsers: 3 }).costPerUserCents).toBe(
      333,
    );
  });

  it('rechaza un número de unidades imposible', () => {
    expect(() => unitEconomics({ ...base, activeUsers: -1 })).toThrow(RangeError);
  });
});
