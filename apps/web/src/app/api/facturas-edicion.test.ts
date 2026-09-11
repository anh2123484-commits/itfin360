/**
 * Detalle y edición de factura (F2-02) con la sesión y la base simuladas.
 *
 * Lo que aquí importa es que la edición se cierra cuando la factura ya no es
 * un borrador, y que lo que se valida es la factura **resultante**, no el
 * parche: cambiar sólo el IVA descuadra una factura que estaba bien.
 */
import type { UserMembership } from '@itfin360/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaa1-0000-4000-8000-000000000001';
const PROVEEDOR = 'aaaaaaa5-0000-4000-8000-000000000001';
const OTRO_PROVEEDOR = 'aaaaaaa5-0000-4000-8000-000000000002';
const FACTURA = 'aaaaaaa7-0000-4000-8000-000000000001';

/** Una factura en borrador que cuadra: 100 € de base, 21 % de IVA, una línea. */
function facturaGuardada(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FACTURA,
    invoiceNumber: 'F-2026-001',
    issueDate: new Date('2026-03-31T00:00:00.000Z'),
    accrualDate: new Date('2026-03-01T00:00:00.000Z'),
    dueDate: new Date('2026-04-30T00:00:00.000Z'),
    serviceStart: null,
    serviceEnd: null,
    netCents: 10_000,
    vatCents: 2_100,
    grossCents: 12_100,
    currency: 'EUR',
    fxRate: null,
    status: 'DRAFT',
    source: 'MANUAL',
    duplicateOfId: null,
    createdById: USER,
    vendor: { id: PROVEEDOR, name: 'Proveedor Ficticio' },
    lines: [
      {
        id: 'linea-1',
        lineNumber: 1,
        description: 'Suscripción mensual',
        quantity: 1,
        unitPriceCents: 10_000,
        netCents: 10_000,
        costType: 'OPEX_RECURRING',
        concept: 'SAAS_SUBSCRIPTION',
      },
    ],
    ...extra,
  };
}

/** Una línea de 100 € que cuadra. */
function linea(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Suscripción mensual',
    quantity: 1,
    unitPriceCents: 10_000,
    netCents: 10_000,
    costType: 'OPEX_RECURRING',
    concept: 'SAAS_SUBSCRIPTION',
    ...extra,
  };
}

const estado = {
  userId: null as string | null,
  memberships: [] as UserMembership[],
  factura: null as Record<string, unknown> | null,
  proveedor: { id: OTRO_PROVEEDOR } as { id: string } | null,
  choque: null as { id: string; status: string } | null,
  actualizada: null as { data: Record<string, unknown> } | null,
  auditadas: [] as { data: Record<string, unknown> }[],
};

