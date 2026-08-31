/**
 * Imprime el bloque de RLS de una tabla para pegarlo en una migración:
 *
 * ```bash
 * pnpm --filter @itfin360/db run rls:policy invoice
 * pnpm --filter @itfin360/db run rls:policy tenant id
 * ```
 */
import { tenantIsolationMigrationSql } from './rls-policy.js';

const [table, tenantColumn] = process.argv.slice(2);

if (table === undefined) {
  console.error('Uso: rls:policy <tabla> [columna_de_tenant]');
  process.exit(1);
}

console.log(tenantIsolationMigrationSql(table, tenantColumn));
