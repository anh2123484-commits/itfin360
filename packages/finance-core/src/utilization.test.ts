import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_RECOVERY_BANDS,
  aggregateRecovery,
  recoveryRatio,
  unbookedCostTotal,
  utilization,
  type RecoveryMember,
} from './utilization.js';

/** Tarifa del caso de referencia del documento 02: 49,93 €/h. */
const TARIFA = cents(4_993);

describe('utilization', () => {
  it('reparte el tiempo entre run, change y lo no imputado', () => {
    const u = utilization({
      availableHours: 1_436,
      runHours: 600,
      changeHours: 400,
      hourlyRateCents: TARIFA,
    });

    expect(u.bookedHours).toBe(1_000);
    expect(u.unbookedHours).toBe(436);
    expect(u.utilization).toBeCloseTo(1_000 / 1_436, 12);
    expect(u.runShare).toBeCloseTo(0.6, 12);
    expect(u.changeShare).toBeCloseTo(0.4, 12);
    expect(u.runCostCents).toBe(4_993 * 600);
    expect(u.changeCostCents).toBe(4_993 * 400);
    expect(u.unbookedCostCents).toBe(4_993 * 436);
  });

  it('run y change siempre suman 1 cuando hay imputación', () => {
    const u = utilization({
      availableHours: 1_000,
      runHours: 333,
      changeHours: 667,
      hourlyRateCents: TARIFA,
    });
    expect((u.runShare ?? 0) + (u.changeShare ?? 0)).toBeCloseTo(1, 12);
  });

  it('un empleado de baja todo el periodo no tiene utilización, no tiene cero', () => {
    const u = utilization({
      availableHours: 0,
      runHours: 0,
      changeHours: 0,
      hourlyRateCents: TARIFA,
    });
    expect(u.utilization).toBeNull();
    expect(u.runShare).toBeNull();
    expect(u.changeShare).toBeNull();
    expect(u.unbookedCostCents).toBe(0);
  });

  it('sin horas imputadas, la utilización es 0 pero el reparto run/change no existe', () => {
    const u = utilization({
      availableHours: 1_436,
      runHours: 0,
      changeHours: 0,
      hourlyRateCents: TARIFA,
    });
    expect(u.utilization).toBe(0);
    expect(u.runShare).toBeNull();
    expect(u.changeShare).toBeNull();
    // Todo el coste del puesto es invisible.
    expect(u.unbookedCostCents).toBe(4_993 * 1_436);
  });

  it('un empleado a media jornada con horas parciales sale proporcionado', () => {
    const u = utilization({
      availableHours: 718,
      runHours: 300,
      changeHours: 200,
      hourlyRateCents: TARIFA,
    });
    expect(u.utilization).toBeCloseTo(500 / 718, 12);
    expect(u.unbookedHours).toBe(218);
  });

  it('imputar por encima de la jornada da coste invisible negativo, y se enseña', () => {
    const u = utilization({
      availableHours: 1_436,
      runHours: 1_000,
      changeHours: 600,
      hourlyRateCents: TARIFA,
    });
    expect(u.unbookedHours).toBe(-164);
    expect(u.unbookedCostCents).toBe(-4_993 * 164);
    expect(u.utilization).toBeGreaterThan(1);
  });

  it('admite horas fraccionadas sin descuadrar el importe', () => {
    const u = utilization({
      availableHours: 100,
      runHours: 33.33,
      changeHours: 0,
      hourlyRateCents: cents(1_000),
    });
    // 33,33 h × 10,00 €/h = 333,30 € → 33.330 céntimos, redondeado una sola vez.
    expect(u.runCostCents).toBe(33_330);
  });

  it('rechaza horas imposibles', () => {
    const base = { availableHours: 100, runHours: 10, changeHours: 10, hourlyRateCents: TARIFA };
    expect(() => utilization({ ...base, availableHours: -1 })).toThrow(RangeError);
    expect(() => utilization({ ...base, runHours: -1 })).toThrow(RangeError);
    expect(() => utilization({ ...base, changeHours: Number.NaN })).toThrow(RangeError);
  });
});

describe('unbookedCostTotal', () => {
  it('suma el coste invisible del departamento', () => {
    const entradas = [
      utilization({
        availableHours: 1_000,
        runHours: 800,
        changeHours: 0,
        hourlyRateCents: TARIFA,
      }),
      utilization({
        availableHours: 1_000,
        runHours: 500,
        changeHours: 100,
        hourlyRateCents: TARIFA,
      }),
    ];
    expect(unbookedCostTotal(entradas)).toBe(4_993 * 200 + 4_993 * 400);
  });

  it('sin empleados es cero', () => {
    expect(unbookedCostTotal([])).toBe(0);
  });
});

