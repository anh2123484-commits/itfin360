import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_INDICATOR_BANDS,
  DEFAULT_INDICATOR_WEIGHTS,
  DEFAULT_READING_BANDS,
  VIABILITY_INDICATORS,
  normalizeToBand,
  viabilityScore,
  type ViabilityInput,
} from './viability.js';

const medida = <T>(value: T, ...sourceIds: string[]): { value: T; sourceIds: string[] } => ({
  value,
  sourceIds: sourceIds.length > 0 ? sourceIds : ['reg-1'],
});

/** Departamento con los ocho indicadores cargados y todos en banda buena. */
const TODO_BIEN: ViabilityInput = {
  benchmarks: { itSpendRatio: 0.03, costPerUserCents: cents(150_000) },
  itSpendRatio: medida(0.03, 'tco-2026', 'facturacion-2026'),
  changeShare: medida(0.35, 'horas-2026'),
  weightedCpi: medida(1.05, 'proy-1', 'proy-2'),
  budgetDeviation: medida(0.02, 'presupuesto-2026'),
  costPerUserCents: medida(cents(140_000), 'tco-2026', 'usuarios-2026'),
  teamUtilization: medida(0.78, 'horas-2026'),
  governedSpendShare: medida(0.95, 'contratos-2026'),
  technicalDebtShare: medida(0.03, 'inventario-2026'),
};

describe('normalizeToBand · banda lineal', () => {
  it('interpola y recorta cuando lo alto es mejor', () => {
    const banda = { kind: 'LINEAR', good: 0.3, bad: 0.1 } as const;
    expect(normalizeToBand(0.3, banda)).toBe(100);
    expect(normalizeToBand(0.1, banda)).toBe(0);
    expect(normalizeToBand(0.2, banda)).toBeCloseTo(50, 10);
    expect(normalizeToBand(0.5, banda)).toBe(100);
    expect(normalizeToBand(0, banda)).toBe(0);
  });

  it('interpola y recorta cuando lo bajo es mejor', () => {
    const banda = { kind: 'LINEAR', good: 0.05, bad: 0.25 } as const;
    expect(normalizeToBand(0.05, banda)).toBe(100);
    expect(normalizeToBand(0.25, banda)).toBe(0);
    expect(normalizeToBand(0.15, banda)).toBeCloseTo(50, 10);
    expect(normalizeToBand(0.4, banda)).toBe(0);
    expect(normalizeToBand(0, banda)).toBe(100);
  });

  it('rechaza una banda sin recorrido y un valor no finito', () => {
    expect(() => normalizeToBand(1, { kind: 'LINEAR', good: 1, bad: 1 })).toThrow(RangeError);
    expect(() =>
      normalizeToBand(Number.POSITIVE_INFINITY, { kind: 'LINEAR', good: 1, bad: 2 }),
    ).toThrow(RangeError);
  });
});

describe('normalizeToBand · banda con meseta', () => {
  const banda = {
    kind: 'RANGE',
    goodLow: 0.7,
    goodHigh: 0.85,
    badLow: 0.5,
    badHigh: 0.95,
  } as const;

  it('la meseta vale 100 de extremo a extremo', () => {
    expect(normalizeToBand(0.7, banda)).toBe(100);
    expect(normalizeToBand(0.78, banda)).toBe(100);
    expect(normalizeToBand(0.85, banda)).toBe(100);
  });

  it('pasarse penaliza igual que no llegar', () => {
    expect(normalizeToBand(0.6, banda)).toBeCloseTo(50, 10);
    expect(normalizeToBand(0.9, banda)).toBeCloseTo(50, 10);
    expect(normalizeToBand(0.5, banda)).toBe(0);
    expect(normalizeToBand(0.95, banda)).toBe(0);
    expect(normalizeToBand(1, banda)).toBe(0);
    expect(normalizeToBand(0.2, banda)).toBe(0);
  });

  it('rechaza una meseta mal formada', () => {
    expect(() =>
      normalizeToBand(0.8, {
        kind: 'RANGE',
        goodLow: 0.9,
        goodHigh: 0.7,
        badLow: 0.5,
        badHigh: 0.95,
      }),
    ).toThrow(RangeError);
  });
});

describe('configuración de arranque', () => {
  it('son los ocho indicadores del documento y sus pesos suman 100', () => {
    expect(VIABILITY_INDICATORS).toHaveLength(8);
    const suma = VIABILITY_INDICATORS.reduce((t, id) => t + DEFAULT_INDICATOR_WEIGHTS[id], 0);
    expect(suma).toBe(100);
  });

  it('cada indicador tiene su banda', () => {
    for (const id of VIABILITY_INDICATORS) {
      expect(DEFAULT_INDICATOR_BANDS[id]).toBeDefined();
    }
  });

  it('la lectura del documento: 75 / 55 / 40', () => {
    expect(DEFAULT_READING_BANDS).toEqual({ viable: 75, withTension: 55, atRisk: 40 });
  });
});

