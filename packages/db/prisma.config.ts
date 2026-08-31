import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

import { migrationDatabaseUrl } from './src/env.js';

// Las migraciones se lanzan desde el paquete, pero el `.env` vive en la raíz del monorepo.
loadEnv({ path: ['.env', '../../.env'], quiet: true });

// Valor de `.env.example`: permite `prisma generate` (y por tanto `pnpm build`)
// en un clon limpio sin `.env`. Cualquier comando que toque la base fallará al
// conectar, que es el aviso correcto.
const DEV_FALLBACK_URL = 'postgresql://itfin360:itfin360@localhost:5432/itfin360?schema=public';

function datasourceUrl(): string {
  return migrationDatabaseUrl({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL?.trim() ? process.env.DATABASE_URL : DEV_FALLBACK_URL,
  });
}

/**
 * Configuración de la CLI de Prisma. Las migraciones usan
 * `MIGRATION_DATABASE_URL` (rol con permisos de DDL, distinto del rol de la
 * aplicación en producción) y caen a `DATABASE_URL` si no está definida.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: datasourceUrl(),
  },
});
