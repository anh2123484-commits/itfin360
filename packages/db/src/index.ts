/**
 * Acceso a datos de ITFin360: esquema Prisma, migraciones y cliente tipado.
 *
 * El código de aplicación consulta siempre a través de `withTenant(tenantId,
 * cb)`: el cliente crudo no sale de este paquete (regla dura 4 de `AGENTS.md`).
 * Por eso el índice expone `createTenantAwarePrismaClient` pero no
 * `createPrismaClient` ni `PrismaClient`, y la configuración ESLint compartida
 * prohíbe importarlos —y el cliente generado— fuera de `packages/db`.
 */

export type { PrismaClientOptions } from './client.js';
export { adminDatabaseUrl, databaseUrl, migrationDatabaseUrl } from './env.js';
export {
  currentTenantExpression,
  enableRowLevelSecuritySql,
  TENANT_SETTING,
  tenantIsolationMigrationSql,
  tenantIsolationPolicySql,
} from './rls-policy.js';
export { databaseRolesSql, databaseRolesSpecFromEnv, type DatabaseRolesSpec } from './roles.js';
export {
  assertTenantId,
  createTenantAwarePrismaClient,
  type TenantAwarePrismaClient,
  type TenantDb,
  withTenant,
  withTenantExtension,
} from './tenant-context.js';
export { Plan, Role } from './generated/prisma/enums.js';
export type {
  AuditLogModel as AuditLog,
  MembershipModel as Membership,
  TenantModel as Tenant,
  TenantParamVersionModel as TenantParamVersion,
  UserModel as User,
} from './generated/prisma/models.js';
export { Prisma } from './generated/prisma/client.js';

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const DB_PACKAGE = '@itfin360/db' as const;
