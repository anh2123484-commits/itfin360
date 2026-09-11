/**
 * Aceptación de F2-02 en el servidor: «las transiciones inválidas se rechazan
 * en servidor; toda transición queda auditada; sólo FINANCE/OWNER aprueban».
 *
 * Se ejecuta el route handler real con la sesión, las pertenencias y la base
 * simuladas, y se comprueba el código HTTP y lo que se ha escrito. No hace
 * falta Postgres: lo que se está probando es que la ruta consulta la máquina de
 * estados y escribe el apunte, no que la base guarde la fila.
 */
import { INVOICE_TRANSITIONS, type UserMembership } from '@itfin360/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLE_PERMISSIONS } from '@/lib/permissions';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaa1-0000-4000-8000-000000000001';
const OTRO_USER = 'aaaaaaa1-0000-4000-8000-000000000002';
const FACTURA = 'aaaaaaa7-0000-4000-8000-000000000001';
const ORIGINAL = 'aaaaaaa7-0000-4000-8000-000000000002';

interface FacturaSimulada {
  readonly id: string;
  readonly status: string;
  readonly createdById: string | null;
}

const estado = {
  userId: null as string | null,
  memberships: [] as UserMembership[],
  factura: null as FacturaSimulada | null,
  actualizadas: [] as unknown[],
  auditadas: [] as { data: Record<string, unknown> }[],
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
        invoice: {
          findUnique: vi.fn(async () => estado.factura),
          update: vi.fn(async (args: unknown) => {
            estado.actualizadas.push(args);
            return {};
          }),
        },
        auditLog: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            estado.auditadas.push(args);
            return {};
          }),
        },
      }),
    ),
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'itfin360_tenant' ? { value: TENANT } : undefined),
    set: vi.fn(),
  })),
}));

vi.mock('@/lib/env', () => ({ env: () => ({ APP_URL: 'http://localhost:3000' }) }));

const { POST: transicion } = await import('./invoices/[id]/transition/route');

function conSesion(role: UserMembership['role']): void {
  estado.userId = USER;
  estado.memberships = [
    { tenantId: TENANT, tenantName: 'Tenant Ficticio', role, canViewCompensation: false },
  ];
}

function peticion(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/invoices/${FACTURA}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function llamar(body: Record<string, unknown>): Promise<Response> {
  return transicion(peticion(body), { params: Promise.resolve({ id: FACTURA }) });
}

beforeEach(() => {
  estado.userId = null;
  estado.memberships = [];
  estado.factura = { id: FACTURA, status: 'PENDING_REVIEW', createdById: OTRO_USER };
  estado.actualizadas = [];
  estado.auditadas = [];
});

describe('POST /api/invoices/[id]/transition', () => {
  it('sin sesión, 401 y nada escrito', async () => {
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(401);
    expect(estado.actualizadas).toEqual([]);
    expect(estado.auditadas).toEqual([]);
  });

  it('aprueba y deja el apunte de auditoría en la misma llamada', async () => {
    conSesion('FINANCE');
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      id: FACTURA,
      from: 'PENDING_REVIEW',
      to: 'APPROVED',
    });

    expect(estado.actualizadas).toHaveLength(1);
    expect(estado.auditadas).toHaveLength(1);
    const apunte = estado.auditadas[0]?.data;
    expect(apunte?.['action']).toBe(INVOICE_TRANSITIONS.APPROVE.auditAction);
    expect(apunte?.['entity']).toBe('invoice');
    expect(apunte?.['entityId']).toBe(FACTURA);
    expect(apunte?.['actorId']).toBe(USER);
    expect(apunte?.['before']).toEqual({ status: 'PENDING_REVIEW' });
    expect(apunte?.['after']).toEqual({ status: 'APPROVED' });
  });

  it('un rol sin permiso de facturas recibe 403 del servidor', async () => {
    conSesion('VIEWER');
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(estado.auditadas).toEqual([]);
  });

  it('quien registra facturas pero no aprueba recibe 403 con el motivo', async () => {
    conSesion('CONTRIBUTOR');
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('forbidden_role');
    expect(body.message).toContain('CONTRIBUTOR');
    expect(estado.actualizadas).toEqual([]);
  });

  it('una transición imposible da 409 y no escribe nada', async () => {
    conSesion('OWNER');
    estado.factura = { id: FACTURA, status: 'POSTED', createdById: OTRO_USER };
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_transition');
    expect(body.message).toContain('POSTED');
    expect(estado.actualizadas).toEqual([]);
    expect(estado.auditadas).toEqual([]);
  });

  it('una factura de otro tenant es 404, no 403', async () => {
    // RLS devuelve null: la respuesta no puede confirmar que la factura existe.
    conSesion('OWNER');
    estado.factura = null;
    const res = await llamar({ action: 'APPROVE' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'invoice_not_found' });
  });

  it('marcar duplicado sin decir de cuál es copia da 409', async () => {
    conSesion('FINANCE');
    const res = await llamar({ action: 'MARK_DUPLICATE' });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'missing_duplicate_of' });
  });

  it('marcar duplicado escribe el enlace a la original y lo audita', async () => {
    conSesion('FINANCE');
    const res = await llamar({ action: 'MARK_DUPLICATE', duplicateOfId: ORIGINAL });
    expect(res.status).toBe(200);
    expect(estado.actualizadas).toHaveLength(1);
    expect(estado.auditadas[0]?.data['after']).toEqual({
      status: 'DUPLICATE',
      duplicateOfId: ORIGINAL,
    });
  });

  it('una acción que no existe es 400, no 500', async () => {
    conSesion('OWNER');
    const res = await llamar({ action: 'BORRAR_TODO' });
    expect(res.status).toBe(400);
  });

  it('un id de factura original mal formado es 400', async () => {
    conSesion('FINANCE');
    const res = await llamar({ action: 'MARK_DUPLICATE', duplicateOfId: 'no-es-un-uuid' });
    expect(res.status).toBe(400);
  });
});

describe('coherencia entre la máquina de estados y la matriz de permisos', () => {
  it('quien puede registrar en el flujo es quien tiene `invoices:create`', () => {
    // Si las dos listas se separan, un rol ve el botón y recibe un 403 al
    // pulsarlo, o al revés: la ruta le deja pasar y la máquina le frena.
    const enElFlujo = [...INVOICE_TRANSITIONS.SUBMIT.roles].sort();
    const conPermiso = Object.entries(ROLE_PERMISSIONS)
      .filter(([, permisos]) => permisos.has('invoices:create'))
      .map(([role]) => role)
      .sort();
    expect(enElFlujo).toEqual(conPermiso);
  });

  it('todo rol que aparece en cualquier transición tiene `invoices:create`', () => {
    for (const [action, rule] of Object.entries(INVOICE_TRANSITIONS)) {
      for (const role of rule.roles) {
        expect(ROLE_PERMISSIONS[role].has('invoices:create'), `${action}/${role}`).toBe(true);
      }
    }
  });
});
