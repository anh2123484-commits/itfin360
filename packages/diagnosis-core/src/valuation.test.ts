import { describe, expect, it } from 'vitest';

import {
  CRITERIA,
  DEFAULT_BANDS,
  DEFAULT_CRITERIA_WEIGHTS,
  levelFromBands,
  quadrant,
  shareOf,
  valuate,
  type Criterion,
} from './valuation.js';

const TODO_TRES = Object.fromEntries(CRITERIA.map((c) => [c, 3_000])) as Record<Criterion, number>;

const INICIATIVA: Record<Criterion, number> = {
  V1_STRATEGIC: 4_000,
  V2_BUSINESS: 3_500,
  V3_PEOPLE: 3_000,
  V4_RISK_COMPLIANCE: 3_557,
  V5_RETURN: 3_000,
  E1_CAPEX: 4_000,
  E2_OPEX: 5_000,
  E3_INTERNAL_CAPACITY: 3_000,
  E4_TIME_TO_VALUE: 5_000,
  E5_SOLUTION_MATURITY: 4_000,
};

describe('pesos por defecto', () => {
  it('suman 10000, con un 60 % para valor y el retorno como el criterio que más pesa', () => {
    const pesos = Object.values(DEFAULT_CRITERIA_WEIGHTS);
    expect(pesos.reduce((a, b) => a + b, 0)).toBe(10_000);
    const valor =
      DEFAULT_CRITERIA_WEIGHTS.V1_STRATEGIC +
      DEFAULT_CRITERIA_WEIGHTS.V2_BUSINESS +
      DEFAULT_CRITERIA_WEIGHTS.V3_PEOPLE +
      DEFAULT_CRITERIA_WEIGHTS.V4_RISK_COMPLIANCE +
      DEFAULT_CRITERIA_WEIGHTS.V5_RETURN;
    expect(valor).toBe(6_000);
    expect(Math.max(...pesos)).toBe(DEFAULT_CRITERIA_WEIGHTS.V5_RETURN);
  });
});

describe('levelFromBands', () => {
  it('payback: hasta 6 meses es un 5, y 12,2 meses ya es un 3', () => {
    expect(levelFromBands(60, DEFAULT_BANDS.V5_RETURN)).toBe(5);
    expect(levelFromBands(61, DEFAULT_BANDS.V5_RETURN)).toBe(4);
    expect(levelFromBands(120, DEFAULT_BANDS.V5_RETURN)).toBe(4);
    expect(levelFromBands(122, DEFAULT_BANDS.V5_RETURN)).toBe(3);
    expect(levelFromBands(360, DEFAULT_BANDS.V5_RETURN)).toBe(2);
    expect(levelFromBands(361, DEFAULT_BANDS.V5_RETURN)).toBe(1);
  });

  it('lo que no se recupera vale 1', () => {
    expect(levelFromBands(null, DEFAULT_BANDS.V5_RETURN)).toBe(1);
  });

  it('CAPEX: el 2 % exacto ya no es "menos del 2 %"', () => {
    expect(levelFromBands(199, DEFAULT_BANDS.E1_CAPEX)).toBe(5);
    expect(levelFromBands(200, DEFAULT_BANDS.E1_CAPEX)).toBe(4);
    expect(levelFromBands(999, DEFAULT_BANDS.E1_CAPEX)).toBe(3);
    expect(levelFromBands(1_999, DEFAULT_BANDS.E1_CAPEX)).toBe(2);
    expect(levelFromBands(2_000, DEFAULT_BANDS.E1_CAPEX)).toBe(1);
  });

  it('tiempo hasta el primer valor, en meses', () => {
    expect(levelFromBands(2, DEFAULT_BANDS.E4_TIME_TO_VALUE)).toBe(5);
    expect(levelFromBands(3, DEFAULT_BANDS.E4_TIME_TO_VALUE)).toBe(4);
    expect(levelFromBands(18, DEFAULT_BANDS.E4_TIME_TO_VALUE)).toBe(1);
  });

  it('rechaza valores negativos o no finitos y tramos desordenados', () => {
    expect(() => levelFromBands(-1, DEFAULT_BANDS.E1_CAPEX)).toThrow('fuera de rango');
    expect(() => levelFromBands(Number.NaN, DEFAULT_BANDS.E1_CAPEX)).toThrow('fuera de rango');
    expect(() => levelFromBands(1, { bounds: [5, 4, 3, 2], inclusive: false })).toThrow(
      'orden creciente',
    );
  });
});

