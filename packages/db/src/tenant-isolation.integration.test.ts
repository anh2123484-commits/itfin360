/**
 * Aceptación de F0-05: fuga cero entre tenants contra un Postgres real
 * (Testcontainers), con el mismo rol sin `BYPASSRLS` que usa la aplicación y
 * las migraciones aplicadas por el rol de migraciones.
 *
 * Recorre todos los modelos del esquema y comprueba, para cada uno, que desde
 * el contexto del tenant A ninguna consulta, agregado, `count` ni escritura
 * alcanza una fila de B; que fuera de contexto de tenant se ven 0 filas; y que
 * con `app.current_tenant` fijado a cadena vacía se ven 0 filas en lugar de
 * un error de sintaxis de uuid.
 *
 * Datos ficticios (regla dura 8 de AGENTS.md).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from './client.js';
import { Prisma } from './generated/prisma/client.js';
import { provisionTenant, userMemberships } from './identity.js';
import { databaseRolesSql } from './roles.js';
import { TENANT_SETTING } from './rls-policy.js';
import {
  createTenantAwarePrismaClient,
  type TenantAwarePrismaClient,
  type TenantDb,
} from './tenant-context.js';

const execFileAsync = promisify(execFile);

const ROLES = {
  appRole: 'itfin360_app',
  appPassword: 'app-de-prueba',
  migrationRole: 'itfin360_migrator',
  migrationPassword: 'migrator-de-prueba',
} as const;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** Ids fijos para poder pedir explícitamente una fila del otro tenant. */
const A = {
  user: 'aaaaaaa1-0000-4000-8000-000000000001',
  params: 'aaaaaaa2-0000-4000-8000-000000000001',
  membership: 'aaaaaaa3-0000-4000-8000-000000000001',
  auditLog: 'aaaaaaa4-0000-4000-8000-000000000001',
  invitation: 'aaaaaaa5-0000-4000-8000-000000000001',
} as const;
const B = {
  user: 'bbbbbbb1-0000-4000-8000-000000000001',
  params: 'bbbbbbb2-0000-4000-8000-000000000001',
  membership: 'bbbbbbb3-0000-4000-8000-000000000001',
  auditLog: 'bbbbbbb4-0000-4000-8000-000000000001',
  invitation: 'bbbbbbb5-0000-4000-8000-000000000001',
} as const;

/** B tiene el doble de filas y fechas posteriores: cualquier fuga cambia counts y máximos. */
const FECHA_A = new Date('2026-01-01T00:00:00.000Z');
const FECHA_B = new Date('2026-06-01T00:00:00.000Z');

let container: StartedPostgreSqlContainer;
let migrator: PrismaClient;
let app: TenantAwarePrismaClient;
/** Cliente de aplicación sin contexto de tenant: sirve para comprobar el caso "0 filas". */
let appSinContexto: PrismaClient;

function connectionString(role: string, password: string): string {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return `postgresql://${role}:${password}@${host}:${port}/${container.getDatabase()}?schema=public`;
}

