import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import {
  applyScenario,
  budgetExecution,
  budgetForPeriods,
  forecast,
  type BudgetLine,
  type ForecastInput,
  type Scenario,
} from './forecast.js';

const MESES_2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const DESDE_JULIO = MESES_2026.slice(6); // 2026-07 … 2026-12, seis meses

/** Contrato de 1.000 €/mes vigente todo el año, más otro que no se toca. */
const BASE: ForecastInput = {
  actualToDateCents: cents(5_000_000),
  recurring: [
    { contractId: 'crm', monthlyCents: cents(100_000), remainingMonths: MESES_2026 },
    { contractId: 'backup', monthlyCents: cents(20_000), remainingMonths: MESES_2026 },
  ],
  projectEtcCents: cents(3_000_000),
  remainingDepreciationCents: cents(1_200_000),
  committedNotAccruedCents: cents(800_000),
};

describe('budgetForPeriods y budgetExecution', () => {
  const lineas: BudgetLine[] = [
    { id: 'l1', period: '2026-01', amountCents: cents(1_000_000), category: 'SAAS' },
    { id: 'l2', period: '2026-02', amountCents: cents(1_000_000), category: 'SAAS' },
    { id: 'l3', period: '2026-03', amountCents: cents(500_000), category: 'HARDWARE' },
  ];

  it('suma sólo las líneas de los periodos pedidos', () => {
    expect(budgetForPeriods(lineas, ['2026-01', '2026-02'])).toBe(2_000_000);
    expect(budgetForPeriods(lineas, ['2026-03'])).toBe(500_000);
    expect(budgetForPeriods(lineas, ['2026-11'])).toBe(0);
  });

  it('varianza y porcentaje de ejecución', () => {
    const e = budgetExecution(cents(2_000_000), cents(2_300_000));
    expect(e.varianceCents).toBe(300_000);
    expect(e.executionRatio).toBeCloseTo(1.15, 12);
  });

  it('gasto sin presupuesto: hay varianza, pero no porcentaje', () => {
    const e = budgetExecution(cents(0), cents(450_000));
    expect(e.varianceCents).toBe(450_000);
    expect(e.executionRatio).toBeNull();
  });
});

describe('forecast', () => {
  it('suma los cinco componentes del documento', () => {
    const f = forecast(BASE);
    // Recurrente: (1.000 € + 200 €) × 12 = 14.400 €
    expect(f.recurringRemainingCents).toBe(1_440_000);
    expect(f.totalCents).toBe(5_000_000 + 1_440_000 + 3_000_000 + 1_200_000 + 800_000);
    expect(
      f.actualToDateCents +
        f.recurringRemainingCents +
        f.projectEtcCents +
        f.remainingDepreciationCents +
        f.committedNotAccruedCents,
    ).toBe(f.totalCents);
  });

  it('desglosa el recurrente mes a mes y en orden', () => {
    const f = forecast(BASE);
    const meses = Object.keys(f.recurringByMonth);
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe('2026-01');
    expect(meses[11]).toBe('2026-12');
    expect(f.recurringByMonth['2026-07']).toBe(120_000);
  });

  it('sin datos, el forecast es el real acumulado', () => {
    const f = forecast({ actualToDateCents: cents(5_000_000) });
    expect(f.totalCents).toBe(5_000_000);
    expect(f.recurringRemainingCents).toBe(0);
    expect(f.recurringByMonth).toEqual({});
  });
});

