/**
 * Desperdicio de licencias y subidas de precio (F3-02, `docs/01` §M3).
 *
 * Las dos fugas de dinero de un contrato de software, y las dos son invisibles
 * en el extracto bancario porque el importe se paga puntualmente todos los meses:
 *
 * 1. **Puestos contratados que nadie usa.** Se contratan 120 licencias, se usan
 *    84, y se siguen pagando 120 hasta la renovación.
 * 2. **Subidas de precio que pasan sin discusión.** El proveedor sube un 9 % y
 *    nadie lo compara con el periodo anterior porque la factura llega firmada.
 *
 * La comparación de precio se hace siempre sobre el **coste mensual normalizado**
 * de `recurring.ts`, nunca sobre el importe facturado. Un proveedor que pasa de
 * facturación mensual a anual multiplica el importe por doce sin subir el precio
 * ni un céntimo; comparar importes en bruto convertiría eso en una alerta
 * crítica falsa, y una alerta falsa enseña al departamento a ignorar las alertas.
 *
 * Este módulo no hace I/O: recibe contratos ya leídos y devuelve avisos.
 */

import type { Cents } from './money.js';
import { ZERO_CENTS, cents, roundHalfUp, subtractCents } from './money.js';
import type { Periodicity, RecurringContract } from './recurring.js';
import { normalizeRecurring } from './recurring.js';

/** Tipos de aviso de `AlertType` en `docs/03` que salen de este módulo. */
export type ContractAlertType = 'LICENSE_WASTE' | 'PRICE_INCREASE';

/** Gravedad del aviso (`Severity` en `docs/03`). */
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/** Puestos contratados y realmente en uso. */
export interface SeatUsage {
  readonly licensedSeats: number;
  readonly activeSeats: number;
}

/** Un contrato de puestos: lo que se paga, cada cuánto, y cuántos se usan. */
export interface SeatContract {
  readonly amountCents: Cents;
  readonly periodicity: Periodicity;
  readonly licensedSeats: number;
  readonly activeSeats: number;
}

/** Resultado del cálculo de desperdicio. */
export interface LicenseWaste {
  readonly licensedSeats: number;
  readonly activeSeats: number;
  /** Puestos pagados y sin usar. Nunca negativo. */
  readonly unusedSeats: number;
  /**
   * Puestos usados por encima de lo contratado. Nunca negativo.
   *
   * No es desperdicio, es riesgo de auditoría del proveedor: se está usando
   * software que no se ha comprado. Se devuelve porque el dato importa, pero no
   * genera aviso: `AlertType` en `docs/03` no tiene un tipo para esto, y la
   * regla del documento es no implementar lo que no tiene campo de origen.
   */
  readonly overDeployedSeats: number;
  /** Proporción de puestos pagados sin usar, entre 0 y 1. */
  readonly wasteRatio: number;
  readonly costPerSeatMonthlyCents: Cents;
  readonly wastedMonthlyCents: Cents;
  readonly wastedAnnualCents: Cents;
}

function validarPuestos(usage: SeatUsage): void {
  if (!Number.isInteger(usage.licensedSeats) || usage.licensedSeats <= 0) {
    throw new RangeError(`Puestos contratados no válidos: ${usage.licensedSeats}`);
  }
  if (!Number.isInteger(usage.activeSeats) || usage.activeSeats < 0) {
    throw new RangeError(`Puestos activos no válidos: ${usage.activeSeats}`);
  }
}

/**
 * Cuánto cuesta al año lo que no se usa de un contrato de puestos.
 *
 * El importe desperdiciado se calcula sobre el coste mensual completo, **no**
 * multiplicando el coste por puesto ya redondeado: 100 licencias a 999 €/mes
 * dan 9,99 € por puesto, y multiplicar ese redondeo por 37 puestos sin usar
 * desvía el resultado del importe real que se está tirando.
 */
export function licenseWaste(contract: SeatContract): LicenseWaste {
  validarPuestos(contract);

  const { monthlyCents } = normalizeRecurring(contract);
  const unusedSeats = Math.max(0, contract.licensedSeats - contract.activeSeats);
  const overDeployedSeats = Math.max(0, contract.activeSeats - contract.licensedSeats);
  const wasteRatio = unusedSeats / contract.licensedSeats;

  const wastedMonthlyCents = roundHalfUp((monthlyCents * unusedSeats) / contract.licensedSeats);

  return {
    licensedSeats: contract.licensedSeats,
    activeSeats: contract.activeSeats,
    unusedSeats,
    overDeployedSeats,
    wasteRatio,
    costPerSeatMonthlyCents: roundHalfUp(monthlyCents / contract.licensedSeats),
    wastedMonthlyCents,
    wastedAnnualCents: cents(wastedMonthlyCents * 12),
  };
}

