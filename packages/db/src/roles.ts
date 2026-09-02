/**
 * Roles de base de datos (F0-05).
 *
 * Dos roles, como exige `docs/03-arquitectura-y-datos.md`:
 *
 * - **aplicación** (`DATABASE_URL`): sin `BYPASSRLS`, sin DDL. Sólo
 *   `SELECT/INSERT/UPDATE/DELETE`, siempre sujeto a las políticas RLS.
 * - **migraciones** (`MIGRATION_DATABASE_URL`): con `BYPASSRLS` y permisos de
 *   DDL, porque una migración tiene que poder tocar filas de todos los tenants
 *   y las tablas llevan `FORCE ROW LEVEL SECURITY`.
 *
 * El SQL se genera aquí (función pura, con test) y lo aplica `roles.cli.ts`
 * con una conexión de superusuario (`ADMIN_DATABASE_URL`), que es la única que
 * puede crear roles. Ninguno de los dos roles puede crear el otro.
 */

import { quoteSqlIdentifier } from './rls-policy.js';

/** Roles a aprovisionar. */
export interface DatabaseRolesSpec {
  readonly appRole: string;
  readonly appPassword: string;
  readonly migrationRole: string;
  readonly migrationPassword: string;
  /** Esquema donde viven las tablas; `public` en desarrollo. */
  readonly schema?: string;
}

function quoteLiteral(value: string, name: string): string {
  if (value === '') throw new Error(`${name} no puede estar vacía.`);
  return `'${value.replaceAll("'", "''")}'`;
}

/** `CREATE ROLE` idempotente: crea el rol si falta y deja sus atributos fijados. */
function upsertRole(role: string, password: string, attributes: string): string {
  const quoted = quoteSqlIdentifier(role);
  const literalRole = quoteLiteral(role, `El nombre del rol ${role}`);
  const literalPassword = quoteLiteral(password, `La contraseña del rol ${role}`);
  return [
    'DO $$',
    'BEGIN',
    `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literalRole}) THEN`,
    `    CREATE ROLE ${quoted} LOGIN;`,
    '  END IF;',
    'END $$;',
    `ALTER ROLE ${quoted} WITH LOGIN PASSWORD ${literalPassword} ${attributes};`,
  ].join('\n');
}

/**
 * SQL completo de aprovisionamiento. Es idempotente: se puede volver a
 * ejecutar tras cada migración para reponer los permisos sobre tablas nuevas.
 */
export function databaseRolesSql(spec: DatabaseRolesSpec): string {
  const { appRole, migrationRole } = spec;
  if (appRole === migrationRole) {
    throw new Error(
      'El rol de aplicación y el de migraciones no pueden ser el mismo: uno tiene BYPASSRLS.',
    );
  }
  const app = quoteSqlIdentifier(appRole);
  const migration = quoteSqlIdentifier(migrationRole);
  const schema = quoteSqlIdentifier(spec.schema ?? 'public');

  return [
    '-- Rol de migraciones: DDL y BYPASSRLS (las tablas llevan FORCE ROW LEVEL SECURITY).',
    upsertRole(
      migrationRole,
      spec.migrationPassword,
      'NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS',
    ),
    `GRANT USAGE, CREATE ON SCHEMA ${schema} TO ${migration};`,
    '',
    '-- Rol de aplicación: nunca BYPASSRLS, nunca DDL.',
    upsertRole(appRole, spec.appPassword, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'),
    `GRANT USAGE ON SCHEMA ${schema} TO ${app};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${app};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${app};`,
    '',
    '-- Las tablas que cree el rol de migraciones quedan accesibles sin volver a pasar por aquí.',
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema}`,
    `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema}`,
    `  GRANT USAGE, SELECT ON SEQUENCES TO ${app};`,
    '',
  ].join('\n');
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Falta la variable de entorno ${name}. Declárala en .env (ver .env.example).`);
  }
  return value;
}

/** Lee los roles del entorno. */
export function databaseRolesSpecFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseRolesSpec {
  return {
    appRole: required('APP_DB_ROLE', env.APP_DB_ROLE),
    appPassword: required('APP_DB_PASSWORD', env.APP_DB_PASSWORD),
    migrationRole: required('MIGRATION_DB_ROLE', env.MIGRATION_DB_ROLE),
    migrationPassword: required('MIGRATION_DB_PASSWORD', env.MIGRATION_DB_PASSWORD),
  };
}
