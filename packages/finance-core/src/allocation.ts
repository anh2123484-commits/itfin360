/**
 * TCO por servicio, reparto en cascada y unit economics (F1-06), según
 * `docs/02-modelo-financiero.md` §4.
 *
 * El reparto conserva el importe: la suma de lo asignado es **exactamente** el
 * total de origen. En un chargeback el descuadre se factura a alguien, así que
 * un céntimo perdido no es un detalle de redondeo, es una factura mal emitida.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, addCents, allocateByLargestRemainder, roundHalfUp } from './money.js';

/** Drivers de reparto soportados (`docs/02-modelo-financiero.md` §4.2). */
export const ALLOCATION_DRIVERS = [
  'HEADCOUNT',
  'ACTIVE_USERS',
  'DEVICES',
  'TICKETS',
  'STORAGE_GB',
  'COMPUTE_UNITS',
  'REVENUE',
  'FIXED_PERCENT',
] as const;

/** Driver de una regla de reparto. */
export type AllocationDriver = (typeof ALLOCATION_DRIVERS)[number];

/** Componentes del TCO de un servicio. */
export interface ServiceTcoInput {
  readonly serviceId: string;
  /** Facturas y recurrentes imputados al servicio. */
  readonly directOpexCents?: Cents;
  /** Cuotas de amortización de los activos asignados al servicio. */
  readonly capexDepreciationCents?: Cents;
  /** Horas de run imputadas al servicio, valoradas a tarifa. */
  readonly personnelCents?: Cents;
  /** Overhead que le llega por reglas de reparto. */
  readonly allocatedOverheadCents?: Cents;
}

/** TCO de un servicio, con su desglose. */
export interface ServiceTco {
  readonly serviceId: string;
  readonly directOpexCents: Cents;
  readonly capexDepreciationCents: Cents;
  readonly personnelCents: Cents;
  readonly allocatedOverheadCents: Cents;
  readonly totalCents: Cents;
}

/** TCO de un servicio en un periodo. Los cuatro componentes suman el total. */
export function serviceTco(input: ServiceTcoInput): ServiceTco {
  const directOpexCents = input.directOpexCents ?? ZERO_CENTS;
  const capexDepreciationCents = input.capexDepreciationCents ?? ZERO_CENTS;
  const personnelCents = input.personnelCents ?? ZERO_CENTS;
  const allocatedOverheadCents = input.allocatedOverheadCents ?? ZERO_CENTS;

  return {
    serviceId: input.serviceId,
    directOpexCents,
    capexDepreciationCents,
    personnelCents,
    allocatedOverheadCents,
    totalCents: addCents(
      directOpexCents,
      capexDepreciationCents,
      personnelCents,
      allocatedOverheadCents,
    ),
  };
}

/** Destino de una regla de reparto y el valor de su driver. */
export interface AllocationTarget {
  /** Unidad de negocio o servicio que recibe el coste. */
  readonly id: string;
  /** Valor del driver para este destino. Con `FIXED_PERCENT`, el porcentaje. */
  readonly driverValue: number;
}

/** Una regla de reparto: de dónde sale el coste, con qué driver y hacia dónde. */
export interface AllocationRule {
  readonly id: string;
  /** Bolsa de origen. Cada bolsa se reparte con una única regla. */
  readonly from: string;
  readonly driver: AllocationDriver;
  readonly targets: readonly AllocationTarget[];
}

/**
 * Error de configuración cíclica del reparto.
 *
 * Falla de forma explícita, nombrando las reglas y los nodos implicados: un ciclo
 * en cascada no se resuelve solo, y repartir "lo que se pueda" dejaría coste sin
 * asignar sin que nadie se entere.
 */
export class AllocationCycleError extends Error {
  /** Ids de las reglas que forman el ciclo, en orden. */
  readonly ruleIds: readonly string[];
  /** Ids de los nodos del ciclo, empezando y terminando en el mismo. */
  readonly nodeIds: readonly string[];

  constructor(nodeIds: readonly string[], ruleIds: readonly string[]) {
    super(
      `Ciclo en las reglas de reparto: ${nodeIds.join(' → ')}. ` +
        `Reglas implicadas: ${ruleIds.join(', ')}.`,
    );
    this.name = 'AllocationCycleError';
    this.nodeIds = nodeIds;
    this.ruleIds = ruleIds;
  }
}

