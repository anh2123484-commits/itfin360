/**
 * Contexto de tenant (F0-05): toda consulta de la aplicación pasa por
 * `withTenant(tenantId, cb)`, que abre una transacción y fija
 * `app.current_tenant` con alcance local a esa transacción. Las políticas RLS
 * de las migraciones comparan cada fila contra esa variable, así que el
 * aislamiento no depende de que el código se acuerde de filtrar por
 * `tenantId` (regla dura 4 de `AGENTS.md`).
 */

import { createPrismaClient, type PrismaClient, type PrismaClientOptions } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import { identityOperations } from './identity.js';
import { TENANT_SETTING } from './rls-policy.js';

/** Cliente disponible dentro de `withTenant`: el de la transacción, ya con el tenant fijado. */
export type TenantDb = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida el identificador antes de fijarlo. Un valor no `uuid` (vacío incluido)
 * es un error del programa, no una consulta sin resultados: fallar aquí evita
 * abrir una transacción cuyo contexto nunca habría dejado ver nada.
 */
export function assertTenantId(tenantId: string): string {
  if (!UUID.test(tenantId)) {
    throw new Error(`tenantId no es un uuid: ${JSON.stringify(tenantId)}`);
  }
  return tenantId;
}

/**
 * Ejecuta `fn` dentro de una transacción con `app.current_tenant = tenantId`.
 *
 * `set_config(..., true)` es el equivalente parametrizable de `SET LOCAL`: el
 * valor sólo vive hasta el final de la transacción, de modo que una conexión
 * devuelta al pool nunca arrastra el tenant de la petición anterior.
 */
export async function withTenant<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  const id = assertTenantId(tenantId);
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${id}, true)`;
    return fn(tx);
  });
}

/**
 * Extensión de cliente que expone `withTenant` en el propio cliente, más la
 * superficie global de identidad (`identity`: usuario, magic link, alta de
 * tenant y pertenencias), que por definición ocurre antes de tener tenant.
 * Es la única puerta de entrada que debe usar el código de aplicación; el
 * cliente crudo se queda en este paquete.
 */
export function withTenantExtension(client: PrismaClient) {
  return client.$extends({
    name: 'tenantContext',
    client: {
      withTenant: <T>(tenantId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> =>
        withTenant(client, tenantId, fn),
      identity: identityOperations(client),
    },
  });
}

/** Cliente Prisma con `withTenant`. */
export type TenantAwarePrismaClient = ReturnType<typeof withTenantExtension>;

/**
 * Cliente de la aplicación: se conecta con `DATABASE_URL` (rol sin
 * `BYPASSRLS`) y sólo permite consultar a través de `withTenant`.
 */
export function createTenantAwarePrismaClient(
  options: PrismaClientOptions = {},
): TenantAwarePrismaClient {
  return withTenantExtension(createPrismaClient(options));
}
