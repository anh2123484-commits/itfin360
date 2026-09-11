/**
 * Flujo de aprobación de una factura (F2-02).
 *
 * `DRAFT → PENDING_REVIEW → APPROVED → POSTED`, con rechazo y marcado de
 * duplicado. La aceptación de F2-02 dice que las transiciones inválidas se
 * rechazan **en servidor**: por eso la regla vive aquí, en una función pura sin
 * I/O, y no en el formulario. Una pantalla que esconde un botón es una ayuda,
 * no un control; el control es que la transición no ocurra.
 *
 * Este módulo **no lanza excepciones**. Devuelve el resultado con el motivo del
 * rechazo, para que la capa de API lo traduzca a su código HTTP —403 si el rol
 * no llega, 409 si el estado no encaja— y a un mensaje que la persona entienda.
 * Un `throw` obligaría a cada llamada a distinguir a ciegas entre las dos cosas.
 *
 * También devuelve el apunte de auditoría que hay que escribir. Escribirlo es
 * I/O y vive fuera; decidir qué dice no lo es, y aquí hay un test que fija que
 * toda transición válida lo produce.
 */

/**
 * Estados, en el orden del enum `InvoiceStatus` del esquema.
 *
 * Se declaran aquí como literales en vez de importarse del cliente generado
 * para que este módulo siga siendo puro y se pueda razonar sobre él sin haber
 * ejecutado `prisma generate`. `invoice-workflow-enums.test.ts` comprueba que
 * la lista coincide con la del esquema.
 */
export const INVOICE_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'DUPLICATE',
] as const;

/** Estado de una factura. */
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Roles, en el orden del enum `Role` del esquema. */
export const INVOICE_ROLES = [
  'OWNER',
  'FINANCE',
  'IT_MANAGER',
  'PROJECT_MANAGER',
  'CONTRIBUTOR',
  'VIEWER',
] as const;

/** Rol de quien pide una transición. */
export type InvoiceRole = (typeof INVOICE_ROLES)[number];

/** Lo que alguien puede pedir hacerle a una factura. */
export type InvoiceAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'POST' | 'REOPEN' | 'MARK_DUPLICATE';

/** Quién puede llevar una factura de dónde a dónde. */
export interface TransitionRule {
  readonly from: readonly InvoiceStatus[];
  readonly to: InvoiceStatus;
  readonly roles: readonly InvoiceRole[];
  /** Verbo para el `action` del apunte de auditoría. */
  readonly auditAction: string;
}

/**
 * Quien puede registrar y corregir facturas, sin poder aprobarlas.
 *
 * Coincide exactamente con quien tiene el permiso `invoices:create` en la
 * matriz de roles de `docs/01` §7. `PROJECT_MANAGER` no está: gestiona
 * proyectos y sus horas, no la entrada de facturas. Hay un test en `apps/web`
 * que comprueba que las dos listas no se separan; si lo hicieran, un rol
 * tendría el botón y recibiría un 403 al pulsarlo, o al revés.
 */
const REGISTRA: readonly InvoiceRole[] = ['OWNER', 'FINANCE', 'IT_MANAGER', 'CONTRIBUTOR'];

/** Quien decide sobre el dinero. `VIEWER` no aparece en ninguna transición. */
const APRUEBA: readonly InvoiceRole[] = ['OWNER', 'FINANCE'];

/**
 * La máquina de estados completa.
 *
 * `POSTED` no aparece como origen de ninguna transición: una factura
 * contabilizada no se reabre. Corregirla es un ajuste fechado en el periodo
 * abierto (F6-05), no una reescritura del pasado, porque un periodo cerrado que
 * cambia deja de poder auditarse.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceAction, TransitionRule>> = {
  SUBMIT: {
    from: ['DRAFT', 'REJECTED'],
    to: 'PENDING_REVIEW',
    roles: REGISTRA,
    auditAction: 'invoice.submitted',
  },
  APPROVE: {
    from: ['PENDING_REVIEW'],
    to: 'APPROVED',
    roles: APRUEBA,
    auditAction: 'invoice.approved',
  },
  REJECT: {
    // También desde APPROVED: entre aprobar y contabilizar puede aparecer el
    // motivo por el que la factura no debía aprobarse.
    from: ['PENDING_REVIEW', 'APPROVED'],
    to: 'REJECTED',
    roles: APRUEBA,
    auditAction: 'invoice.rejected',
  },
  POST: {
    from: ['APPROVED'],
    to: 'POSTED',
    roles: APRUEBA,
    auditAction: 'invoice.posted',
  },
  REOPEN: {
    from: ['REJECTED'],
    to: 'DRAFT',
    roles: REGISTRA,
    auditAction: 'invoice.reopened',
  },
  MARK_DUPLICATE: {
    from: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'],
    to: 'DUPLICATE',
    roles: APRUEBA,
    auditAction: 'invoice.marked_duplicate',
  },
};

/** Estados desde los que ya no se puede mover una factura. */
export const TERMINAL_STATUSES: readonly InvoiceStatus[] = ['POSTED', 'DUPLICATE'];

/**
 * Si el contenido de la factura todavía se puede editar.
 *
 * Bajo revisión no: quien revisa tiene que estar mirando lo mismo que se le
 * mandó. Para corregir algo hay que rechazarla o devolverla a borrador, y eso
 * queda auditado.
 */
export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

/** Por qué no se ha hecho la transición. */
export type RefusalKind =
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_ROLE'
  | 'MISSING_DUPLICATE_OF'
  | 'DUPLICATE_OF_SELF'
  | 'SELF_APPROVAL';

