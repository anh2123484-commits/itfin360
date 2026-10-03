import { describe, expect, it } from 'vitest';

import { rocWeights, rocWeightsFromRanking, toBasisPoints } from './weights.js';

describe('rocWeights', () => {
  it('con diez criterios, el primero pesa un 29,3 % y el último un 1 %', () => {
    const pesos = rocWeights(10);
    expect(pesos).toHaveLength(10);
    expect(pesos[0]).toBeCloseTo(0.2929, 4);
    expect(pesos[9]).toBeCloseTo(0.01, 4);
    expect(pesos.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('con un solo criterio pesa todo', () => {
    expect(rocWeights(1)).toEqual([1]);
  });

  it('rechaza un número de criterios que no sea entero positivo', () => {
    expect(() => rocWeights(0)).toThrow('entero positivo');
    expect(() => rocWeights(2.5)).toThrow('entero positivo');
  });
});

describe('toBasisPoints', () => {
  it('reparte 10000 puntos sin perder ni ganar uno', () => {
    expect(toBasisPoints([1, 1, 1])).toEqual([3_334, 3_333, 3_333]);
    expect(toBasisPoints([2, 1, 1])).toEqual([5_000, 2_500, 2_500]);
  });

  it('rechaza pesos vacíos, negativos o que suman cero', () => {
    expect(() => toBasisPoints([])).toThrow('no negativos');
    expect(() => toBasisPoints([1, -1, 1])).toThrow('no negativos');
    expect(() => toBasisPoints([0, 0])).toThrow('no negativos');
  });
});

describe('rocWeightsFromRanking', () => {
  it('convierte un orden en pesos enteros que suman 10000 y no crecen', () => {
    const orden = ['V5', 'V4', 'V1', 'V2', 'E1', 'V3', 'E2', 'E3', 'E5', 'E4'] as const;
    const pesos = rocWeightsFromRanking(orden);
    const valores = orden.map((c) => pesos[c]);
    expect(valores.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(pesos.V5).toBe(2_929);
    expect(pesos.E4).toBe(100);
    for (let i = 1; i < valores.length; i += 1) {
      expect(valores[i]).toBeLessThanOrEqual(valores[i - 1] as number);
    }
  });

  it('rechaza un criterio repetido', () => {
    expect(() => rocWeightsFromRanking(['A', 'B', 'A'])).toThrow('dos veces');
  });
});