describe('applyScenario · cancelar un contrato en julio', () => {
  const cancelarCrm: Scenario = {
    id: 'sin-crm',
    name: 'Cancelar el CRM en julio',
    overrides: [{ kind: 'CANCEL_RECURRING', contractId: 'crm', fromPeriod: '2026-07' }],
  };

  it('reduce el forecast exactamente en los meses restantes', () => {
    const r = applyScenario(BASE, cancelarCrm);
    // Seis meses (julio a diciembre) × 1.000 € = 6.000 €
    expect(r.deltaCents).toBe(-600_000);
    expect(r.scenario.totalCents).toBe(r.base.totalCents - 600_000);
    expect(DESDE_JULIO).toHaveLength(6);
  });

  it('deja intactos los meses anteriores y el resto de contratos', () => {
    const r = applyScenario(BASE, cancelarCrm);
    // Antes de julio siguen los dos contratos; a partir de julio sólo backup.
    expect(r.scenario.recurringByMonth['2026-06']).toBe(120_000);
    expect(r.scenario.recurringByMonth['2026-07']).toBe(20_000);
    expect(r.scenario.recurringByMonth['2026-12']).toBe(20_000);
  });

  it('el real acumulado no se toca', () => {
    const r = applyScenario(BASE, cancelarCrm);
    expect(r.scenario.actualToDateCents).toBe(BASE.actualToDateCents);
    expect(r.base.actualToDateCents).toBe(BASE.actualToDateCents);
  });

  it('la entrada original queda igual: se puede volver a calcular el base', () => {
    const antes = forecast(BASE).totalCents;
    applyScenario(BASE, cancelarCrm);
    applyScenario(BASE, cancelarCrm);
    expect(forecast(BASE).totalCents).toBe(antes);
    expect(BASE.recurring?.[0]?.remainingMonths).toHaveLength(12);
  });
});

describe('applyScenario · otros overrides', () => {
  it('cambiar el precio de un contrato desde un mes', () => {
    const subida: Scenario = {
      id: 'crm-sube',
      name: 'El CRM sube un 20 % en julio',
      overrides: [
        {
          kind: 'REPRICE_RECURRING',
          contractId: 'crm',
          fromPeriod: '2026-07',
          monthlyCents: cents(120_000),
        },
      ],
    };
    const r = applyScenario(BASE, subida);
    // Seis meses × 200 € de diferencia = 1.200 €
    expect(r.deltaCents).toBe(120_000);
    expect(r.scenario.recurringByMonth['2026-06']).toBe(120_000);
    expect(r.scenario.recurringByMonth['2026-07']).toBe(140_000);
  });

  it('ajustar el ETC agregado de proyectos', () => {
    const retraso: Scenario = {
      id: 'retraso-erp',
      name: 'El ERP se retrasa un trimestre',
      overrides: [{ kind: 'ADJUST_PROJECT_ETC', deltaCents: cents(900_000) }],
    };
    const r = applyScenario(BASE, retraso);
    expect(r.deltaCents).toBe(900_000);
    expect(r.scenario.projectEtcCents).toBe(3_900_000);
  });

  it('añadir un coste nuevo, por ejemplo +1 FTE', () => {
    const masFte: Scenario = {
      id: 'mas-fte',
      name: '+1 FTE en septiembre',
      overrides: [{ kind: 'ADD_COST', id: 'fte-extra', amountCents: cents(2_000_000) }],
    };
    const r = applyScenario(BASE, masFte);
    expect(r.deltaCents).toBe(2_000_000);
  });

  it('combina varios overrides en un mismo escenario', () => {
    const plan: Scenario = {
      id: 'plan-ahorro',
      name: 'Plan de ahorro',
      overrides: [
        { kind: 'CANCEL_RECURRING', contractId: 'crm', fromPeriod: '2026-07' },
        { kind: 'ADJUST_PROJECT_ETC', deltaCents: cents(-500_000) },
        { kind: 'ADD_COST', id: 'migracion', amountCents: cents(300_000) },
      ],
    };
    const r = applyScenario(BASE, plan);
    expect(r.deltaCents).toBe(-600_000 - 500_000 + 300_000);
    expect(r.scenarioId).toBe('plan-ahorro');
  });

  it('un escenario vacío no cambia nada', () => {
    const r = applyScenario(BASE, { id: 'nada', name: 'Sin cambios', overrides: [] });
    expect(r.deltaCents).toBe(0);
    expect(r.scenario.totalCents).toBe(r.base.totalCents);
  });

  it('un override sobre un contrato que no existe no rompe el forecast', () => {
    const r = applyScenario(BASE, {
      id: 'fantasma',
      name: 'Contrato inexistente',
      overrides: [
        { kind: 'CANCEL_RECURRING', contractId: 'no-existe', fromPeriod: '2026-07' },
        {
          kind: 'REPRICE_RECURRING',
          contractId: 'tampoco',
          fromPeriod: '2026-07',
          monthlyCents: cents(1),
        },
      ],
    });
    expect(r.deltaCents).toBe(0);
  });
});
