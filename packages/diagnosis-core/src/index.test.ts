import { describe, expect, it } from 'vitest';

import * as motor from './index.js';

describe('superficie pública', () => {
  it('expone el cálculo del diagnóstico desde un solo punto de entrada', () => {
    for (const nombre of [
      'aggregateCriterion',
      'tastleWiermanConsensus',
      'dimensionLevel',
      'rocWeightsFromRanking',
      'valuate',
      'quadrant',
      'levelFromBands',
    ]) {
      expect(typeof (motor as Record<string, unknown>)[nombre]).toBe('function');
    }
    expect(motor.CRITERIA).toHaveLength(10);
    expect(motor.MATURITY_DIMENSIONS).toHaveLength(9);
  });
});