/** Un paso del reparto, para poder explicar cada euro asignado. */
export interface AllocationStep {
  readonly ruleId: string;
  readonly from: string;
  readonly driver: AllocationDriver;
  readonly amountCents: Cents;
  readonly toEach: readonly { readonly id: string; readonly amountCents: Cents }[];
}

/** Resultado de la cascada de reparto. */
export interface AllocationResult {
  /** Saldo final de cada nodo. Las bolsas repartidas quedan a cero. */
  readonly balances: Readonly<Record<string, Cents>>;
  /** Traza del reparto, en el orden en que se aplicó. */
  readonly trace: readonly AllocationStep[];
  /** Total repartido: es exactamente el total de las bolsas de entrada. */
  readonly totalCents: Cents;
}

const TOLERANCIA_PORCENTAJE = 1e-6;

function validateRules(rules: readonly AllocationRule[]): void {
  const vistas = new Set<string>();
  const origenes = new Set<string>();
  for (const rule of rules) {
    if (vistas.has(rule.id)) {
      throw new RangeError(`Hay dos reglas de reparto con el mismo id: ${rule.id}`);
    }
    vistas.add(rule.id);

    if (origenes.has(rule.from)) {
      throw new RangeError(
        `La bolsa "${rule.from}" tiene más de una regla de reparto; el resultado sería ambiguo.`,
      );
    }
    origenes.add(rule.from);

    if (rule.targets.length === 0) {
      throw new RangeError(`La regla "${rule.id}" no tiene destinos.`);
    }

    let suma = 0;
    for (const target of rule.targets) {
      if (!Number.isFinite(target.driverValue) || target.driverValue < 0) {
        throw new RangeError(
          `Valor de driver no válido en la regla "${rule.id}", destino "${target.id}": ${target.driverValue}`,
        );
      }
      if (target.id === rule.from) {
        throw new RangeError(`La regla "${rule.id}" se reparte a sí misma ("${rule.from}").`);
      }
      suma += target.driverValue;
    }

    if (suma <= 0) {
      throw new RangeError(
        `La regla "${rule.id}" tiene todos los valores de driver a cero: no hay forma de repartir.`,
      );
    }
    if (rule.driver === 'FIXED_PERCENT' && Math.abs(suma - 100) > TOLERANCIA_PORCENTAJE) {
      throw new RangeError(
        `La regla "${rule.id}" usa FIXED_PERCENT y sus porcentajes suman ${suma}, no 100.`,
      );
    }
  }
}

/**
 * Orden topológico de las reglas. Lanza `AllocationCycleError` si hay ciclo.
 *
 * Se recorre en profundidad marcando los nodos en curso: si se vuelve a entrar en
 * uno que ya está en la pila, ese es el ciclo, y se devuelve el trozo exacto de la
 * pila que lo forma en vez de un mensaje genérico.
 */
function topologicalOrder(rules: readonly AllocationRule[]): AllocationRule[] {
  const porOrigen = new Map(rules.map((rule) => [rule.from, rule]));
  const estado = new Map<string, 'en-curso' | 'hecho'>();
  const pila: string[] = [];
  const orden: AllocationRule[] = [];

  const visitar = (nodo: string): void => {
    const marca = estado.get(nodo);
    if (marca === 'hecho') return;
    if (marca === 'en-curso') {
      const desde = pila.indexOf(nodo);
      const ciclo = [...pila.slice(desde), nodo];
      const reglas = ciclo
        .slice(0, -1)
        .map((id) => porOrigen.get(id)?.id)
        .filter((id): id is string => id !== undefined);
      throw new AllocationCycleError(ciclo, reglas);
    }

    const regla = porOrigen.get(nodo);
    if (regla === undefined) {
      estado.set(nodo, 'hecho');
      return;
    }

    estado.set(nodo, 'en-curso');
    pila.push(nodo);
    for (const target of regla.targets) visitar(target.id);
    pila.pop();
    estado.set(nodo, 'hecho');
    orden.push(regla);
  };

  for (const rule of rules) visitar(rule.from);

  // `orden` sale en post-orden: los destinos antes que sus orígenes. El reparto
  // necesita lo contrario, repartir la bolsa de arriba antes que las de abajo.
  return orden.reverse();
}

