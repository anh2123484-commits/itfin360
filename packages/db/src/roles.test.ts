import { describe, expect, it } from 'vitest';

import {
  APP_EXECUTABLE_FUNCTIONS,
  databaseRolesSql,
  databaseRolesSpecFromEnv,
  type DatabaseRolesSpec,
} from './roles.js';

const SPEC: DatabaseRolesSpec = {
  appRole: 'itfin360_app',
  appPassword: 'contraseña-de-desarrollo',
  migrationRole: 'itfin360_migrator',
  migrationPassword: 'otra-contraseña-de-desarrollo',
};

describe('roles de base de datos', () => {
  it('crea el rol de aplicación sin BYPASSRLS y el de migraciones con BYPASSRLS', () => {
    const sql = databaseRolesSql(SPEC);
    expect(sql).toContain('ALTER ROLE "itfin360_app" WITH LOGIN PASSWORD');
    expect(sql).toMatch(/ALTER ROLE "itfin360_app" WITH LOGIN PASSWORD .* NOBYPASSRLS;/);
    expect(sql).toMatch(/ALTER ROLE "itfin360_migrator" WITH LOGIN PASSWORD .* BYPASSRLS;/);
    expect(sql).not.toMatch(/ALTER ROLE "itfin360_app".* SUPERUSER/);
  });

  it('no da DDL al rol de aplicación', () => {
    const sql = databaseRolesSql(SPEC);
    expect(sql).toContain('GRANT USAGE ON SCHEMA "public" TO "itfin360_app";');
    expect(sql).toContain('GRANT USAGE, CREATE ON SCHEMA "public" TO "itfin360_migrator";');
    expect(sql).not.toContain('GRANT USAGE, CREATE ON SCHEMA "public" TO "itfin360_app";');
  });

  it('deja las tablas futuras del rol de migraciones accesibles a la aplicación', () => {
    expect(databaseRolesSql(SPEC)).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "itfin360_migrator" IN SCHEMA "public"',
    );
  });

  it('sólo concede EXECUTE sobre las funciones SECURITY DEFINER acotadas, y nunca por defecto', () => {
    const sql = databaseRolesSql(SPEC);
    expect(sql).not.toContain('ON ALL FUNCTIONS');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;');
    for (const signature of APP_EXECUTABLE_FUNCTIONS) {
      expect(sql).toContain(`to_regprocedure('"public".${signature}')`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION "public".${signature} TO "itfin360_app"`);
    }
    expect(APP_EXECUTABLE_FUNCTIONS).toEqual([
      'provision_tenant(text, char(3), uuid)',
      'user_memberships(uuid)',
    ]);
  });

  it('rechaza usar el mismo rol para las dos cosas', () => {
    expect(() => databaseRolesSql({ ...SPEC, migrationRole: SPEC.appRole })).toThrow(/BYPASSRLS/);
  });

  it('escapa las comillas de la contraseña y rechaza nombres de rol no válidos', () => {
    expect(databaseRolesSql({ ...SPEC, appPassword: "a'b" })).toContain("PASSWORD 'a''b'");
    expect(() => databaseRolesSql({ ...SPEC, appRole: 'app"; DROP TABLE tenant; --' })).toThrow(
      /no válido/,
    );
    expect(() => databaseRolesSql({ ...SPEC, appPassword: '' })).toThrow(/vacía/);
  });

  it('exige las cuatro variables de entorno', () => {
    expect(() => databaseRolesSpecFromEnv({})).toThrow(/APP_DB_ROLE/);
    expect(
      databaseRolesSpecFromEnv({
        APP_DB_ROLE: SPEC.appRole,
        APP_DB_PASSWORD: SPEC.appPassword,
        MIGRATION_DB_ROLE: SPEC.migrationRole,
        MIGRATION_DB_PASSWORD: SPEC.migrationPassword,
      }),
    ).toEqual(SPEC);
  });
});
