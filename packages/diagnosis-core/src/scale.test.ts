import { describe, expect, it } from 'vitest';

import { assertLevel, assertWeightsSumToFull, isLevel, roundHalfUp, toMilli } from './scale.js';

describe('isLevel y assertLevel', () => {
  it('solo acepta enteros de 1 a 5', () => {
    expect([1, 2, 3, 4, 5].every(isLevel)).toBe(true);
    expect([0, 6, 2.5, '3', null].some(isLevel)).toBe(false);
    expect(assertLevel(3, 'Prueba')).toBe(3);
    expect(() => assertLevel(7, 'Prueba')).toThrow('Prueba: el nivel debe ser un entero de 1 a 5');
  });
});

describe('roundHalfUp', () => {
  it('redondea la mitad hacia fuera del cero, simétrico', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999)).toBe(2);
  });

  it('rechaza valores no finitos', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow('no finito');
  });
});

describe('toMilli', () => {
  it('pasa un nivel con decimales a milésimas', () => {
    expect(toMilli(3.5566)).toBe(3_557);
  });
});

describe('assertWeightsSumToFull', () => {
  it('acepta pesos enteros que suman 10000', () => {
    const pesos = { a: 6_000, b: 4_000 };
    expect(assertWeightsSumToFull(pesos, 'Prueba')).toBe(pesos);
  });

  it('rechaza pesos que no suman, negativos o con decimales', () => {
    expect(() => assertWeightsSumToFull({ a: 5_000 }, 'Prueba')).toThrow('suman 5000');
    expect(() => assertWeightsSumToFull({ a: 11_000, b: -1_000 }, 'Prueba')).toThrow('peso de b');
    expect(() => assertWeightsSumToFull({ a: 9_999.5, b: 0.5 }, 'Prueba')).toThrow('peso de a');
  });
});