describe('recoveryRatio', () => {
  const base = {
    bookedHours: 1_000,
    referenceRateCents: cents(6_000),
    employerCostCents: cents(6_094_000),
  };

  it('valora las horas a la tarifa de referencia y compara con el coste empresa', () => {
    const r = recoveryRatio(base);
    expect(r.bookedValueCents).toBe(6_000_000);
    expect(r.ratio).toBeCloseTo(6_000_000 / 6_094_000, 12);
    expect(r.band).toBe('BREAK_EVEN');
  });

  it('clasifica las tres bandas del documento', () => {
    expect(recoveryRatio({ ...base, referenceRateCents: cents(4_000) }).band).toBe('DEFICIT');
    expect(recoveryRatio({ ...base, referenceRateCents: cents(6_000) }).band).toBe('BREAK_EVEN');
    expect(recoveryRatio({ ...base, referenceRateCents: cents(9_000) }).band).toBe('MARGIN');
  });

  it('los límites de banda son inclusivos hacia el equilibrio', () => {
    const coste = cents(1_000_000);
    const enElLimiteBajo = recoveryRatio({
      bookedHours: 1,
      referenceRateCents: cents(800_000),
      employerCostCents: coste,
    });
    const enElLimiteAlto = recoveryRatio({
      bookedHours: 1,
      referenceRateCents: cents(1_100_000),
      employerCostCents: coste,
    });
    expect(enElLimiteBajo.ratio).toBe(DEFAULT_RECOVERY_BANDS.deficitBelow);
    expect(enElLimiteBajo.band).toBe('BREAK_EVEN');
    expect(enElLimiteAlto.ratio).toBe(DEFAULT_RECOVERY_BANDS.marginAbove);
    expect(enElLimiteAlto.band).toBe('BREAK_EVEN');
  });

  it('admite bandas del tenant', () => {
    // El ratio base es 0,985: con la banda por defecto está en equilibrio, y con
    // una exigencia del 0,99 pasa a deficitario sin que cambie ningún importe.
    expect(recoveryRatio(base).band).toBe('BREAK_EVEN');
    expect(recoveryRatio({ ...base, bands: { deficitBelow: 0.99, marginAbove: 1.5 } }).band).toBe(
      'DEFICIT',
    );
  });

  it('sin coste empresa no hay ratio, no hay infinito', () => {
    const r = recoveryRatio({ ...base, employerCostCents: cents(0) });
    expect(r.ratio).toBeNull();
    expect(r.band).toBeNull();
    expect(r.bookedValueCents).toBe(6_000_000);
  });

  it('rechaza bandas invertidas y horas imposibles', () => {
    expect(() =>
      recoveryRatio({ ...base, bands: { deficitBelow: 1.5, marginAbove: 0.8 } }),
    ).toThrow(RangeError);
    expect(() => recoveryRatio({ ...base, bookedHours: -1 })).toThrow(RangeError);
  });
});

describe('aggregateRecovery', () => {
  const miembro = (employeeId: string, valor: number, coste: number): RecoveryMember => ({
    employeeId,
    bookedValueCents: cents(valor),
    employerCostCents: cents(coste),
  });

  it('suprime el agregado por debajo de 4 empleados', () => {
    const equipo = [
      miembro('e1', 6_000_000, 6_094_000),
      miembro('e2', 6_000_000, 6_094_000),
      miembro('e3', 6_000_000, 6_094_000),
    ];
    const r = aggregateRecovery(equipo);
    expect(r.status).toBe('SUPPRESSED');
    expect(r.employeeCount).toBe(3);
  });

  it('agrega valor total entre coste total, no la media de los ratios', () => {
    const equipo = [
      miembro('caro', 9_000_000, 9_000_000),
      miembro('e2', 1_000_000, 2_000_000),
      miembro('e3', 1_000_000, 2_000_000),
      miembro('e4', 1_000_000, 2_000_000),
    ];
    const r = aggregateRecovery(equipo);
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;

    expect(r.bookedValueCents).toBe(12_000_000);
    expect(r.employerCostCents).toBe(15_000_000);
    expect(r.ratio).toBeCloseTo(0.8, 12);

    // La media de los ratios daría 0,625, que no es una cifra económica.
    const mediaDeRatios = (1 + 0.5 + 0.5 + 0.5) / 4;
    expect(r.ratio).not.toBe(mediaDeRatios);
  });

  it('sin coste agregado no hay ratio', () => {
    const equipo = Array.from({ length: 4 }, (_, i) => miembro(`e${i}`, 1_000, 0));
    const r = aggregateRecovery(equipo);
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;
    expect(r.ratio).toBeNull();
    expect(r.band).toBeNull();
  });
});
