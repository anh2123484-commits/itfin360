import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_DUPLICATE_CONFIG,
  findDuplicates,
  flaggedInvoiceIds,
  normalizeInvoiceNumber,
  type InvoiceForDuplicates,
} from './duplicates.js';

const fac = (
  invoiceId: string,
  supplierId: string,
  invoiceNumber: string,
  issueDate: string,
  importe: number,
): InvoiceForDuplicates => ({
  invoiceId,
  supplierId,
  invoiceNumber,
  issueDate,
  totalCents: cents(importe),
});

describe('normalizeInvoiceNumber', () => {
  it('la misma factura escrita de tres formas da la misma clave', () => {
    const esperada = normalizeInvoiceNumber('F-2026/0001');
    expect(normalizeInvoiceNumber('f2026 0001')).toBe(esperada);
    expect(normalizeInvoiceNumber('F 2026-0001')).toBe(esperada);
    expect(esperada).toBe('F20260001');
  });

  it('no confunde dos números distintos', () => {
    expect(normalizeInvoiceNumber('F-2026/0001')).not.toBe(normalizeInvoiceNumber('F-2026/0010'));
  });

  it('un número vacío se queda vacío', () => {
    expect(normalizeInvoiceNumber('   ')).toBe('');
    expect(normalizeInvoiceNumber('')).toBe('');
  });
});

describe('findDuplicates · mismo número de factura', () => {
  it('el mismo número del mismo proveedor es duplicado seguro', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-2026/0001', '2026-03-01', 120_000),
      fac('i2', 'prov-a', 'f2026 0001', '2026-05-20', 999_999),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.reason).toBe('SAME_INVOICE_NUMBER');
    expect(r[0]?.confidence).toBe(1);
    // La antigua es la original; la que llegó después es la sospechosa.
    expect(r[0]?.duplicateOfId).toBe('i1');
    expect(r[0]?.invoiceId).toBe('i2');
  });

  it('el mismo número de proveedores distintos no es duplicado', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-2026/0001', '2026-03-01', 120_000),
      fac('i2', 'prov-b', 'F-2026/0001', '2026-03-01', 120_000),
    ]);
    expect(r).toEqual([]);
  });

  it('un número vacío no vale como prueba: media importación viene sin número', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', '', '2026-03-01', 120_000),
      fac('i2', 'prov-a', '', '2026-09-01', 340_000),
    ]);
    expect(r).toEqual([]);
  });

  it('la explicación nombra el número que ya estaba registrado', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-2026/0001', '2026-03-01', 120_000),
      fac('i2', 'prov-a', 'F-2026/0001', '2026-03-02', 120_000),
    ]);
    expect(r[0]?.explanation).toContain('F-2026/0001');
  });
});

describe('findDuplicates · mismo importe y fechas cercanas', () => {
  it('mismo importe el mismo día se marca con la confianza más alta', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-10', 250_000),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.reason).toBe('SAME_AMOUNT_AND_DATE');
    expect(r[0]?.confidence).toBeCloseTo(DEFAULT_DUPLICATE_CONFIG.sameDayConfidence, 10);
  });

  it('la confianza baja según se separan las fechas', () => {
    const cerca = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-11', 250_000),
    ]);
    const lejos = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-15', 250_000),
    ]);
    expect(cerca[0]?.confidence).toBeGreaterThan(lejos[0]?.confidence ?? 1);
    expect(lejos[0]?.confidence).toBeCloseTo(0.9 - 0.05 * 5, 10);
  });

  it('fuera de la ventana de cinco días ya no se marca', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-16', 250_000),
    ]);
    expect(r).toEqual([]);
  });

  it('importes distintos nunca se marcan, por cerca que estén las fechas', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-10', 250_001),
    ]);
    expect(r).toEqual([]);
  });

  it('una suscripción mensual del mismo importe NO se marca a sí misma', () => {
    const meses = [
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
      '2026-06-15',
    ];
    const r = findDuplicates(meses.map((d, i) => fac(`i${i}`, 'prov-saas', `S-${i}`, d, 99_000)));
    expect(r).toEqual([]);
  });

  it('febrero corto tampoco confunde a la ventana', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-02-26', 99_000),
      fac('i2', 'prov-a', 'B-9', '2026-03-03', 99_000),
    ]);
    // 26 feb → 3 mar en 2026 son 5 días: entra justo.
    expect(r).toHaveLength(1);
    expect(r[0]?.confidence).toBeCloseTo(0.65, 10);
  });

  it('la ventana se puede estrechar por configuración', () => {
    const invoices = [
      fac('i1', 'prov-a', 'A-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'B-9', '2026-04-13', 250_000),
    ];
    expect(findDuplicates(invoices)).toHaveLength(1);
    expect(findDuplicates(invoices, { ...DEFAULT_DUPLICATE_CONFIG, dayWindow: 2 })).toEqual([]);
  });
});

