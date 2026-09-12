import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { HttpError, parseJson, route } from '@/lib/http';
import { aplicarTransicion } from '@/lib/invoice-transition';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Mueve una factura por el flujo de aprobación (F2-02).
 *
 * Aquí no hay ninguna regla de negocio. La máquina de estados vive en
 * `@itfin360/db` y es pura; leer la factura y escribir el cambio con su apunte
 * de auditoría en la misma transacción vive en `@/lib/invoice-transition`, que
 * es lo que usan también los botones de la pantalla de detalle. Esta ruta sólo
 * traduce: cuerpo a parámetros, resultado a código HTTP.
 *
 * El rechazo no pasa por `HttpError` a propósito: `errorResponse` sólo devuelve
 * el código, y aquí el mensaje de la máquina de estados es la mitad del valor
 * («se esperaba PENDING_REVIEW», «sólo OWNER, FINANCE»). Ese texto no contiene
 * datos de la factura ni de nadie, sólo nombres de estados y de roles, así que
 * puede viajar sin romper la regla de cero PII en respuestas de error.
 */

const cuerpo = z.object({
  action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'POST', 'REOPEN', 'MARK_DUPLICATE']),
  /** Sólo se usa en `MARK_DUPLICATE`; la máquina de estados exige que esté. */
  duplicateOfId: z.uuid().optional(),
});

export const POST = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const principal = await requirePermission('invoices:create');
    const { action, duplicateOfId } = await parseJson(request, cuerpo);

    const resultado = await db().withTenant(principal.tenantId, (tx) =>
      aplicarTransicion(tx, principal, id, action, duplicateOfId),
    );

    if (!resultado.ok) {
      // El 404 sí es un error de recurso y va por el camino de siempre, para
      // que el cuerpo tenga la misma forma que el resto de 404 de la API.
      if (resultado.httpStatus === 404) throw new HttpError(404, 'invoice_not_found');
      return NextResponse.json(
        { error: resultado.motivo, message: resultado.mensaje },
        { status: resultado.httpStatus },
      );
    }

    return NextResponse.json({ id, from: resultado.from, to: resultado.to });
  },
);
