import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { HttpError, parseJson, route } from '@/lib/http';
import { requireAnyPermission, requirePermission } from '@/lib/tenant-context';
import {
  CAMPOS_PROVEEDOR,
  edicionProveedor,
  textoOpcional,
  traduciendoConflictos,
} from '@/lib/vendors';

/**
 * Un proveedor concreto.
 *
 * Un proveedor de otro tenant da 404, no 403: RLS hace que la consulta
 * devuelva `null`, y un 403 confirmaría que ese identificador existe en algún
 * sitio. Es la misma decisión que en la ruta de transiciones de factura.
 */

export const GET = route(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const principal = await requireAnyPermission(['invoices:read', 'invoices:create']);

    return db().withTenant(principal.tenantId, async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id }, select: CAMPOS_PROVEEDOR });
      if (!vendor) throw new HttpError(404, 'vendor_not_found');
      return NextResponse.json(vendor);
    });
  },
);

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const principal = await requirePermission('invoices:create');
    const cambios = await parseJson(request, edicionProveedor);

    return db().withTenant(principal.tenantId, async (tx) => {
      const antes = await tx.vendor.findUnique({ where: { id }, select: CAMPOS_PROVEEDOR });
      if (!antes) throw new HttpError(404, 'vendor_not_found');

      const data = {
        ...(cambios.name === undefined ? {} : { name: cambios.name }),
        ...(cambios.legalName === undefined ? {} : { legalName: textoOpcional(cambios.legalName) }),
        ...(cambios.taxId === undefined ? {} : { taxId: textoOpcional(cambios.taxId) }),
        ...(cambios.country === undefined ? {} : { country: cambios.country }),
        ...(cambios.criticality === undefined ? {} : { criticality: cambios.criticality }),
      };

      const despues = await traduciendoConflictos(() =>
        tx.vendor.update({ where: { id }, data, select: CAMPOS_PROVEEDOR }),
      );

      // En la auditoría van sólo los campos que cambian, y su valor anterior.
      // Volcar el registro entero convertiría cada edición en una copia del
      // proveedor y haría ilegible el historial.
      const tocados = Object.keys(data) as (keyof typeof CAMPOS_PROVEEDOR)[];
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'vendor.updated',
          entity: 'vendor',
          entityId: id,
          before: Object.fromEntries(tocados.map((campo) => [campo, antes[campo]])),
          after: Object.fromEntries(tocados.map((campo) => [campo, despues[campo]])),
        },
      });

      return NextResponse.json(despues);
    });
  },
);
