import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_HARDWARE_INFLATION_RATE,
  DEFAULT_USEFUL_LIFE_MONTHS,
  depreciationSchedule,
  monthlyDepreciationCents,
  netBookValueAt,
  replacementCost,
  technicalDebt,
  type AssetForDebt,
  type DepreciationInput,
} from './depreciation.js';

/** Servidor de 12.000 €, sin residual, 60 meses, alta el 15/03. Caso del backlog. */
const SERVIDOR: DepreciationInput = {
  acquisitionCents: cents(1_200_000),
  residualCents: cents(0),
  usefulLifeMonths: 60,
  inServiceDate: '2026-03-15',
};

const suma = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);

describe('depreciationSchedule', () => {
  it('reproduce el caso de referencia del backlog', () => {
    const cuadro = depreciationSchedule(SERVIDOR);

    // 200 € × 17/31 = 109,677… → 109,68 €
    expect(cuadro[0]?.period).toBe('2026-03');
    expect(cuadro[0]?.chargeCents).toBe(10_968);
    expect(cuadro[1]?.chargeCents).toBe(20_000);
    expect(monthlyDepreciationCents(SERVIDOR)).toBe(20_000);
  });

  it('el cuadro suma exactamente la base amortizable', () => {
    const cuadro = depreciationSchedule(SERVIDOR);
    expect(suma(cuadro.map((linea) => linea.chargeCents))).toBe(1_200_000);
    expect(cuadro.at(-1)?.accumulatedCents).toBe(1_200_000);
    expect(cuadro.at(-1)?.netBookValueCents).toBe(0);
  });

  it('con prorrateo añade un mes al final para recuperar la parte no amortizada', () => {
    const cuadro = depreciationSchedule(SERVIDOR);
    expect(cuadro).toHaveLength(61);
    expect(cuadro.at(-1)?.period).toBe('2031-03');
    // 200 € × 14/31 = 90,32 €
    expect(cuadro.at(-1)?.chargeCents).toBe(9_032);
  });

  it('sin prorrateo reparte en cuotas iguales sobre la vida útil', () => {
    const cuadro = depreciationSchedule({ ...SERVIDOR, prorateFirstMonth: false });
    expect(cuadro).toHaveLength(60);
    expect(cuadro.every((linea) => linea.chargeCents === 20_000)).toBe(true);
    expect(suma(cuadro.map((linea) => linea.chargeCents))).toBe(1_200_000);
  });

  it('con alta el día 1 no necesita mes adicional aunque el prorrateo esté activo', () => {
    const cuadro = depreciationSchedule({ ...SERVIDOR, inServiceDate: '2026-03-01' });
    expect(cuadro).toHaveLength(60);
    expect(cuadro[0]?.chargeCents).toBe(20_000);
  });

  it('respeta el valor residual: el VNC final es exactamente el residual', () => {
    const cuadro = depreciationSchedule({
      ...SERVIDOR,
      residualCents: cents(150_000),
      inServiceDate: '2026-01-01',
    });
    expect(suma(cuadro.map((linea) => linea.chargeCents))).toBe(1_050_000);
    expect(cuadro.at(-1)?.netBookValueCents).toBe(150_000);
  });

  it('cuadra con importes que no son divisibles por la vida útil', () => {
    const cuadro = depreciationSchedule({
      acquisitionCents: cents(100_003),
      residualCents: cents(0),
      usefulLifeMonths: 7,
      inServiceDate: '2026-02-14',
    });
    expect(suma(cuadro.map((linea) => linea.chargeCents))).toBe(100_003);
    expect(cuadro).toHaveLength(8);
  });

  it('cuadra en 200 combinaciones deterministas de importe, vida útil y fecha de alta', () => {
    let seed = 20260904;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let caso = 0; caso < 200; caso += 1) {
      const acquisition = cents(1 + Math.floor(random() * 5_000_000));
      const residual = cents(Math.floor(random() * acquisition));
      const usefulLifeMonths = 1 + Math.floor(random() * 84);
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const fecha = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const cuadro = depreciationSchedule({
        acquisitionCents: acquisition,
        residualCents: residual,
        usefulLifeMonths,
        inServiceDate: fecha,
      });

      expect(suma(cuadro.map((linea) => linea.chargeCents))).toBe(acquisition - residual);
      expect(cuadro.at(-1)?.netBookValueCents).toBe(residual);
      expect(cuadro).toHaveLength(day === 1 ? usefulLifeMonths : usefulLifeMonths + 1);
    }
  });

  it('rechaza entradas imposibles', () => {
    expect(() => depreciationSchedule({ ...SERVIDOR, usefulLifeMonths: 0 })).toThrow(RangeError);
    expect(() => depreciationSchedule({ ...SERVIDOR, usefulLifeMonths: 12.5 })).toThrow(RangeError);
    expect(() => depreciationSchedule({ ...SERVIDOR, residualCents: cents(-1) })).toThrow(
      RangeError,
    );
    expect(() => depreciationSchedule({ ...SERVIDOR, acquisitionCents: cents(-1) })).toThrow(
      RangeError,
    );
    expect(() => depreciationSchedule({ ...SERVIDOR, residualCents: cents(2_000_000) })).toThrow(
      RangeError,
    );
  });
});