async function seed(): Promise<void> {
  await migrator.user.createMany({
    data: [
      { id: A.user, email: 'ana@tenant-a.example', name: 'Ana Ficticia' },
      { id: B.user, email: 'bruno@tenant-b.example', name: 'Bruno Ficticio' },
    ],
  });
  await migrator.tenant.createMany({
    data: [
      { id: TENANT_A, name: 'Tenant A Ficticio', baseCurrency: 'EUR' },
      { id: TENANT_B, name: 'Tenant B Ficticio', baseCurrency: 'EUR' },
    ],
  });
  await migrator.tenantParamVersion.createMany({
    data: [
      { id: A.params, tenantId: TENANT_A, effectiveFrom: FECHA_A, params: { horasAnuales: 1720 } },
      { id: B.params, tenantId: TENANT_B, effectiveFrom: FECHA_B, params: { horasAnuales: 1600 } },
      {
        id: 'bbbbbbb2-0000-4000-8000-000000000002',
        tenantId: TENANT_B,
        effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        params: { horasAnuales: 1500 },
      },
    ],
  });
  await migrator.membership.createMany({
    data: [
      { id: A.membership, tenantId: TENANT_A, userId: A.user, role: 'OWNER' },
      { id: B.membership, tenantId: TENANT_B, userId: B.user, role: 'OWNER' },
      {
        id: 'bbbbbbb3-0000-4000-8000-000000000002',
        tenantId: TENANT_B,
        userId: A.user,
        role: 'VIEWER',
      },
    ],
  });
  await migrator.auditLog.createMany({
    data: [
      {
        id: A.auditLog,
        tenantId: TENANT_A,
        actorId: A.user,
        action: 'tenant.created',
        entity: 'tenant',
        entityId: TENANT_A,
        at: FECHA_A,
      },
      {
        id: B.auditLog,
        tenantId: TENANT_B,
        actorId: B.user,
        action: 'tenant.created',
        entity: 'tenant',
        entityId: TENANT_B,
        at: FECHA_B,
      },
      {
        id: 'bbbbbbb4-0000-4000-8000-000000000002',
        tenantId: TENANT_B,
        actorId: B.user,
        action: 'params.updated',
        entity: 'tenant_param_version',
        entityId: B.params,
        at: FECHA_B,
      },
    ],
  });
  await migrator.invitation.createMany({
    data: [
      {
        id: A.invitation,
        tenantId: TENANT_A,
        email: 'invitada-a@tenant-a.example',
        role: 'VIEWER',
        tokenHash: 'hash-a-1',
        expiresAt: FECHA_A,
        invitedById: A.user,
      },
      {
        id: B.invitation,
        tenantId: TENANT_B,
        email: 'invitado-b@tenant-b.example',
        role: 'FINANCE',
        canViewCompensation: true,
        tokenHash: 'hash-b-1',
        expiresAt: FECHA_B,
        invitedById: B.user,
      },
      {
        id: 'bbbbbbb5-0000-4000-8000-000000000002',
        tenantId: TENANT_B,
        email: 'invitado-b2@tenant-b.example',
        role: 'VIEWER',
        tokenHash: 'hash-b-2',
        expiresAt: FECHA_B,
      },
    ],
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // 1. El superusuario crea los dos roles, igual que `pnpm db:roles` en desarrollo.
  const superuser = createPrismaClient({ connectionString: container.getConnectionUri() });
  await superuser.$executeRawUnsafe(databaseRolesSql(ROLES));

  // 2. Las migraciones se aplican con el rol de migraciones (BYPASSRLS + DDL).
  const migrationUrl = connectionString(ROLES.migrationRole, ROLES.migrationPassword);
  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: migrationUrl, MIGRATION_DATABASE_URL: migrationUrl },
  });

  // 3. `pnpm db:roles` de nuevo (es idempotente): concede EXECUTE sólo sobre las funciones
  //    SECURITY DEFINER acotadas que acaba de crear la migración.
  await superuser.$executeRawUnsafe(databaseRolesSql(ROLES));
  await superuser.$disconnect();

  migrator = createPrismaClient({ connectionString: migrationUrl });
  await seed();

  const appUrl = connectionString(ROLES.appRole, ROLES.appPassword);
  app = createTenantAwarePrismaClient({ connectionString: appUrl });
  appSinContexto = createPrismaClient({ connectionString: appUrl });
}, 300_000);

afterAll(async () => {
  await migrator?.$disconnect();
  await app?.$disconnect();
  await appSinContexto?.$disconnect();
  await container?.stop();
});

/**
 * Un modelo del esquema con todo lo que hay que probar sobre él. Las funciones
 * se escriben a mano, sin metaprogramación, para que se vea qué se comprueba.
 */
