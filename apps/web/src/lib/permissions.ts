import type { Role } from '@itfin360/db';

/**
 * Permisos de la aplicación, derivados de la matriz de roles de
 * `docs/01-prd-y-alcance.md` §7. Se comprueban siempre en el servidor con
 * `can()`; el cliente sólo los usa para no pintar lo que va a fallar.
 *
 * `compensation:read_individual` es la excepción deliberada: no lo concede
 * ningún rol, sólo el permiso `canViewCompensation` de la membership
 * (docs/01: «La visibilidad salarial es un permiso separado del rol»).
 */
export type Permission =
  | 'tenant:manage'
  | 'billing:manage'
  | 'members:invite'
  | 'finance:read'
  | 'invoices:read'
  | 'invoices:create'
  | 'projects:read_all'
  | 'projects:read_own'
  | 'time:log_own'
  | 'dashboards:showback'
  | 'compensation:read_bands'
  | 'compensation:read_individual';

export const PERMISSIONS: readonly Permission[] = [
  'tenant:manage',
  'billing:manage',
  'members:invite',
  'finance:read',
  'invoices:read',
  'invoices:create',
  'projects:read_all',
  'projects:read_own',
  'time:log_own',
  'dashboards:showback',
  'compensation:read_bands',
  'compensation:read_individual',
];

/** Permisos que otorga cada rol por sí mismo. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set<Permission>([
    'tenant:manage',
    'billing:manage',
    'members:invite',
    'finance:read',
    'invoices:read',
    'invoices:create',
    'projects:read_all',
    'projects:read_own',
    'time:log_own',
    'dashboards:showback',
    'compensation:read_bands',
  ]),
  FINANCE: new Set<Permission>([
    'finance:read',
    'invoices:read',
    'invoices:create',
    'projects:read_all',
    'projects:read_own',
    'dashboards:showback',
    'compensation:read_bands',
  ]),
  IT_MANAGER: new Set<Permission>([
    'finance:read',
    'invoices:read',
    'invoices:create',
    'projects:read_all',
    'projects:read_own',
    'time:log_own',
    'dashboards:showback',
    'compensation:read_bands',
  ]),
  PROJECT_MANAGER: new Set<Permission>([
    'projects:read_own',
    'time:log_own',
    'dashboards:showback',
  ]),
  CONTRIBUTOR: new Set<Permission>(['invoices:create', 'time:log_own', 'dashboards:showback']),
  VIEWER: new Set<Permission>(['dashboards:showback']),
};

/** Lo que el servidor sabe del usuario en el tenant activo. */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly canViewCompensation: boolean;
}

/** Comprobación de permiso. Pura: sin I/O, sin excepciones. */
export function can(
  principal: Pick<Principal, 'role' | 'canViewCompensation'>,
  permission: Permission,
): boolean {
  if (permission === 'compensation:read_individual') return principal.canViewCompensation;
  return ROLE_PERMISSIONS[principal.role].has(permission);
}

/** Permisos efectivos del principal, para enviarlos al cliente. */
export function grantedPermissions(
  principal: Pick<Principal, 'role' | 'canViewCompensation'>,
): Permission[] {
  return PERMISSIONS.filter((permission) => can(principal, permission));
}
