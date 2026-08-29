import { expect, it } from 'vitest';

import { covered } from './subject.mjs';

it('cubre sólo una de las dos funciones', () => {
  expect(covered(1)).toBe(2);
});
