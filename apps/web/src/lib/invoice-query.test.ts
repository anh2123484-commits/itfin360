import { parseIsoDate } from '@itfin360/finance-core';
import { describe, expect, it } from 'vitest';

import { whereDeFacturas } from '@/lib/invoice-query';

const VENDEDOR = 'aaaaaaa5-0000-4000-8000-000000000001';

describe('whereDeFacturas', () => {
  it('sin filtros, sin condiciones: RLS ya limita al tenant', () => {
    expect(whereDeFacturas({})).toEqual({});
  });

  it('el rango va sobre el devengo, no sobre la emisión', () => {
    // La factura de enero emitida en febrero es gasto de enero.
    const where = whereDeFacturas({
      desde: parseIsoDate('2026-01-01'),
      hasta: parseIsoDate('2026-03-31'),
    });
    expect(Object.keys(where)).toEqual(['accrualDate']);
    const rango = where.accrualDate as { gte: Date; lte: Date };
    expect(rango.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rango.lte.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('medio rango también vale', () => {
    const desde = whereDeFacturas({ desde: parseIsoDate('2026-01-01') });
    expect(desde.accrualDate).toEqual({ gte: new Date('2026-01-01T00:00:00.000Z') });

    const hasta = whereDeFacturas({ hasta: parseIsoDate('2026-03-31') });
    expect(hasta.accrualDate).toEqual({ lte: new Date('2026-03-31T00:00:00.000Z') });
  });

  it('las fechas límite se incluyen', () => {
    // `gte` y `lte`, no `gt` y `lt`: quien filtra «marzo» espera ver la factura
    // del 31 de marzo.
    const where = whereDeFacturas({ hasta: parseIsoDate('2026-03-31') });
    const rango = where.accrualDate as Record<string, unknown>;
    expect(Object.keys(rango)).toEqual(['lte']);
  });

  it('el número no distingue mayúsculas', () => {
    expect(whereDeFacturas({ numero: 'f-2026' }).invoiceNumber).toEqual({
      contains: 'f-2026',
      mode: 'insensitive',
    });
  });

  it('un número vacío no filtra nada', () => {
    expect(whereDeFacturas({ numero: '' })).toEqual({});
  });

  it('estado y proveedor entran tal cual', () => {
    expect(whereDeFacturas({ status: 'APPROVED', vendorId: VENDEDOR })).toEqual({
      status: 'APPROVED',
      vendorId: VENDEDOR,
    });
  });

  it('los filtros se combinan, no se pisan', () => {
    const where = whereDeFacturas({
      status: 'POSTED',
      vendorId: VENDEDOR,
      numero: 'F-2026',
      desde: parseIsoDate('2026-01-01'),
    });
    expect(Object.keys(where).sort()).toEqual([
      'accrualDate',
      'invoiceNumber',
      'status',
      'vendorId',
    ]);
  });
});