/**
 * Reparto en cascada del overhead entre unidades de negocio o servicios.
 *
 * Cada bolsa se vacía sobre sus destinos con el método del mayor resto, así que
 * la suma de lo repartido es exactamente el importe de origen. Una bolsa que a su
 * vez es destino de otra recibe primero y reparte después: por eso el orden
 * topológico, y por eso un ciclo es un error y no algo que "converge".
 */
export function allocate(
  pools: Readonly<Record<string, Cents>>,
  rules: readonly AllocationRule[],
): AllocationResult {
  validateRules(rules);

  const balances = new Map<string, Cents>();
  let total = ZERO_CENTS;
  for (const [id, amount] of Object.entries(pools)) {
    balances.set(id, amount);
    total = addCents(total, amount);
  }
  for (const rule of rules) {
    if (!balances.has(rule.from)) balances.set(rule.from, ZERO_CENTS);
    for (const target of rule.targets) {
      if (!balances.has(target.id)) balances.set(target.id, ZERO_CENTS);
    }
  }

  const trace: AllocationStep[] = [];
  for (const rule of topologicalOrder(rules)) {
    const importe = balances.get(rule.from) ?? ZERO_CENTS;
    balances.set(rule.from, ZERO_CENTS);

    const partes = allocateByLargestRemainder(
      importe,
      rule.targets.map((target) => target.driverValue),
    );

    const toEach = rule.targets.map((target, index) => {
      const parte = partes[index] ?? ZERO_CENTS;
      balances.set(target.id, addCents(balances.get(target.id) ?? ZERO_CENTS, parte));
      return { id: target.id, amountCents: parte };
    });

    trace.push({
      ruleId: rule.id,
      from: rule.from,
      driver: rule.driver,
      amountCents: importe,
      toEach,
    });
  }

  return { balances: Object.fromEntries(balances), trace, totalCents: total };
}

/** Entradas de las unit economics del departamento. */
export interface UnitEconomicsInput {
  readonly tcoTotalCents: Cents;
  readonly activeUsers?: number;
  readonly managedDevices?: number;
  readonly resolvedTickets?: number;
  readonly runCostCents?: Cents;
  readonly supportOpexCents?: Cents;
  readonly companyRevenueCents?: Cents;
}

/** Unit economics. Cada ratio es `null` si su denominador no existe o es cero. */
export interface UnitEconomics {
  readonly costPerUserCents: Cents | null;
  readonly costPerDeviceCents: Cents | null;
  readonly costPerTicketCents: Cents | null;
  readonly itSpendRatio: number | null;
}

function porUnidad(total: Cents, unidades: number | undefined): Cents | null {
  if (unidades === undefined) return null;
  if (!Number.isFinite(unidades) || unidades < 0) {
    throw new RangeError(`Número de unidades no válido: ${unidades}`);
  }
  return unidades === 0 ? null : roundHalfUp(total / unidades);
}

/**
 * Coste por usuario, por dispositivo y por ticket, e IT spend ratio.
 *
 * Un departamento sin tickets resueltos no tiene un coste por ticket de cero:
 * no tiene coste por ticket. Devolver `null` evita que el cuadro de mando pinte
 * un cero que parece una buena noticia.
 */
export function unitEconomics(input: UnitEconomicsInput): UnitEconomics {
  const soporte = addCents(input.runCostCents ?? ZERO_CENTS, input.supportOpexCents ?? ZERO_CENTS);
  const facturacion = input.companyRevenueCents;

  return {
    costPerUserCents: porUnidad(input.tcoTotalCents, input.activeUsers),
    costPerDeviceCents: porUnidad(input.tcoTotalCents, input.managedDevices),
    costPerTicketCents: porUnidad(soporte, input.resolvedTickets),
    itSpendRatio:
      facturacion === undefined || facturacion === 0 ? null : input.tcoTotalCents / facturacion,
  };
}
