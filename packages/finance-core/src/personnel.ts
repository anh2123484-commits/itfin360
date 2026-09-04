/**
 * Coste de personal y tarifa horaria interna (F1-04), según
 * `docs/02-modelo-financiero.md` §3.
 *
 * Los tipos de cotización y la jornada de convenio **cambian cada año**: aquí
 * sólo viven los valores de arranque, y toda función acepta que el tenant los
 * sustituya. Nada de esto es una constante de negocio en código.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, multiplyCents, roundHalfUp } from './money.js';

/** Tipo de cotización empresarial por defecto en España (`config`, redondeo conservador). */
export const DEFAULT_EMPLOYER_SS_RATE = 0.32;

/** Jornada anual de convenio por defecto, en horas (`config`). */
export const DEFAULT_COLLECTIVE_AGREEMENT_HOURS = 1780;

/** Factor de productividad por defecto (`config`). */
export const DEFAULT_PRODUCTIVITY_FACTOR = 0.85;

/**
 * Mínimo de empleados para publicar un agregado retributivo
 * (`docs/03-arquitectura-y-datos.md` §3.4). Por debajo, la media de un equipo
 * revela el sueldo de sus miembros.
 */
export const MIN_EMPLOYEES_FOR_AGGREGATE = 4;

/** Desglose editable del tipo de cotización empresarial. */
export interface SocialSecurityBreakdown {
  /** Contingencias comunes. */
  readonly commonContingencies: number;
  /** Desempleo. */
  readonly unemployment: number;
  /** FOGASA. */
  readonly wageGuaranteeFund: number;
  /** Formación profesional. */
  readonly vocationalTraining: number;
  /** Mecanismo de Equidad Intergeneracional. */
  readonly intergenerationalEquity: number;
  /** AT/EP, variable por CNAE. */
  readonly occupationalAccidents: number;
}

/** Desglose de arranque (`docs/02-modelo-financiero.md` §3.1). Suma 32,07 %. */
export const DEFAULT_SS_BREAKDOWN: SocialSecurityBreakdown = {
  commonContingencies: 0.236,
  unemployment: 0.055,
  wageGuaranteeFund: 0.002,
  vocationalTraining: 0.006,
  intergenerationalEquity: 0.0067,
  occupationalAccidents: 0.015,
};

/** Tipo total resultante de un desglose. */
export function socialSecurityRate(breakdown: SocialSecurityBreakdown): number {
  return (
    breakdown.commonContingencies +
    breakdown.unemployment +
    breakdown.wageGuaranteeFund +
    breakdown.vocationalTraining +
    breakdown.intergenerationalEquity +
    breakdown.occupationalAccidents
  );
}

/** Componentes del coste de puesto de trabajo. */
export interface WorkplaceCostInput {
  /** Cuota mensual de amortización de los activos asignados. */
  readonly monthlyAssetDepreciationCents?: Cents;
  readonly licencesAnnualCents?: Cents;
  readonly workspaceAnnualCents?: Cents;
  readonly telephonyAnnualCents?: Cents;
}

/** Coste anual del puesto: amortización de activos asignados, licencias, espacio y telefonía. */
export function workplaceCost(input: WorkplaceCostInput): Cents {
  return addCents(
    multiplyCents(input.monthlyAssetDepreciationCents ?? ZERO_CENTS, 12),
    input.licencesAnnualCents ?? ZERO_CENTS,
    input.workspaceAnnualCents ?? ZERO_CENTS,
    input.telephonyAnnualCents ?? ZERO_CENTS,
  );
}

/** Entradas del coste empresa anual de un empleado. */
export interface EmployerCostInput {
  readonly grossAnnualCents: Cents;
  /** Tipo de cotización empresarial. Por defecto, `DEFAULT_EMPLOYER_SS_RATE`. */
  readonly employerSocialSecurityRate?: number;
  readonly variableAnnualCents?: Cents;
  readonly benefitsAnnualCents?: Cents;
  readonly trainingAnnualCents?: Cents;
  /** Coste de puesto anual, normalmente el de `workplaceCost`. */
  readonly workplaceCostAnnualCents?: Cents;
  readonly otherAnnualCents?: Cents;
  /** Jornada del empleado sobre la completa. Por defecto, 1. */
  readonly fteRatio?: number;
}

/** Coste empresa desglosado. Los componentes suman exactamente el total. */
export interface EmployerCost {
  readonly grossAnnualCents: Cents;
  readonly socialSecurityCents: Cents;
  readonly variableAnnualCents: Cents;
  readonly benefitsAnnualCents: Cents;
  readonly trainingAnnualCents: Cents;
  readonly workplaceCostAnnualCents: Cents;
  readonly otherAnnualCents: Cents;
  readonly totalCents: Cents;
}

function validateFte(fteRatio: number): number {
  if (!Number.isFinite(fteRatio) || fteRatio <= 0 || fteRatio > 1) {
    throw new RangeError(`La jornada (fteRatio) debe estar en (0, 1]: ${fteRatio}`);
  }
  return fteRatio;
}

/**
 * Coste empresa anual de un empleado.
 *
 * Con jornada parcial se escala **cada componente** y luego se suman, en vez de
 * escalar el total: así el desglose que ve el usuario cuadra al céntimo con la
 * cifra agregada, que es lo que se audita.
 */