describe('netBookValueAt', () => {
  it('devuelve el valor de adquisición antes del alta', () => {
    expect(netBookValueAt(SERVIDOR, '2026-01')).toBe(1_200_000);
  });

  it('devuelve el VNC del mes consultado', () => {
    expect(netBookValueAt(SERVIDOR, '2026-03')).toBe(1_200_000 - 10_968);
    expect(netBookValueAt(SERVIDOR, '2026-04')).toBe(1_200_000 - 10_968 - 20_000);
  });

  it('se queda en el residual una vez agotada la vida útil', () => {
    expect(netBookValueAt(SERVIDOR, '2099-12')).toBe(0);
    expect(netBookValueAt({ ...SERVIDOR, residualCents: cents(100_000) }, '2099-12')).toBe(100_000);
  });
});

describe('replacementCost', () => {
  const activo: AssetForDebt = {
    id: 'srv-1',
    status: 'IN_USE',
    acquisitionCents: cents(1_200_000),
    inServiceDate: '2020-03-15',
    usefulLifeMonths: 60,
  };

  it('usa el precio de catálogo cuando existe, sin inflar nada', () => {
    expect(replacementCost({ ...activo, catalogPriceCents: cents(999_900) }, '2026-03-15')).toBe(
      999_900,
    );
  });

  it('infla el valor de adquisición con la inflación por defecto', () => {
    // 6 años exactos al 3 %: 12.000 € × 1,03^6 = 14.328,73 €
    const esperado = Math.round(1_200_000 * Math.pow(1 + DEFAULT_HARDWARE_INFLATION_RATE, 6));
    expect(replacementCost(activo, '2026-03-15')).toBe(esperado);
  });

  it('admite la inflación configurada por el tenant', () => {
    expect(replacementCost(activo, '2026-03-15', { hardwareInflationRate: 0 })).toBe(1_200_000);
  });

  it('no descuenta valor para un activo aún no dado de alta', () => {
    expect(replacementCost(activo, '2019-01-01')).toBe(1_200_000);
  });

  it('rechaza una inflación imposible', () => {
    expect(() => replacementCost(activo, '2026-03-15', { hardwareInflationRate: -1 })).toThrow(
      RangeError,
    );
  });
});

describe('technicalDebt', () => {
  const base: Omit<AssetForDebt, 'id'> = {
    status: 'IN_USE',
    acquisitionCents: cents(100_000),
    inServiceDate: '2019-01-15',
    usefulLifeMonths: 36,
  };

  it('suma sólo los activos vencidos y en uso', () => {
    const resultado = technicalDebt(
      [
        { ...base, id: 'vencido', catalogPriceCents: cents(120_000) },
        { ...base, id: 'vencido-retirado', status: 'RETIRED', catalogPriceCents: cents(120_000) },
        { ...base, id: 'vencido-en-stock', status: 'IN_STOCK', catalogPriceCents: cents(120_000) },
        {
          ...base,
          id: 'vigente',
          inServiceDate: '2026-01-15',
          catalogPriceCents: cents(120_000),
        },
      ],
      '2026-06-30',
    );

    expect(resultado.expiredAssetIds).toEqual(['vencido']);
    expect(resultado.totalCents).toBe(120_000);
  });

  it('marca como riesgo los activos que vencen en 12 meses sin línea de presupuesto', () => {
    const resultado = technicalDebt(
      [
        {
          ...base,
          id: 'vence-pronto',
          inServiceDate: '2024-01-15',
          catalogPriceCents: cents(90_000),
        },
        {
          ...base,
          id: 'vence-pronto-presupuestado',
          inServiceDate: '2024-01-15',
          hasBudgetLine: true,
          catalogPriceCents: cents(90_000),
        },
        {
          ...base,
          id: 'vence-tarde',
          inServiceDate: '2025-06-15',
          catalogPriceCents: cents(90_000),
        },
      ],
      '2026-06-30',
    );

    expect(resultado.unbudgetedRenewalAssetIds).toEqual(['vence-pronto']);
    expect(resultado.unbudgetedRenewalCents).toBe(90_000);
    expect(resultado.totalCents).toBe(0);
  });

  it('un activo ya vencido cuenta como deuda, no como riesgo de renovación', () => {
    const resultado = technicalDebt(
      [{ ...base, id: 'vencido', catalogPriceCents: cents(50_000) }],
      '2026-06-30',
    );
    expect(resultado.expiredAssetIds).toEqual(['vencido']);
    expect(resultado.unbudgetedRenewalAssetIds).toEqual([]);
  });

  it('sin activos devuelve ceros', () => {
    const resultado = technicalDebt([], '2026-06-30');
    expect(resultado.totalCents).toBe(0);
    expect(resultado.unbudgetedRenewalCents).toBe(0);
    expect(resultado.expiredAssetIds).toEqual([]);
    expect(resultado.unbudgetedRenewalAssetIds).toEqual([]);
  });
});

describe('DEFAULT_USEFUL_LIFE_MONTHS', () => {
  it('recoge las vidas útiles del documento 02', () => {
    expect(DEFAULT_USEFUL_LIFE_MONTHS.SERVER).toBe(60);
    expect(DEFAULT_USEFUL_LIFE_MONTHS.NETWORK).toBe(84);
    expect(DEFAULT_USEFUL_LIFE_MONTHS.LAPTOP).toBe(48);
    expect(DEFAULT_USEFUL_LIFE_MONTHS.MOBILE).toBe(36);
    expect(DEFAULT_USEFUL_LIFE_MONTHS.INTANGIBLE_DEV).toBe(60);
  });
});
