/**
 * Acceso a datos de ITFin360: esquema Prisma, migraciones y cliente tipado.
 *
 * El código de aplicación consulta siempre a través de `withTenant(tenantId,
 * cb)`: el cliente crudo no sale de este paquete (regla dura 4 de `AGENTS.md`).
 */

export { createPrismaClient, PrismaClient, type PrismaClientOptions } from './client.js';
export { adminDatabaseUrl, databaseUrl, migrationDatabaseUrl } from './env.js';
export {
  currentTenantExpression,
  enableRowLevelSecuritySql,
  TENANT_SETTING,
  tenantIsolationMigrationSql,
  tenantIsolationPolicySql,
} from './rls-policy.js';
export {
  type IdentityOperations,
  type IdentityUser,
  identityOperations,
  type ProvisionTenantInput,
  provisionTenant,
  type UserMembership,
  userMemberships,
  type VerificationTokenRecord,
} from './identity.js';
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
  InvitationModel as Invitation,
  MembershipModel as Membership,
  TenantModel as Tenant,
  TenantParamVersionModel as TenantParamVersion,
  UserModel as User,
} from './generated/prisma/models.js';
export { Prisma } from './generated/prisma/client.js';

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const DB_PACKAGE = '@itfin360/db' as const;
