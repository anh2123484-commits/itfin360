/**
 * Matriz de roles de `docs/01-prd-y-alcance.md` §7, permiso a permiso.
 * `compensation:read_individual` no depende del rol: sólo de `canViewCompensation`.
 */
import { Role } from '@itfin360/db';
import { describe, expect, it } from 'vitest';

import { can, grantedPermissions, type Permission, PERMISSIONS } from './permissions';

const ROLES = Object.values(Role);

/** Fila = permiso; columna = rol en el orden de `ROLES`. */
const MATRIZ: Record<Permission, Record<Role, boolean>> = {
  'tenant:manage': {
    OWNER: true,
    FINANCE: false,
    IT_MANAGER: false,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'billing:manage': {
    OWNER: true,
    FINANCE: false,
    IT_MANAGER: false,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'members:invite': {
    OWNER: true,
    FINANCE: false,
    IT_MANAGER: false,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'finance:read': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'invoices:read': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'invoices:create': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: true,
    VIEWER: false,
  },
  'projects:read_all': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'projects:read_own': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: true,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  'time:log_own': {
    OWNER: true,
    FINANCE: false,
    IT_MANAGER: true,
    PROJECT_MANAGER: true,
    CONTRIBUTOR: true,
    VIEWER: false,
  },
  'dashboards:showback': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: true,
    CONTRIBUTOR: true,
    VIEWER: true,
  },
  'compensation:read_bands': {
    OWNER: true,
    FINANCE: true,
    IT_MANAGER: true,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
  // Ningún rol lo concede por sí mismo.
  'compensation:read_individual': {
    OWNER: false,
    FINANCE: false,
    IT_MANAGER: false,
    PROJECT_MANAGER: false,
    CONTRIBUTOR: false,
    VIEWER: false,
  },
};

describe('matriz de roles (docs/01 §7)', () => {
  it('cubre todos los permisos y todos los roles', () => {
    expect(Object.keys(MATRIZ).sort()).toEqual([...PERMISSIONS].sort());
    for (const permission of PERMISSIONS) {
      expect(Object.keys(MATRIZ[permission]).sort()).toEqual([...ROLES].sort());
    }
  });

  for (const role of ROLES) {
    describe(`rol ${role} sin canViewCompensation`, () => {
      for (const permission of PERMISSIONS) {
        it(`${permission} → ${MATRIZ[permission][role]}`, () => {
          expect(can({ role, canViewCompensation: false }, permission)).toBe(
            MATRIZ[permission][role],
          );
        });
      }
    });
  }

  it('OWNER es el único que gestiona tenant, facturación del SaaS e invitaciones', () => {
    for (const role of ROLES) {
      const esOwner = role === 'OWNER';
      expect(can({ role, canViewCompensation: false }, 'tenant:manage')).toBe(esOwner);
      expect(can({ role, canViewCompensation: false }, 'billing:manage')).toBe(esOwner);
      expect(can({ role, canViewCompensation: false }, 'members:invite')).toBe(esOwner);
    }
  });

  it('VIEWER sólo ve dashboards agregados', () => {
    expect(grantedPermissions({ role: 'VIEWER', canViewCompensation: false })).toEqual([
      'dashboards:showback',
    ]);
  });
});

describe('canViewCompensation es independiente del rol', () => {
  for (const role of ROLES) {
    it(`${role}: sin permiso no ve retribución individual aunque vea el resto del dato económico`, () => {
      expect(can({ role, canViewCompensation: false }, 'compensation:read_individual')).toBe(false);
    });
    it(`${role}: con permiso sí, y sin alterar el resto de sus permisos`, () => {
      const sin = grantedPermissions({ role, canViewCompensation: false });
      const con = grantedPermissions({ role, canViewCompensation: true });
      expect(con).toEqual([...sin, 'compensation:read_individual']);
    });
  }
});
