import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_WORKDAY_HOURS,
  DELAY_CAUSES,
  costOfDelay,
  costOfDelayForUniformDays,
  delayCostForDay,
  delayOverrunRatio,
  retainedTeamCost,
  reworkCost,
  type DelayDay,
} from './delay.js';

/**
 * Caso de referencia obligatorio de `docs/02-modelo-financiero.md` §5.2:
 * 3 FTE a 50 €/h y jornada de 8 h; ahorro anual esperado 120.000 €;
 * penalización 0; legacy 4.000 €/mes.
 */
const DIA_REFERENCIA: Omit<DelayDay, 'date'> = {
  team: [{ employeeId: 'equipo', fteAssigned: 3, hourlyRateCents: cents(5_000) }],
  expectedAnnualBenefitCents: cents(12_000_000),
  legacyMonthlyCostCents: cents(400_000),
};

describe('caso de referencia del documento 02', () => {
  it('CoD diario = 1.662,10 €', () => {
    const d = delayCostForDay({ date: '2026-09-01', ...DIA_REFERENCIA });
    expect(d.retainedTeamCents).toBe(120_000); // 3 × 50 € × 8 h = 1.200 €
    expect(d.opportunityCents).toBe(32_877); // 120.000 € / 365 = 328,77 €
    expect(d.contractualPenaltyCents).toBe(0);
    expect(d.bridgeCents).toBe(13_333); // 4.000 € / 30 = 133,33 €
    expect(d.totalCents).toBe(166_210);
  });

  it('30 días de retraso = 49.863 €', () => {
    const r = costOfDelayForUniformDays(DIA_REFERENCIA, 30);
    expect(r.totalCents).toBe(4_986_300);
    expect(r.delayDays).toBe(30);
  });

  it('sobre un BAC de 150.000 € es un 33 % de sobrecoste invisible', () => {
    const r = costOfDelayForUniformDays(DIA_REFERENCIA, 30);
    const ratio = delayOverrunRatio(r.totalCents, cents(15_000_000));
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeCloseTo(0.3324, 4);
  });
});

describe('retainedTeamCost', () => {
  it('tres personas al 100 % dan lo mismo que un bloque de 3 FTE', () => {
    const bloque = retainedTeamCost([
      { employeeId: 'equipo', fteAssigned: 3, hourlyRateCents: cents(5_000) },
    ]);
    const personas = retainedTeamCost([
      { employeeId: 'a', fteAssigned: 1, hourlyRateCents: cents(5_000) },
      { employeeId: 'b', fteAssigned: 1, hourlyRateCents: cents(5_000) },
      { employeeId: 'c', fteAssigned: 1, hourlyRateCents: cents(5_000) },
    ]);
    expect(bloque).toBe(personas);
    expect(bloque).toBe(120_000);
  });

  it('respeta tarifas distintas por persona', () => {
    expect(
      retainedTeamCost([
        { employeeId: 'senior', fteAssigned: 1, hourlyRateCents: cents(7_000) },
        { employeeId: 'junior', fteAssigned: 0.5, hourlyRateCents: cents(3_000) },
      ]),
    ).toBe(7_000 * 8 + 3_000 * 0.5 * 8);
  });

  it('sin equipo es cero', () => {
    expect(retainedTeamCost([])).toBe(0);
  });

  it('la jornada por defecto es de 8 h y se puede configurar', () => {
    expect(DEFAULT_WORKDAY_HOURS).toBe(8);
    const equipo = [{ employeeId: 'a', fteAssigned: 1, hourlyRateCents: cents(5_000) }];
    expect(retainedTeamCost(equipo, 7)).toBe(35_000);
  });

  it('rechaza jornadas y FTE imposibles', () => {
    const equipo = [{ employeeId: 'a', fteAssigned: 1, hourlyRateCents: cents(5_000) }];
    expect(() => retainedTeamCost(equipo, 0)).toThrow(RangeError);
    expect(() =>
      retainedTeamCost([{ employeeId: 'a', fteAssigned: -1, hourlyRateCents: cents(5_000) }]),
    ).toThrow(RangeError);
  });
});

describe('delayCostForDay', () => {
  it('un proyecto sin beneficio esperado ni legacy sólo suma equipo retenido', () => {
    const d = delayCostForDay({ date: '2026-09-01', team: DIA_REFERENCIA.team });
    expect(d.opportunityCents).toBe(0);
    expect(d.bridgeCents).toBe(0);
    expect(d.contractualPenaltyCents).toBe(0);
    expect(d.reworkCents).toBe(0);
    expect(d.totalCents).toBe(d.retainedTeamCents);
    expect(d.totalCents).toBe(120_000);
  });

  it('el desglose suma exactamente el total', () => {
    const d = delayCostForDay(
      {
        date: '2026-09-01',
        ...DIA_REFERENCIA,
        contractualPenaltyPerDayCents: cents(50_000),
      },
      cents(1_234),
    );
    expect(
      d.retainedTeamCents +
        d.opportunityCents +
        d.contractualPenaltyCents +
        d.bridgeCents +
        d.reworkCents,
    ).toBe(d.totalCents);
  });

  it('admite los divisores del tenant', () => {
    const d = delayCostForDay({ date: '2026-09-01', ...DIA_REFERENCIA }, cents(0), {
      daysInYear: 250,
      daysInMonth: 31,
    });
    expect(d.opportunityCents).toBe(48_000); // 12.000.000 / 250
    expect(d.bridgeCents).toBe(12_903); // 400.000 / 31 = 12.903,2 → 12.903
  });

  it('rechaza divisores imposibles', () => {
    const dia = { date: '2026-09-01', ...DIA_REFERENCIA };
    expect(() => delayCostForDay(dia, cents(0), { daysInYear: 0 })).toThrow(RangeError);
    expect(() => delayCostForDay(dia, cents(0), { daysInMonth: -1 })).toThrow(RangeError);
  });
});