/** Lo escrito en la cabecera, sin la operación anidada de líneas. */
function sinLineas(data: Record<string, unknown>): Record<string, unknown> {
  const copia = { ...data };
  delete copia['lines'];
  return copia;
}

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
        vendor: { findUnique: vi.fn(async () => estado.proveedor) },
        invoice: {
          findUnique: vi.fn(async () => estado.factura),
          findFirst: vi.fn(async () => estado.choque),
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            estado.actualizada = args;
            return { ...(estado.factura ?? {}), ...sinLineas(args.data) };
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

const { GET: leer, PATCH: editar } = await import('./invoices/[id]/route');

function conSesion(role: UserMembership['role']): void {
  estado.userId = USER;
  estado.memberships = [
    { tenantId: TENANT, tenantName: 'Tenant Ficticio', role, canViewCompensation: false },
  ];
}

const contexto = (): { params: Promise<{ id: string }> } => ({
  params: Promise.resolve({ id: FACTURA }),
});

const detalle = (): Promise<Response> =>
  leer(new Request(`http://localhost/api/invoices/${FACTURA}`), contexto());

const patch = (body: unknown): Promise<Response> =>
  editar(
    new Request(`http://localhost/api/invoices/${FACTURA}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    contexto(),
  );

const escrito = (): Record<string, unknown> => estado.actualizada?.data ?? {};

beforeEach(() => {
  estado.userId = null;
  estado.memberships = [];
  estado.factura = facturaGuardada();
  estado.proveedor = { id: OTRO_PROVEEDOR };
  estado.choque = null;
  estado.actualizada = null;
  estado.auditadas = [];
});

describe('GET /api/invoices/[id]', () => {
  it('sin sesión, 401', async () => {
    expect((await detalle()).status).toBe(401);
  });

  it('quien no toca facturas no ve el detalle', async () => {
    conSesion('VIEWER');
    expect((await detalle()).status).toBe(403);
  });

  it('devuelve las fechas como día, no como instante', async () => {
    conSesion('CONTRIBUTOR');
    const res = await detalle();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['issueDate']).toBe('2026-03-31');
    expect(body['accrualDate']).toBe('2026-03-01');
    expect(body['dueDate']).toBe('2026-04-30');
    expect(body['serviceStart']).toBe(null);
  });

  it('la cantidad de línea sale como número', async () => {
    conSesion('FINANCE');
    const body = (await (await detalle()).json()) as { lines: { quantity: unknown }[] };
    expect(body.lines[0]?.quantity).toBe(1);
  });

  it('una factura de otro tenant es 404', async () => {
    conSesion('FINANCE');
    estado.factura = null;
    expect((await detalle()).status).toBe(404);
  });
});

describe('PATCH /api/invoices/[id]', () => {
  it('una factura que ya no es borrador no se edita', async () => {
    // Quien revisa tiene que estar mirando lo mismo que se le mandó.
    conSesion('OWNER');
    for (const status of ['PENDING_REVIEW', 'APPROVED', 'POSTED', 'DUPLICATE']) {
      estado.factura = facturaGuardada({ status });
      const res = await patch({ vatCents: 0, grossCents: 10_000 });
      expect(res.status, status).toBe(409);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('invoice_not_editable');
      expect(body.message).toContain(status);
    }
    expect(estado.actualizada).toBe(null);
  });

  it('tras un rechazo sí se edita', async () => {
    conSesion('FINANCE');
    estado.factura = facturaGuardada({ status: 'REJECTED' });
    expect((await patch({ vatCents: 0, grossCents: 10_000 })).status).toBe(200);
  });

  it('se valida la factura resultante, no el parche', async () => {
    // Tocar sólo el IVA descuadra una factura que estaba bien.
    conSesion('FINANCE');
    const res = await patch({ vatCents: 500 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: { code: string }[] };
    expect(body.error).toBe('incoherent_invoice');
    expect(body.issues.map((i) => i.code)).toContain('GROSS_MISMATCH');
    expect(estado.actualizada).toBe(null);
  });

  it('si el cambio deja la factura cuadrada, pasa', async () => {
    conSesion('FINANCE');
    const res = await patch({ vatCents: 500, grossCents: 10_500 });
    expect(res.status).toBe(200);
    expect(escrito()['vatCents']).toBe(500);
    expect(escrito()['grossCents']).toBe(10_500);
  });

  it('audita sólo lo que cambia, con su valor anterior', async () => {
    conSesion('FINANCE');
    await patch({ vatCents: 500, grossCents: 10_500 });
    const apunte = estado.auditadas[0]?.data;
    expect(apunte?.['action']).toBe('invoice.updated');
    expect(apunte?.['before']).toEqual({ vatCents: 2_100, grossCents: 12_100 });
    expect(apunte?.['after']).toEqual({ vatCents: 500, grossCents: 10_500 });
  });

  it('las fechas se auditan como día', async () => {
    conSesion('FINANCE');
    await patch({ issueDate: '2026-03-30' });
    expect(estado.auditadas[0]?.data['before']).toEqual({ issueDate: '2026-03-31' });
    expect(estado.auditadas[0]?.data['after']).toEqual({ issueDate: '2026-03-30' });
  });

  it('null borra un campo opcional; no mandarlo lo deja como estaba', async () => {
    conSesion('FINANCE');
    await patch({ dueDate: null });
    expect(escrito()['dueDate']).toBe(null);

    estado.actualizada = null;
    await patch({ issueDate: '2026-03-30' });
    expect(Object.keys(escrito())).toEqual(['issueDate']);
  });

  it('las líneas se reemplazan enteras, no se parchean una a una', async () => {
    conSesion('FINANCE');
    const res = await patch({
      netCents: 20_000,
      vatCents: 4_200,
      grossCents: 24_200,
      lines: [linea({ description: 'Primera' }), linea({ description: 'Segunda' })],
    });
    expect(res.status).toBe(200);
    const operacion = escrito()['lines'] as {
      deleteMany: unknown;
      create: { lineNumber: number }[];
    };
    expect(operacion.deleteMany).toEqual({});
    expect(operacion.create.map((l) => l.lineNumber)).toEqual([1, 2]);
    expect(estado.auditadas[0]?.data['before']).toMatchObject({ lines: 1 });
    expect(estado.auditadas[0]?.data['after']).toMatchObject({ lines: 2 });
  });

  it('unas líneas que no suman la cabecera son 422', async () => {
    conSesion('FINANCE');
    const res = await patch({ lines: [linea(), linea({ description: 'Sobra' })] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { code: string }[] };
    expect(body.issues.map((i) => i.code)).toContain('NET_MISMATCH');
  });

  it('cambiar el número a uno que ya existe es 409 con la referencia', async () => {
    conSesion('FINANCE');
    estado.choque = { id: 'ya-existe', status: 'POSTED' };
    const res = await patch({ invoiceNumber: 'F-2026-999' });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'invoice_duplicate',
      existingInvoiceId: 'ya-existe',
      existingStatus: 'POSTED',
    });
    expect(estado.actualizada).toBe(null);
  });

  it('sin tocar número ni proveedor, no se busca ningún choque', async () => {
    // Si se buscara, la propia factura saldría como duplicada de sí misma.
    conSesion('FINANCE');
    estado.choque = { id: FACTURA, status: 'DRAFT' };
    expect((await patch({ vatCents: 500, grossCents: 10_500 })).status).toBe(200);
  });

  it('mover la factura a un proveedor de otro tenant es 404', async () => {
    conSesion('FINANCE');
    estado.proveedor = null;
    const res = await patch({ vendorId: OTRO_PROVEEDOR });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'vendor_not_found' });
  });

  it('un PATCH que no cambia nada es 400', async () => {
    conSesion('FINANCE');
    const res = await patch({});
    expect(res.status).toBe(400);
    expect(estado.auditadas).toEqual([]);
  });

  it('un rol sin permiso de facturas no edita', async () => {
    conSesion('PROJECT_MANAGER');
    expect((await patch({ vatCents: 500, grossCents: 10_500 })).status).toBe(403);
    expect(estado.actualizada).toBe(null);
  });
});
