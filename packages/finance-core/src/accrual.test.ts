import { describe, expect, it } from 'vitest';

import { accruedInPeriod, accrualSpread } from './accrual.js';
import { cents } from './money.js';

describe('accrualSpread', () => {
  it('devenga todo en el mes cuando no hay periodo de servicio', () => {
    expect(accrualSpread({ totalCents: cents(1200000), accrualDate: '2026-01-15' })).toEqual([
      { period: '2026-01', cents: 1200000 },
    ]);
  });

  it('reparte una anual de 12.000 € con servicio 15/01–14/01', () => {
    const tramos = accrualSpread({
      totalCents: cents(1200000),
      accrualDate: '2026-01-15',
      servicePeriod: { start: '2026-01-15', end: '2027-01-14' },
    });

    expect(tramos).toHaveLength(13);
    expect(tramos[0]?.period).toBe('2026-01');
    expect(tramos[12]?.period).toBe('2027-01');
    // La suma es exactamente la factura: ni un céntimo de más ni de menos.
    expect(tramos.reduce((total, tramo) => total + tramo.cents, 0)).toBe(1200000);
    // 17 de los 365 días caen en enero de 2026.
    expect(tramos[0]?.cents).toBe(55890);
    // Y los meses de 31 días reciben más que los de 30.
    expect(tramos[2]?.cents).toBeGreaterThan(tramos[3]?.cents ?? 0);
  });

  it('reparte proporcionalmente a los días, no a los meses', () => {
    const tramos = accrualSpread({
      totalCents: cents(6000),
      accrualDate: '2026-01-01',
      servicePeriod: { start: '2026-01-01', end: '2026-02-28' },
    });

    expect(tramos).toEqual([
      { period: '2026-01', cents: 3153 },
      { period: '2026-02', cents: 2847 },
    ]);
    expect(tramos.reduce((total, tramo) => total + tramo.cents, 0)).toBe(6000);
  });

  it('reparte una rectificativa negativa manteniendo el signo', () => {
    const tramos = accrualSpread({
      totalCents: cents(-6000),
      accrualDate: '2026-01-01',
      servicePeriod: { start: '2026-01-01', end: '2026-02-28' },
    });

    expect(tramos.reduce((total, tramo) => total + tramo.cents, 0)).toBe(-6000);
    expect(tramos[0]?.cents).toBeLessThan(0);
  });

  it('admite un periodo de un solo día', () => {
    expect(
      accrualSpread({
        totalCents: cents(999),
        accrualDate: '2026-06-10',
        servicePeriod: { start: '2026-06-10', end: '2026-06-10' },
      }),
    ).toEqual([{ period: '2026-06', cents: 999 }]);
  });

  it('rechaza una fecha de devengo inválida', () => {
    expect(() => accrualSpread({ totalCents: cents(100), accrualDate: '15-01-2026' })).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it('rechaza un periodo invertido', () => {
    expect(() =>
      accrualSpread({
        totalCents: cents(100),
        accrualDate: '2026-01-01',
        servicePeriod: { start: '2026-03-01', end: '2026-02-01' },
      }),
    ).toThrow(/termina antes de empezar/);
  });
});

describe('accruedInPeriod', () => {
  it('suma lo devengado en un mes', () => {
    const tramos = accrualSpread({
      totalCents: cents(6000),
      accrualDate: '2026-01-01',
      servicePeriod: { start: '2026-01-01', end: '2026-02-28' },
    });

    expect(accruedInPeriod(tramos, '2026-01')).toBe(3153);
    expect(accruedInPeriod(tramos, '2026-12')).toBe(0);
  });
});
