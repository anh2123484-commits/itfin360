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
 * con la conexión administrativa (`ADMIN_DATABASE_URL`), que es la única que
 * puede crear roles. Ninguno de los dos roles puede crear el otro.
 *
 * ## Por qué este SQL no usa lo que parecería obvio
 *
 * Este script se escribió contra un PostgreSQL local, donde el administrador es
 * superusuario, y se rompió tres veces al aplicarlo en una base gestionada,
 * donde no lo es. Las tres formas están arregladas aquí, y cada una lleva su
 * comentario, porque todas invitan a simplificarlas de vuelta:
 *
 * 1. No se escribe `NOSUPERUSER`. Tocar el atributo `SUPERUSER` de un rol, aunque
 *    sea para ponerlo a `NO`, exige ser superusuario. En una base gestionada eso
 *    devuelve `42501` y el script entero no llega a correr. Lo que garantiza que
 *    el rol de aplicación no es superusuario es la comprobación del final, que
 *    lee `pg_roles` y aborta si algo no cuadra. Comprobar es mejor que declarar:
 *    detecta también que alguien se lo haya concedido por fuera.
 *
 * 2. No se usa `ALTER DEFAULT PRIVILEGES FOR ROLE x`. Esa forma exige ser miembro
 *    de `x`, y el administrador de una base gestionada no lo es por defecto. En
 *    su lugar el script se concede el rol, hace `SET ROLE` y fija los privilegios
 *    por defecto desde dentro, que es la misma operación sin el requisito.
 *
 * 3. Ese `GRANT` va `WITH SET TRUE`, no `WITH ADMIN OPTION`. Con `ADMIN OPTION`
 *    PostgreSQL responde `0LP01: ADMIN option cannot be granted back to your own
 *    grantor` cuando el administrador es quien creó el rol. `SET TRUE` concede lo
 *    único que hace falta aquí, poder asumir el rol, sin la capacidad de
 *    repartirlo. Es sintaxis de PostgreSQL 16, la versión que fija el proyecto.
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
 * Comprobación final de atributos, en lugar de declararlos con `NOSUPERUSER`.
 *
 * Aborta si el rol de aplicación tiene cualquier atributo que le daría más de lo
 * que debe, o si el de migraciones ha perdido `BYPASSRLS` y por tanto no podría
 * migrar tablas con `FORCE ROW LEVEL SECURITY`. Falla ruidosa a propósito: un rol
 * de aplicación con `BYPASSRLS` deja el aislamiento entre tenants sin efecto, y
 * eso no puede quedarse en un aviso que nadie lee.
 */
function attributeCheck(appRole: string, migrationRole: string): string {
  const literalApp = quoteLiteral(appRole, `El nombre del rol ${appRole}`);
  const literalMigration = quoteLiteral(migrationRole, `El nombre del rol ${migrationRole}`);
  return [
    'DO $$',
    'DECLARE',
    '  atributos pg_roles%ROWTYPE;',
    'BEGIN',
    `  SELECT * INTO atributos FROM pg_roles WHERE rolname = ${literalApp};`,
    '  IF NOT FOUND THEN',
    `    RAISE EXCEPTION 'El rol de aplicación % no existe después de crearlo.', ${literalApp};`,
    '  END IF;',
    '  IF atributos.rolsuper OR atributos.rolbypassrls OR atributos.rolcreaterole',
    '     OR atributos.rolcreatedb THEN',
    "    RAISE EXCEPTION 'El rol de aplicación % no puede tener estos atributos " +
      '(superusuario %, bypassrls %, createrole %, createdb %): con cualquiera de ellos ' +
      "el aislamiento entre tenants deja de sostenerse.',",
    `      ${literalApp}, atributos.rolsuper, atributos.rolbypassrls, atributos.rolcreaterole,`,
    '      atributos.rolcreatedb;',
    '  END IF;',
    '',
    `  SELECT * INTO atributos FROM pg_roles WHERE rolname = ${literalMigration};`,
    '  IF NOT FOUND THEN',
    `    RAISE EXCEPTION 'El rol de migraciones % no existe después de crearlo.', ${literalMigration};`,
    '  END IF;',
    '  IF NOT atributos.rolbypassrls THEN',
    "    RAISE EXCEPTION 'El rol de migraciones % se ha quedado sin BYPASSRLS, así que no podrá " +
      `migrar tablas con FORCE ROW LEVEL SECURITY.', ${literalMigration};`,
    '  END IF;',
    'END $$;',
  ].join('\n');
}