/** Comparación de precio entre dos periodos del mismo contrato. */
export interface PriceChange {
  readonly previousMonthlyCents: Cents;
  readonly currentMonthlyCents: Cents;
  /** Diferencia mensual. Negativa si el precio ha bajado. */
  readonly deltaMonthlyCents: Cents;
  /**
   * Variación proporcional, o `null` si antes no se pagaba nada.
   *
   * Un contrato nuevo no es una subida de precio infinita: es un contrato nuevo,
   * y quien lo mire tiene que verlo como tal.
   */
  readonly deltaRatio: number | null;
  /** Lo que cuesta la diferencia en un año completo. */
  readonly annualImpactCents: Cents;
}

/**
 * Variación de precio entre el periodo anterior y el actual.
 *
 * Compara costes mensuales normalizados, así que un cambio de periodicidad de
 * facturación no se lee como cambio de precio.
 */
export function priceChange(previous: RecurringContract, current: RecurringContract): PriceChange {
  const antes = normalizeRecurring(previous).monthlyCents;
  const ahora = normalizeRecurring(current).monthlyCents;
  const delta = subtractCents(ahora, antes);

  return {
    previousMonthlyCents: antes,
    currentMonthlyCents: ahora,
    deltaMonthlyCents: delta,
    deltaRatio: antes === 0 ? null : delta / antes,
    annualImpactCents: cents(delta * 12),
  };
}

/** Umbrales a partir de los cuales una desviación merece un aviso. */
export interface AlertThresholds {
  /** Proporción de puestos sin usar que enciende un aviso. */
  readonly wasteRatioWarning: number;
  readonly wasteRatioCritical: number;
  /** Subida proporcional que enciende un aviso. */
  readonly priceIncreaseWarning: number;
  readonly priceIncreaseCritical: number;
  /**
   * Suelo de materialidad anual: por debajo no se avisa.
   *
   * Un contrato de 40 €/año con la mitad de puestos sin usar da un ratio del
   * 50 % y un ahorro de 20 €. Avisar de eso entrena al departamento a cerrar
   * los avisos sin leerlos, y entonces tampoco lee el de 14.000 €.
   */
  readonly minAnnualImpactCents: Cents;
}

/** Umbrales por defecto. Configurables por tenant. */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  wasteRatioWarning: 0.15,
  wasteRatioCritical: 0.3,
  priceIncreaseWarning: 0.05,
  priceIncreaseCritical: 0.15,
  minAnnualImpactCents: cents(10_000),
};

/** Un contrato tal y como llega para revisar. */
export interface ContractForAlerts {
  readonly contractId: string;
  /** Nombre legible, para el texto del aviso. */
  readonly name: string;
  readonly amountCents: Cents;
  readonly periodicity: Periodicity;
  readonly licensedSeats?: number | undefined;
  readonly activeSeats?: number | undefined;
  /** Importe del periodo anterior, si lo hay. */
  readonly previousAmountCents?: Cents | undefined;
  /** Periodicidad anterior; si no se indica, se asume la misma. */
  readonly previousPeriodicity?: Periodicity | undefined;
}

/** Un aviso listo para persistir como `Alert` y para enseñar en pantalla. */
export interface ContractAlert {
  readonly type: ContractAlertType;
  readonly severity: AlertSeverity;
  readonly contractId: string;
  /** Dinero al año que hay en juego. Siempre positivo: es lo que se ordena. */
  readonly impactAnnualCents: Cents;
  readonly message: string;
}

function validarUmbrales(t: AlertThresholds): void {
  if (t.wasteRatioWarning < 0 || t.wasteRatioWarning > 1) {
    throw new RangeError(`Umbral de desperdicio no válido: ${t.wasteRatioWarning}`);
  }
  if (t.wasteRatioCritical < t.wasteRatioWarning) {
    throw new RangeError('El umbral crítico de desperdicio no puede ser menor que el de aviso.');
  }
  if (t.priceIncreaseWarning < 0) {
    throw new RangeError(`Umbral de subida no válido: ${t.priceIncreaseWarning}`);
  }
  if (t.priceIncreaseCritical < t.priceIncreaseWarning) {
    throw new RangeError('El umbral crítico de subida no puede ser menor que el de aviso.');
  }
  if (t.minAnnualImpactCents < 0) {
    throw new RangeError(`Suelo de materialidad no válido: ${t.minAnnualImpactCents}`);
  }
}

function gravedad(valor: number, aviso: number, critico: number): AlertSeverity | null {
  if (valor >= critico) return 'CRITICAL';
  if (valor >= aviso) return 'WARNING';
  return null;
}

/** Porcentaje con un decimal, en formato español, para el texto del aviso. */
function porcentaje(ratio: number): string {
  return (Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',');
}

