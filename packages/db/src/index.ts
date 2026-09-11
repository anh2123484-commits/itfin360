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
  FOREIGN_KEY_CONSTRAINT,
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueConstraintViolation,
  prismaErrorCode,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT,
  uniqueConstraintFields,
} from './errors.js';
export {
  availableActions,
  canEditInvoice,
  INVOICE_ROLES,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  type InvoiceAction,
  type InvoiceAuditEntry,
  type InvoiceForTransition,
  type InvoiceRole,
  type RefusalKind,
  requestTransition,
  TERMINAL_STATUSES,
  type TransitionAccepted,
  type TransitionOutcome,
  type TransitionRefusal,
  type TransitionRejected,
  type TransitionRequest,
  type TransitionRule,
} from './invoice-workflow.js';
export {
  assertTenantId,
  createTenantAwarePrismaClient,
  type TenantAwarePrismaClient,
  type TenantDb,
  withTenant,
  withTenantExtension,
} from './tenant-context.js';
export {
  CostType,
  Criticality,
  InvoiceSource,
  InvoiceStatus,
  Plan,
  Role,
  SpendConcept,
} from './generated/prisma/enums.js';
export type {
  AuditLogModel as AuditLog,
  InvitationModel as Invitation,
  InvoiceLineModel as InvoiceLine,
  InvoiceModel as Invoice,
  MembershipModel as Membership,
  TenantModel as Tenant,
  TenantParamVersionModel as TenantParamVersion,
  UserModel as User,
  VendorModel as Vendor,
} from './generated/prisma/models.js';
export { Prisma } from './generated/prisma/client.js';

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const DB_PACKAGE = '@itfin360/db' as const;
