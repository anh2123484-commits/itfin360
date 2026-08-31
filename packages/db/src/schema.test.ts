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

  it('sólo exime tablas sin columna `tenant_id`', () => {
    const exempt = [...sql.matchAll(/--\s*rls-exempt:\s*(\w+)/g)].map((match) => match[1]);
    for (const table of exempt) {
      const create = new RegExp(`CREATE TABLE "${table}" \\(([^;]*)\\)`, 's');
      expect(create.exec(sql)?.[1]).not.toContain('"tenant_id"');
    }
  });
});
