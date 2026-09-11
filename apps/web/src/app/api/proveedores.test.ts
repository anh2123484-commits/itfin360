/**
 * Rutas de proveedor (F2-01/F2-02) con la sesión y la base simuladas.
 *
 * Lo que se prueba aquí es lo que la base **no** puede probar: quién entra,
 * qué se audita y en qué se traduce el choque de un índice único. El
 * aislamiento por tenant ya lo cubre el test de integración de `packages/db`
 * contra Postgres de verdad.
 */
import { UNIQUE_CONSTRAINT, type UserMembership } from '@itfin360/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaa1-0000-4000-8000-000000000001';
const PROVEEDOR = 'aaaaaaa5-0000-4000-8000-000000000001';

interface ProveedorSimulado {
  readonly id: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly country: string | null;
  readonly criticality: string;
}

const FICTICIO: ProveedorSimulado = {
  id: PROVEEDOR,
  name: 'Proveedor Ficticio',
  legalName: null,
  taxId: 'A00000000',
  country: 'ES',
  criticality: 'MEDIUM',
};

const estado = {
  userId: null as string | null,
  memberships: [] as UserMembership[],
  proveedor: null as ProveedorSimulado | null,
  lista: [] as ProveedorSimulado[],
  /** Si la siguiente escritura choca con un índice único, y con cuál. */
  choque: null as string[] | null,
  consultas: [] as unknown[],
  escrituras: [] as unknown[],
  auditadas: [] as { data: Record<string, unknown> }[],
};

function chocarSiToca(): void {
  if (estado.choque === null) return;
  const target = estado.choque;
  estado.choque = null;
  throw Object.assign(new Error('unique'), { code: UNIQUE_CONSTRAINT, meta: { target } });
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
        vendor: {
          findMany: vi.fn(async (args: unknown) => {
            estado.consultas.push(args);
            return estado.lista;
          }),
          findUnique: vi.fn(async () => estado.proveedor),
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            chocarSiToca();
            estado.escrituras.push(args);
            return { ...FICTICIO, ...args.data, id: PROVEEDOR };
          }),
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            chocarSiToca();
            estado.escrituras.push(args);
            return { ...(estado.proveedor ?? FICTICIO), ...args.data };
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

const { GET: listar, POST: crear } = await import('./vendors/route');
const { GET: leer, PATCH: editar } = await import('./vendors/[id]/route');

function conSesion(role: UserMembership['role']): void {
  estado.userId = USER;
  estado.memberships = [
    { tenantId: TENANT, tenantName: 'Tenant Ficticio', role, canViewCompensation: false },
  ];
}

const peticion = (url: string, body?: unknown, method = 'POST'): Request =>
  body === undefined
    ? new Request(url)
    : new Request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

const contexto = { params: Promise.resolve({ id: PROVEEDOR }) };

beforeEach(() => {
  estado.userId = null;
  estado.memberships = [];
  estado.proveedor = FICTICIO;
  estado.lista = [FICTICIO];
  estado.choque = null;
  estado.consultas = [];
  estado.escrituras = [];
  estado.auditadas = [];
});

