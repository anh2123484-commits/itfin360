/**
 * Plan de conceptos: qué se ha comprado, en qué se convierte y de qué
 * presupuesto sale (F2-01, `docs/03-arquitectura-y-datos.md`).
 *
 * `InvoiceLine.category` es hoy un `String` libre mientras el resto del modelo
 * son enums. Ese hueco es el que rompe la alineación con el presupuesto: "SaaS",
 * "Saas" y "Software" acaban siendo tres líneas presupuestarias distintas, y el
 * `% de gasto gobernado` del Viability Score deja de ser calculable. Aquí vive el
 * vocabulario controlado que lo cierra, y las reglas que se derivan de él.
 *
 * Nada de esto hace I/O: son tablas y funciones puras. Los enums replican los de
 * `docs/03`; si cambian allí, tienen que cambiar aquí, y hay un test que fija la
 * correspondencia.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents } from './money.js';
import type { AssetCategory } from './depreciation.js';
import { DEFAULT_USEFUL_LIFE_MONTHS } from './depreciation.js';

/** Naturaleza contable de una línea (`CostType` en `docs/03`). */
export type CostType =
  | 'OPEX_RECURRING'
  | 'OPEX_ONE_OFF'
  | 'CAPEX'
  | 'PERSONNEL_EXTERNAL'
  | 'PROJECT_COST'
  | 'PENALTY';

/**
 * Categoría presupuestaria: el nivel al que se fija el presupuesto anual
 * (`docs/01` §M6, "presupuesto por centro de coste / servicio / categoría").
 *
 * Es deliberadamente más gruesa que el concepto: se presupuesta por bloques que
 * un comité entiende, no por las veinte cosas distintas que se pueden comprar.
 */
export type BudgetCategory =
  | 'SOFTWARE_AND_SERVICES'
  | 'INFRASTRUCTURE'
  | 'COMMUNICATIONS'
  | 'PROFESSIONAL_SERVICES'
  | 'PROJECTS'
  | 'PENALTIES'
  | 'OTHER';

/** Reparto run/change de un concepto. */
export type WorkNature = 'RUN' | 'CHANGE' | 'FROM_IMPUTATION';

/** Los conceptos de gasto del departamento IT. Vocabulario controlado. */
export const SPEND_CONCEPTS = [
  'SAAS_SUBSCRIPTION',
  'SOFTWARE_LICENSE',
  'CLOUD_INFRASTRUCTURE',
  'HOSTING',
  'TELECOM',
  'MAINTENANCE',
  'THIRD_PARTY_SUPPORT',
  'INSURANCE',
  'CONSULTING',
  'TRAINING',
  'CONSUMABLES',
  'HARDWARE_SERVER',
  'HARDWARE_STORAGE',
  'HARDWARE_NETWORK',
  'HARDWARE_ENDUSER',
  'HARDWARE_MOBILE',
  'PERPETUAL_LICENSE',
  'CAPITALISED_DEV',
  'CONTRACTOR',
  'PROJECT_SERVICES',
  'SLA_PENALTY',
  'OTHER',
] as const;

/** Concepto de gasto. */
export type SpendConcept = (typeof SPEND_CONCEPTS)[number];

/** Definición completa de un concepto: todo lo que se deriva de él. */
export interface ConceptDefinition {
  readonly id: SpendConcept;
  /** Etiqueta para la interfaz, en español. */
  readonly label: string;
  /** Naturaleza contable que le corresponde. */
  readonly costType: CostType;
  /** De qué presupuesto sale. */
  readonly budgetCategory: BudgetCategory;
  /** Si es run, change, o depende de a qué se impute la línea. */
  readonly workNature: WorkNature;
  /** Si genera un activo y por tanto se amortiza en vez de contar como gasto. */
  readonly capitalises: boolean;
  /** Categoría de activo por defecto cuando capitaliza. */
  readonly assetCategory?: AssetCategory;
  /** Si lo normal es que venga de un contrato con vencimiento. */
  readonly typicallyRecurring: boolean;
  /**
   * Si cuenta como **gasto gobernado** cuando tiene contrato asociado.
   * Alimenta el indicador 7 del Viability Score.
   */
  readonly governable: boolean;
}

