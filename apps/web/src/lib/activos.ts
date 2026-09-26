import { AssetCategory, AssetStatus } from '@itfin360/db';
import {
  type AssetForDebt,
  type AssetStatus as EstadoActivo,
  cents,
  DEFAULT_USEFUL_LIFE_MONTHS,
  monthlyDepreciationCents,
  netBookValueAt,
  technicalDebt,
  type TechnicalDebtResult,
} from '@itfin360/finance-core';
import { z } from 'zod';

import { DIVISA, ENTERO_NO_NEGATIVO, FECHA, IMPORTE } from '@/lib/contratos';

/**
 * Inmovilizado: validación y puente con el motor de amortización.
 *
 * El motor sabía amortizar desde el principio. Lo que faltaba era la tabla y
 * esta traducción. Aquí no se calcula nada: se prepara la entrada, se llama a
 * `finance-core` y se devuelve lo que la pantalla enseña.
 */

const TEXTO = z.string().trim().max(200);

export const CATEGORIA = z.enum(AssetCategory);
export const ESTADO_ACTIVO = z.enum(AssetStatus);

export const altaActivo = z.object({
  name: TEXTO.min(1),
  category: CATEGORIA,
  vendorId: z.uuid().optional(),
  serialNumber: TEXTO.optional(),
  acquisitionCents: IMPORTE,
  residualCents: IMPORTE.optional(),
  usefulLifeMonths: ENTERO_NO_NEGATIVO.optional(),
  inServiceDate: FECHA,
  currency: DIVISA,
  catalogPriceCents: IMPORTE.optional(),
  hasBudgetLine: z.boolean().optional(),
  assignedTo: TEXTO.optional(),
});

export const CAMPOS_ACTIVO = {
  id: true,
  name: true,
  category: true,
  serialNumber: true,
  acquisitionCents: true,
  residualCents: true,
  usefulLifeMonths: true,
  inServiceDate: true,
  currency: true,
  status: true,
  catalogPriceCents: true,
  hasBudgetLine: true,
  assignedTo: true,
  vendor: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
} as const;

export const ETIQUETA_CATEGORIA: Readonly<Record<keyof typeof AssetCategory, string>> = {
  SERVER: 'Servidor',
  STORAGE: 'Almacenamiento',
  NETWORK: 'Red',
  WORKSTATION: 'Puesto de trabajo',
  LAPTOP: 'Portátil',
  MOBILE: 'Móvil',
  PERIPHERAL: 'Periférico',
  SOFTWARE_LICENSE_PERPETUAL: 'Licencia perpetua',
  INTANGIBLE_DEV: 'Desarrollo capitalizado',
};

export const ETIQUETA_ESTADO_ACTIVO: Readonly<Record<keyof typeof AssetStatus, string>> = {
  IN_USE: 'En uso',
  IN_STOCK: 'En almacén',
  IN_REPAIR: 'En reparación',
  RETIRED: 'Retirado',
  DISPOSED: 'Dado de baja',
};

/** Vida útil por defecto de la categoría, en meses. */
export function vidaUtilPorDefecto(categoria: keyof typeof AssetCategory): number {
  return DEFAULT_USEFUL_LIFE_MONTHS[categoria];
}

/** Lo que hace falta de un activo para calcular. */
export interface ActivoParaCalcular {
  readonly id: string;
  readonly acquisitionCents: number;
  readonly residualCents: number;
  readonly usefulLifeMonths: number;
  readonly inServiceDate: Date;
  readonly status: keyof typeof AssetStatus;
  readonly catalogPriceCents: number | null;
  readonly hasBudgetLine: boolean;
}

/** Un activo con su amortización y su edad. */
export interface ActivoCalculado {
  readonly id: string;
  /** Cuota mensual de referencia. */
  readonly monthlyChargeCents: number;
  /** Valor neto contable al cierre del periodo consultado. */
  readonly netBookValueCents: number;
  /** Meses desde la puesta en servicio. */
  readonly edadMeses: number;
  /** Meses que faltan para agotar la vida útil. Negativo si ya está vencido. */
  readonly mesesRestantes: number;
}

/** Periodo `YYYY-MM` de una fecha. */
export function periodoDe(fecha: Date): string {
  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${anio}-${mes}`;
}

/** Fecha `YYYY-MM-DD` en UTC. */
export function isoDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Meses completos entre dos fechas, contando sólo año y mes. */
export function mesesEntre(desde: Date, hasta: Date): number {
  const meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    (hasta.getUTCMonth() - desde.getUTCMonth());
  return hasta.getUTCDate() < desde.getUTCDate() ? meses - 1 : meses;
}

function paraDeuda(activo: ActivoParaCalcular): AssetForDebt {
  return {
    id: activo.id,
    status: activo.status as EstadoActivo,
    acquisitionCents: cents(activo.acquisitionCents),
    inServiceDate: isoDe(activo.inServiceDate),
    usefulLifeMonths: activo.usefulLifeMonths,
    ...(activo.catalogPriceCents === null
      ? {}
      : { catalogPriceCents: cents(activo.catalogPriceCents) }),
    hasBudgetLine: activo.hasBudgetLine,
  };
}

export interface ResumenActivos {
  readonly calculados: readonly ActivoCalculado[];
  /** Valor de compra del parque en uso o en almacén. */
  readonly valorAdquisicionCents: number;
  /** Valor neto contable de ese mismo parque. */
  readonly valorNetoCents: number;
  /** Amortización que se lleva cada mes. */
  readonly amortizacionMensualCents: number;
  readonly deuda: TechnicalDebtResult;
}

/** Activos que siguen en el balance. Lo dado de baja ya no vale nada. */
function enBalance(activo: ActivoParaCalcular): boolean {
  return activo.status !== 'DISPOSED';
}

/**
 * Todo lo que la pantalla de inmovilizado necesita.
 *
 * El reloj entra por parámetro, igual que en contratos: así se puede probar la
 * deuda técnica con un parque envejecido sin esperar cuatro años.
 */
export function resumenActivos(
  activos: readonly ActivoParaCalcular[],
  ahora: Date,
): ResumenActivos {
  const periodo = periodoDe(ahora);

  const calculados = activos.map((activo) => {
    const entrada = {
      acquisitionCents: cents(activo.acquisitionCents),
      residualCents: cents(activo.residualCents),
      usefulLifeMonths: activo.usefulLifeMonths,
      inServiceDate: isoDe(activo.inServiceDate),
    };
    const edadMeses = mesesEntre(activo.inServiceDate, ahora);
    return {
      id: activo.id,
      monthlyChargeCents: monthlyDepreciationCents(entrada),
      netBookValueCents: netBookValueAt(entrada, periodo),
      edadMeses,
      mesesRestantes: activo.usefulLifeMonths - edadMeses,
    };
  });

  const vivos = activos.filter(enBalance);
  const idsVivos = new Set(vivos.map((activo) => activo.id));
  const calculadosVivos = calculados.filter((c) => idsVivos.has(c.id));

  return {
    calculados,
    valorAdquisicionCents: vivos.reduce((total, a) => total + a.acquisitionCents, 0),
    valorNetoCents: calculadosVivos.reduce((total, c) => total + c.netBookValueCents, 0),
    // Lo ya amortizado del todo no sigue restando del resultado cada mes.
    amortizacionMensualCents: calculadosVivos
      .filter((c) => c.mesesRestantes > 0)
      .reduce((total, c) => total + c.monthlyChargeCents, 0),
    deuda: technicalDebt(activos.map(paraDeuda), isoDe(ahora)),
  };
}
