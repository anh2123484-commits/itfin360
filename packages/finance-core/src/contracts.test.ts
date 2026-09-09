import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_ALERT_THRESHOLDS,
  contractAlerts,
  licenseWaste,
  priceChange,
  totalAnnualImpact,
  type ContractForAlerts,
} from './contracts.js';

describe('licenseWaste', () => {
  it('cuenta los puestos pagados que nadie usa', () => {
    const w = licenseWaste({
      amountCents: cents(1_200_000),
      periodicity: 'ANNUAL',
      licensedSeats: 120,
      activeSeats: 84,
    });
    expect(w.unusedSeats).toBe(36);
    expect(w.overDeployedSeats).toBe(0);
    expect(w.wasteRatio).toBeCloseTo(0.3, 10);
  });

  it('el coste desperdiciado sale del importe completo, no del coste por puesto redondeado', () => {
    // 999,00 €/mes entre 100 puestos son 9,99 € por puesto; 37 sin usar.
    const w = licenseWaste({
      amountCents: cents(99_900),
      periodicity: 'MONTHLY',
      licensedSeats: 100,
      activeSeats: 63,
    });
    expect(w.costPerSeatMonthlyCents).toBe(999);
    // 99.900 × 37 / 100 = 36.963, que aquí coincide con 999 × 37.
    expect(w.wastedMonthlyCents).toBe(36_963);
    expect(w.wastedAnnualCents).toBe(36_963 * 12);
  });

  it('no encadena redondeos cuando el importe no divide exacto', () => {
    // 100,00 €/mes entre 3 puestos: 33,33 € por puesto, 1 sin usar.
    const w = licenseWaste({
      amountCents: cents(10_000),
      periodicity: 'MONTHLY',
      licensedSeats: 3,
      activeSeats: 2,
    });
    expect(w.costPerSeatMonthlyCents).toBe(3_333);
    // 10.000 / 3 = 3.333,33 → 3.333. Aquí coinciden, pero el cálculo parte del total.
    expect(w.wastedMonthlyCents).toBe(3_333);
  });

  it('normaliza la periodicidad antes de calcular', () => {
    const anual = licenseWaste({
      amountCents: cents(1_200_000),
      periodicity: 'ANNUAL',
      licensedSeats: 100,
      activeSeats: 50,
    });
    const mensual = licenseWaste({
      amountCents: cents(100_000),
      periodicity: 'MONTHLY',
      licensedSeats: 100,
      activeSeats: 50,
    });
    expect(anual.wastedMonthlyCents).toBe(mensual.wastedMonthlyCents);
    expect(anual.wastedAnnualCents).toBe(mensual.wastedAnnualCents);
  });

  it('usar más puestos de los contratados no es desperdicio negativo', () => {
    const w = licenseWaste({
      amountCents: cents(100_000),
      periodicity: 'MONTHLY',
      licensedSeats: 50,
      activeSeats: 63,
    });
    expect(w.unusedSeats).toBe(0);
    expect(w.wastedAnnualCents).toBe(0);
    expect(w.wasteRatio).toBe(0);
    // El dato que importa es el otro: se está usando software sin comprar.
    expect(w.overDeployedSeats).toBe(13);
  });

  it('todo usado no desperdicia nada', () => {
    const w = licenseWaste({
      amountCents: cents(100_000),
      periodicity: 'MONTHLY',
      licensedSeats: 50,
      activeSeats: 50,
    });
    expect(w.wasteRatio).toBe(0);
    expect(w.wastedAnnualCents).toBe(0);
  });

  it('rechaza cifras de puestos imposibles', () => {
    const base = { amountCents: cents(100_000), periodicity: 'MONTHLY' } as const;
    expect(() => licenseWaste({ ...base, licensedSeats: 0, activeSeats: 0 })).toThrow(RangeError);
    expect(() => licenseWaste({ ...base, licensedSeats: 10.5, activeSeats: 5 })).toThrow(
      RangeError,
    );
    expect(() => licenseWaste({ ...base, licensedSeats: 10, activeSeats: -1 })).toThrow(RangeError);
  });
});

describe('priceChange', () => {
  it('mide la subida sobre el coste mensual normalizado', () => {
    const c = priceChange(
      { amountCents: cents(100_000), periodicity: 'MONTHLY' },
      { amountCents: cents(109_000), periodicity: 'MONTHLY' },
    );
    expect(c.deltaMonthlyCents).toBe(9_000);
    expect(c.deltaRatio).toBeCloseTo(0.09, 10);
    expect(c.annualImpactCents).toBe(108_000);
  });

  it('cambiar de facturación mensual a anual NO es una subida de precio', () => {
    const c = priceChange(
      { amountCents: cents(100_000), periodicity: 'MONTHLY' },
      { amountCents: cents(1_200_000), periodicity: 'ANNUAL' },
    );
    expect(c.deltaMonthlyCents).toBe(0);
    expect(c.deltaRatio).toBe(0);
    expect(c.annualImpactCents).toBe(0);
  });

  it('una bajada da delta negativo', () => {
    const c = priceChange(
      { amountCents: cents(100_000), periodicity: 'MONTHLY' },
      { amountCents: cents(90_000), periodicity: 'MONTHLY' },
    );
    expect(c.deltaMonthlyCents).toBe(-10_000);
    expect(c.deltaRatio).toBeCloseTo(-0.1, 10);
    expect(c.annualImpactCents).toBe(-120_000);
  });

  it('un contrato nuevo no es una subida infinita', () => {
    const c = priceChange(
      { amountCents: cents(0), periodicity: 'MONTHLY' },
      { amountCents: cents(50_000), periodicity: 'MONTHLY' },
    );
    expect(c.deltaRatio).toBeNull();
    expect(c.deltaMonthlyCents).toBe(50_000);
  });
});

