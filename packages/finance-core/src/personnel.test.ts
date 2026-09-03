import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  DEFAULT_COLLECTIVE_AGREEMENT_HOURS,
  DEFAULT_EMPLOYER_SS_RATE,
  DEFAULT_PRODUCTIVITY_FACTOR,
  DEFAULT_SS_BREAKDOWN,
  MIN_EMPLOYEES_FOR_AGGREGATE,
  employerCost,
  internalHourlyRate,
  productiveHours,
  roleHourlyRate,
  socialSecurityRate,
  workplaceCost,
  type EmployerCostInput,
  type RoleMember,
} from './personnel.js';

/** Caso de referencia obligatorio de `docs/02-modelo-financiero.md` §3.2. */
const REFERENCIA: EmployerCostInput = {
  grossAnnualCents: cents(4_200_000),
  variableAnnualCents: cents(200_000),
  benefitsAnnualCents: cents(120_000),
  trainingAnnualCents: cents(80_000),
  workplaceCostAnnualCents: cents(150_000),
};

const HORAS_REFERENCIA = {
  holidayHours: 184,
  publicHolidayHours: 96,
  expectedAbsenceHours: 40,
  trainingHours: 24,
};

describe('caso de referencia del documento 02', () => {
  it('coste empresa = 60.940 € al céntimo', () => {
    const coste = employerCost(REFERENCIA);
    expect(coste.socialSecurityCents).toBe(1_344_000);
    expect(coste.totalCents).toBe(6_094_000);
  });

  it('horas: 1.780 − 184 − 96 − 40 − 24 = 1.436 disponibles y 1.220,6 productivas', () => {
    const horas = productiveHours(HORAS_REFERENCIA);
    expect(horas.availableHours).toBe(1436);
    expect(horas.productiveHours).toBeCloseTo(1220.6, 10);
  });

  it('tarifa interna = 49,93 €/h al céntimo', () => {
    const coste = employerCost(REFERENCIA);
    const horas = productiveHours(HORAS_REFERENCIA);
    expect(internalHourlyRate(coste.totalCents, horas.productiveHours)).toBe(4_993);
  });
});

describe('employerCost', () => {
  it('el desglose suma exactamente el total', () => {
    const coste = employerCost({ ...REFERENCIA, otherAnnualCents: cents(33_333) });
    const suma =
      coste.grossAnnualCents +
      coste.socialSecurityCents +
      coste.variableAnnualCents +
      coste.benefitsAnnualCents +
      coste.trainingAnnualCents +
      coste.workplaceCostAnnualCents +
      coste.otherAnnualCents;
    expect(suma).toBe(coste.totalCents);
  });

  it('con sólo bruto aplica el tipo por defecto', () => {
    const coste = employerCost({ grossAnnualCents: cents(3_000_000) });
    expect(coste.socialSecurityCents).toBe(960_000);
    expect(coste.totalCents).toBe(3_960_000);
  });

  it('admite el tipo de cotización del tenant', () => {
    const coste = employerCost({ ...REFERENCIA, employerSocialSecurityRate: 0.3207 });
    expect(coste.socialSecurityCents).toBe(1_346_940);
  });

  it('escala todos los componentes con la jornada parcial', () => {
    const completa = employerCost(REFERENCIA);
    const media = employerCost({ ...REFERENCIA, fteRatio: 0.5 });
    expect(media.grossAnnualCents).toBe(2_100_000);
    expect(media.totalCents).toBe(completa.totalCents / 2);
  });

  it('rechaza jornadas y tipos imposibles', () => {
    expect(() => employerCost({ ...REFERENCIA, fteRatio: 0 })).toThrow(RangeError);
    expect(() => employerCost({ ...REFERENCIA, fteRatio: 1.5 })).toThrow(RangeError);
    expect(() => employerCost({ ...REFERENCIA, employerSocialSecurityRate: -0.1 })).toThrow(
      RangeError,
    );
  });
});

describe('workplaceCost', () => {
  it('anualiza la amortización mensual y suma el resto', () => {
    expect(
      workplaceCost({
        monthlyAssetDepreciationCents: cents(2_500),
        licencesAnnualCents: cents(90_000),
        workspaceAnnualCents: cents(24_000),
        telephonyAnnualCents: cents(6_000),
      }),
    ).toBe(2_500 * 12 + 90_000 + 24_000 + 6_000);
  });

  it('sin componentes es cero', () => {
    expect(workplaceCost({})).toBe(0);
  });
});

describe('socialSecurityRate', () => {
  it('el desglose de arranque suma 32,07 %', () => {
    expect(socialSecurityRate(DEFAULT_SS_BREAKDOWN)).toBeCloseTo(0.3207, 10);
  });

  it('el 32 % por defecto es el redondeo conservador del desglose', () => {
    expect(DEFAULT_EMPLOYER_SS_RATE).toBe(0.32);
    expect(socialSecurityRate(DEFAULT_SS_BREAKDOWN)).toBeGreaterThan(DEFAULT_EMPLOYER_SS_RATE);
  });

  it('admite un AT/EP distinto por CNAE', () => {
    expect(
      socialSecurityRate({ ...DEFAULT_SS_BREAKDOWN, occupationalAccidents: 0.031 }),
    ).toBeCloseTo(0.3367, 10);
  });
});

