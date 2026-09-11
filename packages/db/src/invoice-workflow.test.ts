import { describe, expect, it } from 'vitest';

import {
  INVOICE_TRANSITIONS,
  TERMINAL_STATUSES,
  availableActions,
  canEditInvoice,
  requestTransition,
  type InvoiceAction,
  type InvoiceRole,
  type InvoiceStatus,
  type TransitionRequest,
} from './invoice-workflow.js';

const ACTOR = 'user-que-registra';
const REVISOR = 'user-que-aprueba';

const pedir = (
  status: InvoiceStatus,
  action: InvoiceAction,
  role: InvoiceRole,
  extra: Partial<TransitionRequest> = {},
): ReturnType<typeof requestTransition> =>
  requestTransition({
    invoice: { id: 'inv-1', status, createdById: ACTOR },
    action,
    actorId: REVISOR,
    role,
    ...extra,
  });

const TODOS_LOS_ESTADOS: readonly InvoiceStatus[] = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'DUPLICATE',
];

const TODOS_LOS_ROLES: readonly InvoiceRole[] = [
  'OWNER',
  'FINANCE',
  'IT_MANAGER',
  'PROJECT_MANAGER',
  'CONTRIBUTOR',
  'VIEWER',
];

describe('el camino feliz de una factura', () => {
  it('recorre DRAFT → PENDING_REVIEW → APPROVED → POSTED', () => {
    const submit = pedir('DRAFT', 'SUBMIT', 'CONTRIBUTOR');
    expect(submit.ok && submit.to).toBe('PENDING_REVIEW');

    const approve = pedir('PENDING_REVIEW', 'APPROVE', 'FINANCE');
    expect(approve.ok && approve.to).toBe('APPROVED');

    const post = pedir('APPROVED', 'POST', 'FINANCE');
    expect(post.ok && post.to).toBe('POSTED');
  });

  it('cada transición válida deja su apunte de auditoría', () => {
    for (const action of Object.keys(INVOICE_TRANSITIONS) as InvoiceAction[]) {
      const rule = INVOICE_TRANSITIONS[action];
      const desde = rule.from[0];
      const rol = rule.roles[0];
      if (desde === undefined || rol === undefined) throw new Error(`Regla vacía: ${action}`);
      const r = pedir(desde, action, rol, { duplicateOfId: 'inv-original' });
      expect(r.ok, action).toBe(true);
      if (!r.ok) continue;
      expect(r.audit.entity).toBe('invoice');
      expect(r.audit.entityId).toBe('inv-1');
      expect(r.audit.action.startsWith('invoice.')).toBe(true);
      expect(r.audit.before).toEqual({ status: desde });
      expect(r.audit.after['status']).toBe(rule.to);
    }
  });
});

describe('transiciones inválidas', () => {
  it('una factura contabilizada ya no se mueve', () => {
    for (const action of Object.keys(INVOICE_TRANSITIONS) as InvoiceAction[]) {
      const r = pedir('POSTED', action, 'OWNER');
      expect(r.ok, action).toBe(false);
      if (r.ok) continue;
      expect(r.refusal.kind).toBe('INVALID_TRANSITION');
      expect(r.refusal.httpStatus).toBe(409);
    }
  });

  it('una factura marcada como duplicada tampoco', () => {
    for (const action of Object.keys(INVOICE_TRANSITIONS) as InvoiceAction[]) {
      expect(pedir('DUPLICATE', action, 'OWNER').ok, action).toBe(false);
    }
  });

  it('no se aprueba un borrador sin pasar por revisión', () => {
    const r = pedir('DRAFT', 'APPROVE', 'FINANCE');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('INVALID_TRANSITION');
    expect(r.refusal.message).toContain('PENDING_REVIEW');
  });

  it('no se contabiliza lo que no está aprobado', () => {
    expect(pedir('PENDING_REVIEW', 'POST', 'FINANCE').ok).toBe(false);
    expect(pedir('DRAFT', 'POST', 'OWNER').ok).toBe(false);
  });

  it('el mensaje dice en qué estado está y cuál se esperaba', () => {
    const r = pedir('APPROVED', 'SUBMIT', 'CONTRIBUTOR');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.message).toContain('APPROVED');
    expect(r.refusal.message).toContain('DRAFT');
  });
});

describe('quién puede qué', () => {
  it('sólo FINANCE y OWNER aprueban y contabilizan', () => {
    for (const role of TODOS_LOS_ROLES) {
      const puede = role === 'FINANCE' || role === 'OWNER';
      expect(pedir('PENDING_REVIEW', 'APPROVE', role).ok, role).toBe(puede);
      expect(pedir('APPROVED', 'POST', role).ok, role).toBe(puede);
      expect(pedir('PENDING_REVIEW', 'REJECT', role).ok, role).toBe(puede);
    }
  });

  it('VIEWER no puede hacer absolutamente nada', () => {
    for (const status of TODOS_LOS_ESTADOS) {
      expect(availableActions(status, 'VIEWER'), status).toEqual([]);
    }
  });

  it('un contribuidor registra y corrige, pero no aprueba', () => {
    expect(pedir('DRAFT', 'SUBMIT', 'CONTRIBUTOR').ok).toBe(true);
    expect(pedir('REJECTED', 'REOPEN', 'CONTRIBUTOR').ok).toBe(true);
    const r = pedir('PENDING_REVIEW', 'APPROVE', 'CONTRIBUTOR');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('FORBIDDEN_ROLE');
    expect(r.refusal.httpStatus).toBe(403);
  });

  it('el estado manda sobre el rol en el orden de las comprobaciones', () => {
    // Rol insuficiente y estado imposible a la vez: gana el estado.
    const r = pedir('POSTED', 'APPROVE', 'VIEWER');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('INVALID_TRANSITION');
  });
});

