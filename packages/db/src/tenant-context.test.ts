import { describe, expect, it } from 'vitest';

import { assertTenantId } from './tenant-context.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('validación del tenant activo', () => {
  it('acepta un uuid', () => {
    expect(assertTenantId(TENANT_ID)).toBe(TENANT_ID);
  });

  it('rechaza lo que no es un uuid, empezando por la cadena vacía', () => {
    for (const value of ['', ' ', 'tenant-a', `${TENANT_ID} or true`, "'; DROP TABLE tenant; --"]) {
      expect(() => assertTenantId(value), JSON.stringify(value)).toThrow(/no es un uuid/);
    }
  });
});
