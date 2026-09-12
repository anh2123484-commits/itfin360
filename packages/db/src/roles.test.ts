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
  });

  it('no da DDL al rol de aplicación', () => {
    const sql = databaseRolesSql(SPEC);
    expect(sql).toContain('GRANT USAGE ON SCHEMA "public" TO "itfin360_app";');
    expect(sql).toContain('GRANT USAGE, CREATE ON SCHEMA "public" TO "itfin360_migrator";');
    expect(sql).not.toContain('GRANT USAGE, CREATE ON SCHEMA "public" TO "itfin360_app";');
  });

  it('no toca el atributo SUPERUSER de nadie, ni para quitarlo', () => {
    // Tocarlo exige ser superusuario, y en una base gestionada el administrador
    // no lo es: el script entero se caía con 42501 antes de hacer nada. Lo que
    // sostiene la regla es la comprobación de `pg_roles`, no la declaración.
    expect(databaseRolesSql(SPEC)).not.toContain('SUPERUSER');
  });

  it('comprueba en pg_roles que el rol de aplicación no tiene atributos de más', () => {
    const sql = databaseRolesSql(SPEC);
    expect(sql).toContain('atributos pg_roles%ROWTYPE;');
    expect(sql).toContain(
      'IF atributos.rolsuper OR atributos.rolbypassrls OR atributos.rolcreaterole',
    );
    expect(sql).toContain('atributos.rolcreatedb THEN');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('comprueba que el rol de migraciones conserva BYPASSRLS', () => {
    // Sin BYPASSRLS una migración no puede tocar tablas con FORCE ROW LEVEL
    // SECURITY, y el fallo aparecería a mitad de un despliegue.
    expect(databaseRolesSql(SPEC)).toContain('IF NOT atributos.rolbypassrls THEN');
  });

  it('fija los privilegios por defecto asumiendo el rol, no con FOR ROLE', () => {
    const sql = databaseRolesSql(SPEC);
    // `ALTER DEFAULT PRIVILEGES FOR ROLE x` exige ser miembro de x, y el
    // administrador de una base gestionada no lo es.
    expect(sql).not.toContain('ALTER DEFAULT PRIVILEGES FOR ROLE');
    expect(sql).toContain('SET ROLE "itfin360_migrator";');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA "public"');
    expect(sql).toContain('RESET ROLE;');
  });

  it('el rol se concede con SET TRUE, nunca con ADMIN OPTION', () => {
    const sql = databaseRolesSql(SPEC);
    // Con ADMIN OPTION PostgreSQL devuelve 0LP01 cuando el administrador es
    // quien creó el rol. SET TRUE permite asumirlo sin poder repartirlo.
    expect(sql).toContain('GRANT "itfin360_migrator" TO CURRENT_USER WITH SET TRUE;');
    expect(sql).toContain('GRANT "itfin360_app" TO CURRENT_USER WITH SET TRUE;');
    expect(sql).not.toContain('WITH ADMIN OPTION');
  });

  it('deja el rol asumido cerrado antes de terminar', () => {
    // Si el script acabase con el rol de migraciones puesto, lo que viniera
    // después en esa conexión correría con BYPASSRLS.
    const sql = databaseRolesSql(SPEC);
    expect(sql.indexOf('SET ROLE "itfin360_migrator";')).toBeLessThan(sql.indexOf('RESET ROLE;'));
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

  it('avisa cuando una función todavía no existe en vez de saltarla en silencio', () => {
    // En un entorno nuevo el script corre antes de la primera migración y estos
    // permisos quedan sin dar. Sin aviso, el fallo aparece mucho después, en el
    // alta de empresa, y se ve como un error genérico del servidor.
    const sql = databaseRolesSql(SPEC);
    expect(sql).toContain('RAISE NOTICE');
    expect(sql).toContain('Vuelve a ejecutar este script después de migrar.');
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
