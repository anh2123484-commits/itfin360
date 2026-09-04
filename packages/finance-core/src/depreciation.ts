/**
 * Amortización de inmovilizado (F1-03), según `docs/02-modelo-financiero.md` §2.
 *
 * Todo el cuadro se genera de una vez y se reparte con el método del mayor resto,
 * así que la suma de las cuotas es **exactamente** la base amortizable: si cada
 * cuota se redondease por su cuenta, el activo nunca llegaría a su valor residual.
 */

import type { Cents } from './money.js';
import {
  ZERO_CENTS,
  addCents,
  allocateByLargestRemainder,
  roundHalfUp,
  subtractCents,
} from './money.js';
import type { CivilDate } from './dates.js';
import { addMonths, daysInMonth, monthKey, monthsBetween, parseIsoDate } from './dates.js';

/** Vidas útiles por defecto, en meses (`docs/02-modelo-financiero.md` §2.1). */
export const DEFAULT_USEFUL_LIFE_MONTHS = {
  SERVER: 60,
  STORAGE: 60,
  NETWORK: 84,
  WORKSTATION: 48,
  LAPTOP: 48,
  MOBILE: 36,
  PERIPHERAL: 36,
  SOFTWARE_LICENSE_PERPETUAL: 36,
  INTANGIBLE_DEV: 60,
} as const;

/** Categoría de inmovilizado con vida útil por defecto. */
export type AssetCategory = keyof typeof DEFAULT_USEFUL_LIFE_MONTHS;

/** Inflación anual de hardware por defecto (`docs/02-modelo-financiero.md` §2.3). */
export const DEFAULT_HARDWARE_INFLATION_RATE = 0.03;

/** Datos mínimos para amortizar un activo. */
export interface DepreciationInput {
  /** Valor de adquisición. */
  readonly acquisitionCents: Cents;
  /** Valor residual estimado al final de la vida útil. */
  readonly residualCents: Cents;
  /** Vida útil en meses; entero positivo. */
  readonly usefulLifeMonths: number;
  /** Fecha de puesta en servicio, `YYYY-MM-DD`. */
  readonly inServiceDate: string;
  /** Prorrateo del primer mes por días naturales. Por defecto, `true`. */
  readonly prorateFirstMonth?: boolean;
}

/** Una línea del cuadro de amortización. */
export interface DepreciationEntry {
  /** Periodo mensual, `YYYY-MM`. */
  readonly period: string;
  /** Cuota del mes. */
  readonly chargeCents: Cents;
  /** Amortización acumulada al cierre del mes. */
  readonly accumulatedCents: Cents;
  /** Valor neto contable al cierre del mes. */
  readonly netBookValueCents: Cents;
}

function validate(input: DepreciationInput): void {
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 1) {
    throw new RangeError(
      `La vida útil debe ser un entero de meses positivo: ${input.usefulLifeMonths}`,
    );
  }
  if (input.residualCents < 0) {
    throw new RangeError(`El valor residual no puede ser negativo: ${input.residualCents}`);
  }
  if (input.acquisitionCents < 0) {
    throw new RangeError(
      `El valor de adquisición no puede ser negativo: ${input.acquisitionCents}`,
    );
  }
  if (input.residualCents > input.acquisitionCents) {
    throw new RangeError('El valor residual no puede superar al de adquisición.');
  }
}

/**
 * Fracción del primer mes que se amortiza: del día de alta al fin de mes, sobre
 * los días naturales del mes. Con alta el día 1, o sin prorrateo, vale 1.
 */
function firstMonthFraction(start: CivilDate, prorate: boolean): number {
  if (!prorate) return 1;
  const total = daysInMonth(start.year, start.month);
  return (total - start.day + 1) / total;
}

/**
 * Cuadro de amortización lineal con valor residual y prorrateo del primer mes.
 *
 * Con prorrateo, la parte que el primer mes no amortiza se recupera en un mes
 * adicional al final: el cuadro tiene `vidaÚtil + 1` líneas y sigue sumando la
 * base completa.
 */
export function depreciationSchedule(input: DepreciationInput): DepreciationEntry[] {
  validate(input);
  const start = parseIsoDate(input.inServiceDate);
  const prorate = input.prorateFirstMonth ?? true;
  const base = subtractCents(input.acquisitionCents, input.residualCents);

  const fraction = firstMonthFraction(start, prorate);
  const weights =
    fraction < 1
      ? [fraction, ...Array.from({ length: input.usefulLifeMonths - 1 }, () => 1), 1 - fraction]
      : Array.from({ length: input.usefulLifeMonths }, () => 1);

  const charges = allocateByLargestRemainder(base, weights);

  let accumulated = ZERO_CENTS;
  return charges.map((charge, index) => {
    accumulated = addCents(accumulated, charge);
    const period = monthKey(addMonths(start, index));
    return {
      period,
      chargeCents: charge,
      accumulatedCents: accumulated,
      netBookValueCents: subtractCents(input.acquisitionCents, accumulated),
    };
  });
}