/** Euros con dos decimales, en formato español. */
function euros(importe: Cents): string {
  const negativo = importe < 0;
  const absoluto = Math.abs(importe);
  const entero = Math.floor(absoluto / 100).toString();
  const decimales = (absoluto % 100).toString().padStart(2, '0');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${conMiles},${decimales} €`;
}

function avisoDeDesperdicio(
  contract: ContractForAlerts,
  thresholds: AlertThresholds,
): ContractAlert | null {
  const { licensedSeats, activeSeats } = contract;
  if (licensedSeats === undefined || activeSeats === undefined) return null;
  if (!Number.isInteger(licensedSeats) || licensedSeats <= 0) return null;
  if (!Number.isInteger(activeSeats) || activeSeats < 0) return null;

  const waste = licenseWaste({
    amountCents: contract.amountCents,
    periodicity: contract.periodicity,
    licensedSeats,
    activeSeats,
  });
  if (waste.wastedAnnualCents < thresholds.minAnnualImpactCents) return null;

  const severity = gravedad(
    waste.wasteRatio,
    thresholds.wasteRatioWarning,
    thresholds.wasteRatioCritical,
  );
  if (severity === null) return null;

  const message =
    `${contract.name}: ${waste.unusedSeats} de ${waste.licensedSeats} puestos sin usar ` +
    `(${porcentaje(waste.wasteRatio)} %). Son ${euros(waste.wastedAnnualCents)} al año.`;

  return {
    type: 'LICENSE_WASTE',
    severity,
    contractId: contract.contractId,
    impactAnnualCents: waste.wastedAnnualCents,
    message,
  };
}

function avisoDeSubida(
  contract: ContractForAlerts,
  thresholds: AlertThresholds,
): ContractAlert | null {
  const { previousAmountCents } = contract;
  if (previousAmountCents === undefined) return null;

  const change = priceChange(
    {
      amountCents: previousAmountCents,
      periodicity: contract.previousPeriodicity ?? contract.periodicity,
    },
    { amountCents: contract.amountCents, periodicity: contract.periodicity },
  );
  if (change.deltaRatio === null || change.deltaRatio <= 0) return null;
  if (change.annualImpactCents < thresholds.minAnnualImpactCents) return null;

  const severity = gravedad(
    change.deltaRatio,
    thresholds.priceIncreaseWarning,
    thresholds.priceIncreaseCritical,
  );
  if (severity === null) return null;

  const message =
    `${contract.name}: sube un ${porcentaje(change.deltaRatio)} %, de ` +
    `${euros(change.previousMonthlyCents)} a ${euros(change.currentMonthlyCents)} al mes. ` +
    `Son ${euros(change.annualImpactCents)} más al año.`;

  return {
    type: 'PRICE_INCREASE',
    severity,
    contractId: contract.contractId,
    impactAnnualCents: change.annualImpactCents,
    message,
  };
}

const ORDEN_GRAVEDAD: Readonly<Record<AlertSeverity, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

/** Primero lo grave, y dentro de cada nivel lo que más dinero mueve. */
function porUrgencia(a: ContractAlert, b: ContractAlert): number {
  const nivel = ORDEN_GRAVEDAD[a.severity] - ORDEN_GRAVEDAD[b.severity];
  if (nivel !== 0) return nivel;
  if (a.impactAnnualCents !== b.impactAnnualCents) {
    return b.impactAnnualCents - a.impactAnnualCents;
  }
  if (a.contractId === b.contractId) return 0;
  return a.contractId < b.contractId ? -1 : 1;
}

/**
 * Revisa una cartera de contratos y devuelve los avisos que merecen atención.
 *
 * Un contrato puede generar los dos avisos a la vez: se puede estar pagando de
 * más por puestos que nadie usa. Son dos conversaciones distintas con el
 * proveedor, así que salen como dos filas.
 *
 * El orden es determinista —gravedad, después dinero, después id— para que la
 * lista no baile entre ejecuciones ni dependa del orden de la consulta.
 */
export function contractAlerts(
  contracts: readonly ContractForAlerts[],
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): ContractAlert[] {
  validarUmbrales(thresholds);

  const avisos: ContractAlert[] = [];
  for (const contract of contracts) {
    const desperdicio = avisoDeDesperdicio(contract, thresholds);
    if (desperdicio !== null) avisos.push(desperdicio);
    const subida = avisoDeSubida(contract, thresholds);
    if (subida !== null) avisos.push(subida);
  }

  return avisos.sort(porUrgencia);
}

/** Dinero anual en juego en un conjunto de avisos. */
export function totalAnnualImpact(alerts: readonly ContractAlert[]): Cents {
  return alerts.reduce<Cents>((total, alert) => cents(total + alert.impactAnnualCents), ZERO_CENTS);
}