/**
 * Únicas funciones que el rol de aplicación puede ejecutar. Son `SECURITY DEFINER`
 * (propiedad del rol de migraciones) y cada una está acotada a una operación concreta.
 */
export const APP_EXECUTABLE_FUNCTIONS: readonly string[] = [
  'provision_tenant(text, char(3), uuid)',
  'user_memberships(uuid)',
];

function grantExecuteIfExists(schema: string, signature: string, app: string): string {
  const qualified = `${schema}.${signature}`;
  const literal = quoteLiteral(qualified, 'La firma de función');
  return [
    'DO $$',
    'BEGIN',
    `  IF to_regprocedure(${literal}) IS NOT NULL THEN`,
    `    EXECUTE 'GRANT EXECUTE ON FUNCTION ${qualified.replaceAll("'", "''")} TO ${app.replaceAll("'", "''")}';`,
    '  ELSE',
    "    RAISE NOTICE 'La función % todavía no existe: su permiso queda sin dar. Vuelve a " +
      `ejecutar este script después de migrar.', ${literal};`,
    '  END IF;',
    'END $$;',
  ].join('\n');
}

/**
 * SQL completo de aprovisionamiento. Es idempotente: se puede volver a
 * ejecutar tras cada migración para reponer los permisos sobre tablas nuevas.
 *
 * Y hay que volver a ejecutarlo. Los `GRANT EXECUTE` de abajo sólo alcanzan a
 * funciones que ya existan, y las funciones las crean las migraciones. En un
 * entorno nuevo la primera pasada las salta, y hasta que no se ejecuta otra vez
 * después de migrar, el alta de empresa falla por un permiso que nunca se dio.
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
    '-- No se declara nada sobre el atributo de superusuario: se comprueba al final, leyendo',
    '-- pg_roles. Ver el comentario de cabecera del módulo.',
    upsertRole(migrationRole, spec.migrationPassword, 'NOCREATEDB NOCREATEROLE BYPASSRLS'),
    `GRANT USAGE, CREATE ON SCHEMA ${schema} TO ${migration};`,
    '',
    '-- Rol de aplicación: nunca BYPASSRLS, nunca DDL.',
    upsertRole(appRole, spec.appPassword, 'NOCREATEDB NOCREATEROLE NOBYPASSRLS'),
    `GRANT USAGE ON SCHEMA ${schema} TO ${app};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${app};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${app};`,
    '',
    '-- Funciones SECURITY DEFINER acotadas: sólo las listadas, y sólo si ya existen (se ejecuta',
    '-- este SQL antes y después de migrar). Ninguna otra función queda ejecutable por el rol app.',
    '-- Cuando una falta se avisa por NOTICE en vez de saltarla en silencio: ése era el aviso que',
    '-- faltó el día que el alta de empresa reventó por un permiso que nunca se llegó a dar.',
    ...APP_EXECUTABLE_FUNCTIONS.map((signature) => grantExecuteIfExists(schema, signature, app)),
    '',
    '-- Las tablas que cree el rol de migraciones quedan accesibles sin volver a pasar por aquí.',
    '-- Se hace asumiendo el rol. La variante que nombra al rol en la propia sentencia exige ser',
    '-- miembro de él y falla en una base gestionada. Ver el comentario de cabecera del módulo.',
    `GRANT ${migration} TO CURRENT_USER WITH SET TRUE;`,
    `SET ROLE ${migration};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}`,
    `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}`,
    `  GRANT USAGE, SELECT ON SEQUENCES TO ${app};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}`,
    '  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    'RESET ROLE;',
    '',
    '-- Para poder comprobar el aislamiento a mano contra la base real:',
    '--   SET ROLE <rol de aplicación>; SELECT count(*) FROM tenant;   -- tiene que dar 0',
    '-- Sin esto esa comprobación no se puede hacer en una base gestionada, y una política RLS que',
    '-- nadie puede verificar es una política en la que hay que creer. No concede nada nuevo: quien',
    '-- ejecuta este script ya administra la base.',
    `GRANT ${app} TO CURRENT_USER WITH SET TRUE;`,
    '',
    '-- Comprobación final: los atributos de los dos roles, leídos de pg_roles.',
    attributeCheck(appRole, migrationRole),
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
