import { describe, expect, it } from 'vitest';

import { cents } from './money.js';
import { DEFAULT_USEFUL_LIFE_MONTHS } from './depreciation.js';
import {
  CONCEPT_DEFINITIONS,
  SPEND_CONCEPTS,
  budgetCategoryFor,
  conceptDefinition,
  defaultUsefulLifeMonths,
  governedSpendShare,
  periodSpend,
  treatLine,
  validateLineConcept,
  type CostableLine,
  type SpendConcept,
} from './concepts.js';

const linea = (
  lineId: string,
  concept: SpendConcept,
  importe: number,
  assetId?: string,
): CostableLine => ({
  lineId,
  concept,
  netCents: cents(importe),
  ...(assetId === undefined ? {} : { assetId }),
});

describe('tabla de conceptos', () => {
  it('cada concepto del vocabulario tiene definición, y sin sobrantes', () => {
    expect(Object.keys(CONCEPT_DEFINITIONS).sort()).toEqual([...SPEND_CONCEPTS].sort());
    for (const c of SPEND_CONCEPTS) {
      expect(conceptDefinition(c).id).toBe(c);
      expect(conceptDefinition(c).label.length).toBeGreaterThan(0);
    }
  });

  it('sólo capitaliza lo que es CAPEX, y todo lo que capitaliza tiene categoría de activo', () => {
    for (const c of SPEND_CONCEPTS) {
      const d = conceptDefinition(c);
      if (d.capitalises) {
        expect(d.costType).toBe('CAPEX');
        expect(d.assetCategory).toBeDefined();
      } else {
        expect(d.assetCategory).toBeUndefined();
      }
    }
  });

  it('todo CAPEX capitaliza: no hay CAPEX que se quede como gasto del periodo', () => {
    for (const c of SPEND_CONCEPTS) {
      const d = conceptDefinition(c);
      if (d.costType === 'CAPEX') expect(d.capitalises).toBe(true);
    }
  });

  it('las cuatro vías de gasto del PRD tienen conceptos', () => {
    const tipos = new Set(SPEND_CONCEPTS.map((c) => conceptDefinition(c).costType));
    expect(tipos.has('OPEX_RECURRING')).toBe(true);
    expect(tipos.has('CAPEX')).toBe(true);
    expect(tipos.has('PERSONNEL_EXTERNAL')).toBe(true);
    expect(tipos.has('PROJECT_COST')).toBe(true);
  });

  it('la vida útil por defecto sale de la tabla del documento 02', () => {
    expect(defaultUsefulLifeMonths('HARDWARE_SERVER')).toBe(DEFAULT_USEFUL_LIFE_MONTHS.SERVER);
    expect(defaultUsefulLifeMonths('HARDWARE_ENDUSER')).toBe(48);
    expect(defaultUsefulLifeMonths('HARDWARE_NETWORK')).toBe(84);
    expect(defaultUsefulLifeMonths('CAPITALISED_DEV')).toBe(60);
    // Lo que no capitaliza no tiene vida útil, y se dice con null.
    expect(defaultUsefulLifeMonths('SAAS_SUBSCRIPTION')).toBeNull();
  });

  it('cada concepto sale de una categoría presupuestaria', () => {
    expect(budgetCategoryFor('SAAS_SUBSCRIPTION')).toBe('SOFTWARE_AND_SERVICES');
    expect(budgetCategoryFor('HARDWARE_SERVER')).toBe('INFRASTRUCTURE');
    expect(budgetCategoryFor('TELECOM')).toBe('COMMUNICATIONS');
    expect(budgetCategoryFor('CONTRACTOR')).toBe('PROFESSIONAL_SERVICES');
    expect(budgetCategoryFor('PROJECT_SERVICES')).toBe('PROJECTS');
    expect(budgetCategoryFor('SLA_PENALTY')).toBe('PENALTIES');
  });
});

describe('validateLineConcept', () => {
  it('una línea coherente no da problemas', () => {
    expect(
      validateLineConcept({ concept: 'SAAS_SUBSCRIPTION', costType: 'OPEX_RECURRING' }),
    ).toEqual([]);
  });

  it('detecta un SaaS marcado como CAPEX', () => {
    const p = validateLineConcept({ concept: 'SAAS_SUBSCRIPTION', costType: 'CAPEX' });
    expect(p).toHaveLength(1);
    expect(p[0]?.code).toBe('COST_TYPE_MISMATCH');
    expect(p[0]?.message).toContain('OPEX_RECURRING');
  });

  it('detecta un activo colgado de un concepto que no capitaliza', () => {
    const p = validateLineConcept({
      concept: 'SAAS_SUBSCRIPTION',
      costType: 'OPEX_RECURRING',
      assetId: 'act-1',
    });
    expect(p.map((x) => x.code)).toEqual(['ASSET_ON_NON_CAPEX']);
  });

  it('acumula varios problemas en la misma línea', () => {
    const p = validateLineConcept({
      concept: 'TELECOM',
      costType: 'CAPEX',
      assetId: 'act-1',
    });
    expect(p.map((x) => x.code).sort()).toEqual(['ASSET_ON_NON_CAPEX', 'COST_TYPE_MISMATCH']);
  });

  it('devuelve los problemas en vez de lanzar: una importación no se aborta por una fila', () => {
    const filas = [
      { concept: 'SAAS_SUBSCRIPTION' as const, costType: 'CAPEX' as const },
      { concept: 'HARDWARE_SERVER' as const, costType: 'CAPEX' as const },
    ];
    const resultados = filas.map((f) => validateLineConcept(f));
    expect(resultados[0]).toHaveLength(1);
    expect(resultados[1]).toHaveLength(0);
  });
});