describe('productiveHours', () => {
  it('usa los valores por defecto del documento', () => {
    const horas = productiveHours();
    expect(horas.availableHours).toBe(DEFAULT_COLLECTIVE_AGREEMENT_HOURS);
    expect(horas.productiveHours).toBeCloseTo(
      DEFAULT_COLLECTIVE_AGREEMENT_HOURS * DEFAULT_PRODUCTIVITY_FACTOR,
      10,
    );
  });

  it('la jornada parcial escala las horas, de modo que la tarifa no cambia', () => {
    const completa = productiveHours(HORAS_REFERENCIA);
    const media = productiveHours({ ...HORAS_REFERENCIA, fteRatio: 0.5 });
    expect(media.availableHours).toBe(completa.availableHours / 2);

    const costeCompleto = employerCost(REFERENCIA);
    const costeMedio = employerCost({ ...REFERENCIA, fteRatio: 0.5 });
    expect(internalHourlyRate(costeMedio.totalCents, media.productiveHours)).toBe(
      internalHourlyRate(costeCompleto.totalCents, completa.productiveHours),
    );
  });

  it('rechaza un año sin horas disponibles', () => {
    expect(() => productiveHours({ holidayHours: 2_000 })).toThrow(RangeError);
  });

  it('rechaza factores de productividad imposibles', () => {
    expect(() => productiveHours({ productivityFactor: 0 })).toThrow(RangeError);
    expect(() => productiveHours({ productivityFactor: 1.2 })).toThrow(RangeError);
  });
});

describe('internalHourlyRate', () => {
  it('redondea al céntimo una sola vez', () => {
    expect(internalHourlyRate(cents(1_000), 3)).toBe(333);
    expect(internalHourlyRate(cents(1_001), 3)).toBe(334);
  });

  it('rechaza un divisor no positivo', () => {
    expect(() => internalHourlyRate(cents(1_000), 0)).toThrow(RangeError);
    expect(() => internalHourlyRate(cents(1_000), -5)).toThrow(RangeError);
  });
});

describe('roleHourlyRate', () => {
  const miembro = (employeeId: string, coste: number, fteRatio = 1): RoleMember => ({
    employeeId,
    totalCostCents: cents(coste),
    productiveHours: 1_220.6,
    fteRatio,
  });

  it('suprime el agregado por debajo de 4 empleados', () => {
    expect(MIN_EMPLOYEES_FOR_AGGREGATE).toBe(4);
    for (let n = 0; n < MIN_EMPLOYEES_FOR_AGGREGATE; n += 1) {
      const equipo = Array.from({ length: n }, (_, i) => miembro(`e${i}`, 6_094_000));
      const resultado = roleHourlyRate(equipo);
      expect(resultado.status).toBe('SUPPRESSED');
      expect(resultado.employeeCount).toBe(n);
    }
  });

  it('con 4 empleados publica la tarifa', () => {
    const resultado = roleHourlyRate([
      miembro('e1', 6_094_000),
      miembro('e2', 6_094_000),
      miembro('e3', 6_094_000),
      miembro('e4', 6_094_000),
    ]);
    expect(resultado.status).toBe('OK');
    if (resultado.status !== 'OK') return;
    expect(resultado.hourlyRateCents).toBe(4_993);
    expect(resultado.totalFte).toBe(4);
  });

  it('pondera por FTE, no por cabezas', () => {
    const resultado = roleHourlyRate([
      miembro('senior', 8_000_000),
      miembro('senior-2', 8_000_000),
      miembro('senior-3', 8_000_000),
      // Media jornada: pesa la mitad que un compañero a jornada completa.
      {
        employeeId: 'junior',
        totalCostCents: cents(2_000_000),
        productiveHours: 610.3,
        fteRatio: 0.5,
      },
    ]);
    expect(resultado.status).toBe('OK');
    if (resultado.status !== 'OK') return;
    expect(resultado.totalFte).toBe(3.5);

    const senior = internalHourlyRate(cents(8_000_000), 1_220.6);
    const junior = internalHourlyRate(cents(2_000_000), 610.3);
    expect(resultado.hourlyRateCents).toBe(Math.round((senior * 3 + junior * 0.5) / 3.5));
  });

  it('rechaza un miembro con jornada imposible', () => {
    expect(() =>
      roleHourlyRate([
        miembro('e1', 6_094_000),
        miembro('e2', 6_094_000),
        miembro('e3', 6_094_000),
        miembro('e4', 6_094_000, 0),
      ]),
    ).toThrow(RangeError);
  });
});
