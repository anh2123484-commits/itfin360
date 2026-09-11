import { requestTransition } from '@itfin360/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { HttpError, parseJson, route } from '@/lib/http';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Mueve una factura por el flujo de aprobación (F2-02).
 *
 * Aquí no hay ninguna regla de negocio: la máquina de estados vive en
 * `@itfin360/db` y es pura. Esta ruta hace lo que la máquina no puede hacer,
 * que es exactamente lo que la aceptación de F2-02 exige que ocurra en el
 * servidor: leer la factura dentro del contexto del tenant, preguntar, y
 * escribir el cambio **y su apunte de auditoría en la misma transacción**. Si
 * la auditoría fallara, la transición tampoco ocurre; una factura que cambia de
 * estado sin dejar rastro es peor que una que no cambia.
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

    return db().withTenant(principal.tenantId, async (tx) => {
      // RLS ya garantiza que sólo se ve la factura del tenant activo: si es de
      // otro tenant, esto devuelve null y la respuesta es 404, no 403. Un 403
      // confirmaría que la factura existe en algún sitio.
      const invoice = await tx.invoice.findUnique({
        where: { id },
        select: { id: true, status: true, createdById: true },
      });
      if (!invoice) throw new HttpError(404, 'invoice_not_found');

      const outcome = requestTransition({
        invoice: {
          id: invoice.id,
          status: invoice.status,
          createdById: invoice.createdById ?? undefined,
        },
        action,
        actorId: principal.userId,
        role: principal.role,
        duplicateOfId,
      });

      if (!outcome.ok) {
        return NextResponse.json(
          { error: outcome.refusal.kind.toLowerCase(), message: outcome.refusal.message },
          { status: outcome.refusal.httpStatus },
        );
      }

      const after =
        action === 'MARK_DUPLICATE' && duplicateOfId !== undefined
          ? { status: outcome.to, duplicateOfId }
          : { status: outcome.to };

      await tx.invoice.update({ where: { id }, data: after });
      await tx.auditLog.create({
        data: {
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: outcome.audit.action,
          entity: 'invoice',
          entityId: id,
          before: { status: outcome.from },
          after,
        },
      });

      return NextResponse.json({ id, from: outcome.from, to: outcome.to });
    });
  },
);
