import { InvoiceStatus } from '@itfin360/db';
import { describe, expect, it } from 'vitest';

import { COLOR_ESTADO, ETIQUETA_ESTADO, formatearFecha, formatearImporte } from '@/lib/formato';

/** `Intl` separa el importe de la divisa con espacio duro según la versión de ICU. */
const normal = (texto: string): string => texto.replace(/[\u00A0\u202F]/g, ' ');

describe('formatearImporte', () => {
  it('céntimos a euros con coma decimal y punto de millares', () => {
    expect(normal(formatearImporte(1_234_567, 'EUR'))).toBe('12.345,67 €');
  });

  it('en castellano, cuatro cifras van sin punto', () => {
    // CLDR fija `minimumGroupingDigits: 2` para el español: 1234 se escribe
    // seguido y la agrupación empieza en 10.000. No es un fallo de formato, y
    // por eso el test de arriba usa una cifra de cinco dígitos.
    expect(normal(formatearImporte(123_456, 'EUR'))).toBe('1234,56 €');
  });

  it('siempre dos decimales, aunque sean cero', () => {
    expect(normal(formatearImporte(10_000, 'EUR'))).toBe('100,00 €');
  });

  it('un abono se ve como negativo', () => {
    expect(normal(formatearImporte(-10_000, 'EUR'))).toContain('100,00');
    expect(formatearImporte(-10_000, 'EUR')).toContain('-');
  });

  it('cero céntimos son cero euros, no una celda vacía', () => {
    expect(normal(formatearImporte(0, 'EUR'))).toBe('0,00 €');
  });

  it('otra divisa se ve con su símbolo', () => {
    expect(formatearImporte(1_234_567, 'USD')).toContain('12.345,67');
    expect(formatearImporte(1_234_567, 'USD')).not.toContain('€');
  });
});

describe('formatearFecha', () => {
  it('pone el día delante, como se escribe en España', () => {
    expect(formatearFecha('2026-03-31')).toBe('31/03/2026');
  });

  it('el último día del mes no se corre al anterior', () => {
    // Con `new Date('2026-03-31')` en un navegador al oeste de Greenwich, esto
    // daría el 30. Por eso aquí no hay ningún `Date`.
    expect(formatearFecha('2026-01-01')).toBe('01/01/2026');
    expect(formatearFecha('2026-12-31')).toBe('31/12/2026');
  });

  it('sin fecha, celda vacía', () => {
    expect(formatearFecha(null)).toBe('');
    expect(formatearFecha(undefined)).toBe('');
  });

  it('lo que no es una fecha se devuelve tal cual, sin inventar', () => {
    expect(formatearFecha('mañana')).toBe('mañana');
  });
});

describe('etiquetas de estado', () => {
  it('todos los estados del esquema tienen nombre y color', () => {
    // Si el esquema gana un estado, esto falla antes de que el enum crudo
    // aparezca en una pantalla.
    for (const estado of Object.keys(InvoiceStatus)) {
      expect(ETIQUETA_ESTADO[estado as keyof typeof ETIQUETA_ESTADO], estado).toBeTruthy();
      expect(COLOR_ESTADO[estado as keyof typeof COLOR_ESTADO], estado).toBeTruthy();
    }
  });

  it('ninguna etiqueta es el propio identificador', () => {
    for (const [estado, etiqueta] of Object.entries(ETIQUETA_ESTADO)) {
      expect(etiqueta, estado).not.toBe(estado);
    }
  });
});
