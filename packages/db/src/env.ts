/**
 * Cadenas de conexión del paquete de datos.
 *
 * Se separan dos roles, como exige `docs/03-arquitectura-y-datos.md`:
 * la aplicación usa `DATABASE_URL` (rol sin `BYPASSRLS`) y las migraciones
 * `MIGRATION_DATABASE_URL`. En desarrollo ambas apuntan al mismo Postgres.
 */

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Falta la variable de entorno ${name}. Declárala en .env (ver .env.example).`);
  }
  return value;
}

/** Conexión de la aplicación. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return required('DATABASE_URL', env.DATABASE_URL);
}

/** Conexión de las migraciones; cae a `DATABASE_URL` si no está definida. */
export function migrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.MIGRATION_DATABASE_URL?.trim() ? env.MIGRATION_DATABASE_URL : databaseUrl(env);
}

/**
 * Conexión de superusuario, usada sólo para crear los dos roles (`pnpm
 * db:roles`). No cae a `DATABASE_URL`: el rol de aplicación no puede crear
 * roles y confundirlos escondería el error.
 */
export function adminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return required('ADMIN_DATABASE_URL', env.ADMIN_DATABASE_URL);
}