describe('costOfDelay', () => {
  it('acumula con la composición real de cada día, no con una media', () => {
    const dias: DelayDay[] = [
      {
        date: '2026-09-01',
        team: [{ employeeId: 'a', fteAssigned: 3, hourlyRateCents: cents(5_000) }],
      },
      {
        date: '2026-09-02',
        team: [{ employeeId: 'a', fteAssigned: 1, hourlyRateCents: cents(5_000) }],
      },
    ];
    const r = costOfDelay(dias);
    expect(r.perDay[0]?.retainedTeamCents).toBe(120_000);
    expect(r.perDay[1]?.retainedTeamCents).toBe(40_000);
    expect(r.totalCents).toBe(160_000);
  });

  it('reparte el retrabajo entre los días y cuadra al céntimo', () => {
    const dias: DelayDay[] = Array.from({ length: 3 }, (_, i) => ({
      date: `2026-09-0${i + 1}`,
      team: [],
    }));
    const r = costOfDelay(dias, cents(10_001));
    expect(r.perDay.map((d) => d.reworkCents)).toEqual([3_334, 3_334, 3_333]);
    expect(r.breakdown.reworkCents).toBe(10_001);
    expect(r.totalCents).toBe(10_001);
  });

  it('el desglose acumulado suma el total', () => {
    const r = costOfDelayForUniformDays(
      { ...DIA_REFERENCIA, contractualPenaltyPerDayCents: cents(25_000) },
      7,
      cents(333_333),
    );
    const b = r.breakdown;
    expect(
      b.retainedTeamCents +
        b.opportunityCents +
        b.contractualPenaltyCents +
        b.bridgeCents +
        b.reworkCents,
    ).toBe(r.totalCents);
    expect(b.reworkCents).toBe(333_333);
  });

  it('agrupa el coste acumulado por causa', () => {
    const dias: DelayDay[] = [
      { date: 'd1', team: DIA_REFERENCIA.team, cause: 'VENDOR_DELAY' },
      { date: 'd2', team: DIA_REFERENCIA.team, cause: 'VENDOR_DELAY' },
      { date: 'd3', team: DIA_REFERENCIA.team, cause: 'SCOPE_CHANGE' },
      { date: 'd4', team: DIA_REFERENCIA.team },
    ];
    const r = costOfDelay(dias);
    expect(r.byCause.VENDOR_DELAY).toBe(240_000);
    expect(r.byCause.SCOPE_CHANGE).toBe(120_000);
    // El día sin causa cuenta en el total pero no se atribuye a ninguna.
    expect(r.totalCents).toBe(480_000);
    expect(Object.keys(r.byCause)).toHaveLength(2);
  });

  it('sin días de retraso todo es cero', () => {
    const r = costOfDelay([]);
    expect(r.totalCents).toBe(0);
    expect(r.delayDays).toBe(0);
    expect(r.perDay).toEqual([]);
    expect(r.byCause).toEqual({});
  });

  it('recoge las ocho causas tipificadas del documento', () => {
    expect(DELAY_CAUSES).toHaveLength(8);
    expect(DELAY_CAUSES).toContain('QUALITY_REWORK');
    expect(DELAY_CAUSES).toContain('ESTIMATION_ERROR');
  });

  it('rechaza un número de días imposible', () => {
    expect(() => costOfDelayForUniformDays(DIA_REFERENCIA, -1)).toThrow(RangeError);
    expect(() => costOfDelayForUniformDays(DIA_REFERENCIA, 2.5)).toThrow(RangeError);
  });
});

describe('reworkCost y delayOverrunRatio', () => {
  it('el retrabajo son horas por tarifa, con un solo redondeo', () => {
    expect(reworkCost(12.5, cents(4_993))).toBe(62_413); // 62.412,5 → 62.413
    expect(reworkCost(0, cents(4_993))).toBe(0);
  });

  it('sin presupuesto baseline no hay porcentaje de sobrecoste', () => {
    expect(delayOverrunRatio(cents(1_000), cents(0))).toBeNull();
  });

  it('rechaza horas de retrabajo negativas', () => {
    expect(() => reworkCost(-1, cents(4_993))).toThrow(RangeError);
  });
});
