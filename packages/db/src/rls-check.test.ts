import { describe, expect, it } from 'vitest';

import { auditRlsPolicies, formatRlsViolations } from './rls-check.js';

const withPolicy = `
CREATE TABLE "public"."Contract" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "public"."Contract" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "public"."Contract"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE));
`;

const withoutPolicy = `
CREATE TABLE "public"."Invoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
`;

describe('auditRlsPolicies', () => {
  it('acepta una tabla con RLS activada y política', () => {
    expect(auditRlsPolicies([{ file: '001_init/migration.sql', sql: withPolicy }])).toEqual([]);
  });

  it('rechaza una tabla nueva sin RLS ni política', () => {
    const violations = auditRlsPolicies([
      { file: '002_invoice/migration.sql', sql: withoutPolicy },
    ]);

    expect(violations).toEqual([
      {
        table: 'invoice',
        file: '002_invoice/migration.sql',
        missing: ['ENABLE ROW LEVEL SECURITY', 'CREATE POLICY'],
      },
    ]);
  });

  it('rechaza una tabla con RLS activada pero sin política', () => {
    const sql = `${withoutPolicy}\nALTER TABLE "public"."Invoice" ENABLE ROW LEVEL SECURITY;`;

    expect(auditRlsPolicies([{ file: '002_invoice/migration.sql', sql }])).toEqual([
      { table: 'invoice', file: '002_invoice/migration.sql', missing: ['CREATE POLICY'] },
    ]);
  });

  it('acepta que la política llegue en una migración posterior', () => {
    const violations = auditRlsPolicies([
      { file: '002_invoice/migration.sql', sql: withoutPolicy },
      {
        file: '003_invoice_rls/migration.sql',
        sql: `ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
              CREATE POLICY "tenant_isolation" ON "Invoice" USING (TRUE);`,
      },
    ]);

    expect(violations).toEqual([]);
  });

  it('respeta la exención explícita de una tabla sin datos de tenant', () => {
    const sql = `-- rls-exempt: Invoice — tabla de ejemplo sin datos de tenant\n${withoutPolicy}`;

    expect(auditRlsPolicies([{ file: '002_invoice/migration.sql', sql }])).toEqual([]);
  });

  it('formatea las violaciones para el log de CI', () => {
    const violations = auditRlsPolicies([
      { file: '002_invoice/migration.sql', sql: withoutPolicy },
    ]);

    expect(formatRlsViolations(violations)).toBe(
      '- invoice (002_invoice/migration.sql): falta ENABLE ROW LEVEL SECURITY y CREATE POLICY',
    );
  });
});
