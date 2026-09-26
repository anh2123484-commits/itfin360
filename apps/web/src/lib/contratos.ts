import {
  cents,
  type ContractAlert,
  contractAlerts,
  type ContractForAlerts,
  DEFAULT_ALERT_THRESHOLDS,
  normalizeRecurring,
  type Periodicity,
} from '@itfin360/finance-core';
import { ContractStatus, Periodicity as PeriodicityEnum, SpendConcept } from '@itfin360/db';
import { z } from 'zod';

/**
 * Contratos recurrentes: validación y el puente con el motor de cálculo.
 *
 * El motor sabe desde hace semanas normalizar un contrato a coste mensual,
 * medir el desperdicio de licencias y detectar una subida de precio. Lo que no
 * había era de dónde sacar los contratos. Este módulo traduce la fila de la base
 * a lo que el motor espera y devuelve lo que la pantalla enseña, sin meter una
 * segunda versión de las fórmulas por el camino.
 */

const TEXTO = z.string().trim().max(200);

export const PERIODICIDAD = z.enum(PeriodicityEnum);
export const ESTADO_CONTRATO = z.enum(ContractStatus);
export const CONCEPTO = z.enum(SpendConcept);

/** ISO 4217, normalizado a mayúsculas. */
export const DIVISA = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'ISO 4217')
  .transform((valor) => valor.toUpperCase());

/** Importe escrito por una persona: euros con coma o punto, nunca céntimos. */
export const IMPORTE = z
  .string()
  .trim()
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, 'importe')
  .transform((valor) => Math.round(Number(valor.replace(',', '.')) * 100));

export const FECHA = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const ENTERO_NO_NEGATIVO = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, 'entero')
  .transform((valor) => Number(valor));