interface SondaDeModelo {
  readonly modelo: string;
  /** Filas que el tenant A debe ver. */
  readonly filasDeA: number;
  /** Id de una fila que pertenece a B. */
  readonly idDeB: string;
  contar(db: TenantDb): Promise<number>;
  tenantIdsVisibles(db: TenantDb): Promise<string[]>;
  buscarPorId(db: TenantDb, id: string): Promise<unknown>;
  actualizarPorId(db: TenantDb, id: string): Promise<number>;
  borrarPorId(db: TenantDb, id: string): Promise<number>;
}

const SONDAS: readonly SondaDeModelo[] = [
  {
    modelo: 'tenant',
    filasDeA: 1,
    idDeB: TENANT_B,
    contar: (db) => db.tenant.count(),
    tenantIdsVisibles: async (db) => (await db.tenant.findMany()).map((row) => row.id),
    buscarPorId: (db, id) => db.tenant.findUnique({ where: { id } }),
    actualizarPorId: async (db, id) =>
      (await db.tenant.updateMany({ where: { id }, data: { name: 'Intruso' } })).count,
    borrarPorId: async (db, id) => (await db.tenant.deleteMany({ where: { id } })).count,
  },
  {
    modelo: 'tenantParamVersion',
    filasDeA: 1,
    idDeB: B.params,
    contar: (db) => db.tenantParamVersion.count(),
    tenantIdsVisibles: async (db) =>
      (await db.tenantParamVersion.findMany()).map((row) => row.tenantId),
    buscarPorId: (db, id) => db.tenantParamVersion.findUnique({ where: { id } }),
    actualizarPorId: async (db, id) =>
      (await db.tenantParamVersion.updateMany({ where: { id }, data: { params: {} } })).count,
    borrarPorId: async (db, id) =>
      (await db.tenantParamVersion.deleteMany({ where: { id } })).count,
  },
  {
    modelo: 'membership',
    filasDeA: 1,
    idDeB: B.membership,
    contar: (db) => db.membership.count(),
    tenantIdsVisibles: async (db) => (await db.membership.findMany()).map((row) => row.tenantId),
    buscarPorId: (db, id) => db.membership.findUnique({ where: { id } }),
    actualizarPorId: async (db, id) =>
      (await db.membership.updateMany({ where: { id }, data: { canViewCompensation: true } }))
        .count,
    borrarPorId: async (db, id) => (await db.membership.deleteMany({ where: { id } })).count,
  },
  {
    modelo: 'auditLog',
    filasDeA: 1,
    idDeB: B.auditLog,
    contar: (db) => db.auditLog.count(),
    tenantIdsVisibles: async (db) => (await db.auditLog.findMany()).map((row) => row.tenantId),
    buscarPorId: (db, id) => db.auditLog.findUnique({ where: { id } }),
    actualizarPorId: async (db, id) =>
      (await db.auditLog.updateMany({ where: { id }, data: { action: 'intruso' } })).count,
    borrarPorId: async (db, id) => (await db.auditLog.deleteMany({ where: { id } })).count,
  },
  {
    modelo: 'invitation',
    filasDeA: 1,
    idDeB: B.invitation,
    contar: (db) => db.invitation.count(),
    tenantIdsVisibles: async (db) => (await db.invitation.findMany()).map((row) => row.tenantId),
    buscarPorId: (db, id) => db.invitation.findUnique({ where: { id } }),
    actualizarPorId: async (db, id) =>
      (await db.invitation.updateMany({ where: { id }, data: { role: 'OWNER' } })).count,
    borrarPorId: async (db, id) => (await db.invitation.deleteMany({ where: { id } })).count,
  },
];

