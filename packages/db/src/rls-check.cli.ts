/**
 * Gate de CI: recorre `prisma/migrations` y falla si alguna tabla creada por
 * una migración no tiene RLS activada y política.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { auditRlsPolicies, formatRlsViolations, type MigrationSource } from './rls-check.js';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function listMigrationFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...listMigrationFiles(path));
    else if (entry.endsWith('.sql')) files.push(path);
  }
  return files.sort();
}

function readMigrations(): MigrationSource[] {
  let files: string[];
  try {
    files = listMigrationFiles(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return files.map((path) => ({
    file: relative(process.cwd(), path),
    sql: readFileSync(path, 'utf8'),
  }));
}

const migrations = readMigrations();
const violations = auditRlsPolicies(migrations);

if (violations.length > 0) {
  console.error(
    `RLS: ${violations.length} tabla(s) sin política de aislamiento:\n${formatRlsViolations(violations)}`,
  );
  process.exit(1);
}

console.log(`RLS: ${migrations.length} migración(es) revisada(s), sin tablas desprotegidas.`);
