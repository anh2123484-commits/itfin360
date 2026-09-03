/**
 * Presupuesto, forecast y escenarios (F1-09), según
 * `docs/02-modelo-financiero.md` §6.
 *
 * Un escenario **nunca** escribe sobre los datos reales: `applyScenario` recibe
 * la entrada del forecast base y devuelve dos resultados independientes, base y
 * escenario, sin tocar el objeto de entrada. Si un escenario pudiera modificar el
 * real, la primera simulación destruiría la contabilidad.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, subtractCents } from './money.js';

/** Una línea de presupuesto de un periodo mensual. */
export interface BudgetLine {
  readonly id: string;
  /** Periodo mensual, `YYYY-MM`. */
  readonly period: string;
  readonly amountCents: Cents;
  readonly category?: string;
}

/** Ejecución presupuestaria de un periodo. */
export interface BudgetExecution {
  readonly budgetCents: Cents;
  readonly actualCents: Cents;
  /** `real − presupuesto`. Positivo, se ha gastado de más. */
  readonly varianceCents: Cents;
  /** `real / presupuesto`. `null` si no hay presupuesto. */
  readonly executionRatio: number | null;
}

/** Suma de las líneas de presupuesto de los periodos indicados. */
export function budgetForPeriods(lines: readonly BudgetLine[], periods: readonly string[]): Cents {
  const buscados = new Set(periods);
  return addCents(
    ...lines.filter((line) => buscados.has(line.period)).map((line) => line.amountCents),
  );
}

/**
 * Ejecución presupuestaria.
 *
 * Sin presupuesto no hay porcentaje de ejecución: se devuelve `null`, no cero ni
 * infinito. Un gasto sin línea presupuestaria es precisamente lo que hay que ver.
 */
export function budgetExecution(budgetCents: Cents, actualCents: Cents): BudgetExecution {
  return {
    budgetCents,
    actualCents,
    varianceCents: subtractCents(actualCents, budgetCents),
    executionRatio: budgetCents === 0 ? null : actualCents / budgetCents,
  };
}

/** Un contrato recurrente vigente y los meses del año que le quedan. */
export interface RecurringCommitment {
  readonly contractId: string;
  readonly monthlyCents: Cents;
  /** Meses del horizonte en los que sigue vigente, `YYYY-MM`. */
  readonly remainingMonths: readonly string[];
}

/** Entradas del forecast de año completo. */
export interface ForecastInput {
  /** Coste real devengado hasta la fecha. No lo toca ningún escenario. */
  readonly actualToDateCents: Cents;
  readonly recurring?: readonly RecurringCommitment[];
  /** Suma de los ETC de los proyectos activos (viene de EVM). */
  readonly projectEtcCents?: Cents;
  /** Cuotas de amortización que quedan por devengar en el horizonte. */
  readonly remainingDepreciationCents?: Cents;
  /** Pedidos y contratos firmados aún no devengados. */
  readonly committedNotAccruedCents?: Cents;
}

/** Forecast de año completo, con sus cinco componentes. */
export interface Forecast {
  readonly actualToDateCents: Cents;
  readonly recurringRemainingCents: Cents;
  readonly projectEtcCents: Cents;
  readonly remainingDepreciationCents: Cents;
  readonly committedNotAccruedCents: Cents;
  readonly totalCents: Cents;
  /** Recurrente pendiente mes a mes, para poder ver dónde cae el ahorro. */
  readonly recurringByMonth: Readonly<Record<string, Cents>>;
}

/**
 * Forecast de año completo: real acumulado más todo lo que ya está comprometido.
 *
 * Los cinco componentes se devuelven por separado, y suman exactamente el total:
 * un forecast que no se puede desglosar no se puede defender ante dirección.
 */