describe('shareOf', () => {
  it('calcula la proporción en puntos básicos y redondea una vez', () => {
    expect(shareOf(18_000_00, 600_000_00)).toBe(300);
    expect(shareOf(1, 3)).toBe(3_333);
    expect(shareOf(0, 100)).toBe(0);
  });

  it('rechaza partes negativas y totales no positivos', () => {
    expect(() => shareOf(-1, 100)).toThrow('no negativa');
    expect(() => shareOf(1, 0)).toThrow('positivo');
    expect(() => shareOf(Number.POSITIVE_INFINITY, 100)).toThrow('no negativa');
    expect(() => shareOf(1, Number.NaN)).toThrow('positivo');
  });
});

describe('valuate', () => {
  it('todo a 3 da 50 en valor, viabilidad y total', () => {
    expect(valuate(TODO_TRES)).toEqual({ value: 5_000, feasibility: 5_000, total: 5_000 });
  });

  it('calcula valor, viabilidad y total de una iniciativa con los pesos por defecto', () => {
    expect(valuate(INICIATIVA)).toEqual({ value: 6_029, feasibility: 7_875, total: 6_767 });
  });

  it('todo a 1 da cero y todo a 5 da cien', () => {
    const unos = Object.fromEntries(CRITERIA.map((c) => [c, 1_000])) as Record<Criterion, number>;
    const cincos = Object.fromEntries(CRITERIA.map((c) => [c, 5_000])) as Record<Criterion, number>;
    expect(valuate(unos)).toEqual({ value: 0, feasibility: 0, total: 0 });
    expect(valuate(cincos)).toEqual({ value: 10_000, feasibility: 10_000, total: 10_000 });
  });

  it('un grupo sin peso vale cero en su eje y no rompe el cálculo', () => {
    const soloValor = Object.fromEntries(
      CRITERIA.map((c) => [c, c === 'V1_STRATEGIC' ? 10_000 : 0]),
    ) as Record<Criterion, number>;
    expect(valuate(INICIATIVA, soloValor)).toEqual({ value: 7_500, feasibility: 0, total: 7_500 });
  });

  it('rechaza pesos que no suman 10000', () => {
    expect(() => valuate(TODO_TRES, { ...DEFAULT_CRITERIA_WEIGHTS, V1_STRATEGIC: 0 })).toThrow(
      'deben sumar 10000',
    );
  });

  it('rechaza una nota fuera de 1000..5000 o con decimales', () => {
    expect(() => valuate({ ...TODO_TRES, E2_OPEX: 5_001 })).toThrow('E2_OPEX');
    expect(() => valuate({ ...TODO_TRES, V3_PEOPLE: 999 })).toThrow('V3_PEOPLE');
    expect(() => valuate({ ...TODO_TRES, V3_PEOPLE: 2_500.5 })).toThrow('V3_PEOPLE');
  });
});

describe('quadrant', () => {
  it('reparte los cuatro cuadrantes con el umbral de 50', () => {
    expect(quadrant({ value: 5_000, feasibility: 5_000 })).toBe('DO_NOW');
    expect(quadrant({ value: 8_000, feasibility: 4_999 })).toBe('PLAN');
    expect(quadrant({ value: 4_999, feasibility: 9_000 })).toBe('FILL_IN');
    expect(quadrant({ value: 1_000, feasibility: 1_000 })).toBe('RETHINK');
  });

  it('acepta umbrales por cliente', () => {
    expect(quadrant({ value: 6_000, feasibility: 6_000 }, 7_000, 5_000)).toBe('FILL_IN');
  });
});