/** Ejecuta `fn` en el cliente de aplicación con `app.current_tenant` fijado a `valor`. */
function conVariableDeTenant<T>(valor: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  return appSinContexto.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${valor}, true)`;
    return fn(tx);
  });
}

describe('aislamiento entre tenants con RLS', () => {
  it('la aplicación se conecta con un rol sin BYPASSRLS ni superusuario', async () => {
    const roles = await appSinContexto.$queryRaw<
      { rolname: string; rolbypassrls: boolean; rolsuper: boolean }[]
    >(Prisma.sql`
      SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
    `);
    expect(roles).toEqual([{ rolname: ROLES.appRole, rolbypassrls: false, rolsuper: false }]);
  });

  it('toda tabla con datos de tenant tiene RLS forzada y su política contra NULLIF', async () => {
    const tablas = await migrator.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >(Prisma.sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('tenant', 'tenant_param_version', 'membership', 'audit_log', 'invitation')
      ORDER BY relname
    `);
    expect(tablas).toHaveLength(5);
    for (const tabla of tablas) {
      expect(tabla, tabla.relname).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    }

    const politicas = await migrator.$queryRaw<
      { tablename: string; policyname: string; qual: string; with_check: string }[]
    >(Prisma.sql`
      SELECT tablename, policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    expect(politicas).toHaveLength(5);
    for (const politica of politicas) {
      expect(politica.policyname, politica.tablename).toBe('tenant_isolation');
      expect(politica.qual, politica.tablename).toContain('NULLIF');
      expect(politica.with_check, politica.tablename).toContain('NULLIF');
    }
  });

  it('el rol de migraciones sí ve los dos tenants (control del test)', async () => {
    expect(await migrator.tenant.count()).toBe(2);
    expect(await migrator.auditLog.count()).toBe(3);
  });

  for (const sonda of SONDAS) {
    describe(`modelo ${sonda.modelo}`, () => {
      it('sólo ve filas de su tenant al listar y al contar', async () => {
        await app.withTenant(TENANT_A, async (db) => {
          expect(await sonda.contar(db)).toBe(sonda.filasDeA);
          expect(await sonda.tenantIdsVisibles(db)).toEqual([TENANT_A]);
        });
        await app.withTenant(TENANT_B, async (db) => {
          const tenantIds = await sonda.tenantIdsVisibles(db);
          expect(tenantIds.length).toBeGreaterThan(0);
          expect(new Set(tenantIds)).toEqual(new Set([TENANT_B]));
        });
      });

      it('no alcanza una fila del otro tenant ni pidiéndola por id', async () => {
        await app.withTenant(TENANT_A, async (db) => {
          expect(await sonda.buscarPorId(db, sonda.idDeB)).toBeNull();
          expect(await sonda.actualizarPorId(db, sonda.idDeB)).toBe(0);
          expect(await sonda.borrarPorId(db, sonda.idDeB)).toBe(0);
        });
        // La fila de B sigue intacta.
        expect(await sonda.buscarPorId(migrator, sonda.idDeB)).not.toBeNull();
      });

      it('devuelve 0 filas fuera de contexto de tenant', async () => {
        expect(await sonda.contar(appSinContexto)).toBe(0);
        expect(await sonda.tenantIdsVisibles(appSinContexto)).toEqual([]);
      });

      it('devuelve 0 filas, y no un error de uuid, con la variable a cadena vacía', async () => {
        await expect(
          conVariableDeTenant('', async (db) => ({
            contados: await sonda.contar(db),
            tenantIds: await sonda.tenantIdsVisibles(db),
          })),
        ).resolves.toEqual({ contados: 0, tenantIds: [] });
      });
    });
  }

  it('los agregados y los group by no cruzan tenants', async () => {
    const enA = await app.withTenant(TENANT_A, async (db) => ({
      params: await db.tenantParamVersion.aggregate({
        _count: { _all: true },
        _max: { effectiveFrom: true },
      }),
      audit: await db.auditLog.aggregate({ _count: { _all: true }, _max: { at: true } }),
      porTenant: await db.auditLog.groupBy({ by: ['tenantId'], _count: { _all: true } }),
      miembrosPorRol: await db.membership.groupBy({ by: ['role'], _count: { _all: true } }),
    }));

    expect(enA.params._count._all).toBe(1);
    expect(enA.params._max.effectiveFrom).toEqual(FECHA_A);
    expect(enA.audit._count._all).toBe(1);
    expect(enA.audit._max.at).toEqual(FECHA_A);
    expect(enA.porTenant).toEqual([{ tenantId: TENANT_A, _count: { _all: 1 } }]);
    expect(enA.miembrosPorRol).toEqual([{ role: 'OWNER', _count: { _all: 1 } }]);

    const enB = await app.withTenant(TENANT_B, (db) =>
      db.tenantParamVersion.aggregate({ _count: { _all: true }, _max: { effectiveFrom: true } }),
    );
    expect(enB._count._all).toBe(2);
    expect(enB._max.effectiveFrom).not.toEqual(FECHA_A);

    const fueraDeContexto = await appSinContexto.tenantParamVersion.aggregate({
      _count: { _all: true },
      _max: { effectiveFrom: true },
    });
    expect(fueraDeContexto._count._all).toBe(0);
    expect(fueraDeContexto._max.effectiveFrom).toBeNull();
  });

  it('las relaciones anidadas tampoco cruzan tenants', async () => {
    const visto = await app.withTenant(TENANT_A, (db) =>
      db.tenant.findMany({
        include: { memberships: { include: { user: true } }, auditLogs: true, paramVersions: true },
      }),
    );
    expect(visto).toHaveLength(1);
    const [tenant] = visto;
    expect(tenant?.memberships.map((m) => m.user.email)).toEqual(['ana@tenant-a.example']);
    expect(tenant?.auditLogs).toHaveLength(1);
    expect(tenant?.paramVersions).toHaveLength(1);
  });

  it('no se puede escribir una fila de otro tenant desde el contexto de A', async () => {
    await expect(
      app.withTenant(TENANT_A, (db) =>
        db.auditLog.create({
          data: {
            tenantId: TENANT_B,
            action: 'intruso',
            entity: 'tenant',
            entityId: TENANT_B,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('sí se puede escribir en el propio tenant, y la fila queda en él', async () => {
    const creado = await app.withTenant(TENANT_A, (db) =>
      db.auditLog.create({
        data: { tenantId: TENANT_A, action: 'params.viewed', entity: 'tenant', entityId: TENANT_A },
      }),
    );
    expect(creado.tenantId).toBe(TENANT_A);

    await app.withTenant(TENANT_B, async (db) => {
      expect(await db.auditLog.findUnique({ where: { id: creado.id } })).toBeNull();
    });

    await migrator.auditLog.delete({ where: { id: creado.id } });
  });

  it('la conexión devuelta al pool no arrastra el tenant anterior', async () => {
    await app.withTenant(TENANT_A, async (db) => {
      expect(await db.tenant.count()).toBe(1);
    });
    expect(await appSinContexto.tenant.count()).toBe(0);
    await app.withTenant(TENANT_B, async (db) => {
      expect((await db.tenant.findMany()).map((row) => row.id)).toEqual([TENANT_B]);
    });
    expect(await appSinContexto.tenant.count()).toBe(0);
  });

  it('withTenant rechaza un tenant que no es uuid antes de abrir la transacción', async () => {
    await expect(app.withTenant('', async () => undefined)).rejects.toThrow(/no es un uuid/);
  });

  it('la tabla user es global y no la protege RLS (identidad compartida entre tenants)', async () => {
    // Documentado como excepción `rls-exempt` en la migración de F0-04: un
    // usuario pertenece a varios tenants. Lo que no debe filtrarse es a qué
    // tenants pertenece, y eso lo cubre `membership`.
    expect(await appSinContexto.user.count()).toBe(2);
    await app.withTenant(TENANT_A, async (db) => {
      const miembros = await db.membership.findMany({ include: { user: true } });
      expect(miembros.map((m) => m.user.email)).toEqual(['ana@tenant-a.example']);
    });
  });
});

describe('alta de tenant con provision_tenant (issue #68)', () => {
  it('el rol de aplicación no puede insertar en tenant directamente: el WITH CHECK sigue intacto', async () => {
    await expect(
      appSinContexto.tenant.create({
        data: { name: 'Sin contexto', baseCurrency: 'EUR' },
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('crea tenant, membership OWNER y audit_log atómicamente y devuelve el id', async () => {
    const tenantId = await provisionTenant(appSinContexto, {
      name: '  Tenant Nuevo Ficticio  ',
      baseCurrency: 'EUR',
      ownerUserId: A.user,
    });

    await app.withTenant(tenantId, async (db) => {
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant).toMatchObject({
        name: 'Tenant Nuevo Ficticio',
        baseCurrency: 'EUR',
        plan: 'TRIAL',
      });

      const miembros = await db.membership.findMany();
      expect(miembros).toHaveLength(1);
      expect(miembros[0]).toMatchObject({
        tenantId,
        userId: A.user,
        role: 'OWNER',
        canViewCompensation: true,
      });

      const auditoria = await db.auditLog.findMany();
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        tenantId,
        actorId: A.user,
        action: 'tenant.created',
        entity: 'tenant',
        entityId: tenantId,
      });
    });

    // Fuera de la función, el contexto de la conexión vuelve a estar vacío.
    expect(await appSinContexto.tenant.count()).toBe(0);
    // Y desde otro tenant el nuevo sigue siendo invisible.
    await app.withTenant(TENANT_A, async (db) => {
      expect(await db.tenant.findUnique({ where: { id: tenantId } })).toBeNull();
    });
  });

  it('rechaza propietario inexistente, nombre vacío y moneda inválida sin crear nada', async () => {
    const antes = await migrator.tenant.count();
    await expect(
      provisionTenant(appSinContexto, {
        name: 'X',
        baseCurrency: 'EUR',
        ownerUserId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toThrow(/propietario no existe/);
    await expect(
      provisionTenant(appSinContexto, { name: '   ', baseCurrency: 'EUR', ownerUserId: A.user }),
    ).rejects.toThrow(/nombre de tenant/);
    await expect(
      provisionTenant(appSinContexto, { name: 'X', baseCurrency: 'eur', ownerUserId: A.user }),
    ).rejects.toThrow(/moneda base/);
    expect(await migrator.tenant.count()).toBe(antes);
  });

  it('la función está acotada: sólo el rol de migraciones es propietario y PUBLIC no la ejecuta', async () => {
    const funciones = await migrator.$queryRaw<
      { proname: string; owner: string; prosecdef: boolean; acl: string[] | null }[]
    >(Prisma.sql`
      SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proacl::text[] AS acl
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN ('provision_tenant', 'user_memberships')
      ORDER BY p.proname
    `);
    expect(funciones.map((f) => f.proname)).toEqual(['provision_tenant', 'user_memberships']);
    for (const f of funciones) {
      expect(f.owner, f.proname).toBe(ROLES.migrationRole);
      expect(f.prosecdef, f.proname).toBe(true);
      const acl = f.acl ?? [];
      expect(
        acl.some((entry) => entry.startsWith('=X/')),
        `${f.proname} PUBLIC`,
      ).toBe(false);
      expect(
        acl.some((entry) => entry.startsWith(`${ROLES.appRole}=X/`)),
        f.proname,
      ).toBe(true);
    }
  });

  it('user_memberships devuelve sólo las pertenencias del usuario pedido, sin contexto de tenant', async () => {
    const deA = await userMemberships(appSinContexto, A.user);
    expect(deA.map((m) => [m.tenantId, m.role, m.canViewCompensation])).toEqual(
      expect.arrayContaining([
        [TENANT_A, 'OWNER', false],
        [TENANT_B, 'VIEWER', false],
      ]),
    );
    expect(deA.find((m) => m.tenantId === TENANT_A)?.tenantName).toBe('Tenant A Ficticio');

    const deB = await userMemberships(appSinContexto, B.user);
    expect(deB.map((m) => m.tenantId)).toEqual([TENANT_B]);

    expect(await userMemberships(appSinContexto, '99999999-9999-4999-8999-999999999999')).toEqual(
      [],
    );
  });
});
