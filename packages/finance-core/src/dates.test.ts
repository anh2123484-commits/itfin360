import { describe, expect, it } from 'vitest';

import {
  addMonths,
  compareDates,
  daysInMonth,
  isLeapYear,
  monthKey,
  monthlyDayCounts,
  monthsBetween,
  parseIsoDate,
  startOfNextMonth,
  toEpochDay,
} from './dates.js';

describe('calendario', () => {
  it('conoce los bisiestos', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('cuenta los días de cada mes', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(() => daysInMonth(2026, 13)).toThrow(/Mes fuera de rango/);
  });

  it('sitúa el epoch y ordena fechas', () => {
    expect(toEpochDay({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(toEpochDay({ year: 2026, month: 1, day: 1 })).toBe(20454);
    expect(compareDates(parseIsoDate('2026-01-01'), parseIsoDate('2026-01-02'))).toBeLessThan(0);
    expect(compareDates(parseIsoDate('2026-03-01'), parseIsoDate('2026-03-01'))).toBe(0);
  });

  it('pasa al mes siguiente, también en diciembre', () => {
    expect(startOfNextMonth({ year: 2026, month: 3, day: 17 })).toEqual({
      year: 2026,
      month: 4,
      day: 1,
    });
    expect(startOfNextMonth({ year: 2026, month: 12, day: 31 })).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('formatea la clave de periodo', () => {
    expect(monthKey({ year: 2026, month: 7, day: 4 })).toBe('2026-07');
  });
});

describe('parseIsoDate', () => {
  it('lee una fecha válida', () => {
    expect(parseIsoDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rechaza formatos y fechas imposibles', () => {
    expect(() => parseIsoDate('31/12/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseIsoDate('2026-13-01')).toThrow(/Mes fuera de rango/);
    expect(() => parseIsoDate('2026-02-29')).toThrow(/Día fuera de rango/);
    expect(() => parseIsoDate('2026-04-31')).toThrow(/Día fuera de rango/);
    expect(() => parseIsoDate('2026-01-00')).toThrow(/Día fuera de rango/);
  });
});

describe('monthlyDayCounts', () => {
  it('cuenta un solo mes parcial', () => {
    expect(monthlyDayCounts(parseIsoDate('2026-03-10'), parseIsoDate('2026-03-20'))).toEqual([
      { period: '2026-03', days: 11 },
    ]);
  });

  it('recorre un año de servicio a caballo entre dos ejercicios', () => {
    const tramos = monthlyDayCounts(parseIsoDate('2026-01-15'), parseIsoDate('2027-01-14'));

    expect(tramos).toHaveLength(13);
    expect(tramos[0]).toEqual({ period: '2026-01', days: 17 });
    expect(tramos[12]).toEqual({ period: '2027-01', days: 14 });
    expect(tramos.reduce((total, tramo) => total + tramo.days, 0)).toBe(365);
  });

  it('incluye el 29 de febrero de un bisiesto', () => {
    const tramos = monthlyDayCounts(parseIsoDate('2024-02-01'), parseIsoDate('2024-02-29'));

    expect(tramos).toEqual([{ period: '2024-02', days: 29 }]);
  });

  it('rechaza un periodo invertido', () => {
    expect(() => monthlyDayCounts(parseIsoDate('2026-05-02'), parseIsoDate('2026-05-01'))).toThrow(
      /termina antes de empezar/,
    );
  });
});

describe('addMonths', () => {
  it('suma meses cruzando el fin de año', () => {
    expect(addMonths({ year: 2026, month: 11, day: 5 }, 3)).toEqual({
      year: 2027,
      month: 2,
      day: 5,
    });
  });

  it('recorta el día al último del mes destino', () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it('admite meses negativos', () => {
    expect(addMonths({ year: 2026, month: 2, day: 10 }, -3)).toEqual({
      year: 2025,
      month: 11,
      day: 10,
    });
  });
});

describe('monthsBetween', () => {
  it('cuenta meses completos', () => {
    expect(
      monthsBetween({ year: 2026, month: 3, day: 15 }, { year: 2026, month: 4, day: 14 }),
    ).toBe(0);
    expect(
      monthsBetween({ year: 2026, month: 3, day: 15 }, { year: 2026, month: 4, day: 15 }),
    ).toBe(1);
    expect(
      monthsBetween({ year: 2020, month: 3, day: 15 }, { year: 2026, month: 3, day: 15 }),
    ).toBe(72);
  });

  it('es negativo hacia atrás', () => {
    expect(monthsBetween({ year: 2026, month: 6, day: 1 }, { year: 2026, month: 1, day: 1 })).toBe(
      -5,
    );
  });
});