describe('findDuplicates · reglas del conjunto', () => {
  it('el número de factura gana al importe: un par se reporta una sola vez', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'F-1', '2026-04-10', 250_000),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.reason).toBe('SAME_INVOICE_NUMBER');
  });

  it('tres copias de la misma factura dan los tres pares, no uno', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'F-1', '2026-04-10', 250_000),
      fac('i3', 'prov-a', 'F-1', '2026-04-10', 250_000),
    ]);
    expect(r).toHaveLength(3);
    expect(flaggedInvoiceIds(r)).toEqual(['i2', 'i3']);
  });

  it('el resultado no depende del orden de las filas del CSV', () => {
    const invoices = [
      fac('i1', 'prov-a', 'F-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'F-1', '2026-04-12', 250_000),
      fac('i3', 'prov-b', 'G-7', '2026-04-10', 80_000),
      fac('i4', 'prov-b', 'H-8', '2026-04-11', 80_000),
    ];
    const directo = findDuplicates(invoices);
    const alReves = findDuplicates([...invoices].reverse());
    expect(alReves).toEqual(directo);
  });

  it('ordena por confianza descendente: primero lo seguro', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'F-1', '2026-04-10', 250_000),
      fac('i2', 'prov-a', 'F-1', '2026-04-12', 250_000),
      fac('i3', 'prov-b', 'G-7', '2026-04-10', 80_000),
      fac('i4', 'prov-b', 'H-8', '2026-04-14', 80_000),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]?.reason).toBe('SAME_INVOICE_NUMBER');
    expect(r[1]?.reason).toBe('SAME_AMOUNT_AND_DATE');
  });

  it('sin facturas, o con una sola, no hay nada que marcar', () => {
    expect(findDuplicates([])).toEqual([]);
    expect(findDuplicates([fac('i1', 'prov-a', 'F-1', '2026-04-10', 250_000)])).toEqual([]);
    expect(flaggedInvoiceIds([])).toEqual([]);
  });

  it('un catálogo limpio de verdad no genera falsos positivos', () => {
    const r = findDuplicates([
      fac('i1', 'prov-a', 'A-1', '2026-01-10', 120_000),
      fac('i2', 'prov-a', 'A-2', '2026-02-10', 130_000),
      fac('i3', 'prov-b', 'B-1', '2026-01-10', 120_000),
      fac('i4', 'prov-c', 'C-1', '2026-01-11', 120_000),
    ]);
    expect(r).toEqual([]);
  });
});

describe('findDuplicates · configuración inválida', () => {
  it('rechaza una ventana negativa o fraccionaria', () => {
    expect(() => findDuplicates([], { ...DEFAULT_DUPLICATE_CONFIG, dayWindow: -1 })).toThrow(
      RangeError,
    );
    expect(() => findDuplicates([], { ...DEFAULT_DUPLICATE_CONFIG, dayWindow: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('rechaza una confianza fuera de (0, 1]', () => {
    expect(() => findDuplicates([], { ...DEFAULT_DUPLICATE_CONFIG, sameDayConfidence: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      findDuplicates([], { ...DEFAULT_DUPLICATE_CONFIG, sameDayConfidence: 1.2 }),
    ).toThrow(RangeError);
  });

  it('rechaza un decaimiento negativo', () => {
    expect(() =>
      findDuplicates([], { ...DEFAULT_DUPLICATE_CONFIG, confidenceDecayPerDay: -0.1 }),
    ).toThrow(RangeError);
  });
});