export function employerCost(input: EmployerCostInput): EmployerCost {
  const fte = validateFte(input.fteRatio ?? 1);
  const rate = input.employerSocialSecurityRate ?? DEFAULT_EMPLOYER_SS_RATE;
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(`Tipo de cotización no válido: ${rate}`);
  }

  const gross = multiplyCents(input.grossAnnualCents, fte);
  const socialSecurity = multiplyCents(gross, rate);
  const variable = multiplyCents(input.variableAnnualCents ?? ZERO_CENTS, fte);
  const benefits = multiplyCents(input.benefitsAnnualCents ?? ZERO_CENTS, fte);
  const training = multiplyCents(input.trainingAnnualCents ?? ZERO_CENTS, fte);
  const workplace = multiplyCents(input.workplaceCostAnnualCents ?? ZERO_CENTS, fte);
  const other = multiplyCents(input.otherAnnualCents ?? ZERO_CENTS, fte);

  return {
    grossAnnualCents: gross,
    socialSecurityCents: socialSecurity,
    variableAnnualCents: variable,
    benefitsAnnualCents: benefits,
    trainingAnnualCents: training,
    workplaceCostAnnualCents: workplace,
    otherAnnualCents: other,
    totalCents: addCents(gross, socialSecurity, variable, benefits, training, workplace, other),
  };
}

/** Entradas del cálculo de horas productivas. */
export interface ProductiveHoursInput {
  /** Jornada anual de convenio. Por defecto, `DEFAULT_COLLECTIVE_AGREEMENT_HOURS`. */
  readonly collectiveAgreementHours?: number;
  readonly holidayHours?: number;
  readonly publicHolidayHours?: number;
  readonly expectedAbsenceHours?: number;
  readonly trainingHours?: number;
  /** Factor de productividad. Por defecto, `DEFAULT_PRODUCTIVITY_FACTOR`. */
  readonly productivityFactor?: number;
  /** Jornada del empleado sobre la completa. Por defecto, 1. */
  readonly fteRatio?: number;
}

/** Horas disponibles y productivas de un empleado en el año. */
export interface ProductiveHours {
  readonly availableHours: number;
  readonly productiveHours: number;
}

/**
 * Horas disponibles y productivas.
 *
 * La jornada parcial escala las horas igual que escala el coste: si sólo se
 * escalase el coste, la tarifa de un empleado al 50 % saldría el doble que la de
 * su compañero a jornada completa haciendo el mismo trabajo.
 *
 * Las horas **no** se redondean: son un divisor, no un importe, y redondearlas
 * mete un error de céntimos en la tarifa.
 */
export function productiveHours(input: ProductiveHoursInput = {}): ProductiveHours {
  const fte = validateFte(input.fteRatio ?? 1);
  const factor = input.productivityFactor ?? DEFAULT_PRODUCTIVITY_FACTOR;
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
    throw new RangeError(`El factor de productividad debe estar en (0, 1]: ${factor}`);
  }

  const convenio = input.collectiveAgreementHours ?? DEFAULT_COLLECTIVE_AGREEMENT_HOURS;
  const descuentos =
    (input.holidayHours ?? 0) +
    (input.publicHolidayHours ?? 0) +
    (input.expectedAbsenceHours ?? 0) +
    (input.trainingHours ?? 0);

  const available = (convenio - descuentos) * fte;
  if (available <= 0) {
    throw new RangeError('Las horas disponibles deben ser positivas; revisa jornada y descuentos.');
  }

  return { availableHours: available, productiveHours: available * factor };
}

/** Tarifa horaria interna: coste empresa entre horas productivas. */
export function internalHourlyRate(totalCostCents: Cents, hours: number): Cents {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new RangeError(`Las horas productivas deben ser positivas: ${hours}`);
  }
  return roundHalfUp(totalCostCents / hours);
}

/** Un empleado, ya resuelto su coste y sus horas, para agregar por rol. */
export interface RoleMember {
  readonly employeeId: string;
  readonly totalCostCents: Cents;
  readonly productiveHours: number;
  readonly fteRatio: number;
}

/** Resultado de la tarifa por rol, con supresión por privacidad. */
export type RoleHourlyRate =
  | {
      readonly status: 'OK';
      readonly hourlyRateCents: Cents;
      readonly employeeCount: number;
      readonly totalFte: number;
    }
  | {
      readonly status: 'SUPPRESSED';
      readonly employeeCount: number;
      readonly reason: 'MIN_HEADCOUNT';
    };

/**
 * Tarifa horaria de un rol, media ponderada por FTE.
 *
 * Existe para estimar proyectos **sin exponer sueldos individuales**, así que
 * por debajo de `MIN_EMPLOYEES_FOR_AGGREGATE` devuelve `SUPPRESSED` en lugar de
 * un número: con dos personas, la media y el propio sueldo revelan el del otro.
 * La supresión se decide aquí, en el motor, no en la interfaz.
 */
export function roleHourlyRate(members: readonly RoleMember[]): RoleHourlyRate {
  if (members.length < MIN_EMPLOYEES_FOR_AGGREGATE) {
    return { status: 'SUPPRESSED', employeeCount: members.length, reason: 'MIN_HEADCOUNT' };
  }

  let fteSum = 0;
  let ponderado = 0;
  for (const member of members) {
    const fte = validateFte(member.fteRatio);
    fteSum += fte;
    ponderado += internalHourlyRate(member.totalCostCents, member.productiveHours) * fte;
  }

  return {
    status: 'OK',
    hourlyRateCents: roundHalfUp(ponderado / fteSum),
    employeeCount: members.length,
    totalFte: fteSum,
  };
}
