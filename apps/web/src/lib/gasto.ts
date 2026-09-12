import type { InvoiceStatus, TenantDb } from '@itfin360/db';
import {
  type BudgetCategory,
  type CostableLine,
  cents,
  countsAsDepartmentSpend,
  periodSpend,
  type PeriodSpend,
  type SpendConcept,
} from '@itfin360/finance-core';

import { aInstanteUtc } from '@/lib/fechas';
import type { Periodo } from '@/lib/periodos';

/**
 * Gasto del departamento en un periodo (F2-05).
 *
 * Traduce lo que hay en la base a lo que el motor sabe calcular, y no calcula
 * nada por su cuenta: el reparto por categoría, el doble cómputo de lo que
 * capitaliza y la exclusión del material de reventa los decide `periodSpend` en
 * `finance-core`. Aquí sólo se elige **qué líneas entran**.
 *
 * ## Qué cuenta como gasto
 *
 * Sólo las facturas **aprobadas y contabilizadas**. Un borrador es algo que
 * alguien está tecleando, y una factura en revisión es algo que todavía puede
 * rechazarse: contarlos daría una cifra que cambia sola mientras nadie toca
 * nada. La aplicación ya lo dice al guardar («para que cuente como gasto hay que
 * mandarla a revisión y aprobarla»), y ésta es la otra mitad de esa frase.
 *
 * ## Qué fecha decide el periodo
 *
 * El **devengo**, no la emisión ni el pago. El servicio de enero es gasto de
 * enero aunque la factura llegue en febrero y se pague en marzo. Es la única
 * forma de que el gasto de un mes deje de moverse cuando el mes se cierra.
 */

/** Estados cuyo importe cuenta como gasto del departamento. */
export const ESTADOS_QUE_CUENTAN: readonly InvoiceStatus[] = ['APPROVED', 'POSTED'];

/** Un proveedor y lo que se le ha gastado en el periodo. */
export interface GastoDeProveedor {
  readonly vendorId: string;
  readonly nombre: string;
  readonly cents: number;
}

/** Una línea que ha quedado marcada para regularizar. */
export interface LineaPendiente {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly descripcion: string;
  readonly concepto: SpendConcept;
  readonly cents: number;
}

/** El gasto de un periodo, ya listo para pintar. */
export interface GastoDelPeriodo {
  readonly divisa: string;
  /** `true` si en el periodo hay facturas en más de una divisa. */
  readonly variasDivisas: boolean;
  readonly facturas: number;
  readonly reparto: PeriodSpend;
  readonly porProveedor: readonly GastoDeProveedor[];
  readonly pendientes: readonly LineaPendiente[];
}

/** Divisa de contabilización cuando en el periodo no hay ninguna factura. */
const DIVISA_POR_DEFECTO = 'EUR';

/**
 * Líneas del periodo, con su factura.
 *
 * Se consulta por líneas y no por totales de factura porque el reparto por
 * categoría presupuestaria vive en el concepto de cada línea. Sumar por cabecera
 * daría el mismo total y ningún desglose, y el desglose es justo lo que hace
 * falta para hablar de presupuesto.
 */
async function lineasDelPeriodo(tx: TenantDb, periodo: Periodo) {
  return tx.invoiceLine.findMany({
    where: {
      invoice: {
        status: { in: [...ESTADOS_QUE_CUENTAN] },
        accrualDate: { gte: aInstanteUtc(periodo.desde), lte: aInstanteUtc(periodo.hasta) },
      },
    },
    select: {
      id: true,
      description: true,
      netCents: true,
      concept: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          currency: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Calcula el gasto del periodo.
 *
 * Todo lo que se devuelve sale de una sola consulta: si el total y el desglose
 * vinieran de consultas distintas podrían no cuadrar entre sí, y dos cifras que
 * no cuadran en una herramienta financiera valen menos que ninguna.
 */
export async function gastoDelPeriodo(tx: TenantDb, periodo: Periodo): Promise<GastoDelPeriodo> {
  const lineas = await lineasDelPeriodo(tx, periodo);

  const divisas = new Set(lineas.map((linea) => linea.invoice.currency));
  const facturas = new Set(lineas.map((linea) => linea.invoice.id));

  const costables: CostableLine[] = lineas.map((linea) => ({
    lineId: linea.id,
    concept: linea.concept,
    netCents: cents(linea.netCents),
  }));
  const reparto = periodSpend(costables);

  // El gasto por proveedor se cuenta con las mismas reglas que el total: lo que
  // no es gasto del departamento tampoco lo es de su proveedor. Con otra regla,
  // la suma de la tabla de proveedores no cuadraría con la cifra de arriba.
  const porProveedor = new Map<string, GastoDeProveedor>();
  for (const linea of lineas) {
    if (!countsAsDepartmentSpend(linea.concept)) continue;
    const vendor = linea.invoice.vendor;
    const previo = porProveedor.get(vendor.id);
    porProveedor.set(vendor.id, {
      vendorId: vendor.id,
      nombre: vendor.name,
      cents: (previo?.cents ?? 0) + linea.netCents,
    });
  }

  const pendientesPorLinea = new Map(lineas.map((linea) => [linea.id, linea]));
  const pendientes: LineaPendiente[] = [];
  for (const pendiente of reparto.pendingCapitalisation) {
    const linea = pendientesPorLinea.get(pendiente.lineId);
    if (linea === undefined) continue;
    pendientes.push({
      invoiceId: linea.invoice.id,
      invoiceNumber: linea.invoice.invoiceNumber,
      descripcion: linea.description,
      concepto: linea.concept,
      cents: pendiente.netCents,
    });
  }

  return {
    divisa: [...divisas][0] ?? DIVISA_POR_DEFECTO,
    variasDivisas: divisas.size > 1,
    facturas: facturas.size,
    reparto,
    porProveedor: [...porProveedor.values()].sort((a, b) => b.cents - a.cents),
    pendientes: pendientes.sort((a, b) => b.cents - a.cents),
  };
}

/** Nombre en castellano de cada categoría presupuestaria. */
export const ETIQUETA_CATEGORIA: Readonly<Record<BudgetCategory, string>> = {
  SOFTWARE_AND_SERVICES: 'Software y servicios',
  INFRASTRUCTURE: 'Infraestructura',
  COMMUNICATIONS: 'Comunicaciones',
  PROFESSIONAL_SERVICES: 'Servicios profesionales',
  PROJECTS: 'Proyectos',
  PENALTIES: 'Penalizaciones',
  SECURITY_AND_COMPLIANCE: 'Seguridad y cumplimiento',
  OTHER: 'Otros',
};

/** Variación entre dos importes, o `null` si el anterior era cero. */
export function variacion(actual: number, anterior: number): number | null {
  // Con el mes anterior a cero, cualquier gasto es un aumento infinito. Decir
  // «+∞ %» no informa de nada; es mejor no dar porcentaje y enseñar las cifras.
  if (anterior === 0) return null;
  return (actual - anterior) / anterior;
}

/** `+12,4 %` o `−8,1 %`, con el signo delante para que se lea de un vistazo. */
export function formatearVariacion(razon: number | null): string {
  if (razon === null) return '—';
  const porcentaje = (razon * 100).toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return razon >= 0 ? `+${porcentaje} %` : `${porcentaje} %`;
}
