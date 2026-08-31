/**
 * Comprobación estática de las migraciones SQL: toda tabla creada por una
 * migración debe activar Row Level Security y tener al menos una política.
 *
 * Regla dura 3 de `AGENTS.md`. La función es pura: recibe el SQL ya leído,
 * el acceso a disco vive en `rls-check.cli.ts`.
 */

/** Migración a analizar. */
export interface MigrationSource {
  /** Ruta relativa del fichero, sólo para el mensaje de error. */
  readonly file: string;
  readonly sql: string;
}

/** Requisito que le falta a una tabla. */
export type MissingRlsRequirement = 'ENABLE ROW LEVEL SECURITY' | 'CREATE POLICY';

/** Tabla creada por una migración sin la protección exigida. */
export interface RlsViolation {
  readonly table: string;
  readonly file: string;
  readonly missing: readonly MissingRlsRequirement[];
}

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi;
const ENABLE_RLS = /alter\s+table\s+(?:only\s+)?([\w".]+)\s+enable\s+row\s+level\s+security/gi;
const CREATE_POLICY = /create\s+policy\s+[\w".]+\s+on\s+(?:table\s+)?([\w".]+)/gi;
/** `-- rls-exempt: <tabla> — <motivo>`: exime a una tabla sin datos de tenant. */
const EXEMPT = /--\s*rls-exempt:\s*([\w".]+)/gi;

/** Deja el identificador en minúsculas y sin comillas ni esquema. */
function normalizeTable(identifier: string): string {
  const withoutQuotes = identifier.replaceAll('"', '');
  const lastSegment = withoutQuotes.split('.').at(-1) ?? withoutQuotes;
  return lastSegment.toLowerCase();
}

function collect(sql: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const match of sql.matchAll(pattern)) {
    const captured = match[1];
    if (captured !== undefined) found.add(normalizeTable(captured));
  }
  return found;
}

/**
 * Devuelve las tablas creadas sin RLS. Las políticas pueden llegar en una
 * migración posterior, así que la comprobación se hace sobre el conjunto.
 */
export function auditRlsPolicies(migrations: readonly MigrationSource[]): RlsViolation[] {
  const createdIn = new Map<string, string>();
  const rlsEnabled = new Set<string>();
  const withPolicy = new Set<string>();
  const exempt = new Set<string>();

  for (const { file, sql } of migrations) {
    for (const table of collect(sql, CREATE_TABLE)) {
      if (!createdIn.has(table)) createdIn.set(table, file);
    }
    for (const table of collect(sql, ENABLE_RLS)) rlsEnabled.add(table);
    for (const table of collect(sql, CREATE_POLICY)) withPolicy.add(table);
    for (const table of collect(sql, EXEMPT)) exempt.add(table);
  }

  const violations: RlsViolation[] = [];
  for (const [table, file] of createdIn) {
    if (exempt.has(table)) continue;
    const missing: MissingRlsRequirement[] = [];
    if (!rlsEnabled.has(table)) missing.push('ENABLE ROW LEVEL SECURITY');
    if (!withPolicy.has(table)) missing.push('CREATE POLICY');
    if (missing.length > 0) violations.push({ table, file, missing });
  }
  return violations.sort((a, b) => a.table.localeCompare(b.table));
}

/** Informe legible para la salida de CI. */
export function formatRlsViolations(violations: readonly RlsViolation[]): string {
  return violations
    .map(({ table, file, missing }) => `- ${table} (${file}): falta ${missing.join(' y ')}`)
    .join('\n');
}
