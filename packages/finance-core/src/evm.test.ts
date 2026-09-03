import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_ON_BUDGET_THRESHOLD,
  actualCost,
  deliveryReliability,
  evm,
  projectProgress,
  valueOfProgress,
  type DeliveredProject,
  type ProjectMilestone,
} from './evm.js';

/** Caso de libro del backlog: BAC 100k, EV 40k, AC 50k, PV 45k. */
const LIBRO = {
  bacCents: cents(10_000_000),
  evCents: cents(4_000_000),
  acCents: cents(5_000_000),
  pvCents: cents(4_500_000),
};

describe('evm · caso de libro', () => {
  it('CPI 0,8 · SPI 0,889 · EAC 125k · VAC −25k', () => {
    const r = evm(LIBRO);
    expect(r.cpi).toBeCloseTo(0.8, 12);
    expect(r.spi).toBeCloseTo(0.889, 3);
    expect(r.eacCents).toBe(12_500_000);
    expect(r.vacCents).toBe(-2_500_000);
  });

  it('varianzas y TCPI', () => {
    const r = evm(LIBRO);
    expect(r.cvCents).toBe(-1_000_000);
    expect(r.svCents).toBe(-500_000);
    expect(r.etcCents).toBe(7_500_000);
    expect(r.tcpi).toBeCloseTo(1.2, 12);
  });

  it('el EAC optimista trata la desviación como puntual', () => {
    const r = evm(LIBRO);
    // AC + (BAC − EV) = 50k + 60k = 110k, frente a los 125k por rendimiento.
    expect(r.eacOptimisticCents).toBe(11_000_000);
    expect(r.eacCents).toBeGreaterThan(r.eacOptimisticCents);
  });
});

describe('evm · casos degenerados', () => {
  it('sin coste real no hay CPI, ni EAC, ni ETC, ni VAC', () => {
    const r = evm({ ...LIBRO, acCents: cents(0) });
    expect(r.cpi).toBeNull();
    expect(r.eacCents).toBeNull();
    expect(r.etcCents).toBeNull();
    expect(r.vacCents).toBeNull();
    // Lo que sí se puede calcular, se calcula.
    expect(r.spi).toBeCloseTo(0.889, 3);
    // AC + (BAC − EV) = 0 + 60k = 60k: sin coste real, lo que queda es todo lo no ganado.
    expect(r.eacOptimisticCents).toBe(6_000_000);
  });

  it('sin valor planificado no hay SPI', () => {
    const r = evm({ ...LIBRO, pvCents: cents(0) });
    expect(r.spi).toBeNull();
    expect(r.cpi).toBeCloseTo(0.8, 12);
  });

  it('un proyecto arrancado sin avance no tiene CPI cero, tiene CPI cero de verdad', () => {
    const r = evm({ ...LIBRO, evCents: cents(0) });
    expect(r.cpi).toBe(0);
    // Con CPI 0 el EAC por rendimiento sería infinito: se devuelve null.
    expect(r.eacCents).toBeNull();
  });

  it('con el presupuesto ya consumido no hay TCPI', () => {
    const r = evm({ ...LIBRO, acCents: cents(10_000_000) });
    expect(r.tcpi).toBeNull();
  });

  it('ningún índice devuelve Infinity ni NaN', () => {
    const casos = [
      { ...LIBRO, acCents: cents(0), pvCents: cents(0) },
      { ...LIBRO, bacCents: cents(0), evCents: cents(0), acCents: cents(0), pvCents: cents(0) },
      { ...LIBRO, evCents: cents(0), acCents: cents(0) },
    ];
    for (const caso of casos) {
      const r = evm(caso);
      for (const valor of [r.cpi, r.spi, r.tcpi]) {
        expect(valor === null || Number.isFinite(valor)).toBe(true);
      }
    }
  });
});

