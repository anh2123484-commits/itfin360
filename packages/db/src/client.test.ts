import { describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { DB_PACKAGE, Plan, Role } from './index.js';

describe('cliente exportado', () => {
  it('expone los enums del esquema', () => {
    expect(Plan.TRIAL).toBe('TRIAL');
    expect(Object.keys(Role)).toEqual([
      'OWNER',
      'FINANCE',
      'IT_MANAGER',
      'PROJECT_MANAGER',
      'CONTRIBUTOR',
      'VIEWER',
    ]);
    expect(DB_PACKAGE).toBe('@itfin360/db');
  });

  it('crea un cliente con los modelos del esquema base', async () => {
    const prisma = createPrismaClient({
      connectionString: 'postgresql://app@localhost:5432/itfin360',
    });
    expect(Object.keys(prisma)).toEqual(
      expect.arrayContaining(['tenant', 'tenantParamVersion', 'user', 'membership', 'auditLog']),
    );
    await prisma.$disconnect();
  });
});
