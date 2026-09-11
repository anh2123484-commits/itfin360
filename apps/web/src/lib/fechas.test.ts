import { parseIsoDate } from '@itfin360/finance-core';
import { describe, expect, it } from 'vitest';

import { aFechaCivil, aInstanteUtc, aIso, esFechaIso } from '@/lib/fechas';

describe('fechas civiles en columnas DateTime', () => {
  it('el último día del mes no se va al mes anterior', () => {
    // El caso que motiva este módulo: con `new Date('2026-03-31')` en un
    // servidor en Madrid, esto sería el 30 a las 23:00 y el gasto caería en
    // febrero. Sólo se ve en los cierres, y nadie lo achaca a la zona horaria.
    const instante = aInstanteUtc(parseIsoDate('2026-03-31'));
    expect(instante.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('ida y vuelta sin perder el día', () => {
    for (const iso of [
      '2026-01-01',
      '2026-02-28',
      '2024-02-29',
      '2026-06-15',
      '2026-12-31',
      '1999-12-31',
    ]) {
      expect(aIso(aInstanteUtc(parseIsoDate(iso))), iso).toBe(iso);
    }
  });

  it('el 29 de febrero sobrevive en año bisiesto', () => {
    expect(aFechaCivil(aInstanteUtc(parseIsoDate('2024-02-29')))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it('los meses y los días llevan su cero delante', () => {
    expect(aIso(aInstanteUtc({ year: 2026, month: 3, day: 7 }))).toBe('2026-03-07');
  });
});

describe('esFechaIso', () => {
  it('acepta fechas que existen', () => {
    expect(esFechaIso('2026-03-31')).toBe(true);
    expect(esFechaIso('2024-02-29')).toBe(true);
  });

  it('rechaza lo que no es una fecha civil', () => {
    for (const valor of ['2026-02-30', '2026-13-01', '2026-3-1', '31/03/2026', 'ayer', '']) {
      expect(esFechaIso(valor), valor).toBe(false);
    }
  });

  it('rechaza el 29 de febrero de un año no bisiesto', () => {
    expect(esFechaIso('2026-02-29')).toBe(false);
  });
});