export const altaContrato = z.object({
  vendorId: z.uuid(),
  name: TEXTO.min(1),
  concept: CONCEPTO,
  amountCents: IMPORTE,
  currency: DIVISA,
  periodicity: PERIODICIDAD,
  startDate: FECHA,
  endDate: FECHA.optional(),
  renewalDate: FECHA.optional(),
  noticeDays: ENTERO_NO_NEGATIVO.optional(),
  autoRenew: z.boolean().optional(),
  licensedSeats: ENTERO_NO_NEGATIVO.optional(),
  activeSeats: ENTERO_NO_NEGATIVO.optional(),
  previousAmountCents: IMPORTE.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const CAMPOS_CONTRATO = {
  id: true,
  name: true,
  concept: true,
  amountCents: true,
  currency: true,
  periodicity: true,
  startDate: true,
  endDate: true,
  renewalDate: true,
  noticeDays: true,
  autoRenew: true,
  licensedSeats: true,
  activeSeats: true,
  previousAmountCents: true,
  previousPeriodicity: true,
  status: true,
  vendor: { select: { id: true, name: true } },
} as const;

export const ETIQUETA_PERIODICIDAD: Readonly<Record<Periodicity, string>> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
  BIENNIAL: 'Bienal',
};

export const ETIQUETA_ESTADO_CONTRATO: Readonly<Record<keyof typeof ContractStatus, string>> = {
  ACTIVE: 'Activo',
  NOTICE_GIVEN: 'Preavisado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Vencido',
};

/** Lo mínimo que hace falta de un contrato para calcular. */
export interface ContratoParaCalcular {
  readonly id: string;
  readonly name: string;
  readonly amountCents: number;
  readonly periodicity: Periodicity;
  readonly currency: string;
  readonly status: keyof typeof ContractStatus;
  readonly renewalDate: Date | null;
  readonly noticeDays: number | null;
  readonly licensedSeats: number | null;
  readonly activeSeats: number | null;
  readonly previousAmountCents: number | null;
  readonly previousPeriodicity: Periodicity | null;
}

/** Un contrato con lo que cuesta de verdad al mes y al año. */
export interface ContratoNormalizado {
  readonly id: string;
  readonly monthlyCents: number;
  readonly annualCents: number;
  /** Días que faltan para tener que preavisar, o `null` si no aplica. */
  readonly diasHastaPreaviso: number | null;
  /** Puestos pagados y sin usar, o `null` si el contrato no va por puestos. */
  readonly puestosSinUsar: number | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Días que faltan para la fecha límite de preaviso.
 *
 * Lo que importa de una renovación no es cuándo renueva, es cuándo deja de
 * poder evitarse. Con noventa días de preaviso, un contrato que renueva en
 * octubre hay que cancelarlo en julio; enseñar octubre es enseñar una fecha que
 * ya no sirve para decidir nada.
 */
export function diasHastaPreaviso(
  renewalDate: Date | null,
  noticeDays: number | null,
  ahora: Date,
): number | null {
  if (renewalDate === null) return null;
  const limite = renewalDate.getTime() - (noticeDays ?? 0) * DIA_MS;
  return Math.ceil((limite - ahora.getTime()) / DIA_MS);
}

/** Traduce la fila a lo que espera `finance-core`. */
function paraAvisos(contrato: ContratoParaCalcular): ContractForAlerts {
  return {
    contractId: contrato.id,
    name: contrato.name,
    amountCents: cents(contrato.amountCents),
    periodicity: contrato.periodicity,
    ...(contrato.licensedSeats === null ? {} : { licensedSeats: contrato.licensedSeats }),
    ...(contrato.activeSeats === null ? {} : { activeSeats: contrato.activeSeats }),
    ...(contrato.previousAmountCents === null
      ? {}
      : { previousAmountCents: cents(contrato.previousAmountCents) }),
    ...(contrato.previousPeriodicity === null
      ? {}
      : { previousPeriodicity: contrato.previousPeriodicity }),
  };
}

export interface ResumenContratos {
  readonly normalizados: readonly ContratoNormalizado[];
  readonly avisos: readonly ContractAlert[];
  /** Coste mensual de la cartera viva. Los cancelados y vencidos no cuentan. */
  readonly monthlyCents: number;
  readonly annualCents: number;
}

/** Contratos que siguen costando dinero. */
function vivo(contrato: ContratoParaCalcular): boolean {
  return contrato.status === 'ACTIVE' || contrato.status === 'NOTICE_GIVEN';
}

/**
 * Todo lo que la pantalla de contratos necesita, calculado de una vez.
 *
 * El reloj entra por parámetro para que esto se pueda probar sin esperar a
 * mañana, y para que la pantalla no lea la hora dentro del componente.
 */
export function resumenContratos(
  contratos: readonly ContratoParaCalcular[],
  ahora: Date,
): ResumenContratos {
  const normalizados = contratos.map((contrato) => {
    const { monthlyCents, annualCents } = normalizeRecurring({
      amountCents: cents(contrato.amountCents),
      periodicity: contrato.periodicity,
    });
    const puestosSinUsar =
      contrato.licensedSeats === null || contrato.activeSeats === null
        ? null
        : Math.max(0, contrato.licensedSeats - contrato.activeSeats);
    return {
      id: contrato.id,
      monthlyCents,
      annualCents,
      diasHastaPreaviso: diasHastaPreaviso(contrato.renewalDate, contrato.noticeDays, ahora),
      puestosSinUsar,
    };
  });

  const vivos = contratos.filter(vivo);
  const idsVivos = new Set(vivos.map((contrato) => contrato.id));
  const sumas = normalizados
    .filter((n) => idsVivos.has(n.id))
    .reduce(
      (total, n) => ({
        monthlyCents: total.monthlyCents + n.monthlyCents,
        annualCents: total.annualCents + n.annualCents,
      }),
      { monthlyCents: 0, annualCents: 0 },
    );

  return {
    normalizados,
    avisos: contractAlerts(vivos.map(paraAvisos), DEFAULT_ALERT_THRESHOLDS),
    monthlyCents: sumas.monthlyCents,
    annualCents: sumas.annualCents,
  };
}
