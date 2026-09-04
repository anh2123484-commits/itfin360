import { createTenantAwarePrismaClient, type TenantAwarePrismaClient } from '@itfin360/db';

/**
 * Cliente de datos de la aplicación (rol sin `BYPASSRLS`). Sólo expone
 * `withTenant` y `identity`; el cliente Prisma crudo no sale de `@itfin360/db`.
 * Singleton por proceso para no agotar conexiones con el hot reload.
 */
const globalForDb = globalThis as typeof globalThis & { __itfin360Db?: TenantAwarePrismaClient };

export function db(): TenantAwarePrismaClient {
  globalForDb.__itfin360Db ??= createTenantAwarePrismaClient();
  return globalForDb.__itfin360Db;
}