/**
 * Valor neto contable al cierre del periodo `YYYY-MM` indicado.
 *
 * Antes del alta devuelve el valor de adquisición; pasada la vida útil, el residual.
 */
export function netBookValueAt(input: DepreciationInput, period: string): Cents {
  const schedule = depreciationSchedule(input);
  let value = input.acquisitionCents;
  for (const entry of schedule) {
    if (entry.period > period) break;
    value = entry.netBookValueCents;
  }
  return value;
}

/** Cuota mensual de referencia, sin prorrateos: base amortizable entre vida útil. */
export function monthlyDepreciationCents(input: DepreciationInput): Cents {
  validate(input);
  const base = subtractCents(input.acquisitionCents, input.residualCents);
  return roundHalfUp(base / input.usefulLifeMonths);
}

/** Estado de un activo. Sólo `IN_USE` cuenta para la deuda técnica. */
export type AssetStatus = 'IN_USE' | 'IN_STOCK' | 'IN_REPAIR' | 'RETIRED' | 'DISPOSED';

/** Activo evaluado para deuda técnica y riesgo de renovación. */
export interface AssetForDebt {
  readonly id: string;
  readonly status: AssetStatus;
  readonly acquisitionCents: Cents;
  readonly inServiceDate: string;
  readonly usefulLifeMonths: number;
  /** Precio de catálogo actual, si se conoce. Manda sobre la estimación. */
  readonly catalogPriceCents?: Cents;
  /** Si el activo ya tiene línea de presupuesto para su renovación. */
  readonly hasBudgetLine?: boolean;
}

/** Parámetros de tenant para la estimación de reposición. */
export interface TechnicalDebtConfig {
  /** Inflación anual de hardware. Por defecto, 3 %. */
  readonly hardwareInflationRate?: number;
}

/** Deuda técnica y riesgo de renovación no presupuestada. */
export interface TechnicalDebtResult {
  /** Coste de reponer todo el parque vencido y en uso. */
  readonly totalCents: Cents;
  /** Ids de los activos vencidos, en el orden de entrada. */
  readonly expiredAssetIds: readonly string[];
  /** Coste de los activos que vencen en los próximos 12 meses sin línea de presupuesto. */
  readonly unbudgetedRenewalCents: Cents;
  readonly unbudgetedRenewalAssetIds: readonly string[];
}

/**
 * Coste estimado de reponer un activo.
 *
 * Si hay precio de catálogo, ese manda: es un dato observado y no una proyección.
 * Si no, se infla el valor de adquisición con la inflación de hardware del tenant.
 * Los años se cuentan **fraccionados** (meses / 12): con años enteros el coste
 * daría un salto artificial cada aniversario.
 */
export function replacementCost(
  asset: AssetForDebt,
  asOf: string,
  config: TechnicalDebtConfig = {},
): Cents {
  if (asset.catalogPriceCents !== undefined) return asset.catalogPriceCents;

  const rate = config.hardwareInflationRate ?? DEFAULT_HARDWARE_INFLATION_RATE;
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new RangeError(`Inflación de hardware no válida: ${rate}`);
  }
  const ageMonths = monthsBetween(parseIsoDate(asset.inServiceDate), parseIsoDate(asOf));
  const years = Math.max(ageMonths, 0) / 12;
  return roundHalfUp(asset.acquisitionCents * Math.pow(1 + rate, years));
}

/**
 * Deuda técnica de hardware: coste de reponer los activos en uso cuya edad ya
 * supera su vida útil, más el riesgo de renovación de los que vencen dentro de
 * doce meses sin línea de presupuesto asociada.
 */
export function technicalDebt(
  assets: readonly AssetForDebt[],
  asOf: string,
  config: TechnicalDebtConfig = {},
): TechnicalDebtResult {
  const today = parseIsoDate(asOf);
  const horizon = addMonths(today, 12);

  const expiredIds: string[] = [];
  const renewalIds: string[] = [];
  let total = ZERO_CENTS;
  let renewal = ZERO_CENTS;

  for (const asset of assets) {
    if (asset.status !== 'IN_USE') continue;
    const start = parseIsoDate(asset.inServiceDate);
    const age = monthsBetween(start, today);

    if (age > asset.usefulLifeMonths) {
      expiredIds.push(asset.id);
      total = addCents(total, replacementCost(asset, asOf, config));
      continue;
    }

    const expiry = addMonths(start, asset.usefulLifeMonths);
    const venceEnElHorizonte =
      expiry.year * 10000 + expiry.month * 100 + expiry.day <=
      horizon.year * 10000 + horizon.month * 100 + horizon.day;
    if (venceEnElHorizonte && asset.hasBudgetLine !== true) {
      renewalIds.push(asset.id);
      renewal = addCents(renewal, replacementCost(asset, asOf, config));
    }
  }

  return {
    totalCents: total,
    expiredAssetIds: expiredIds,
    unbudgetedRenewalCents: renewal,
    unbudgetedRenewalAssetIds: renewalIds,
  };
}
