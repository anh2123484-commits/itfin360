/**
 * Aprovisiona los roles de aplicación y de migraciones (`pnpm db:roles`).
 *
 * Necesita la conexión administrativa (`ADMIN_DATABASE_URL`): crear roles no
 * está, a propósito, al alcance de ninguno de los dos roles que crea. En
 * desarrollo es el usuario del contenedor de Postgres, que sí es superusuario;
 * en una base gestionada es el usuario administrador del proyecto, que no lo es.
 * El SQL está escrito para funcionar en los dos casos: ver `roles.ts`.
 *
 * Se ejecuta **dos veces** en una instalación nueva: antes de migrar, para que
 * exista el rol con el que migrar, y otra vez después, porque los permisos sobre
 * las funciones sólo se pueden dar cuando las funciones existen. La segunda
 * pasada no es opcional: sin ella el alta de empresa falla.
 */
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { adminDatabaseUrl } from './env.js';
import { databaseRolesSql, databaseRolesSpecFromEnv } from './roles.js';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const client = new Client({ connectionString: adminDatabaseUrl() });
const spec = databaseRolesSpecFromEnv();

// Los avisos del servidor se imprimen. El SQL usa RAISE NOTICE para decir qué
// permisos no ha podido dar todavía, y sin esto `pg` se los traga: el script
// terminaría diciendo «roles listos» mientras deja media configuración sin
// aplicar, que es exactamente como se perdió una tarde en el primer despliegue.
client.on('notice', (aviso) => {
  console.warn(`Aviso de la base de datos: ${aviso.message ?? String(aviso)}`);
});

await client.connect();
try {
  await client.query(databaseRolesSql(spec));
  console.log(
    `Roles listos: ${spec.appRole} (sin BYPASSRLS, usa DATABASE_URL) y ` +
      `${spec.migrationRole} (BYPASSRLS, usa MIGRATION_DATABASE_URL).`,
  );
  console.log(
    'Si arriba hay avisos de funciones que no existían, vuelve a ejecutar esto ' +
      'después de `pnpm db:migrate:deploy`.',
  );
} finally {
  await client.end();
}
