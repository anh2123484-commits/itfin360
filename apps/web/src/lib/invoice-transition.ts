import {
  availableActions,
  type InvoiceAction,
  type InvoiceStatus,
  type Role,
  requestTransition,
  type TenantDb,
} from '@itfin360/db';

import type { Principal } from '@/lib/permissions';

/**
 * Aplicar una transición del flujo de aprobación, en un solo sitio.
 *
 * La usan `POST /api/invoices/[id]/transition` y los botones de la pantalla de
 * detalle. Es el mismo motivo que en `invoice-ops`: con la escritura duplicada,
 * una de las dos copias acaba aceptando lo que la otra rechaza, y la que se
 * queda corta es siempre la que nadie mira.
 *
 * La decisión no vive aquí. Vive en `requestTransition`, que es puro y está en
 * `@itfin360/db`. Aquí sólo ocurre lo que la función pura no puede hacer: leer
 * la factura dentro del contexto del tenant y escribir el cambio **con su
 * apunte de auditoría en la misma transacción**. Si la auditoría falla, la
 * transición tampoco ocurre. Una factura que cambia de estado sin dejar rastro
 * es peor que una que no cambia.
 */

/** Cómo ha ido la transición. */
export type ResultadoTransicion =
  | { readonly ok: true; readonly from: InvoiceStatus; readonly to: InvoiceStatus }
  | {
      readonly ok: false;
      /** 404 si no existe, 403 si el problema es quién lo pide, 409 si es el estado. */
      readonly httpStatus: 403 | 404 | 409;
      readonly motivo: string;
      readonly mensaje: string;
    };

/**
 * Lee, decide y escribe. Devuelve el rechazo en vez de lanzarlo: quien llama
 * decide si eso es un código HTTP o un mensaje en rojo debajo de los botones.
 */
export async function aplicarTransicion(
  tx: TenantDb,
  principal: Principal,
  invoiceId: string,
  action: InvoiceAction,
  duplicateOfId?: string | undefined,
): Promise<ResultadoTransicion> {
  // RLS ya limita a las facturas del tenant activo: una de otro tenant sale
  // como inexistente, y la respuesta es 404. Un 403 confirmaría que existe en
  // algún sitio.
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, createdById: true },
  });
  if (!invoice) {
    return {
      ok: false,
      httpStatus: 404,
      motivo: 'invoice_not_found',
      mensaje: 'Esa factura no existe.',
    };
  }

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
    return {
      ok: false,
      httpStatus: outcome.refusal.httpStatus,
      motivo: outcome.refusal.kind.toLowerCase(),
      mensaje: outcome.refusal.message,
    };
  }

  const after =
    action === 'MARK_DUPLICATE' && duplicateOfId !== undefined
      ? { status: outcome.to, duplicateOfId }
      : { status: outcome.to };

  await tx.invoice.update({ where: { id: invoiceId }, data: after });
  await tx.auditLog.create({
    data: {
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: outcome.audit.action,
      entity: 'invoice',
      entityId: invoiceId,
      before: { status: outcome.from },
      after,
    },
  });

  return { ok: true, from: outcome.from, to: outcome.to };
}

/**
 * Nombre de cada acción en castellano.
 *
 * `Record<InvoiceAction, string>` obliga a que estén todas: si la máquina de
 * estados gana una acción, esto deja de compilar en vez de enseñar el verbo
 * crudo en un botón.
 */
export const ETIQUETA_ACCION: Readonly<Record<InvoiceAction, string>> = {
  SUBMIT: 'Mandar a revisión',
  APPROVE: 'Aprobar',
  POST: 'Contabilizar',
  REOPEN: 'Devolver a borrador',
  REJECT: 'Rechazar',
  MARK_DUPLICATE: 'Marcar como duplicada',
};

/**
 * Orden en pantalla: primero lo que hace avanzar la factura, después lo que la
 * frena. Sin un orden fijo, los botones bailan de sitio según el estado y se
 * acaba pulsando el que no era.
 */
export const ORDEN_ACCIONES: readonly InvoiceAction[] = [
  'SUBMIT',
  'APPROVE',
  'POST',
  'REOPEN',
  'REJECT',
  'MARK_DUPLICATE',
];

/**
 * Acciones con botón en la pantalla de detalle.
 *
 * `MARK_DUPLICATE` no está: exige decir de qué factura es copia, y elegirla
 * pide una búsqueda que es su propia pantalla (F2-03). La API sí la acepta, así
 * que la función está disponible aunque todavía no tenga botón.
 */
export const ACCIONES_CON_BOTON: readonly InvoiceAction[] = [
  'SUBMIT',
  'APPROVE',
  'POST',
  'REOPEN',
  'REJECT',
];

/** Acciones que quitan valor a la factura; se pintan distinto. */
export const ACCIONES_DESTRUCTIVAS: readonly InvoiceAction[] = ['REJECT', 'MARK_DUPLICATE'];

/**
 * Las acciones que este rol puede pedir ahora mismo, en orden de pantalla.
 *
 * Esconder un botón es comodidad, no control: la transición se vuelve a
 * comprobar en el servidor con la misma función pura. Lo que impide de verdad
 * la transición es `requestTransition`, no la ausencia del botón.
 */
export function accionesVisibles(status: InvoiceStatus, role: Role): readonly InvoiceAction[] {
  const disponibles = new Set(availableActions(status, role));
  return ORDEN_ACCIONES.filter((accion) => disponibles.has(accion));
}

/** Las anteriores, quedándose sólo con las que tienen botón. */
export function botonesVisibles(status: InvoiceStatus, role: Role): readonly InvoiceAction[] {
  return accionesVisibles(status, role).filter((accion) => ACCIONES_CON_BOTON.includes(accion));
}