export function forecast(input: ForecastInput): Forecast {
  const recurringByMonth = new Map<string, Cents>();
  for (const contrato of input.recurring ?? []) {
    for (const mes of contrato.remainingMonths) {
      recurringByMonth.set(
        mes,
        addCents(recurringByMonth.get(mes) ?? ZERO_CENTS, contrato.monthlyCents),
      );
    }
  }

  const recurringRemainingCents = addCents(...recurringByMonth.values());
  const projectEtcCents = input.projectEtcCents ?? ZERO_CENTS;
  const remainingDepreciationCents = input.remainingDepreciationCents ?? ZERO_CENTS;
  const committedNotAccruedCents = input.committedNotAccruedCents ?? ZERO_CENTS;

  return {
    actualToDateCents: input.actualToDateCents,
    recurringRemainingCents,
    projectEtcCents,
    remainingDepreciationCents,
    committedNotAccruedCents,
    totalCents: addCents(
      input.actualToDateCents,
      recurringRemainingCents,
      projectEtcCents,
      remainingDepreciationCents,
      committedNotAccruedCents,
    ),
    recurringByMonth: Object.fromEntries(
      [...recurringByMonth.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}

/** Un cambio hipotético sobre el forecast base. */
export type ScenarioOverride =
  | {
      /** Cancela un contrato recurrente a partir de un mes, ése incluido. */
      readonly kind: 'CANCEL_RECURRING';
      readonly contractId: string;
      readonly fromPeriod: string;
    }
  | {
      /** Cambia el precio mensual de un contrato a partir de un mes, ése incluido. */
      readonly kind: 'REPRICE_RECURRING';
      readonly contractId: string;
      readonly fromPeriod: string;
      readonly monthlyCents: Cents;
    }
  | {
      /** Ajusta el ETC agregado de proyectos (retrasos, alcance). */
      readonly kind: 'ADJUST_PROJECT_ETC';
      readonly deltaCents: Cents;
    }
  | {
      /** Añade un coste nuevo al horizonte: +1 FTE, una compra, una licencia. */
      readonly kind: 'ADD_COST';
      readonly id: string;
      readonly amountCents: Cents;
    };

/** Un escenario: un conjunto de cambios hipotéticos con nombre. */
export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly overrides: readonly ScenarioOverride[];
}

/** Comparación entre el forecast base y el del escenario. */
export interface ScenarioForecast {
  readonly scenarioId: string;
  readonly base: Forecast;
  readonly scenario: Forecast;
  /** `escenario − base`. Negativo, el escenario ahorra. */
  readonly deltaCents: Cents;
}

/**
 * Aplica un escenario sobre las entradas del forecast **sin tocarlas**.
 *
 * El real acumulado se copia tal cual: ningún override puede alcanzarlo. Los
 * contratos se reconstruyen en estructuras nuevas, así que la entrada original
 * sigue sirviendo para calcular el forecast base después de simular.
 */
export function applyScenario(input: ForecastInput, scenario: Scenario): ScenarioForecast {
  let recurring = (input.recurring ?? []).map((contrato) => ({
    contractId: contrato.contractId,
    monthlyCents: contrato.monthlyCents,
    remainingMonths: [...contrato.remainingMonths],
  }));
  let projectEtcCents = input.projectEtcCents ?? ZERO_CENTS;
  let extraCents = ZERO_CENTS;

  for (const override of scenario.overrides) {
    switch (override.kind) {
      case 'CANCEL_RECURRING':
        recurring = recurring.map((contrato) =>
          contrato.contractId === override.contractId
            ? {
                ...contrato,
                remainingMonths: contrato.remainingMonths.filter(
                  (mes) => mes < override.fromPeriod,
                ),
              }
            : contrato,
        );
        break;

      case 'REPRICE_RECURRING': {
        const afectado = recurring.find((c) => c.contractId === override.contractId);
        if (afectado !== undefined) {
          const antes = afectado.remainingMonths.filter((mes) => mes < override.fromPeriod);
          const despues = afectado.remainingMonths.filter((mes) => mes >= override.fromPeriod);
          recurring = [
            ...recurring.filter((c) => c.contractId !== override.contractId),
            { ...afectado, remainingMonths: antes },
            {
              contractId: `${afectado.contractId}@${override.fromPeriod}`,
              monthlyCents: override.monthlyCents,
              remainingMonths: despues,
            },
          ];
        }
        break;
      }

      case 'ADJUST_PROJECT_ETC':
        projectEtcCents = addCents(projectEtcCents, override.deltaCents);
        break;

      case 'ADD_COST':
        extraCents = addCents(extraCents, override.amountCents);
        break;
    }
  }

  const base = forecast(input);
  const simulado = forecast({
    actualToDateCents: input.actualToDateCents,
    recurring,
    projectEtcCents,
    remainingDepreciationCents: input.remainingDepreciationCents ?? ZERO_CENTS,
    committedNotAccruedCents: addCents(input.committedNotAccruedCents ?? ZERO_CENTS, extraCents),
  });

  return {
    scenarioId: scenario.id,
    base,
    scenario: simulado,
    deltaCents: subtractCents(simulado.totalCents, base.totalCents),
  };
}