describe('viabilityScore · caso completo', () => {
  it('con todos los indicadores en banda buena, el score es 100 y la cobertura total', () => {
    const r = viabilityScore(TODO_BIEN);
    expect(r.score).toBeCloseTo(100, 10);
    expect(r.coverage).toBe(1);
    expect(r.reading).toBe('VIABLE');
    expect(r.excluded).toEqual([]);
  });

  it('cada indicador expone valor, normalizado, peso, contribución, banda y origen', () => {
    const r = viabilityScore(TODO_BIEN);
    for (const i of r.indicators) {
      expect(i.status).toBe('OK');
      expect(i.value).not.toBeNull();
      expect(i.normalized).not.toBeNull();
      expect(i.contribution).not.toBeNull();
      expect(i.band).not.toBeNull();
      expect(i.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it('las contribuciones suman el score', () => {
    const r = viabilityScore({ ...TODO_BIEN, weightedCpi: medida(0.85, 'proy-1') });
    const suma = r.indicators.reduce((t, i) => t + (i.contribution ?? 0), 0);
    expect(r.score).toBeCloseTo(suma, 10);
  });

  it('los indicadores 1 y 5 se normalizan sobre el cociente con la referencia', () => {
    const r = viabilityScore({
      ...TODO_BIEN,
      benchmarks: { itSpendRatio: 0.03, costPerUserCents: cents(100_000) },
      itSpendRatio: medida(0.045, 'tco'),
      costPerUserCents: medida(cents(200_000), 'tco'),
    });
    const spend = r.indicators.find((i) => i.id === 'IT_SPEND_RATIO');
    const usuario = r.indicators.find((i) => i.id === 'COST_PER_USER');

    // 0,045 / 0,03 = 1,5 → a mitad de camino entre 1 (100) y 2 (0).
    expect(spend?.rawValue).toBe(0.045);
    expect(spend?.value).toBeCloseTo(1.5, 10);
    expect(spend?.normalized).toBeCloseTo(50, 10);
    // 200.000 / 100.000 = 2 → el doble de la referencia, 0.
    expect(usuario?.value).toBeCloseTo(2, 10);
    expect(usuario?.normalized).toBe(0);
  });

  it('clasifica las cuatro lecturas', () => {
    const conCpi = (cpi: number, deviation: number, change: number): number | null =>
      viabilityScore({
        ...TODO_BIEN,
        weightedCpi: medida(cpi),
        budgetDeviation: medida(deviation),
        changeShare: medida(change),
      }).score;

    expect(viabilityScore(TODO_BIEN).reading).toBe('VIABLE');
    expect(conCpi(0.75, 0.25, 0.1)).toBeCloseTo(55, 10);
    expect(
      viabilityScore({
        ...TODO_BIEN,
        weightedCpi: medida(0.75),
        budgetDeviation: medida(0.25),
        changeShare: medida(0.1),
      }).reading,
    ).toBe('VIABLE_WITH_TENSION');
  });
});

describe('viabilityScore · datos insuficientes', () => {
  it('sin benchmarks, los indicadores 1 y 5 quedan excluidos y el score informa de la cobertura', () => {
    const { benchmarks: _sinUsar, ...sinReferencias } = TODO_BIEN;
    const r = viabilityScore(sinReferencias);

    const spend = r.indicators.find((i) => i.id === 'IT_SPEND_RATIO');
    const usuario = r.indicators.find((i) => i.id === 'COST_PER_USER');
    expect(spend?.status).toBe('INSUFFICIENT_DATA');
    expect(spend?.reason).toBe('NO_BENCHMARK');
    expect(usuario?.reason).toBe('NO_BENCHMARK');
    expect(r.excluded).toEqual(['IT_SPEND_RATIO', 'COST_PER_USER']);

    // Se excluyen 15 + 10 de 100: queda el 75 % del peso.
    expect(r.coverage).toBeCloseTo(0.75, 10);
    // Los que quedan siguen en banda buena, así que el score sigue siendo 100.
    expect(r.score).toBeCloseTo(100, 10);
  });

  it('un indicador excluido no aporta nada y su peso efectivo es cero', () => {
    const { benchmarks: _sinUsar, ...sinReferencias } = TODO_BIEN;
    const r = viabilityScore(sinReferencias);
    const spend = r.indicators.find((i) => i.id === 'IT_SPEND_RATIO');
    expect(spend?.contribution).toBeNull();
    expect(spend?.effectiveWeight).toBe(0);
    expect(spend?.normalized).toBeNull();
    // El valor medido sí se conserva, para poder explicar por qué se excluyó.
    expect(spend?.rawValue).toBe(0.03);
  });

  it('los pesos se redistribuyen proporcionalmente entre los disponibles', () => {
    const { benchmarks: _sinUsar, ...sinReferencias } = TODO_BIEN;
    const r = viabilityScore(sinReferencias);
    const disponibles = r.indicators.filter((i) => i.status === 'OK');
    const suma = disponibles.reduce((t, i) => t + i.effectiveWeight, 0);
    expect(suma).toBeCloseTo(1, 10);

    // Los de peso 15 siguen pesando el triple que los de peso 10 entre sí.
    const cpi = r.indicators.find((i) => i.id === 'WEIGHTED_CPI');
    const utilizacion = r.indicators.find((i) => i.id === 'TEAM_UTILIZATION');
    expect((cpi?.effectiveWeight ?? 0) / (utilizacion?.effectiveWeight ?? 1)).toBeCloseTo(1.5, 10);
  });

  it('un indicador sin valor se excluye, no se rellena con un defecto', () => {
    const { weightedCpi: _sinUsar, ...sinCpi } = TODO_BIEN;
    const r = viabilityScore(sinCpi);
    const cpi = r.indicators.find((i) => i.id === 'WEIGHTED_CPI');
    expect(cpi?.reason).toBe('NO_VALUE');
    expect(cpi?.rawValue).toBeNull();
    expect(r.coverage).toBeCloseTo(0.85, 10);
  });

  it('un indicador sin registros de origen se excluye: sin drill-down no cuenta', () => {
    const r = viabilityScore({
      ...TODO_BIEN,
      governedSpendShare: { value: 0.95, sourceIds: [] },
    });
    const gobernado = r.indicators.find((i) => i.id === 'GOVERNED_SPEND');
    expect(gobernado?.status).toBe('INSUFFICIENT_DATA');
    expect(gobernado?.reason).toBe('NO_TRACEABILITY');
    expect(gobernado?.contribution).toBeNull();
    expect(r.coverage).toBeCloseTo(0.9, 10);
  });

  it('sin ningún indicador no hay score ni lectura, y la cobertura es cero', () => {
    const r = viabilityScore({});
    expect(r.score).toBeNull();
    expect(r.reading).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.excluded).toHaveLength(8);
    expect(r.indicators).toHaveLength(8);
    for (const i of r.indicators) {
      expect(i.effectiveWeight).toBe(0);
      expect(i.contribution).toBeNull();
    }
  });

  it('con un solo indicador disponible, ese indicador es el score', () => {
    const r = viabilityScore({ weightedCpi: medida(0.875, 'proy-1') });
    // 0,875 está a mitad entre 0,75 (0) y 1,00 (100).
    expect(r.score).toBeCloseTo(50, 10);
    expect(r.coverage).toBeCloseTo(0.15, 10);
    expect(r.reading).toBe('AT_RISK');
  });
});

describe('viabilityScore · configuración del tenant', () => {
  it('admite pesos propios', () => {
    const r = viabilityScore({
      ...TODO_BIEN,
      weights: { WEIGHTED_CPI: 50 },
    });
    const cpi = r.indicators.find((i) => i.id === 'WEIGHTED_CPI');
    expect(cpi?.weight).toBe(50);
    expect(cpi?.effectiveWeight).toBeCloseTo(50 / 135, 10);
  });

  it('admite bandas propias', () => {
    const r = viabilityScore({
      ...TODO_BIEN,
      weightedCpi: medida(0.9, 'proy-1'),
      bands: { WEIGHTED_CPI: { kind: 'LINEAR', good: 0.9, bad: 0.5 } },
    });
    expect(r.indicators.find((i) => i.id === 'WEIGHTED_CPI')?.normalized).toBe(100);
  });

  it('admite otras bandas de lectura', () => {
    const r = viabilityScore({
      ...TODO_BIEN,
      readingBands: { viable: 101, withTension: 90, atRisk: 80 },
    });
    expect(r.score).toBeCloseTo(100, 10);
    expect(r.reading).toBe('VIABLE_WITH_TENSION');
  });

  it('rechaza bandas de lectura desordenadas y pesos negativos', () => {
    expect(() =>
      viabilityScore({ ...TODO_BIEN, readingBands: { viable: 40, withTension: 55, atRisk: 75 } }),
    ).toThrow(RangeError);
    expect(() => viabilityScore({ ...TODO_BIEN, weights: { WEIGHTED_CPI: -1 } })).toThrow(
      RangeError,
    );
  });
});