describe('marcado de duplicado', () => {
  it('exige decir de qué factura es copia', () => {
    const r = pedir('PENDING_REVIEW', 'MARK_DUPLICATE', 'FINANCE');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('MISSING_DUPLICATE_OF');
  });

  it('una factura no puede ser copia de sí misma', () => {
    const r = pedir('PENDING_REVIEW', 'MARK_DUPLICATE', 'FINANCE', { duplicateOfId: 'inv-1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('DUPLICATE_OF_SELF');
  });

  it('escribe el enlace a la original en la factura y en la auditoría', () => {
    const r = pedir('APPROVED', 'MARK_DUPLICATE', 'OWNER', { duplicateOfId: 'inv-original' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toEqual({ status: 'DUPLICATE', duplicateOfId: 'inv-original' });
    expect(r.audit.after['duplicateOfId']).toBe('inv-original');
  });

  it('una cadena vacía no vale como referencia', () => {
    const r = pedir('DRAFT', 'MARK_DUPLICATE', 'FINANCE', { duplicateOfId: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('MISSING_DUPLICATE_OF');
  });
});

describe('segregación de funciones', () => {
  const propia: TransitionRequest = {
    invoice: { id: 'inv-1', status: 'PENDING_REVIEW', createdById: ACTOR },
    action: 'APPROVE',
    actorId: ACTOR,
    role: 'FINANCE',
  };

  it('está desactivada por defecto: un departamento de dos personas no se bloquea', () => {
    expect(requestTransition(propia).ok).toBe(true);
  });

  it('activada, quien registra no aprueba ni contabiliza', () => {
    const aprobar = requestTransition({ ...propia, requireSegregationOfDuties: true });
    expect(aprobar.ok).toBe(false);
    if (aprobar.ok) return;
    expect(aprobar.refusal.kind).toBe('SELF_APPROVAL');
    expect(aprobar.refusal.httpStatus).toBe(403);

    const contabilizar = requestTransition({
      ...propia,
      invoice: { id: 'inv-1', status: 'APPROVED', createdById: ACTOR },
      action: 'POST',
      requireSegregationOfDuties: true,
    });
    expect(contabilizar.ok).toBe(false);
  });

  it('activada, otra persona sí puede', () => {
    const r = requestTransition({
      ...propia,
      actorId: REVISOR,
      requireSegregationOfDuties: true,
    });
    expect(r.ok).toBe(true);
  });

  it('no afecta a rechazar ni a registrar', () => {
    const rechazo = requestTransition({
      ...propia,
      action: 'REJECT',
      requireSegregationOfDuties: true,
    });
    expect(rechazo.ok).toBe(true);
  });

  it('sin saber quién la registró, no se bloquea nada', () => {
    const r = requestTransition({
      ...propia,
      invoice: { id: 'inv-1', status: 'PENDING_REVIEW' },
      requireSegregationOfDuties: true,
    });
    expect(r.ok).toBe(true);
  });
});

describe('edición del contenido', () => {
  it('sólo se edita en borrador o tras un rechazo', () => {
    expect(canEditInvoice('DRAFT')).toBe(true);
    expect(canEditInvoice('REJECTED')).toBe(true);
    // Bajo revisión no: quien revisa tiene que ver lo que se le mandó.
    expect(canEditInvoice('PENDING_REVIEW')).toBe(false);
    expect(canEditInvoice('APPROVED')).toBe(false);
    expect(canEditInvoice('POSTED')).toBe(false);
    expect(canEditInvoice('DUPLICATE')).toBe(false);
  });

  it('ningún estado terminal es editable', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(canEditInvoice(status), status).toBe(false);
    }
  });
});

describe('availableActions', () => {
  it('en borrador, quien registra sólo puede mandarla a revisión', () => {
    expect(availableActions('DRAFT', 'CONTRIBUTOR')).toEqual(['SUBMIT']);
  });

  it('en revisión, finanzas aprueba, rechaza o marca duplicado', () => {
    expect([...availableActions('PENDING_REVIEW', 'FINANCE')].sort()).toEqual([
      'APPROVE',
      'MARK_DUPLICATE',
      'REJECT',
    ]);
  });

  it('coincide siempre con lo que acepta requestTransition', () => {
    for (const status of TODOS_LOS_ESTADOS) {
      for (const role of TODOS_LOS_ROLES) {
        const disponibles = availableActions(status, role);
        for (const action of Object.keys(INVOICE_TRANSITIONS) as InvoiceAction[]) {
          const r = pedir(status, action, role, { duplicateOfId: 'inv-original' });
          expect(r.ok, `${status}/${role}/${action}`).toBe(disponibles.includes(action));
        }
      }
    }
  });

  it('desde un estado terminal no hay nada disponible para nadie', () => {
    for (const status of TERMINAL_STATUSES) {
      for (const role of TODOS_LOS_ROLES) {
        expect(availableActions(status, role), `${status}/${role}`).toEqual([]);
      }
    }
  });
});
