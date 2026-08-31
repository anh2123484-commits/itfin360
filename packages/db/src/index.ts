/**
 * Acceso a datos de ITFin360: esquema Prisma, migraciones y cliente tipado.
 *
 * El helper `withTenant` y el rol de aplicación sin `BYPASSRLS` llegan en
 * F0-05; aquí queda el esquema base de tenancy y el cliente generado.
 */

export { createPrismaClient, PrismaClient, type PrismaClientOptions } from './client.js';
export { databaseUrl, migrationDatabaseUrl } from './env.js';
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
