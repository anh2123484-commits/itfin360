import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auditRlsPolicies, type MigrationSource } from './rls-check.js';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function listSqlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...listSqlFiles(path));
    else if (entry.endsWith('.sql')) files.push(path);
  }
  return files.sort();
}

const migrations: MigrationSource[] = listSqlFiles(MIGRATIONS_DIR).map((path) => ({
  file: relative(process.cwd(), path),
  sql: readFileSync(path, 'utf8'),
}));

const sql = migrations.map((migration) => migration.sql).join('\n');

/** Tablas con datos de tenant: llevan `tenant_id` (o son el propio tenant). */
const TENANT_TABLES = ['tenant', 'tenant_param_version', 'membership', 'audit_log'] as const;

/** Tablas de F2-01: proveedores, facturas y líneas. */
const F2_TABLES = ['vendor', 'invoice', 'invoice_line'] as const;

describe('migraciones de tenancy', () => {
  it('crea las cinco tablas del esquema base', () => {
    for (const table of [...TENANT_TABLES, 'user']) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('pasa el gate de RLS de CI', () => {
    expect(auditRlsPolicies(migrations)).toEqual([]);
  });

  it('activa y fuerza RLS en toda tabla con datos de tenant', () => {
    for (const table of TENANT_TABLES) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  });

  it('aísla por `app.current_tenant` en toda tabla con datos de tenant', () => {
    for (const table of TENANT_TABLES) {
      const column = table === 'tenant' ? 'id' : 'tenant_id';
      const policy = new RegExp(
        `CREATE POLICY tenant_isolation ON "${table}"\\s+USING \\("${column}" = current_setting\\('app\\.current_tenant', true\\)::uuid\\)`,
      );
      expect(sql).toMatch(policy);
    }
  });

  it('documenta el motivo de cada tabla eximida', () => {
    expect(sql).toMatch(/--\s*rls-exempt:\s*user\s*—\s*\S+/);
  });

  it('crea las tres tablas de proveedores, facturas y líneas (F2-01)', () => {
    for (const table of F2_TABLES) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('activa y fuerza RLS en las tablas de F2-01, con la política contra NULLIF', () => {
    for (const table of F2_TABLES) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      const policy = new RegExp(
        `CREATE POLICY tenant_isolation ON "${table}"\\s+USING \\("tenant_id" = NULLIF\\(current_setting\\('app\\.current_tenant', true\\), ''\\)::uuid\\)`,
      );
      expect(sql).toMatch(policy);
    }
  });

  it('la unicidad (tenant, proveedor, número) bloquea el duplicado exacto en la base', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "invoice_tenant_id_vendor_id_invoice_number_key" ON "invoice"("tenant_id", "vendor_id", "invoice_number")',
    );
  });

  it('la categoría de una línea es un enum, no texto libre', () => {
    // El hueco que cierra F2-01: con texto libre, "SaaS" y "Saas" son dos
    // líneas presupuestarias distintas y el % de gasto gobernado no se calcula.
    expect(sql).toContain('CREATE TYPE "spend_concept" AS ENUM');
    const create = /CREATE TABLE "invoice_line" \(([^;]*)\)/s.exec(sql)?.[1] ?? '';
    expect(create).toContain('"concept" "spend_concept" NOT NULL');
  });

  it('sólo exime tablas sin columna `tenant_id`', () => {
    const exempt = [...sql.matchAll(/--\s*rls-exempt:\s*(\w+)/g)].map((match) => match[1]);
    for (const table of exempt) {
      const create = new RegExp(`CREATE TABLE "${table}" \\(([^;]*)\\)`, 's');
      expect(create.exec(sql)?.[1]).not.toContain('"tenant_id"');
    }
  });
});
