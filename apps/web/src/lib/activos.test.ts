import { describe, expect, it } from 'vitest';

import {
  type ActivoParaCalcular,
  mesesEntre,
  periodoDe,
  resumenActivos,
  vidaUtilPorDefecto,
} from '@/lib/activos';

const BASE: ActivoParaCalcular = {
  id: 'a1',
  acquisitionCents: 120_000,
  residualCents: 0,
  usefulLifeMonths: 48,
  inServiceDate: new Date('2024-01-15T00:00:00Z'),
  status: 'IN_USE',
  catalogPriceCents: null,
  hasBudgetLine: false,
};

const activo = (cambios: Partial<ActivoParaCalcular>): ActivoParaCalcular => ({
  ...BASE,
  ...cambios,
});

describe('periodoDe y mesesEntre', () => {
  it('el periodo es el año y el mes', () => {
    expect(periodoDe(new Date('2026-09-26T12:00:00Z'))).toBe('2026-09');
    expect(periodoDe(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });

  it('el mes no se cuenta hasta que se cumple el día', () => {
    // Del 15 de enero al 14 de febrero no ha pasado un mes entero. Contarlo
    // adelantaría un mes la amortización de todo el parque.
    expect(mesesEntre(new Date('2026-01-15Z'), new Date('2026-02-14Z'))).toBe(0);
    expect(mesesEntre(new Date('2026-01-15Z'), new Date('2026-02-15Z'))).toBe(1);
  });

  it('cuenta años completos', () => {
    expect(mesesEntre(new Date('2024-01-15Z'), new Date('2026-01-15Z'))).toBe(24);
  });
});

describe('vidaUtilPorDefecto', () => {
  it('sale de la tabla del motor, no de una copia', () => {
    expect(vidaUtilPorDefecto('LAPTOP')).toBe(48);
    expect(vidaUtilPorDefecto('NETWORK')).toBe(84);
    expect(vidaUtilPorDefecto('MOBILE')).toBe(36);
  });
});

describe('resumenActivos', () => {
  const ahora = new Date('2026-09-26T00:00:00Z');

  it('reparte el valor entre los meses de vida útil', () => {
    const { calculados } = resumenActivos([activo({ acquisitionCents: 96_000 })], ahora);
    // 960 € entre 48 meses son 20 € al mes.
    expect(calculados[0]?.monthlyChargeCents).toBe(2_000);
  });

  it('el residual no se amortiza', () => {
    const { calculados } = resumenActivos(
      [activo({ acquisitionCents: 100_000, residualCents: 4_000, usefulLifeMonths: 48 })],
      ahora,
    );
    expect(calculados[0]?.monthlyChargeCents).toBe(2_000);
  });

  it('dice cuánto le queda de vida a cada activo', () => {
    const { calculados } = resumenActivos(
      [activo({ inServiceDate: new Date('2024-01-15Z'), usefulLifeMonths: 48 })],
      ahora,
    );
    expect(calculados[0]?.edadMeses).toBe(32);
    expect(calculados[0]?.mesesRestantes).toBe(16);
  });

  it('un activo pasado de vida útil tiene meses restantes negativos', () => {
    const { calculados } = resumenActivos(
      [activo({ inServiceDate: new Date('2019-01-15Z'), usefulLifeMonths: 48 })],
      ahora,
    );
    expect(calculados[0]?.mesesRestantes).toBeLessThan(0);
  });

  it('lo dado de baja no suma al balance', () => {
    const { valorAdquisicionCents } = resumenActivos(
      [
        activo({ id: 'vivo', acquisitionCents: 100_000 }),
        activo({ id: 'baja', acquisitionCents: 900_000, status: 'DISPOSED' }),
      ],
      ahora,
    );
    expect(valorAdquisicionCents).toBe(100_000);
  });

  it('lo ya amortizado del todo deja de restar cada mes', () => {
    // Un parque viejo que siguiera amortizando sería un gasto inventado que
    // nadie encontraría al cuadrar con contabilidad.
    const { amortizacionMensualCents } = resumenActivos(
      [
        activo({ id: 'nuevo', inServiceDate: new Date('2026-01-15Z'), acquisitionCents: 96_000 }),
        activo({ id: 'viejo', inServiceDate: new Date('2015-01-15Z'), acquisitionCents: 96_000 }),
      ],
      ahora,
    );
    expect(amortizacionMensualCents).toBe(2_000);
  });

  it('el parque vencido y en uso es deuda técnica', () => {
    const { deuda } = resumenActivos(
      [
        activo({ id: 'vencido', inServiceDate: new Date('2018-01-15Z'), usefulLifeMonths: 48 }),
        activo({ id: 'nuevo', inServiceDate: new Date('2026-01-15Z'), usefulLifeMonths: 48 }),
      ],
      ahora,
    );
    expect(deuda.expiredAssetIds).toEqual(['vencido']);
    expect(deuda.totalCents).toBeGreaterThan(0);
  });

  it('lo que está en almacén no cuenta como deuda técnica', () => {
    // Un portátil de repuesto vencido en el armario no hay que reponerlo, y
    // meterlo en la cifra le quita credibilidad a todo el número.
    const { deuda } = resumenActivos(
      [
        activo({
          id: 'repuesto',
          inServiceDate: new Date('2018-01-15Z'),
          usefulLifeMonths: 48,
          status: 'IN_STOCK',
        }),
      ],
      ahora,
    );
    expect(deuda.expiredAssetIds).toHaveLength(0);
    expect(deuda.totalCents).toBe(0);
  });

  it('lo que vence dentro de un año sin presupuesto es riesgo, no deuda', () => {
    const { deuda } = resumenActivos(
      [
        activo({
          id: 'vence-pronto',
          inServiceDate: new Date('2022-12-15Z'),
          usefulLifeMonths: 48,
          hasBudgetLine: false,
        }),
      ],
      ahora,
    );
    expect(deuda.unbudgetedRenewalAssetIds).toEqual(['vence-pronto']);
    expect(deuda.expiredAssetIds).toHaveLength(0);
  });

  it('con línea de presupuesto deja de ser riesgo', () => {
    const { deuda } = resumenActivos(
      [
        activo({
          id: 'previsto',
          inServiceDate: new Date('2022-12-15Z'),
          usefulLifeMonths: 48,
          hasBudgetLine: true,
        }),
      ],
      ahora,
    );
    expect(deuda.unbudgetedRenewalAssetIds).toHaveLength(0);
  });

  it('un parque vacío no revienta', () => {
    const resumen = resumenActivos([], ahora);
    expect(resumen.valorNetoCents).toBe(0);
    expect(resumen.deuda.totalCents).toBe(0);
  });
});