/** Rechazo con lo necesario para explicarlo y para elegir el código HTTP. */
export interface TransitionRefusal {
  readonly kind: RefusalKind;
  /** 403 cuando el problema es quién lo pide; 409 cuando es el estado. */
  readonly httpStatus: 403 | 409;
  readonly message: string;
}

/** Apunte de auditoría a escribir. Los campos son los de `AuditLog`. */
export interface InvoiceAuditEntry {
  readonly action: string;
  readonly entity: 'invoice';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

/** La factura, con lo justo para decidir. */
export interface InvoiceForTransition {
  readonly id: string;
  readonly status: InvoiceStatus;
  /** Quién la registró, para la segregación de funciones. */
  readonly createdById?: string | undefined;
}

/** Quién pide la transición y con qué datos. */
export interface TransitionRequest {
  readonly invoice: InvoiceForTransition;
  readonly action: InvoiceAction;
  readonly actorId: string;
  readonly role: InvoiceRole;
  /** Obligatorio en `MARK_DUPLICATE`: la factura de la que ésta es copia. */
  readonly duplicateOfId?: string | undefined;
  /**
   * Si quien registró la factura no puede aprobarla ni contabilizarla.
   *
   * Es el control de las cuatro manos. Por defecto **desactivado**: en un
   * departamento de dos personas lo habitual es que quien teclea la factura sea
   * también quien la aprueba, y activarlo por defecto dejaría el flujo
   * bloqueado el primer día. Se enciende por tenant cuando hay gente suficiente.
   */
  readonly requireSegregationOfDuties?: boolean | undefined;
}

/** Transición concedida. */
export interface TransitionAccepted {
  readonly ok: true;
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;
  /** Campos a escribir en la factura. */
  readonly patch: Readonly<Record<string, unknown>>;
  readonly audit: InvoiceAuditEntry;
}

/** Transición denegada, con el motivo. */
export interface TransitionRejected {
  readonly ok: false;
  readonly refusal: TransitionRefusal;
}

/** Resultado de pedir una transición. */
export type TransitionOutcome = TransitionAccepted | TransitionRejected;

function refuse(kind: RefusalKind, httpStatus: 403 | 409, message: string): TransitionRejected {
  return { ok: false, refusal: { kind, httpStatus, message } };
}

/** Lista de estados en prosa, para el mensaje de rechazo. */
function enumerar(estados: readonly InvoiceStatus[]): string {
  if (estados.length === 1) return estados[0] ?? '';
  return `${estados.slice(0, -1).join(', ')} o ${estados.at(-1) ?? ''}`;
}

/**
 * Decide si una transición procede y, si procede, qué hay que escribir.
 *
 * El orden de las comprobaciones es deliberado: primero el estado, después el
 * rol. Quien no tiene permiso no debería poder distinguir, por el mensaje, en
 * qué estado está una factura que no le corresponde; pero el estado inválido es
 * un error del cliente que conviene explicar, y el rol insuficiente ya se filtra
 * antes por RLS y por la sesión. Si esto cambiara, el orden tendría que
 * invertirse.
 */
export function requestTransition(request: TransitionRequest): TransitionOutcome {
  const { invoice, action, role, actorId } = request;
  const rule = INVOICE_TRANSITIONS[action];

  if (!rule.from.includes(invoice.status)) {
    const terminal = TERMINAL_STATUSES.includes(invoice.status);
    const motivo = terminal
      ? `Una factura en ${invoice.status} ya no se mueve.`
      : `Se esperaba ${enumerar(rule.from)}.`;
    return refuse(
      'INVALID_TRANSITION',
      409,
      `No se puede aplicar ${action} a una factura en ${invoice.status}. ${motivo}`,
    );
  }

  if (!rule.roles.includes(role)) {
    return refuse(
      'FORBIDDEN_ROLE',
      403,
      `El rol ${role} no puede aplicar ${action}. Sólo ${rule.roles.join(', ')}.`,
    );
  }

  const apruebaOContabiliza = action === 'APPROVE' || action === 'POST';
  if (
    request.requireSegregationOfDuties === true &&
    apruebaOContabiliza &&
    invoice.createdById !== undefined &&
    invoice.createdById === actorId
  ) {
    return refuse(
      'SELF_APPROVAL',
      403,
      'Quien registra una factura no puede aprobarla ni contabilizarla.',
    );
  }

  const patch: Record<string, unknown> = { status: rule.to };
  const after: Record<string, unknown> = { status: rule.to };

  if (action === 'MARK_DUPLICATE') {
    const { duplicateOfId } = request;
    if (duplicateOfId === undefined || duplicateOfId === '') {
      return refuse(
        'MISSING_DUPLICATE_OF',
        409,
        'Marcar una factura como duplicada exige decir de cuál es copia.',
      );
    }
    if (duplicateOfId === invoice.id) {
      return refuse('DUPLICATE_OF_SELF', 409, 'Una factura no puede ser copia de sí misma.');
    }
    patch['duplicateOfId'] = duplicateOfId;
    after['duplicateOfId'] = duplicateOfId;
  }

  return {
    ok: true,
    from: invoice.status,
    to: rule.to,
    patch,
    audit: {
      action: rule.auditAction,
      entity: 'invoice',
      entityId: invoice.id,
      before: { status: invoice.status },
      after,
    },
  };
}

/** Las acciones que un rol puede pedir sobre una factura en su estado actual. */
export function availableActions(
  status: InvoiceStatus,
  role: InvoiceRole,
): readonly InvoiceAction[] {
  const acciones: InvoiceAction[] = [];
  for (const action of Object.keys(INVOICE_TRANSITIONS) as InvoiceAction[]) {
    const rule = INVOICE_TRANSITIONS[action];
    if (rule.from.includes(status) && rule.roles.includes(role)) acciones.push(action);
  }
  return acciones;
}