describe('projectProgress', () => {
  const hitos: ProjectMilestone[] = [
    { id: 'analisis', weight: 20, status: 'COMPLETED' },
    { id: 'desarrollo', weight: 50, status: 'IN_PROGRESS', progress: 0.4 },
    { id: 'pruebas', weight: 20, status: 'NOT_STARTED' },
    { id: 'despliegue', weight: 10, status: 'NOT_STARTED' },
  ];

  it('pondera por peso, no por número de hitos', () => {
    // (20×1 + 50×0,4) / 100 = 0,40
    expect(projectProgress(hitos)).toBeCloseTo(0.4, 12);
  });

  it('la regla 0/50/100 ignora el avance declarado', () => {
    // (20×1 + 50×0,5) / 100 = 0,45
    expect(projectProgress(hitos, 'ZERO_FIFTY_HUNDRED')).toBeCloseTo(0.45, 12);
  });

  it('un hito en curso sin avance declarado cuenta 0 en el método ponderado', () => {
    const sinDeclarar: ProjectMilestone[] = [
      { id: 'a', weight: 1, status: 'COMPLETED' },
      { id: 'b', weight: 1, status: 'IN_PROGRESS' },
    ];
    expect(projectProgress(sinDeclarar)).toBeCloseTo(0.5, 12);
    expect(projectProgress(sinDeclarar, 'ZERO_FIFTY_HUNDRED')).toBeCloseTo(0.75, 12);
  });

  it('los pesos no tienen que sumar 1', () => {
    const a = projectProgress([
      { id: 'a', weight: 3, status: 'COMPLETED' },
      { id: 'b', weight: 1, status: 'NOT_STARTED' },
    ]);
    const b = projectProgress([
      { id: 'a', weight: 0.75, status: 'COMPLETED' },
      { id: 'b', weight: 0.25, status: 'NOT_STARTED' },
    ]);
    expect(a).toBeCloseTo(0.75, 12);
    expect(b).toBeCloseTo(0.75, 12);
  });

  it('sin hitos, o con todos los pesos a cero, no hay avance calculable', () => {
    expect(projectProgress([])).toBeNull();
    expect(projectProgress([{ id: 'a', weight: 0, status: 'COMPLETED' }])).toBeNull();
  });

  it('rechaza pesos y avances imposibles', () => {
    expect(() => projectProgress([{ id: 'a', weight: -1, status: 'COMPLETED' }])).toThrow(
      RangeError,
    );
    expect(() =>
      projectProgress([{ id: 'a', weight: 1, status: 'IN_PROGRESS', progress: 1.5 }]),
    ).toThrow(RangeError);
  });
});

describe('valueOfProgress', () => {
  it('convierte avance en euros sobre la baseline', () => {
    expect(valueOfProgress(cents(10_000_000), 0.4)).toBe(4_000_000);
    expect(valueOfProgress(cents(10_000_000), 0)).toBe(0);
    expect(valueOfProgress(cents(10_000_000), 1)).toBe(10_000_000);
  });

  it('redondea una sola vez', () => {
    expect(valueOfProgress(cents(1_000_000), 1 / 3)).toBe(333_333);
  });

  it('rechaza avances fuera de 0–1', () => {
    expect(() => valueOfProgress(cents(100), -0.1)).toThrow(RangeError);
    expect(() => valueOfProgress(cents(100), 1.1)).toThrow(RangeError);
  });
});

describe('deliveryReliability', () => {
  const proyecto = (
    projectId: string,
    bac: number,
    real: number,
    dias: number,
    rebaselines = 0,
  ): DeliveredProject => ({
    projectId,
    initialBacCents: cents(bac),
    actualCostCents: cents(real),
    scheduleDeviationDays: dias,
    rebaselineCount: rebaselines,
  });

  it('mide contra la baseline inicial', () => {
    const r = deliveryReliability([
      proyecto('p1', 10_000_000, 10_500_000, 0),
      proyecto('p2', 10_000_000, 13_000_000, 12, 2),
      proyecto('p3', 10_000_000, 9_000_000, -3),
      proyecto('p4', 10_000_000, 11_500_000, 5, 1),
    ]);
    // En fecha: p1 (0 días) y p3 (adelantado). Dentro de presupuesto (≤10 %): p1, p3.
    expect(r.onTimeDelivery).toBe(0.5);
    expect(r.onBudgetDelivery).toBe(0.5);
    expect(r.rebaselineIndex).toBe(0.75);
    expect(r.deliveredCount).toBe(4);
  });

  it('el umbral por defecto es el 10 %', () => {
    expect(DEFAULT_ON_BUDGET_THRESHOLD).toBe(0.1);
    const justo = [proyecto('p1', 10_000_000, 11_000_000, 0)];
    expect(deliveryReliability(justo).onBudgetDelivery).toBe(1);
    expect(deliveryReliability(justo, 0.05).onBudgetDelivery).toBe(0);
  });

  it('sin proyectos entregados no hay métricas', () => {
    const r = deliveryReliability([]);
    expect(r.onTimeDelivery).toBeNull();
    expect(r.onBudgetDelivery).toBeNull();
    expect(r.rebaselineIndex).toBeNull();
    expect(r.deliveredCount).toBe(0);
  });

  it('rechaza un umbral imposible', () => {
    expect(() => deliveryReliability([proyecto('p1', 100, 100, 0)], -1)).toThrow(RangeError);
  });
});

describe('actualCost', () => {
  it('suma horas, facturas y amortización imputada', () => {
    expect(
      actualCost({
        labourCents: cents(3_000_000),
        invoicedCents: cents(1_500_000),
        assetDepreciationCents: cents(500_000),
      }),
    ).toBe(5_000_000);
  });

  it('sin componentes es cero', () => {
    expect(actualCost({})).toBe(0);
  });
});
