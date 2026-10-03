import { describe, expect, it } from 'vitest';

import { aggregateCriterion, consensusFlag, tastleWiermanConsensus, type Vote } from './voting.js';

/**
 * El ejemplo del documento (§5.4) es la prueba principal: si cambia, cambia lo
 * que se explica al cliente, y eso no puede pasar sin que alguien lo vea.
 */

const PESOS = { DG: 3_000, DF: 2_500, IT: 2_500, CISO: 2_000 };

const EJEMPLO: Vote[] = [
  { orgFunction: 'DG', level: 4 },
  { orgFunction: 'DF', level: 2 },
  { orgFunction: 'IT', level: 5 },
  { orgFunction: 'CISO', level: 4 },
];

describe('aggregateCriterion', () => {
  it('reproduce el ejemplo del documento: 3,56 de nota y 0,61 de consenso', () => {
    const resultado = aggregateCriterion(EJEMPLO, PESOS);
    expect(resultado).toEqual({
      status: 'SCORED',
      level: 3_557,
      consensus: 6_108,
      consensusFlag: 'REVIEW',
      coverage: 10_000,
      byFunction: { DG: 4_000, DF: 2_000, IT: 5_000, CISO: 4_000 },
    });
  });

  it('la media geométrica queda por debajo de la aritmética cuando alguien vota bajo', () => {
    const resultado = aggregateCriterion(EJEMPLO, PESOS);
    // La aritmética ponderada sería 3,75.
    expect(resultado.status === 'SCORED' && resultado.level < 3_750).toBe(true);
  });

  it('una función con varias personas cuenta una vez, con la media de sus votos', () => {
    const resultado = aggregateCriterion(
      [...EJEMPLO.slice(1), { orgFunction: 'DG', level: 4 }, { orgFunction: 'DG', level: 5 }],
      PESOS,
    );
    expect(resultado.status).toBe('SCORED');
    if (resultado.status !== 'SCORED') return;
    expect(resultado.byFunction['DG']).toBe(4_500);
    expect(resultado.level).toBe(3_684);
  });

  it('"no lo sé" es abstención: no cuenta como un 3 ni suma al quórum', () => {
    const resultado = aggregateCriterion(
      [
        { orgFunction: 'DG', level: 4 },
        { orgFunction: 'DF', level: null },
        { orgFunction: 'IT', level: 4 },
        { orgFunction: 'CISO', level: 4 },
      ],
      PESOS,
    );
    expect(resultado).toMatchObject({ status: 'SCORED', level: 4_000, coverage: 7_500 });
  });

  it('sin quórum no hay nota', () => {
    const resultado = aggregateCriterion(
      [
        { orgFunction: 'DG', level: 4 },
        { orgFunction: 'CISO', level: 1 },
      ],
      PESOS,
    );
    expect(resultado).toEqual({ status: 'NO_QUORUM', coverage: 5_000 });
  });

  it('el quórum se puede ajustar por cliente', () => {
    const resultado = aggregateCriterion([{ orgFunction: 'DG', level: 4 }], PESOS, 3_000);
    expect(resultado).toMatchObject({ status: 'SCORED', level: 4_000, consensus: 10_000 });
  });

  it('sin votos no hay nota', () => {
    expect(aggregateCriterion([], PESOS)).toEqual({ status: 'NO_QUORUM', coverage: 0 });
  });

  it('una función con peso cero vota pero no cuenta', () => {
    const resultado = aggregateCriterion(
      [
        { orgFunction: 'DG', level: 5 },
        { orgFunction: 'MKT', level: 1 },
      ],
      { DG: 10_000, MKT: 0 },
    );
    expect(resultado).toMatchObject({ status: 'SCORED', level: 5_000, coverage: 10_000 });
  });

  it('rechaza un voto de una función sin peso de decisión', () => {
    expect(() => aggregateCriterion([{ orgFunction: 'COMPRAS', level: 3 }], PESOS)).toThrow(
      'no tiene peso',
    );
  });

  it('rechaza un voto fuera de la escala', () => {
    const voto = { orgFunction: 'DG', level: 6 } as unknown as Vote;
    expect(() => aggregateCriterion([voto], PESOS)).toThrow('entero de 1 a 5');
  });

  it('rechaza unos pesos de decisión que no suman 10000', () => {
    expect(() => aggregateCriterion(EJEMPLO, { DG: 5_000, DF: 2_500 })).toThrow('suman 7500');
  });
});

describe('tastleWiermanConsensus', () => {
  it('vale 1 cuando todos votan lo mismo', () => {
    expect(tastleWiermanConsensus([{ value: 4, share: 1 }])).toBe(10_000);
  });

  it('vale 0 cuando la mitad vota 1 y la otra mitad 5', () => {
    expect(
      tastleWiermanConsensus([
        { value: 1, share: 0.5 },
        { value: 5, share: 0.5 },
      ]),
    ).toBe(0);
  });

  it('dos niveles contiguos a partes iguales dan un consenso alto', () => {
    expect(
      tastleWiermanConsensus([
        { value: 3, share: 0.5 },
        { value: 4, share: 0.5 },
      ]),
    ).toBe(8_074);
  });

  it('un peso cero no aporta, ni siquiera en el extremo', () => {
    expect(
      tastleWiermanConsensus([
        { value: 5, share: 1 },
        { value: 1, share: 0 },
      ]),
    ).toBe(10_000);
  });

  it('necesita al menos un voto con peso', () => {
    expect(() => tastleWiermanConsensus([])).toThrow('al menos un voto');
    expect(() => tastleWiermanConsensus([{ value: 3, share: 0 }])).toThrow('al menos un voto');
  });
});

describe('consensusFlag', () => {
  it('aplica los umbrales del documento', () => {
    expect(consensusFlag(7_000)).toBe('OK');
    expect(consensusFlag(6_999)).toBe('REVIEW');
    expect(consensusFlag(5_000)).toBe('REVIEW');
    expect(consensusFlag(4_999)).toBe('DEBATE');
  });
});
