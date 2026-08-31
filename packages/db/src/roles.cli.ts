/**
 * Aprovisiona los roles de aplicación y de migraciones (`pnpm db:roles`).
 *
 * Necesita una conexión de superusuario (`ADMIN_DATABASE_URL`): crear roles no
 * está —a propósito— al alcance de ninguno de los dos roles que crea. En
 * desarrollo es el usuario del contenedor de Postgres; en producción lo ejecuta
 * quien administra la base, una sola vez.
 */
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { adminDatabaseUrl } from './env.js';
import { databaseRolesSql, databaseRolesSpecFromEnv } from './roles.js';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const client = new Client({ connectionString: adminDatabaseUrl() });
const spec = databaseRolesSpecFromEnv();

await client.connect();
try {
  await client.query(databaseRolesSql(spec));
  console.log(
    `Roles listos: ${spec.appRole} (sin BYPASSRLS, usa DATABASE_URL) y ` +
      `${spec.migrationRole} (BYPASSRLS, usa MIGRATION_DATABASE_URL).`,
  );
} finally {
  await client.end();
}
