import { describe, expect, it } from 'vitest';

import { FINANCE_CORE_PACKAGE } from './index.js';

describe('finance-core', () => {
  it('expone el identificador del paquete', () => {
    expect(FINANCE_CORE_PACKAGE).toBe('@itfin360/finance-core');
  });
});
