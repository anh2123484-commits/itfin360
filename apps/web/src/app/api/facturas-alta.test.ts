/**
 * Alta y listado de facturas (F2-02) con la sesión y la base simuladas.
 *
 * La aritmética de la factura ya la cubren los 37 tests de `validateInvoice` en
 * `finance-core`. Aquí se comprueba lo otro: que la ruta **consulta** al motor
 * antes de escribir, que el estado no se puede elegir desde fuera, y que el
 * duplicado exacto sale con la referencia a la factura que ya existe.
 */
import type { UserMembership } from '@itfin360/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaa1-0000-4000-8000-000000000001';
const PROVEEDOR = 'aaaaaaa5-0000-4000-8000-000000000001';
const FACTURA = 'aaaaaaa7-0000-4000-8000-000000000001';

const estado = {
  userId: null as string | null,
  memberships: [] as UserMembership[],
  proveedor: { id: PROVEEDOR } as { id: string } | null,
  duplicada: null as { id: string; status: string } | null,
  lista: [] as Record<string, unknown>[],
  consultas: [] as Record<string, unknown>[],
  creadas: [] as { data: Record<string, unknown> }[],
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
        vendor: { findUnique: vi.fn(async () => estado.proveedor) },
        invoice: {
          findFirst: vi.fn(async () => estado.duplicada),
          findMany: vi.fn(async (args: Record<string, unknown>) => {
            estado.consultas.push(args);
            return estado.lista;
          }),
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            estado.creadas.push(args);
            return {
              id: FACTURA,
              invoiceNumber: args.data['invoiceNumber'],
              status: args.data['status'],
              grossCents: args.data['grossCents'],
              currency: args.data['currency'],
            };
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

const { GET: listar, POST: crear } = await import('./invoices/route');

function conSesion(role: UserMembership['role']): void {
  estado.userId = USER;
  estado.memberships = [
    { tenantId: TENANT, tenantName: 'Tenant Ficticio', role, canViewCompensation: false },
  ];
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

/** Una factura que cuadra: 100 € de base, 21 % de IVA, una línea. */
function facturaValida(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vendorId: PROVEEDOR,
    invoiceNumber: 'F-2026-001',
    issueDate: '2026-03-31',
    accrualDate: '2026-03-01',
    netCents: 10_000,
    vatCents: 2_100,
    grossCents: 12_100,
    lines: [linea()],
    ...extra,
  };
}

/** Los números de línea tal y como se han escrito en la base. */
function numerosDeLinea(): number[] {
  const lineas = datosCreados()['lines'] as { create: { lineNumber: number }[] } | undefined;
  return (lineas?.create ?? []).map((l) => l.lineNumber);
}

const alta = (body: unknown): Promise<Response> =>
  crear(
    new Request('http://localhost/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const consulta = (qs = ''): Promise<Response> =>
  listar(new Request(`http://localhost/api/invoices${qs}`));

const datosCreados = (): Record<string, unknown> => estado.creadas[0]?.data ?? {};

beforeEach(() => {
  estado.userId = null;
  estado.memberships = [];
  estado.proveedor = { id: PROVEEDOR };
  estado.duplicada = null;
  estado.lista = [];
  estado.consultas = [];
  estado.creadas = [];
  estado.auditadas = [];
});

describe('POST /api/invoices', () => {
  it('sin sesión, 401 y nada escrito', async () => {
    expect((await alta(facturaValida())).status).toBe(401);
    expect(estado.creadas).toEqual([]);
  });

  it('un rol sin permiso de facturas no da de alta', async () => {
    conSesion('VIEWER');
    expect((await alta(facturaValida())).status).toBe(403);
    expect(estado.creadas).toEqual([]);
  });

  it('crea la factura, sus líneas y el apunte de auditoría', async () => {
    conSesion('CONTRIBUTOR');
    const res = await alta(facturaValida());
    expect(res.status).toBe(201);

    const data = datosCreados();
    expect(data['invoiceNumber']).toBe('F-2026-001');
    expect(data['createdById']).toBe(USER);
    expect(estado.auditadas[0]?.data['action']).toBe('invoice.created');
    expect(estado.auditadas[0]?.data['entityId']).toBe(FACTURA);
  });

  it('toda factura nace en DRAFT y el cliente no puede decidirlo', async () => {
    // Si el estado viniera del cuerpo, se podría crear una factura ya aprobada
    // sin que nadie la aprobara y sin el apunte de esa aprobación.
    conSesion('OWNER');
    await alta(facturaValida({ status: 'POSTED' }));
    expect(datosCreados()['status']).toBe('DRAFT');
  });

  it('las fechas se guardan a medianoche UTC, sin correrse de mes', async () => {
    conSesion('FINANCE');
    await alta(facturaValida());
    expect((datosCreados()['issueDate'] as Date).toISOString()).toBe('2026-03-31T00:00:00.000Z');
    expect((datosCreados()['accrualDate'] as Date).toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('las líneas se numeran solas por orden de llegada', async () => {
    conSesion('FINANCE');
    await alta(
      facturaValida({
        netCents: 20_000,
        vatCents: 4_200,
        grossCents: 24_200,
        lines: [linea({ description: 'Primera' }), linea({ description: 'Segunda' })],
      }),
    );
    expect(numerosDeLinea()).toEqual([1, 2]);
  });

  it('respeta los números de línea que trae un ERP', async () => {
    // Es lo que permite reconciliar una importación con su origen.
    conSesion('FINANCE');
    await alta(facturaValida({ lines: [linea({ lineNumber: 7 })] }));
    expect(numerosDeLinea()).toEqual([7]);
  });

  it('una factura que no cuadra es 422 y no llega a la base', async () => {
    conSesion('FINANCE');
    const res = await alta(facturaValida({ grossCents: 99_999 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: { code: string }[] };
    expect(body.error).toBe('incoherent_invoice');
    expect(body.issues.map((i) => i.code)).toContain('GROSS_MISMATCH');
    expect(estado.creadas).toEqual([]);
  });

  it('el 422 señala la línea que falla', async () => {
    conSesion('FINANCE');
    // 3 × 100 € no son los 100 € que declara la línea.
    const res = await alta(facturaValida({ lines: [linea({ quantity: 3 })] }));
    const body = (await res.json()) as { issues: { code: string; lineNumber?: number }[] };
    expect(body.issues.find((i) => i.code === 'LINE_NET_MISMATCH')?.lineNumber).toBe(1);
  });

  it('el duplicado exacto es 409 y dice cuál es la factura que ya existe', async () => {
    // Aceptación de F2-03 para el duplicado exacto.
    conSesion('FINANCE');
    estado.duplicada = { id: 'ya-existe', status: 'POSTED' };
    const res = await alta(facturaValida());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'invoice_duplicate',
      existingInvoiceId: 'ya-existe',
      existingStatus: 'POSTED',
    });
    expect(estado.creadas).toEqual([]);
  });

  it('un proveedor de otro tenant es 404, no un 500 de clave ajena', async () => {
    conSesion('FINANCE');
    estado.proveedor = null;
    const res = await alta(facturaValida());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'vendor_not_found' });
  });

  it('rechaza lo que no es una factura', async () => {
    conSesion('FINANCE');
    const casos: [string, Record<string, unknown>][] = [
      ['sin proveedor', facturaValida({ vendorId: 'no-es-uuid' })],
      ['sin número', facturaValida({ invoiceNumber: '   ' })],
      ['fecha inventada', facturaValida({ issueDate: '2026-02-30' })],
      ['fecha con otro formato', facturaValida({ issueDate: '31/03/2026' })],
      ['céntimos decimales', facturaValida({ netCents: 100.5 })],
      ['sin líneas', facturaValida({ lines: [] })],
      ['divisa inventada', facturaValida({ currency: 'EUROS' })],
      ['tipo de cambio negativo', facturaValida({ currency: 'USD', fxRate: -1 })],
    ];
    for (const [nombre, cuerpo] of casos) {
      expect((await alta(cuerpo)).status, nombre).toBe(400);
    }
    expect(estado.creadas).toEqual([]);
  });

  it('la divisa por defecto es la del tenant y se normaliza a mayúsculas', async () => {
    conSesion('FINANCE');
    await alta(facturaValida());
    expect(datosCreados()['currency']).toBe('EUR');

    estado.creadas = [];
    await alta(facturaValida({ currency: 'usd', fxRate: 0.92 }));
    expect(datosCreados()['currency']).toBe('USD');
  });
});

describe('GET /api/invoices', () => {
  it('quien registra facturas también las lista', async () => {
    conSesion('CONTRIBUTOR');
    expect((await consulta()).status).toBe(200);
  });

  it('quien no toca facturas, no', async () => {
    conSesion('VIEWER');
    expect((await consulta()).status).toBe(403);
  });

  it('ordena por devengo y desempata por id, para que el cursor no salte filas', async () => {
    conSesion('FINANCE');
    await consulta();
    expect(estado.consultas[0]?.['orderBy']).toEqual([{ accrualDate: 'desc' }, { id: 'desc' }]);
  });

  it('filtra por estado, proveedor, número y rango de devengo', async () => {
    conSesion('FINANCE');
    await consulta(
      `?status=APPROVED&vendorId=${PROVEEDOR}&q=F-2026&desde=2026-01-01&hasta=2026-03-31`,
    );
    const where = estado.consultas[0]?.['where'] as Record<string, unknown>;
    expect(where['status']).toBe('APPROVED');
    expect(where['vendorId']).toBe(PROVEEDOR);
    expect(where['invoiceNumber']).toEqual({ contains: 'F-2026', mode: 'insensitive' });
    const rango = where['accrualDate'] as { gte: Date; lte: Date };
    expect(rango.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rango.lte.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('una fecha de filtro mal escrita es 400, no un filtro ignorado', async () => {
    // Filtrar de menos enseña un gasto que no es el real.
    conSesion('FINANCE');
    const res = await consulta('?desde=2026-02-30');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_desde' });
    expect(estado.consultas).toEqual([]);
  });

  it('un estado que no existe es 400', async () => {
    conSesion('FINANCE');
    expect((await consulta('?status=PAGADA')).status).toBe(400);
  });

  it('las fechas salen como YYYY-MM-DD, no como instantes', async () => {
    conSesion('FINANCE');
    estado.lista = [
      {
        id: FACTURA,
        invoiceNumber: 'F-2026-001',
        issueDate: new Date('2026-03-31T00:00:00.000Z'),
        accrualDate: new Date('2026-03-01T00:00:00.000Z'),
        netCents: 10_000,
        vatCents: 2_100,
        grossCents: 12_100,
        currency: 'EUR',
        status: 'DRAFT',
        vendor: { id: PROVEEDOR, name: 'Proveedor Ficticio' },
      },
    ];
    const res = await consulta();
    const body = (await res.json()) as { items: { issueDate: string; accrualDate: string }[] };
    expect(body.items[0]?.issueDate).toBe('2026-03-31');
    expect(body.items[0]?.accrualDate).toBe('2026-03-01');
  });

  it('devuelve cursor cuando hay más página, y no la fila sobrante', async () => {
    conSesion('FINANCE');
    const fila = (id: string): Record<string, unknown> => ({
      id,
      invoiceNumber: id,
      issueDate: new Date('2026-03-01T00:00:00.000Z'),
      accrualDate: new Date('2026-03-01T00:00:00.000Z'),
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
      currency: 'EUR',
      status: 'DRAFT',
      vendor: { id: PROVEEDOR, name: 'Proveedor Ficticio' },
    });
    estado.lista = [fila('a'), fila('b'), fila('c')];
    const res = await consulta('?limit=2');
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBe('b');
    expect(estado.consultas[0]?.['take']).toBe(3);
  });

  it('el cursor pide la página siguiente sin repetir su primera fila', async () => {
    conSesion('FINANCE');
    await consulta(`?cursor=${FACTURA}`);
    expect(estado.consultas[0]?.['cursor']).toEqual({ id: FACTURA });
    expect(estado.consultas[0]?.['skip']).toBe(1);
  });

  it('el tamaño de página tiene tope', async () => {
    conSesion('FINANCE');
    expect((await consulta('?limit=1000')).status).toBe(400);
  });
});
