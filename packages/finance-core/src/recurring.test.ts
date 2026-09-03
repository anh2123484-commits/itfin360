import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  MONTHS_IN_PERIOD,
  normalizeRecurring,
  portfolioMonthlyCents,
  spreadRecurring,
} from './recurring.js';

describe('normalizeRecurring', () => {
  it('normaliza un contrato anual', () => {
    expect(normalizeRecurring({ amountCents: cents(19840000), periodicity: 'ANNUAL' })).toEqual({
      monthlyCents: 1653333,
      annualCents: 19840000,
      monthsInPeriod: 12,
    });
  });

  it('normaliza un contrato bienal a la mitad del anual', () => {
    expect(normalizeRecurring({ amountCents: cents(4320000), periodicity: 'BIENNIAL' })).toEqual({
      monthlyCents: 180000,
      annualCents: 2160000,
      monthsInPeriod: 24,
    });
  });

  it('deja el mensual intacto', () => {
    expect(normalizeRecurring({ amountCents: cents(2180000), periodicity: 'MONTHLY' })).toEqual({
      monthlyCents: 2180000,
      annualCents: 26160000,
      monthsInPeriod: 1,
    });
  });

  it('cubre trimestral y semestral', () => {
    expect(
      normalizeRecurring({ amountCents: cents(300000), periodicity: 'QUARTERLY' }).monthlyCents,
    ).toBe(100000);
    expect(
      normalizeRecurring({ amountCents: cents(600000), periodicity: 'SEMIANNUAL' }).monthlyCents,
    ).toBe(100000);
  });

  it('no encadena redondeos para el anualizado', () => {
    // 100,01 € al trimestre: el mensual redondea a 33,34 €, pero el anual
    // sale de la cifra exacta (400,04 €), no de 33,34 × 12 = 400,08 €.
    const normalizado = normalizeRecurring({ amountCents: cents(10001), periodicity: 'QUARTERLY' });

    expect(normalizado.monthlyCents).toBe(3334);
    expect(normalizado.annualCents).toBe(40004);
  });

  it('rechaza una periodicidad desconocida', () => {
    expect(() =>
      normalizeRecurring({
        amountCents: cents(100),
        periodicity: 'DECENNIAL' as unknown as 'ANNUAL',
      }),
    ).toThrow(/Periodicidad desconocida/);
  });

  it('declara los meses de cada periodicidad', () => {
    expect(MONTHS_IN_PERIOD).toEqual({
      MONTHLY: 1,
      QUARTERLY: 3,
      SEMIANNUAL: 6,
      ANNUAL: 12,
      BIENNIAL: 24,
    });
  });
});

describe('spreadRecurring', () => {
  it('reparte sin perder céntimos', () => {
    const cuotas = spreadRecurring({ amountCents: cents(10001), periodicity: 'QUARTERLY' });

    expect(cuotas).toEqual([3334, 3334, 3333]);
    expect(cuotas.reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it('da doce cuotas para un anual', () => {
    const cuotas = spreadRecurring({ amountCents: cents(19840000), periodicity: 'ANNUAL' });

    expect(cuotas).toHaveLength(12);
    expect(cuotas.reduce((a, b) => a + b, 0)).toBe(19840000);
  });

  it('rechaza una periodicidad desconocida', () => {
    expect(() =>
      spreadRecurring({ amountCents: cents(100), periodicity: 'WEEKLY' as unknown as 'ANNUAL' }),
    ).toThrow(/Periodicidad desconocida/);
  });
});

describe('portfolioMonthlyCents', () => {
  it('suma el coste mensual de una cartera', () => {
    expect(
      portfolioMonthlyCents([
        { amountCents: cents(19840000), periodicity: 'ANNUAL' },
        { amountCents: cents(2180000), periodicity: 'MONTHLY' },
        { amountCents: cents(4320000), periodicity: 'BIENNIAL' },
      ]),
    ).toBe(1653333 + 2180000 + 180000);
  });

  it('suma cero sin contratos', () => {
    expect(portfolioMonthlyCents([])).toBe(0);
  });
});