describe('contractAlerts', () => {
  const desperdicio: ContractForAlerts = {
    contractId: 'c-saas',
    name: 'Suite ofimática',
    amountCents: cents(1_200_000),
    periodicity: 'ANNUAL',
    licensedSeats: 120,
    activeSeats: 84,
  };

  const subida: ContractForAlerts = {
    contractId: 'c-erp',
    name: 'Mantenimiento ERP',
    amountCents: cents(109_000),
    periodicity: 'MONTHLY',
    previousAmountCents: cents(100_000),
  };

  it('avisa del desperdicio con el dinero anual en juego', () => {
    const a = contractAlerts([desperdicio]);
    expect(a).toHaveLength(1);
    expect(a[0]?.type).toBe('LICENSE_WASTE');
    expect(a[0]?.severity).toBe('CRITICAL');
    expect(a[0]?.impactAnnualCents).toBe(360_000);
    expect(a[0]?.message).toContain('36 de 120');
  });

  it('avisa de la subida de precio con el porcentaje y el delta', () => {
    const a = contractAlerts([subida]);
    expect(a).toHaveLength(1);
    expect(a[0]?.type).toBe('PRICE_INCREASE');
    expect(a[0]?.severity).toBe('WARNING');
    expect(a[0]?.impactAnnualCents).toBe(108_000);
    expect(a[0]?.message).toContain('9,0 %');
  });

  it('un contrato puede dar los dos avisos: son dos conversaciones distintas', () => {
    const a = contractAlerts([
      {
        contractId: 'c-crm',
        name: 'CRM',
        amountCents: cents(120_000),
        periodicity: 'MONTHLY',
        previousAmountCents: cents(100_000),
        licensedSeats: 100,
        activeSeats: 50,
      },
    ]);
    expect(a.map((x) => x.type).sort()).toEqual(['LICENSE_WASTE', 'PRICE_INCREASE']);
  });

  it('una bajada de precio no genera aviso', () => {
    const a = contractAlerts([
      {
        contractId: 'c-1',
        name: 'Hosting',
        amountCents: cents(80_000),
        periodicity: 'MONTHLY',
        previousAmountCents: cents(100_000),
      },
    ]);
    expect(a).toEqual([]);
  });

  it('por debajo del umbral no se avisa aunque haya desperdicio', () => {
    const a = contractAlerts([
      {
        contractId: 'c-1',
        name: 'Herramienta menor',
        amountCents: cents(1_000_000),
        periodicity: 'ANNUAL',
        licensedSeats: 100,
        activeSeats: 90,
      },
    ]);
    expect(a).toEqual([]);
  });

  it('el suelo de materialidad calla los avisos que no mueven dinero', () => {
    // La mitad de los puestos sin usar, pero son 24 € al año.
    const contrato: ContractForAlerts = {
      contractId: 'c-mini',
      name: 'Utilidad de 4 €/mes',
      amountCents: cents(400),
      periodicity: 'MONTHLY',
      licensedSeats: 2,
      activeSeats: 1,
    };
    expect(contractAlerts([contrato])).toEqual([]);
    // Sin suelo, el mismo contrato sí avisa: el ratio siempre estuvo por encima.
    const sinSuelo = contractAlerts([contrato], {
      ...DEFAULT_ALERT_THRESHOLDS,
      minAnnualImpactCents: cents(0),
    });
    expect(sinSuelo).toHaveLength(1);
    expect(sinSuelo[0]?.impactAnnualCents).toBe(2_400);
  });

  it('un contrato sin datos de puestos no genera aviso de desperdicio', () => {
    const a = contractAlerts([
      { contractId: 'c-1', name: 'Telefonía', amountCents: cents(500_000), periodicity: 'MONTHLY' },
    ]);
    expect(a).toEqual([]);
  });

  it('ordena por gravedad y, dentro de cada nivel, por dinero', () => {
    const a = contractAlerts([subida, desperdicio]);
    expect(a.map((x) => x.severity)).toEqual(['CRITICAL', 'WARNING']);
    expect(a[0]?.contractId).toBe('c-saas');
  });

  it('el orden no depende del orden de entrada', () => {
    expect(contractAlerts([subida, desperdicio])).toEqual(contractAlerts([desperdicio, subida]));
  });

  it('suma el dinero anual en juego de toda la cartera', () => {
    expect(totalAnnualImpact(contractAlerts([subida, desperdicio]))).toBe(360_000 + 108_000);
    expect(totalAnnualImpact([])).toBe(0);
  });

  it('sin contratos no hay avisos', () => {
    expect(contractAlerts([])).toEqual([]);
  });

  it('rechaza umbrales incoherentes', () => {
    expect(() =>
      contractAlerts([], { ...DEFAULT_ALERT_THRESHOLDS, wasteRatioCritical: 0.05 }),
    ).toThrow(RangeError);
    expect(() =>
      contractAlerts([], { ...DEFAULT_ALERT_THRESHOLDS, priceIncreaseCritical: 0.01 }),
    ).toThrow(RangeError);
    expect(() =>
      contractAlerts([], { ...DEFAULT_ALERT_THRESHOLDS, wasteRatioWarning: 1.5 }),
    ).toThrow(RangeError);
  });
});
