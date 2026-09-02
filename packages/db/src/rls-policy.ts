/**
 * Generador del SQL de aislamiento por tenant para las migraciones (F0-05).
 *
 * Las migraciones de Prisma son SQL literal, así que este helper no se ejecuta
 * dentro de ellas: se invoca desde `pnpm --filter @itfin360/db run rls:policy
 * <tabla> [columna]` y su salida se pega en la migración. De ese modo todas
 * las tablas comparten exactamente la misma política y un test comprueba que
 * lo que hay en las migraciones coincide con lo que genera el helper.
 *
 * La comparación usa `NULLIF(current_setting('app.current_tenant', true), '')`:
 * sin variable de sesión y con la variable a cadena vacía el resultado es
 * NULL, y `columna = NULL` es NULL, que RLS trata como falso. Cero filas, no
 * una excepción de conversión a `uuid`.
 */

/** Nombre de la variable de sesión que fija `withTenant`. */
export const TENANT_SETTING = 'app.current_tenant';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Comprueba el identificador y lo entrecomilla para SQL. */
export function quoteSqlIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `Identificador SQL no válido: ${JSON.stringify(name)}. Se esperaba snake_case sin comillas.`,
    );
  }
  return `"${name}"`;
}

/** Expresión del tenant activo, NULL fuera de contexto y con la variable vacía. */
export function currentTenantExpression(): string {
  return `NULLIF(current_setting('${TENANT_SETTING}', true), '')::uuid`;
}

/** `ENABLE` + `FORCE ROW LEVEL SECURITY`: ni el propietario de la tabla se salta la política. */
export function enableRowLevelSecuritySql(table: string): string {
  const quoted = quoteSqlIdentifier(table);
  return [
    `ALTER TABLE ${quoted} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${quoted} FORCE ROW LEVEL SECURITY;`,
  ].join('\n');
}

/**
 * Política `tenant_isolation` de una tabla. Idempotente: la borra si existe y
 * la vuelve a crear, para que una migración posterior pueda corregirla sin
 * dejar la tabla desprotegida (todo ocurre en la transacción de la migración).
 */
export function tenantIsolationPolicySql(table: string, tenantColumn = 'tenant_id'): string {
  const quotedTable = quoteSqlIdentifier(table);
  const predicate = `${quoteSqlIdentifier(tenantColumn)} = ${currentTenantExpression()}`;
  return [
    `DROP POLICY IF EXISTS tenant_isolation ON ${quotedTable};`,
    `CREATE POLICY tenant_isolation ON ${quotedTable}`,
    `  USING (${predicate})`,
    `  WITH CHECK (${predicate});`,
  ].join('\n');
}

/** Bloque completo para una tabla nueva: activa RLS y crea la política. */
export function tenantIsolationMigrationSql(table: string, tenantColumn = 'tenant_id'): string {
  return `${enableRowLevelSecuritySql(table)}\n${tenantIsolationPolicySql(table, tenantColumn)}`;
}
