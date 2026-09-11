import { describe, expect, it } from 'vitest';

import { importeEditable, parsearCantidad, parsearImporte } from '@/lib/importes';

describe('parsearImporte', () => {
  it('acepta las tres formas de teclear el mismo importe', () => {
    // Rechazar una factura por el separador decimal devuelve a la gente al Excel.
    for (const texto of ['1.234,56', '1234,56', '1234.56']) {
      expect(parsearImporte(texto), texto).toBe(123_456);
    }
  });

  it('un número entero son céntimos a cero', () => {
    expect(parsearImporte('100')).toBe(10_000);
    expect(parsearImporte('0')).toBe(0);
  });

  it('un decimal solo se completa a dos', () => {
    expect(parsearImporte('12,5')).toBe(1_250);
  });

  it('empezar por la coma vale: hay quien teclea «,50»', () => {
    expect(parsearImporte(',50')).toBe(50);
    expect(parsearImporte(',5')).toBe(50);
  });

  it('tres cifras tras un único punto son millares, no decimales', () => {
    // En España «1.234» son mil doscientos treinta y cuatro euros.
    expect(parsearImporte('1.234')).toBe(123_400);
    expect(parsearImporte('1.234.567')).toBe(123_456_700);
  });

  it('pero un punto con una o dos cifras detrás es decimal', () => {
    // Quien teclea en el bloque numérico pone punto y quiere decir coma.
    expect(parsearImporte('1234.5')).toBe(123_450);
    expect(parsearImporte('1234.56')).toBe(123_456);
  });

  it('la agrupación a la inglesa también entra', () => {
    expect(parsearImporte('1,234,567')).toBe(123_456_700);
    expect(parsearImporte('1,234.56')).toBe(123_456);
  });

  it('el símbolo y los espacios sobran', () => {
    expect(parsearImporte('  1.234,56 €  ')).toBe(123_456);
    expect(parsearImporte('1 234,56')).toBe(123_456);
  });

  it('un abono se teclea con menos delante', () => {
    expect(parsearImporte('-100')).toBe(-10_000);
    expect(parsearImporte('-1.234,56')).toBe(-123_456);
  });

  it('más de dos decimales se rechaza, no se redondea', () => {
    // Redondear en silencio el importe que alguien ha escrito es perder dinero
    // sin avisar. El único redondeo del sistema vive en `finance-core`.
    expect(parsearImporte('10,005')).toBe(null);
    expect(parsearImporte('1,234')).toBe(null);
  });

  it('lo que no es un importe es null, no cero', () => {
    // Un campo vacío que se convierte en «0,00 €» es una factura descuadrada
    // que nadie ha escrito.
    for (const texto of ['', '   ', 'cien', '12a', '1.2.3,4,5', '--5', '+5']) {
      expect(parsearImporte(texto), JSON.stringify(texto)).toBe(null);
    }
  });

  it('un importe fuera del rango de enteros seguros es null', () => {
    expect(parsearImporte('999999999999999999')).toBe(null);
  });
});

describe('importeEditable', () => {
  it('lo que se ve es lo que se vuelve a teclear', () => {
    // Sin símbolo y sin separador de millares: el formato bonito es para leer.
    expect(importeEditable(123_456)).toBe('1234,56');
    expect(importeEditable(10_000)).toBe('100,00');
    expect(importeEditable(5)).toBe('0,05');
    expect(importeEditable(0)).toBe('0,00');
  });

  it('el negativo conserva el signo', () => {
    expect(importeEditable(-123_456)).toBe('-1234,56');
    expect(importeEditable(-5)).toBe('-0,05');
  });

  it('ida y vuelta sin perder un céntimo', () => {
    for (const centimos of [0, 1, 99, 100, 123_456, -123_456, 7]) {
      expect(parsearImporte(importeEditable(centimos)), String(centimos)).toBe(centimos);
    }
  });
});

describe('parsearCantidad', () => {
  it('acepta coma y punto', () => {
    expect(parsearCantidad('2,5')).toBe(2.5);
    expect(parsearCantidad('2.5')).toBe(2.5);
    expect(parsearCantidad('12')).toBe(12);
  });

  it('lo que no es un número es null', () => {
    for (const texto of ['', 'dos', '1,2,3']) {
      expect(parsearCantidad(texto), JSON.stringify(texto)).toBe(null);
    }
  });

  it('una cantidad negativa vale: un descuento es una línea negativa', () => {
    expect(parsearCantidad('-1')).toBe(-1);
  });
});
