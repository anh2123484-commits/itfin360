import { PrismaPg } from '@prisma/adapter-pg';

import { databaseUrl } from './env.js';
import { PrismaClient } from './generated/prisma/client.js';

/** Opciones de construcción del cliente. */
export interface PrismaClientOptions {
  /** Cadena de conexión; por defecto `DATABASE_URL` (rol de aplicación, sin `BYPASSRLS`). */
  readonly connectionString?: string;
}

/**
 * Crea un cliente Prisma sobre el adaptador de Postgres.
 *
 * **No usar directamente en código de aplicación**: la regla dura 4 de
 * `AGENTS.md` exige que toda consulta pase por `withTenant(tenantId, cb)`, que
 * llega en F0-05 y se construirá sobre esta función.
 */
export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString ?? databaseUrl() });
  return new PrismaClient({ adapter });
}

export { PrismaClient };