describe('treatLine · el guardián del doble cómputo', () => {
  it('una línea que no capitaliza es gasto del periodo', () => {
    const t = treatLine(linea('l1', 'SAAS_SUBSCRIPTION', 100_000));
    expect(t.kind).toBe('PERIOD_COST');
  });

  it('una línea CAPEX con activo ya dado de alta NO cuenta: entra por amortización', () => {
    const t = treatLine(linea('l1', 'HARDWARE_SERVER', 1_200_000, 'act-1'));
    expect(t.kind).toBe('CAPITALISED');
    if (t.kind !== 'CAPITALISED') return;
    expect(t.assetId).toBe('act-1');
  });

  it('una línea CAPEX sin activo todavía cuenta, pero sale marcada', () => {
    const t = treatLine(linea('l1', 'HARDWARE_SERVER', 1_200_000));
    expect(t.kind).toBe('PENDING_CAPITALISATION');
  });
});

describe('periodSpend', () => {
  const lineas: CostableLine[] = [
    linea('l1', 'SAAS_SUBSCRIPTION', 120_000),
    linea('l2', 'CLOUD_INFRASTRUCTURE', 350_000),
    linea('l3', 'TELECOM', 80_000),
    linea('l4', 'HARDWARE_SERVER', 1_200_000, 'act-1'),
    linea('l5', 'HARDWARE_ENDUSER', 90_000),
    linea('l6', 'PROJECT_SERVICES', 500_000),
  ];

  it('el servidor ya capitalizado no infla el gasto del periodo', () => {
    const r = periodSpend(lineas);
    // 120.000 + 350.000 + 80.000 + 90.000 + 500.000. El servidor de 1.200.000 queda fuera.
    expect(r.totalCents).toBe(1_140_000);
    expect(r.capitalisedCents).toBe(1_200_000);
  });

  it('el desglose por categoría suma exactamente el total', () => {
    const r = periodSpend(lineas);
    const suma = Object.values(r.byBudgetCategory).reduce((a, b) => a + b, 0);
    expect(suma).toBe(r.totalCents);
  });

  it('reparte por categoría presupuestaria', () => {
    const r = periodSpend(lineas);
    expect(r.byBudgetCategory.SOFTWARE_AND_SERVICES).toBe(120_000);
    // Cloud 350.000 + el portátil pendiente 90.000.
    expect(r.byBudgetCategory.INFRASTRUCTURE).toBe(440_000);
    expect(r.byBudgetCategory.COMMUNICATIONS).toBe(80_000);
    expect(r.byBudgetCategory.PROJECTS).toBe(500_000);
  });

  it('marca las líneas CAPEX que faltan por regularizar', () => {
    const r = periodSpend(lineas);
    expect(r.pendingCapitalisation).toEqual([{ lineId: 'l5', netCents: 90_000 }]);
  });

  it('dar de alta el activo mueve el importe, no lo duplica', () => {
    const antes = periodSpend(lineas);
    const despues = periodSpend(
      lineas.map((l) => (l.lineId === 'l5' ? linea('l5', 'HARDWARE_ENDUSER', 90_000, 'act-2') : l)),
    );

    expect(despues.totalCents).toBe(antes.totalCents - 90_000);
    expect(despues.capitalisedCents).toBe(antes.capitalisedCents + 90_000);
    expect(despues.pendingCapitalisation).toEqual([]);
    // Ni un céntimo aparece ni desaparece del sistema.
    expect(despues.totalCents + despues.capitalisedCents).toBe(
      antes.totalCents + antes.capitalisedCents,
    );
  });

  it('sin líneas, todo a cero', () => {
    const r = periodSpend([]);
    expect(r.totalCents).toBe(0);
    expect(r.capitalisedCents).toBe(0);
    expect(r.byBudgetCategory).toEqual({});
    expect(r.pendingCapitalisation).toEqual([]);
  });
});

describe('governedSpendShare', () => {
  it('sólo cuenta el gasto que podría estar gobernado', () => {
    const r = governedSpendShare([
      { concept: 'SAAS_SUBSCRIPTION', netCents: cents(600_000), hasContract: true },
      { concept: 'CLOUD_INFRASTRUCTURE', netCents: cents(400_000), hasContract: false },
      // Ni el consumible ni la penalización entran en el denominador.
      { concept: 'CONSUMABLES', netCents: cents(900_000), hasContract: false },
      { concept: 'SLA_PENALTY', netCents: cents(900_000), hasContract: false },
    ]);
    expect(r).toBeCloseTo(0.6, 10);
  });

  it('no penaliza al departamento por lo que no puede tener contrato', () => {
    const soloConsumibles = governedSpendShare([
      { concept: 'CONSUMABLES', netCents: cents(500_000), hasContract: false },
    ]);
    expect(soloConsumibles).toBeNull();
  });

  it('todo bajo contrato da 1', () => {
    expect(
      governedSpendShare([
        { concept: 'SAAS_SUBSCRIPTION', netCents: cents(100_000), hasContract: true },
        { concept: 'TELECOM', netCents: cents(50_000), hasContract: true },
      ]),
    ).toBe(1);
  });

  it('sin líneas no hay ratio', () => {
    expect(governedSpendShare([])).toBeNull();
  });
});
