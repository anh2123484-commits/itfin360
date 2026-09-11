import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { parseJson, route } from '@/lib/http';
import { requireAnyPermission, requirePermission } from '@/lib/tenant-context';
import {
  altaProveedor,
  CAMPOS_PROVEEDOR,
  textoOpcional,
  traduciendoConflictos,
} from '@/lib/vendors';

/**
 * Proveedores del tenant (F2-01/F2-02).
 *
 * El listado no exige `invoices:read` sino cualquiera de los dos permisos de
 * factura: quien registra facturas tiene que poder elegir proveedor, y
 * `CONTRIBUTOR` tiene `invoices:create` pero no `invoices:read`. Con la
 * comprobación estricta, el desplegable de proveedores saldría vacío justo
 * para el rol que más lo usa.
 */

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 100;

export const GET = route(async (request: Request) => {
  const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);
  const parametros = new URL(request.url).searchParams;

  const busqueda = parametros.get('q')?.trim() ?? '';
  const cursor = parametros.get('cursor') ?? undefined;
  const pedido = Number(parametros.get('limit') ?? LIMITE_POR_DEFECTO);
  const limite =
    Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, LIMITE_MAXIMO) : LIMITE_POR_DEFECTO;

  return db().withTenant(principal.tenantId, async (tx) => {
    // Paginación por cursor sobre el nombre, que es único dentro del tenant.
    // Por desplazamiento (`skip`) la lista se descuadraría en cuanto alguien
    // diera de alta un proveedor mientras otro la recorre.
    const encontrados = await tx.vendor.findMany({
      where: {
        ...(busqueda === '' ? {} : { name: { contains: busqueda, mode: 'insensitive' as const } }),
        ...(cursor === undefined ? {} : { name: { gt: cursor } }),
      },
      select: CAMPOS_PROVEEDOR,
      orderBy: { name: 'asc' },
      take: limite + 1,
    });

    const hayMas = encontrados.length > limite;
    const items = hayMas ? encontrados.slice(0, limite) : encontrados;
    return NextResponse.json({
      items,
      nextCursor: hayMas ? (items.at(-1)?.name ?? null) : null,
    });
  });
});

export const POST = route(async (request: Request) => {
  const principal = await requirePermission('invoices:create');
  const datos = await parseJson(request, altaProveedor);

  return db().withTenant(principal.tenantId, async (tx) => {
    const vendor = await traduciendoConflictos(() =>
      tx.vendor.create({
        data: {
          tenantId: principal.tenantId,
          name: datos.name,
          legalName: textoOpcional(datos.legalName),
          taxId: textoOpcional(datos.taxId),
          country: datos.country ?? null,
          criticality: datos.criticality ?? 'MEDIUM',
        },
        select: CAMPOS_PROVEEDOR,
      }),
    );

    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'vendor.created',
        entity: 'vendor',
        entityId: vendor.id,
        after: { name: vendor.name, criticality: vendor.criticality },
      },
    });

    return NextResponse.json(vendor, { status: 201 });
  });
});
