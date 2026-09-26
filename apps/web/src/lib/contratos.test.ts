import { describe, expect, it } from 'vitest';

import { type ContratoParaCalcular, diasHastaPreaviso, resumenContratos } from '@/lib/contratos';

/**
 * El reloj entra por parámetro, así que aquí no se espera a nada.
 */

const BASE: ContratoParaCalcular = {
  id: 'c1',
  name: 'Microsoft 365 E3',
  amountCents: 120_000,
  periodicity: 'ANNUAL',
  currency: 'EUR',
  status: 'ACTIVE',
  renewalDate: null,
  noticeDays: null,
  licensedSeats: null,
  activeSeats: null,
  previousAmountCents: null,
  previousPeriodicity: null,
};

const contrato = (cambios: Partial<ContratoParaCalcular>): ContratoParaCalcular => ({
  ...BASE,
  ...cambios,
});

describe('diasHastaPreaviso', () => {
  it('sin fecha de renovación no hay cuenta atrás', () => {
    expect(diasHastaPreaviso(null, 90, new Date('2026-09-26'))).toBe(null);
  });

  it('descuenta el preaviso de la fecha de renovación', () => {
    // Renueva el 1 de enero con 90 días de preaviso: la fecha que importa es el
    // 3 de octubre, no enero.
    const dias = diasHastaPreaviso(new Date('2027-01-01'), 90, new Date('2026-09-26'));
    expect(dias).toBe(7);
  });

  it('sin días de preaviso, la cuenta atrás es hasta la renovación', () => {
    expect(diasHastaPreaviso(new Date('2026-10-01'), null, new Date('2026-09-26'))).toBe(5);
  });

  it('pasado el plazo, el número es negativo', () => {
    // Un contrato que ya no se puede cancelar tiene que verse distinto de uno
    // al que le quedan tres meses.
    expect(diasHastaPreaviso(new Date('2026-10-01'), 30, new Date('2026-09-26'))).toBeLessThan(0);
  });
});

describe('resumenContratos', () => {
  const ahora = new Date('2026-09-26');

  it('normaliza cada periodicidad a coste mensual y anual', () => {
    const { normalizados } = resumenContratos(
      [
        contrato({ id: 'anual', amountCents: 120_000, periodicity: 'ANNUAL' }),
        contrato({ id: 'mensual', amountCents: 10_000, periodicity: 'MONTHLY' }),
        contrato({ id: 'bienal', amountCents: 4_320_000, periodicity: 'BIENNIAL' }),
      ],
      ahora,
    );
    const por = (id: string) => normalizados.find((n) => n.id === id);

    expect(por('anual')?.monthlyCents).toBe(10_000);
    expect(por('mensual')?.annualCents).toBe(120_000);
    // El anualizado sale del importe exacto, no de multiplicar el mensual ya
    // redondeado: 43.200 € bienales son 1.800 €/mes y 21.600 €/año.
    expect(por('bienal')?.monthlyCents).toBe(180_000);
    expect(por('bienal')?.annualCents).toBe(2_160_000);
  });

  it('la cartera suma sólo lo que sigue costando dinero', () => {
    const { monthlyCents, annualCents } = resumenContratos(
      [
        contrato({ id: 'a', amountCents: 12_000, periodicity: 'MONTHLY', status: 'ACTIVE' }),
        contrato({ id: 'b', amountCents: 6_000, periodicity: 'MONTHLY', status: 'NOTICE_GIVEN' }),
        contrato({ id: 'c', amountCents: 99_900, periodicity: 'MONTHLY', status: 'CANCELLED' }),
        contrato({ id: 'd', amountCents: 88_800, periodicity: 'MONTHLY', status: 'EXPIRED' }),
      ],
      ahora,
    );

    // Un contrato preavisado se sigue pagando hasta que vence, así que cuenta.
    // Uno cancelado no, y sumarlo inflaría el gasto del departamento.
    expect(monthlyCents).toBe(18_000);
    expect(annualCents).toBe(216_000);
  });

  it('cuenta los puestos pagados y sin usar', () => {
    const { normalizados } = resumenContratos(
      [contrato({ licensedSeats: 120, activeSeats: 80 })],
      ahora,
    );
    expect(normalizados[0]?.puestosSinUsar).toBe(40);
  });

  it('más puestos activos que licencias no da un número negativo', () => {
    // Pasa de verdad: el proveedor mide de una forma y el inventario de otra.
    // Un negativo aquí saldría en pantalla como un ahorro que no existe.
    const { normalizados } = resumenContratos(
      [contrato({ licensedSeats: 50, activeSeats: 60 })],
      ahora,
    );
    expect(normalizados[0]?.puestosSinUsar).toBe(0);
  });

  it('sin datos de puestos no se inventa el desperdicio', () => {
    const { normalizados } = resumenContratos([contrato({ licensedSeats: 100 })], ahora);
    expect(normalizados[0]?.puestosSinUsar).toBe(null);
  });

  it('avisa del desperdicio de licencias cuando hay dinero en juego', () => {
    const { avisos } = resumenContratos(
      [
        contrato({
          id: 'm365',
          amountCents: 12_000_000,
          periodicity: 'ANNUAL',
          licensedSeats: 200,
          activeSeats: 120,
        }),
      ],
      ahora,
    );

    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.type).toBe('LICENSE_WASTE');
    expect(avisos[0]?.contractId).toBe('m365');
    expect(avisos[0]?.impactAnnualCents).toBeGreaterThan(0);
  });

  it('un contrato cancelado no genera avisos', () => {
    // Avisar del desperdicio de algo que ya no se paga es ruido, y el ruido es
    // lo que hace que se dejen de leer los avisos que sí importan.
    const { avisos } = resumenContratos(
      [
        contrato({
          status: 'CANCELLED',
          amountCents: 12_000_000,
          periodicity: 'ANNUAL',
          licensedSeats: 200,
          activeSeats: 20,
        }),
      ],
      ahora,
    );
    expect(avisos).toHaveLength(0);
  });

  it('una cartera vacía no revienta', () => {
    const resumen = resumenContratos([], ahora);
    expect(resumen.monthlyCents).toBe(0);
    expect(resumen.avisos).toHaveLength(0);
  });
});
