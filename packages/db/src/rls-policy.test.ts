import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  currentTenantExpression,
  enableRowLevelSecuritySql,
  quoteSqlIdentifier,
  tenantIsolationMigrationSql,
  tenantIsolationPolicySql,
} from './rls-policy.js';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

/** Tablas con datos de tenant y la columna por la que se aíslan. */
const TENANT_TABLES: readonly (readonly [string, string])[] = [
  ['tenant', 'id'],
  ['tenant_param_version', 'tenant_id'],
  ['membership', 'tenant_id'],
  ['audit_log', 'tenant_id'],
];

function allMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

describe('generador de políticas RLS', () => {
  it('compara contra NULLIF para que la variable vacía dé cero filas y no un error de uuid', () => {
    expect(currentTenantExpression()).toBe(
      "NULLIF(current_setting('app.current_tenant', true), '')::uuid",
    );
    expect(tenantIsolationPolicySql('invoice')).toContain(
      `"tenant_id" = ${currentTenantExpression()}`,
    );
  });

  it('protege también al propietario de la tabla', () => {
    expect(enableRowLevelSecuritySql('invoice')).toContain(
      'ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;',
    );
  });

  it('cubre lectura y escritura, y es reaplicable', () => {
    const sql = tenantIsolationPolicySql('invoice');
    expect(sql).toContain('DROP POLICY IF EXISTS tenant_isolation ON "invoice";');
    expect(sql).toContain('USING (');
    expect(sql).toContain('WITH CHECK (');
  });

  it('rechaza identificadores que no sean snake_case', () => {
    expect(() => quoteSqlIdentifier('invoice"; DROP TABLE tenant; --')).toThrow(/no válido/);
    expect(() => tenantIsolationPolicySql('Invoice')).toThrow(/no válido/);
    expect(() => tenantIsolationPolicySql('invoice', 'tenant id')).toThrow(/no válido/);
  });

  it('las migraciones dejan cada tabla de tenant con la política que genera el helper', () => {
    const sql = allMigrationsSql();
    for (const [table, column] of TENANT_TABLES) {
      expect(sql, `tabla ${table}`).toContain(tenantIsolationPolicySql(table, column));
      expect(sql, `tabla ${table}`).toContain(enableRowLevelSecuritySql(table));
    }
  });

  it('el bloque para una tabla nueva activa RLS y crea la política', () => {
    const sql = tenantIsolationMigrationSql('invoice');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY tenant_isolation');
  });
});