/** Tabla del plan de conceptos. Es configuración de arranque, ampliable por tenant. */
export const CONCEPT_DEFINITIONS: Readonly<Record<SpendConcept, ConceptDefinition>> = {
  SAAS_SUBSCRIPTION: {
    id: 'SAAS_SUBSCRIPTION',
    label: 'Suscripción SaaS',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'SOFTWARE_AND_SERVICES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  SOFTWARE_LICENSE: {
    id: 'SOFTWARE_LICENSE',
    label: 'Licencia de software por suscripción',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'SOFTWARE_AND_SERVICES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  CLOUD_INFRASTRUCTURE: {
    id: 'CLOUD_INFRASTRUCTURE',
    label: 'Infraestructura cloud',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  HOSTING: {
    id: 'HOSTING',
    label: 'Hosting y alojamiento',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  TELECOM: {
    id: 'TELECOM',
    label: 'Telecomunicaciones',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'COMMUNICATIONS',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  MAINTENANCE: {
    id: 'MAINTENANCE',
    label: 'Mantenimiento',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'SOFTWARE_AND_SERVICES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  THIRD_PARTY_SUPPORT: {
    id: 'THIRD_PARTY_SUPPORT',
    label: 'Soporte de terceros',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'PROFESSIONAL_SERVICES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  INSURANCE: {
    id: 'INSURANCE',
    label: 'Seguros',
    costType: 'OPEX_RECURRING',
    budgetCategory: 'OTHER',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  CONSULTING: {
    id: 'CONSULTING',
    label: 'Consultoría puntual',
    costType: 'OPEX_ONE_OFF',
    budgetCategory: 'PROFESSIONAL_SERVICES',
    workNature: 'FROM_IMPUTATION',
    capitalises: false,
    typicallyRecurring: false,
    governable: true,
  },
  TRAINING: {
    id: 'TRAINING',
    label: 'Formación',
    costType: 'OPEX_ONE_OFF',
    budgetCategory: 'PROFESSIONAL_SERVICES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: false,
    governable: false,
  },
  CONSUMABLES: {
    id: 'CONSUMABLES',
    label: 'Consumibles y material fungible',
    costType: 'OPEX_ONE_OFF',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: false,
    governable: false,
  },
  HARDWARE_SERVER: {
    id: 'HARDWARE_SERVER',
    label: 'Servidores',
    costType: 'CAPEX',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'SERVER',
    typicallyRecurring: false,
    governable: false,
  },
  HARDWARE_STORAGE: {
    id: 'HARDWARE_STORAGE',
    label: 'Almacenamiento',
    costType: 'CAPEX',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'STORAGE',
    typicallyRecurring: false,
    governable: false,
  },
  HARDWARE_NETWORK: {
    id: 'HARDWARE_NETWORK',
    label: 'Equipamiento de red',
    costType: 'CAPEX',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'NETWORK',
    typicallyRecurring: false,
    governable: false,
  },
  HARDWARE_ENDUSER: {
    id: 'HARDWARE_ENDUSER',
    label: 'Puesto de trabajo (portátiles y sobremesa)',
    costType: 'CAPEX',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'LAPTOP',
    typicallyRecurring: false,
    governable: false,
  },
  HARDWARE_MOBILE: {
    id: 'HARDWARE_MOBILE',
    label: 'Dispositivos móviles',
    costType: 'CAPEX',
    budgetCategory: 'INFRASTRUCTURE',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'MOBILE',
    typicallyRecurring: false,
    governable: false,
  },
  PERPETUAL_LICENSE: {
    id: 'PERPETUAL_LICENSE',
    label: 'Licencia perpetua',
    costType: 'CAPEX',
    budgetCategory: 'SOFTWARE_AND_SERVICES',
    workNature: 'RUN',
    capitalises: true,
    assetCategory: 'SOFTWARE_LICENSE_PERPETUAL',
    typicallyRecurring: false,
    governable: true,
  },
  CAPITALISED_DEV: {
    id: 'CAPITALISED_DEV',
    label: 'Desarrollo capitalizado',
    costType: 'CAPEX',
    budgetCategory: 'PROJECTS',
    workNature: 'CHANGE',
    capitalises: true,
    assetCategory: 'INTANGIBLE_DEV',
    typicallyRecurring: false,
    governable: false,
  },
  CONTRACTOR: {
    id: 'CONTRACTOR',
    label: 'Personal externo',
    costType: 'PERSONNEL_EXTERNAL',
    budgetCategory: 'PROFESSIONAL_SERVICES',
    workNature: 'FROM_IMPUTATION',
    capitalises: false,
    typicallyRecurring: true,
    governable: true,
  },
  PROJECT_SERVICES: {
    id: 'PROJECT_SERVICES',
    label: 'Servicios de proyecto',
    costType: 'PROJECT_COST',
    budgetCategory: 'PROJECTS',
    workNature: 'CHANGE',
    capitalises: false,
    typicallyRecurring: false,
    governable: true,
  },
  SLA_PENALTY: {
    id: 'SLA_PENALTY',
    label: 'Penalización de SLA',
    costType: 'PENALTY',
    budgetCategory: 'PENALTIES',
    workNature: 'RUN',
    capitalises: false,
    typicallyRecurring: false,
    governable: false,
  },
  OTHER: {
    id: 'OTHER',
    label: 'Otros',
    costType: 'OPEX_ONE_OFF',
    budgetCategory: 'OTHER',
    workNature: 'FROM_IMPUTATION',
    capitalises: false,
    typicallyRecurring: false,
    governable: false,
  },
};

/** Definición de un concepto. */
export function conceptDefinition(concept: SpendConcept): ConceptDefinition {
  return CONCEPT_DEFINITIONS[concept];
}

/** Categoría presupuestaria de la que sale un concepto. */
export function budgetCategoryFor(concept: SpendConcept): BudgetCategory {
  return CONCEPT_DEFINITIONS[concept].budgetCategory;
}

/**
 * Vida útil por defecto de un concepto que capitaliza, o `null` si no capitaliza.
 * Sale de la tabla de `depreciation.ts`, que a su vez sale del documento 02 §2.1.
 */
export function defaultUsefulLifeMonths(concept: SpendConcept): number | null {
  const categoria = CONCEPT_DEFINITIONS[concept].assetCategory;
  if (categoria === undefined) return null;
  return DEFAULT_USEFUL_LIFE_MONTHS[categoria];
}

/** Un problema detectado al clasificar una línea. */
export interface ConceptIssue {
  readonly code: 'COST_TYPE_MISMATCH' | 'CAPEX_WITHOUT_ASSET' | 'ASSET_ON_NON_CAPEX';
  readonly message: string;
}

/**
 * Comprueba que la naturaleza contable declarada encaja con el concepto.
 *
 * Devuelve los problemas en vez de lanzar: esto se ejecuta al teclear una factura
 * y al importar un CSV de mil filas, y ahí lo que hace falta es enseñar el error
 * en la fila, no abortar la importación entera.
 */
export function validateLineConcept(line: {
  readonly concept: SpendConcept;
  readonly costType: CostType;
  readonly assetId?: string | undefined;
}): ConceptIssue[] {
  const definicion = CONCEPT_DEFINITIONS[line.concept];
  const problemas: ConceptIssue[] = [];

  if (definicion.costType !== line.costType) {
    problemas.push({
      code: 'COST_TYPE_MISMATCH',
      message: `El concepto "${definicion.label}" es ${definicion.costType}, pero la línea viene como ${line.costType}.`,
    });
  }

  if (line.assetId !== undefined && !definicion.capitalises) {
    problemas.push({
      code: 'ASSET_ON_NON_CAPEX',
      message: `La línea tiene un activo asociado, pero el concepto "${definicion.label}" no capitaliza.`,
    });
  }

  return problemas;
}

/** Una línea de factura lista para computar. */
export interface CostableLine {
  readonly lineId: string;
  readonly concept: SpendConcept;
  readonly netCents: Cents;
  /** Id del activo dado de alta desde esta línea, si ya se ha creado. */
  readonly assetId?: string | undefined;
}

/** Cómo se trata una línea al calcular el gasto de un periodo. */
export type LineTreatment =
  | { readonly kind: 'PERIOD_COST'; readonly budgetCategory: BudgetCategory }
  | { readonly kind: 'CAPITALISED'; readonly assetId: string }
  | { readonly kind: 'PENDING_CAPITALISATION'; readonly budgetCategory: BudgetCategory };

/**
 * Decide si una línea cuenta como gasto del periodo o entra por amortización.
 *
 * **Ésta es la regla que evita el doble cómputo.** Una línea CAPEX de la que ya
 * se ha dado de alta un activo NO cuenta como gasto: ese importe entrará mes a
 * mes como cuota de amortización. Contarlo en los dos sitios infla el gasto del
 * periodo por el valor completo del equipo.
 *
 * El caso intermedio se marca aparte: una línea CAPEX **sin activo todavía** sí
 * cuenta —el dinero ha salido y esconderlo sería peor—, pero se devuelve como
 * `PENDING_CAPITALISATION` para que la interfaz pueda reclamar el alta. Si no se
 * distinguiera, el día que alguien cree el activo el importe pasaría a contarse
 * dos veces sin que nadie se entere.
 */
export function treatLine(line: CostableLine): LineTreatment {
  const definicion = CONCEPT_DEFINITIONS[line.concept];

  if (!definicion.capitalises) {
    return { kind: 'PERIOD_COST', budgetCategory: definicion.budgetCategory };
  }
  if (line.assetId !== undefined) {
    return { kind: 'CAPITALISED', assetId: line.assetId };
  }
  return { kind: 'PENDING_CAPITALISATION', budgetCategory: definicion.budgetCategory };
}

/** Gasto del periodo, repartido por categoría presupuestaria. */
export interface PeriodSpend {
  readonly totalCents: Cents;
  readonly byBudgetCategory: Readonly<Partial<Record<BudgetCategory, Cents>>>;
  /** Importe que ya no cuenta aquí porque entra por amortización. */
  readonly capitalisedCents: Cents;
  /** Líneas CAPEX sin activo dado de alta: cuentan, pero hay que regularizarlas. */
  readonly pendingCapitalisation: readonly {
    readonly lineId: string;
    readonly netCents: Cents;
  }[];
}

/**
 * Gasto del periodo a partir de las líneas de factura, sin doble cómputo.
 *
 * La suma de `byBudgetCategory` es exactamente `totalCents`: si el desglose por
 * categoría no cuadrase con el total, el presupuesto dejaría de poder auditarse.
 */
export function periodSpend(lines: readonly CostableLine[]): PeriodSpend {
  const porCategoria = new Map<BudgetCategory, Cents>();
  const pendientes: { lineId: string; netCents: Cents }[] = [];
  let total = ZERO_CENTS;
  let capitalizado = ZERO_CENTS;

  for (const line of lines) {
    const trato = treatLine(line);

    if (trato.kind === 'CAPITALISED') {
      capitalizado = addCents(capitalizado, line.netCents);
      continue;
    }

    if (trato.kind === 'PENDING_CAPITALISATION') {
      pendientes.push({ lineId: line.lineId, netCents: line.netCents });
    }

    total = addCents(total, line.netCents);
    porCategoria.set(
      trato.budgetCategory,
      addCents(porCategoria.get(trato.budgetCategory) ?? ZERO_CENTS, line.netCents),
    );
  }

  const desglose: Partial<Record<BudgetCategory, Cents>> = Object.fromEntries(porCategoria);

  return {
    totalCents: total,
    byBudgetCategory: desglose,
    capitalisedCents: capitalizado,
    pendingCapitalisation: pendientes,
  };
}

/** Una línea con la información de contrato necesaria para el gasto gobernado. */
export interface GovernableLine {
  readonly concept: SpendConcept;
  readonly netCents: Cents;
  /** Si la línea cuelga de un contrato registrado. */
  readonly hasContract: boolean;
}

/**
 * Proporción de gasto bajo contrato gobernado (indicador 7 del Viability Score).
 *
 * Sólo entra en el denominador el gasto que **podría** estar gobernado: exigir
 * contrato a un consumible o a una penalización de SLA penalizaría al
 * departamento por algo que no tiene arreglo. `null` si no hay gasto gobernable,
 * porque entonces el ratio no significa nada.
 */
export function governedSpendShare(lines: readonly GovernableLine[]): number | null {
  let gobernable = 0;
  let gobernado = 0;

  for (const line of lines) {
    if (!CONCEPT_DEFINITIONS[line.concept].governable) continue;
    gobernable += line.netCents;
    if (line.hasContract) gobernado += line.netCents;
  }

  return gobernable === 0 ? null : gobernado / gobernable;
}
