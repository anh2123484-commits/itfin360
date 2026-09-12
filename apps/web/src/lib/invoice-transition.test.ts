import { INVOICE_TRANSITIONS, type TenantDb } from '@itfin360/db';
import { describe, expect, it } from 'vitest';

import {
  ACCIONES_CON_BOTON,
  accionesVisibles,
  aplicarTransicion,
  botonesVisibles,
  ETIQUETA_ACCION,
  ORDEN_ACCIONES,
} from '@/lib/invoice-transition';
import type { Principal } from '@/lib/permissions';

const FACTURA = 'aaaaaaa5-0000-4000-8000-000000000001';
const QUIEN = 'bbbbbbb5-0000-4000-8000-000000000002';

const PRINCIPAL: Principal = {
  userId: QUIEN,
  tenantId: 'ccccccc5-0000-4000-8000-000000000003',
  role: 'FINANCE',
  canViewCompensation: false,
};

/** Doble de `TenantDb` que recuerda lo que se le ha pedido escribir. */
function dbFalsa(invoice: { id: string; status: string; createdById: string | null } | null) {
  const escrituras: { tabla: string; datos: unknown }[] = [];
  const tx = {
    invoice: {
      findUnique: () => Promise.resolve(invoice),
      update: ({ data }: { data: unknown }) => {
        escrituras.push({ tabla: 'invoice', datos: data });
        return Promise.resolve({});
      },
    },
    auditLog: {
      create: ({ data }: { data: unknown }) => {
        escrituras.push({ tabla: 'auditLog', datos: data });
        return Promise.resolve({});
      },
    },
  };
  return { tx: tx as unknown as TenantDb, escrituras };
}

describe('etiquetas y orden', () => {
  it('toda acción de la máquina de estados tiene etiqueta y sitio en el orden', () => {
    const acciones = Object.keys(INVOICE_TRANSITIONS).sort();
    expect(Object.keys(ETIQUETA_ACCION).sort()).toEqual(acciones);
    expect([...ORDEN_ACCIONES].sort()).toEqual(acciones);
  });

  it('ninguna etiqueta se repite', () => {
    const textos = Object.values(ETIQUETA_ACCION);
    expect(new Set(textos).size).toBe(textos.length);
  });

  it('marcar duplicada no tiene botón todavía, pero sí existe como acción', () => {
    expect(ACCIONES_CON_BOTON).not.toContain('MARK_DUPLICATE');
    expect(ORDEN_ACCIONES).toContain('MARK_DUPLICATE');
  });
});

describe('acciones visibles', () => {
  it('en borrador, finanzas manda a revisión y puede marcar duplicada', () => {
    expect(accionesVisibles('DRAFT', 'FINANCE')).toEqual(['SUBMIT', 'MARK_DUPLICATE']);
  });

  it('en revisión, finanzas aprueba antes de rechazar', () => {
    // El orden importa: primero lo que hace avanzar, después lo que frena.
    expect(accionesVisibles('PENDING_REVIEW', 'FINANCE')).toEqual([
      'APPROVE',
      'REJECT',
      'MARK_DUPLICATE',
    ]);
  });

  it('quien sólo registra no aprueba', () => {
    expect(accionesVisibles('PENDING_REVIEW', 'CONTRIBUTOR')).toEqual([]);
    expect(accionesVisibles('DRAFT', 'CONTRIBUTOR')).toEqual(['SUBMIT']);
  });

  it('una factura contabilizada ya no se mueve', () => {
    expect(accionesVisibles('POSTED', 'OWNER')).toEqual([]);
    expect(accionesVisibles('DUPLICATE', 'OWNER')).toEqual([]);
  });

  it('el visor no tiene ninguna acción en ningún estado', () => {
    for (const estado of ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const) {
      expect(accionesVisibles(estado, 'VIEWER')).toEqual([]);
    }
  });

  it('los botones son las acciones visibles menos las que no tienen pantalla', () => {
    expect(botonesVisibles('PENDING_REVIEW', 'FINANCE')).toEqual(['APPROVE', 'REJECT']);
  });
});

describe('aplicarTransicion', () => {
  it('una factura que no se ve es un 404, no un 403', async () => {
    // RLS deja fuera las de otros tenants. Un 403 confirmaría que existe.
    const { tx, escrituras } = dbFalsa(null);
    const resultado = await aplicarTransicion(tx, PRINCIPAL, FACTURA, 'APPROVE');
    expect(resultado).toEqual({
      ok: false,
      httpStatus: 404,
      motivo: 'invoice_not_found',
      mensaje: 'Esa factura no existe.',
    });
    expect(escrituras).toEqual([]);
  });

  it('un estado que no encaja no escribe nada', async () => {
    const { tx, escrituras } = dbFalsa({ id: FACTURA, status: 'DRAFT', createdById: QUIEN });
    const resultado = await aplicarTransicion(tx, PRINCIPAL, FACTURA, 'APPROVE');
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.httpStatus).toBe(409);
    expect(escrituras).toEqual([]);
  });

  it('un rol que no llega es 403', async () => {
    const { tx } = dbFalsa({ id: FACTURA, status: 'PENDING_REVIEW', createdById: QUIEN });
    const resultado = await aplicarTransicion(
      tx,
      { ...PRINCIPAL, role: 'CONTRIBUTOR' },
      FACTURA,
      'APPROVE',
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.httpStatus).toBe(403);
  });

  it('la transición válida escribe el estado y su apunte de auditoría', async () => {
    const { tx, escrituras } = dbFalsa({
      id: FACTURA,
      status: 'PENDING_REVIEW',
      createdById: QUIEN,
    });
    const resultado = await aplicarTransicion(tx, PRINCIPAL, FACTURA, 'APPROVE');

    expect(resultado).toEqual({ ok: true, from: 'PENDING_REVIEW', to: 'APPROVED' });
    expect(escrituras.map((e) => e.tabla)).toEqual(['invoice', 'auditLog']);
    expect(escrituras[0]?.datos).toEqual({ status: 'APPROVED' });

    const apunte = escrituras[1]?.datos as Record<string, unknown>;
    expect(apunte['action']).toBe('invoice.approved');
    expect(apunte['entity']).toBe('invoice');
    expect(apunte['entityId']).toBe(FACTURA);
    expect(apunte['actorId']).toBe(QUIEN);
    expect(apunte['before']).toEqual({ status: 'PENDING_REVIEW' });
    expect(apunte['after']).toEqual({ status: 'APPROVED' });
  });

  it('marcar duplicada sin decir de cuál no escribe nada', async () => {
    const { tx, escrituras } = dbFalsa({ id: FACTURA, status: 'DRAFT', createdById: QUIEN });
    const resultado = await aplicarTransicion(tx, PRINCIPAL, FACTURA, 'MARK_DUPLICATE');
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toBe('missing_duplicate_of');
    expect(escrituras).toEqual([]);
  });

  it('marcar duplicada guarda de qué factura es copia', async () => {
    const original = 'ddddddd5-0000-4000-8000-000000000004';
    const { tx, escrituras } = dbFalsa({ id: FACTURA, status: 'DRAFT', createdById: QUIEN });
    const resultado = await aplicarTransicion(tx, PRINCIPAL, FACTURA, 'MARK_DUPLICATE', original);

    expect(resultado).toEqual({ ok: true, from: 'DRAFT', to: 'DUPLICATE' });
    expect(escrituras[0]?.datos).toEqual({ status: 'DUPLICATE', duplicateOfId: original });
  });
});