describe('GET /api/vendors', () => {
  it('sin sesión, 401', async () => {
    expect((await listar(peticion('http://localhost/api/vendors'))).status).toBe(401);
  });

  it('quien no toca facturas no ve la lista de proveedores', async () => {
    conSesion('VIEWER');
    expect((await listar(peticion('http://localhost/api/vendors'))).status).toBe(403);
  });

  it('quien registra facturas la ve, aunque no tenga `invoices:read`', async () => {
    // CONTRIBUTOR tiene `invoices:create` y no `invoices:read`. Si la ruta
    // exigiera sólo el segundo, el desplegable de proveedores saldría vacío
    // justo para el rol que da de alta las facturas.
    conSesion('CONTRIBUTOR');
    expect((await listar(peticion('http://localhost/api/vendors'))).status).toBe(200);
  });

  it('quien sólo lee facturas también', async () => {
    conSesion('FINANCE');
    const res = await listar(peticion('http://localhost/api/vendors'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ items: [FICTICIO], nextCursor: null });
  });

  it('la búsqueda no distingue mayúsculas', async () => {
    conSesion('FINANCE');
    await listar(peticion('http://localhost/api/vendors?q=ficti'));
    expect(estado.consultas[0]).toMatchObject({
      where: { name: { contains: 'ficti', mode: 'insensitive' } },
    });
  });

  it('devuelve cursor cuando hay más página, y no la fila sobrante', async () => {
    conSesion('FINANCE');
    estado.lista = [
      { ...FICTICIO, id: 'a', name: 'Alfa' },
      { ...FICTICIO, id: 'b', name: 'Beta' },
      { ...FICTICIO, id: 'c', name: 'Gamma' },
    ];
    const res = await listar(peticion('http://localhost/api/vendors?limit=2'));
    const body = (await res.json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(body.items.map((v) => v.name)).toEqual(['Alfa', 'Beta']);
    expect(body.nextCursor).toBe('Beta');
  });

  it('sin más página, el cursor es nulo', async () => {
    conSesion('FINANCE');
    const res = await listar(peticion('http://localhost/api/vendors?limit=2'));
    await expect(res.json()).resolves.toMatchObject({ nextCursor: null });
  });

  it('el cursor pide lo que viene después, no un desplazamiento', async () => {
    // Por `skip`, dar de alta un proveedor mientras alguien recorre la lista
    // le haría saltarse una fila.
    conSesion('FINANCE');
    await listar(peticion('http://localhost/api/vendors?cursor=Beta'));
    expect(estado.consultas[0]).toMatchObject({ where: { name: { gt: 'Beta' } } });
  });

  it('el tamaño de página se topa y la basura no lo rompe', async () => {
    conSesion('FINANCE');
    for (const [consulta, esperado] of [
      ['limit=1000', 101],
      ['limit=0', 51],
      ['limit=-3', 51],
      ['limit=abc', 51],
      ['', 51],
    ] as const) {
      estado.consultas = [];
      await listar(peticion(`http://localhost/api/vendors?${consulta}`));
      expect(estado.consultas[0], consulta).toMatchObject({ take: esperado });
    }
  });
});

describe('POST /api/vendors', () => {
  it('da de alta, devuelve 201 y deja el apunte de auditoría', async () => {
    conSesion('IT_MANAGER');
    const res = await crear(
      peticion('http://localhost/api/vendors', { name: '  Acme SL  ', country: 'es' }),
    );
    expect(res.status).toBe(201);

    expect(estado.escrituras).toHaveLength(1);
    const escrito = (estado.escrituras[0] as { data: Record<string, unknown> }).data;
    expect(escrito['name']).toBe('Acme SL');
    expect(escrito['country']).toBe('ES');
    expect(escrito['criticality']).toBe('MEDIUM');
    expect(escrito['taxId']).toBe(null);

    expect(estado.auditadas[0]?.data['action']).toBe('vendor.created');
    expect(estado.auditadas[0]?.data['entity']).toBe('vendor');
  });

  it('un rol sin permiso de facturas no da de alta', async () => {
    conSesion('PROJECT_MANAGER');
    const res = await crear(peticion('http://localhost/api/vendors', { name: 'Acme SL' }));
    expect(res.status).toBe(403);
    expect(estado.escrituras).toEqual([]);
  });

  it('el nombre repetido dice que es el nombre', async () => {
    conSesion('FINANCE');
    estado.choque = ['tenant_id', 'name'];
    const res = await crear(peticion('http://localhost/api/vendors', { name: 'Acme SL' }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'vendor_name_exists' });
  });

  it('el NIF repetido dice que es el NIF', async () => {
    // El mismo proveedor dado de alta dos veces con nombres distintos es como
    // empiezan los duplicados de factura que F2-03 tiene que cazar después.
    conSesion('FINANCE');
    estado.choque = ['tenant_id', 'tax_id'];
    const res = await crear(
      peticion('http://localhost/api/vendors', { name: 'Acme Servicios', taxId: 'A00000000' }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'vendor_tax_id_exists' });
  });

  it('un choque sin detalle sigue siendo 409, no 500', async () => {
    conSesion('FINANCE');
    estado.choque = [];
    const res = await crear(peticion('http://localhost/api/vendors', { name: 'Acme SL' }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'vendor_exists' });
  });

  it('rechaza lo que no es un proveedor', async () => {
    conSesion('FINANCE');
    for (const cuerpo of [
      {},
      { name: '   ' },
      { name: 'Acme SL', country: 'ESP' },
      { name: 'Acme SL', criticality: 'URGENTE' },
    ]) {
      const res = await crear(peticion('http://localhost/api/vendors', cuerpo));
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(estado.escrituras).toEqual([]);
  });

  it('el cuerpo que no es JSON es 400, no 500', async () => {
    conSesion('FINANCE');
    const res = await crear(
      new Request('http://localhost/api/vendors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'no soy json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET y PATCH /api/vendors/[id]', () => {
  it('un proveedor de otro tenant es 404, no 403', async () => {
    // RLS devuelve null: la respuesta no puede confirmar que ese id existe.
    conSesion('FINANCE');
    estado.proveedor = null;
    expect((await leer(peticion('http://localhost/x'), contexto)).status).toBe(404);
    const res = await editar(peticion('http://localhost/x', { name: 'Otro' }, 'PATCH'), contexto);
    expect(res.status).toBe(404);
    expect(estado.escrituras).toEqual([]);
  });

  it('audita sólo lo que cambia, con su valor anterior', async () => {
    conSesion('FINANCE');
    const res = await editar(
      peticion('http://localhost/x', { criticality: 'CRITICAL' }, 'PATCH'),
      contexto,
    );
    expect(res.status).toBe(200);
    const apunte = estado.auditadas[0]?.data;
    expect(apunte?.['action']).toBe('vendor.updated');
    expect(apunte?.['before']).toEqual({ criticality: 'MEDIUM' });
    expect(apunte?.['after']).toEqual({ criticality: 'CRITICAL' });
  });

  it('borrar un dato opcional se escribe como nulo, no como cadena vacía', async () => {
    conSesion('FINANCE');
    await editar(peticion('http://localhost/x', { taxId: '' }, 'PATCH'), contexto);
    expect((estado.escrituras[0] as { data: Record<string, unknown> }).data['taxId']).toBe(null);
  });

  it('un PATCH que no cambia nada es 400', async () => {
    // Si pasara, dejaría un apunte de auditoría diciendo que hubo un cambio.
    conSesion('FINANCE');
    const res = await editar(peticion('http://localhost/x', {}, 'PATCH'), contexto);
    expect(res.status).toBe(400);
    expect(estado.auditadas).toEqual([]);
  });

  it('editar exige permiso de factura; leer, cualquiera de los dos', async () => {
    conSesion('CONTRIBUTOR');
    expect((await leer(peticion('http://localhost/x'), contexto)).status).toBe(200);
    conSesion('VIEWER');
    expect((await leer(peticion('http://localhost/x'), contexto)).status).toBe(403);
    const res = await editar(peticion('http://localhost/x', { name: 'Otro' }, 'PATCH'), contexto);
    expect(res.status).toBe(403);
  });
});
