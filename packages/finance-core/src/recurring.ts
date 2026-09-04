/**
 * Normalización de gasto recurrente (F1-02, `docs/02-modelo-financiero.md` §1.1).
 *
 * Un contrato anual y uno mensual no se pueden comparar hasta que los dos
 * hablan en coste mensual. Eso es todo lo que hace este módulo.
 */
import { allocateByLargestRemainder, cents, roundHalfUp, type Cents } from './money.js';

/** Periodicidades admitidas. */
export type Periodicity = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'BIENNIAL';

/** Meses que cubre cada periodicidad. */
export const MONTHS_IN_PERIOD: Readonly<Record<Periodicity, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
  BIENNIAL: 24,
};

/** Contrato recurrente: lo que se paga y cada cuánto. */
export interface RecurringContract {
  readonly amountCents: Cents;
  readonly periodicity: Periodicity;
}

/** Coste normalizado del contrato. */
export interface NormalizedRecurring {
  readonly monthlyCents: Cents;
  readonly annualCents: Cents;
  readonly monthsInPeriod: number;
}

function monthsOf(periodicity: Periodicity): number {
  const months = MONTHS_IN_PERIOD[periodicity];
  if (months === undefined) {
    throw new RangeError(`Periodicidad desconocida: ${String(periodicity)}`);
  }
  return months;
}

/**
 * Coste mensual y anualizado de un recurrente.
 *
 * El anualizado se calcula sobre el importe exacto, **no** multiplicando por 12
 * el mensual ya redondeado: un contrato bienal de 43.200 € da 1.800,00 €/mes y
 * 21.600,00 €/año, y encadenar redondeos desviaría el anual varios céntimos.
 */
export function normalizeRecurring(contract: RecurringContract): NormalizedRecurring {
  const monthsInPeriod = monthsOf(contract.periodicity);
  return {
    monthlyCents: roundHalfUp(contract.amountCents / monthsInPeriod),
    annualCents: roundHalfUp((contract.amountCents * 12) / monthsInPeriod),
    monthsInPeriod,
  };
}

/**
 * Reparte el importe del contrato entre los meses que cubre, de forma que la
 * suma sea exactamente el importe pagado.
 *
 * `normalizeRecurring` da la cifra que se enseña; ésta da la que se contabiliza.
 * Para 100,01 € en 3 meses son 33,34 € + 33,34 € + 33,33 €, no tres veces 33,34 €.
 */
export function spreadRecurring(contract: RecurringContract): Cents[] {
  const monthsInPeriod = monthsOf(contract.periodicity);
  return allocateByLargestRemainder(
    contract.amountCents,
    new Array<number>(monthsInPeriod).fill(1),
  );
}

/** Coste mensual normalizado de una cartera de contratos. */
export function portfolioMonthlyCents(contracts: readonly RecurringContract[]): Cents {
  return cents(
    contracts.reduce<number>(
      (total, contract) => total + normalizeRecurring(contract).monthlyCents,
      0,
    ),
  );
}
