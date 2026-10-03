import { describe, expect, it } from 'vitest';

import {
  dimensionLevel,
  dimensionsNeedingWork,
  effectiveLevel,
  MATURITY_DIMENSIONS,
  maturityGap,
  type MaturityAnswer,
} from './maturity.js';

describe('MATURITY_DIMENSIONS', () => {
  it('son nueve, con ciberseguridad, cumplimiento e IA como dimensiones propias', () => {
    expect(MATURITY_DIMENSIONS).toHaveLength(9);
    expect(MATURITY_DIMENSIONS).toContain('D5_CYBERSECURITY');
    expect(MATURITY_DIMENSIONS).toContain('D6_COMPLIANCE');
    expect(MATURITY_DIMENSIONS).toContain('D7_AI');
  });
});

describe('effectiveLevel', () => {
  it('sin evidencia, una respuesta cuenta como máximo un 2', () => {
    expect(effectiveLevel({ level: 4, hasEvidence: false })).toBe(2);
    expect(effectiveLevel({ level: 1, hasEvidence: false })).toBe(1);
    expect(effectiveLevel({ level: 2, hasEvidence: false })).toBe(2);
  });

  it('con evidencia cuenta lo que se responde', () => {
    expect(effectiveLevel({ level: 4, hasEvidence: true })).toBe(4);
  });

  it('rechaza un nivel fuera de escala', () => {
    const mala = { level: 0, hasEvidence: true } as unknown as MaturityAnswer;
    expect(() => effectiveLevel(mala)).toThrow('Respuesta de madurez');
  });
});

describe('dimensionLevel', () => {
  it('es la media de las respuestas, en milésimas', () => {
    expect(
      dimensionLevel([
        { level: 3, hasEvidence: true },
        { level: 4, hasEvidence: true },
        { level: 4, hasEvidence: false },
      ]),
    ).toBe(3_000);
    expect(
      dimensionLevel([
        { level: 3, hasEvidence: true },
        { level: 4, hasEvidence: true },
        { level: 4, hasEvidence: true },
      ]),
    ).toBe(3_667);
  });

  it('sin respuestas no hay dato, no un 1', () => {
    expect(dimensionLevel([])).toBeNull();
  });
});

describe('maturityGap y dimensionsNeedingWork', () => {
  it('la brecha es objetivo menos actual', () => {
    expect(maturityGap(2_400, 4_000)).toBe(1_600);
    expect(maturityGap(4_200, 4_000)).toBe(-200);
  });

  it('propone líneas de trabajo para brechas de más de un nivel, de mayor a menor', () => {
    expect(
      dimensionsNeedingWork({
        D1_STRATEGY: { current: 2_000, target: 3_500 },
        D5_CYBERSECURITY: { current: 1_500, target: 4_000 },
        D6_COMPLIANCE: { current: 2_000, target: 3_500 },
        D3_DATA: { current: 3_000, target: 4_000 },
        D9_PEOPLE: { current: 4_000, target: 3_000 },
      }),
    ).toEqual(['D5_CYBERSECURITY', 'D1_STRATEGY', 'D6_COMPLIANCE']);
  });

  it('el umbral se puede bajar', () => {
    expect(dimensionsNeedingWork({ D3_DATA: { current: 3_000, target: 3_600 } }, 500)).toEqual([
      'D3_DATA',
    ]);
  });
});
