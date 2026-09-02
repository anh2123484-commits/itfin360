/**
 * Aceptación de F0-06: «un usuario sin permiso recibe 403 del servidor, no un
 * `hidden` en el cliente». Se ejecutan los route handlers reales con la sesión
 * y las pertenencias simuladas, y se comprueba el código HTTP de la respuesta.
 */
import type { UserMembership } from '@itfin360/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTRO_TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaa1-0000-4000-8000-000000000001';

const estado = {
  userId: null as string | null,
  memberships: [] as UserMembership[],
  cookieTenant: null as string | null,
  auditadas: [] as unknown[],
};

vi.mock('@/lib/auth', () => ({
  currentUserId: vi.fn(async () => estado.userId),
  auth: vi.fn(async () => (estado.userId ? { user: { id: estado.userId } } : null)),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({
    identity: {
      userMemberships: vi.fn(async (userId: string) =>
        userId === estado.userId ? estado.memberships : [],
      ),
    },
    withTenant: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        auditLog: {
          create: vi.fn(async (args: unknown) => {
            estado.auditadas.push(args);
            return {};
          }),
        },
        invitation: { create: vi.fn(async () => ({ id: 'inv-1' })) },
      }),
    ),
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'itfin360_tenant' && estado.cookieTenant
        ? { value: estado.cookieTenant }
        : undefined,
    set: vi.fn(),
  })),
}));

vi.mock('@/lib/env', () => ({ env: () => ({ APP_URL: 'http://localhost:3000' }) }));

const { GET: compensation } = await import('./compensation/route');
const { GET: me } = await import('./me/route');
const { POST: invitar } = await import('./invitations/route');
const { PUT: cambiarTenant } = await import('./tenants/active/route');

function membership(role: UserMembership['role'], canViewCompensation: boolean): UserMembership {
  return { tenantId: TENANT, tenantName: 'Tenant Ficticio', role, canViewCompensation };
}

function conSesion(m: UserMembership[], cookieTenant: string | null = TENANT): void {
  estado.userId = USER;
  estado.memberships = m;
  estado.cookieTenant = cookieTenant;
}

function json(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  estado.userId = null;
  estado.memberships = [];
  estado.cookieTenant = null;
  estado.auditadas = [];
});

describe('GET /api/compensation (retribución individual)', () => {
  it('sin sesión → 401', async () => {
    const res = await compensation();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('con sesión pero sin tenant activo → 403 no_active_tenant', async () => {
    conSesion([], null);
    const res = await compensation();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'no_active_tenant' });
  });

  for (const role of ['OWNER', 'FINANCE', 'IT_MANAGER'] as const) {
    it(`${role} sin canViewCompensation → 403 aunque el rol vea el resto del dato económico`, async () => {
      conSesion([membership(role, false)]);
      const res = await compensation();
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
      expect(estado.auditadas).toEqual([]);
    });
  }

  for (const role of ['PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER'] as const) {
    it(`${role} sin canViewCompensation → 403`, async () => {
      conSesion([membership(role, false)]);
      expect((await compensation()).status).toBe(403);
    });
  }

  it('con canViewCompensation → 200 y queda auditado el acceso', async () => {
    conSesion([membership('IT_MANAGER', true)]);
    const res = await compensation();
    expect(res.status).toBe(200);
    expect(estado.auditadas).toHaveLength(1);
    expect(estado.auditadas[0]).toMatchObject({
      data: { tenantId: TENANT, actorId: USER, action: 'compensation.viewed' },
    });
  });

  it('el permiso se evalúa sobre la membership del tenant activo, no sobre otra', async () => {
    conSesion(
      [
        membership('VIEWER', false),
        { tenantId: OTRO_TENANT, tenantName: 'Otro', role: 'OWNER', canViewCompensation: true },
      ],
      TENANT,
    );
    expect((await compensation()).status).toBe(403);
  });
});

describe('POST /api/invitations (members:invite)', () => {
  const cuerpo = { email: 'nueva@empresa.example', role: 'VIEWER', canViewCompensation: false };

  for (const role of [
    'FINANCE',
    'IT_MANAGER',
    'PROJECT_MANAGER',
    'CONTRIBUTOR',
    'VIEWER',
  ] as const) {
    it(`${role} → 403`, async () => {
      conSesion([membership(role, true)]);
      const res = await invitar(json(cuerpo));
      expect(res.status).toBe(403);
    });
  }

  it('OWNER → 201 con el enlace, sin devolver el email', async () => {
    conSesion([membership('OWNER', false)]);
    const res = await invitar(json(cuerpo));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string; invitationId: string };
    expect(body.invitationId).toBe('inv-1');
    expect(body.url).toMatch(
      new RegExp(`^http://localhost:3000/invitaciones/${TENANT}/[A-Za-z0-9_-]{43}$`),
    );
    expect(JSON.stringify(body)).not.toContain('nueva@empresa.example');
  });

  it('OWNER con cuerpo inválido → 400 sin eco del valor', async () => {
    conSesion([membership('OWNER', false)]);
    const res = await invitar(json({ email: 'no-es-un-email', role: 'VIEWER' }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('invalid_input');
    expect(text).not.toContain('no-es-un-email');
  });
});

describe('GET /api/me y PUT /api/tenants/active', () => {
  it('devuelve el principal con los permisos efectivos', async () => {
    conSesion([membership('FINANCE', false)]);
    const res = await me();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      userId: USER,
      tenantId: TENANT,
      role: 'FINANCE',
      canViewCompensation: false,
      permissions: expect.not.arrayContaining(['compensation:read_individual']),
    });
  });

  it('con un solo tenant y sin cookie, ese es el activo', async () => {
    conSesion([membership('VIEWER', false)], null);
    expect((await me()).status).toBe(200);
  });

  it('la cookie no basta: si no hay membership en ese tenant, no hay tenant activo', async () => {
    conSesion(
      [membership('OWNER', true), { ...membership('VIEWER', false), tenantId: OTRO_TENANT }],
      '33333333-3333-4333-8333-333333333333',
    );
    const res = await me();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'no_active_tenant' });
  });

  it('cambiar a un tenant del que no se es miembro → 403 not_a_member', async () => {
    conSesion([membership('OWNER', true)]);
    const res = await cambiarTenant(json({ tenantId: OTRO_TENANT }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'not_a_member' });
  });

  it('cambiar a un tenant propio → 200', async () => {
    conSesion([
      membership('OWNER', true),
      { ...membership('VIEWER', false), tenantId: OTRO_TENANT },
    ]);
    const res = await cambiarTenant(json({ tenantId: OTRO_TENANT }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      active: { tenantId: OTRO_TENANT, role: 'VIEWER' },
    });
  });
});
