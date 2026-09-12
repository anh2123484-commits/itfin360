import type { TenantDb } from '@itfin360/db';

import type { FacturaImportada } from '@/lib/importacion';
import { altaDeFactura, esRechazo } from '@/lib/invoice-ops';
import type { FacturaEntrante } from '@/lib/invoices';
import type { Principal } from '@/lib/permissions';

/**
 * Alta de lo que sale de un fichero (F2-04).
 *
 * Aquí acaba lo puro y empieza la base: se resuelven los proveedores por
 * nombre, se crean los que falten y se da de alta cada factura con
 * `altaDeFactura`, la misma función que usa el alta manual. Reescribir el alta
 * para la importación es cómo se acaba teniendo dos reglas distintas, y la que
 * se queda corta es siempre la que nadie mira.
 *
 * **Nada entra a medias.** Todo corre dentro de la transacción que abre
 * `withTenant`, y al primer problema se lanza: la transacción se deshace y el
 * fichero se puede volver a subir entero. Media importación dejaría al usuario
 * sin saber qué entró, y sin poder repetir sin duplicar.
 */

/** Tope de facturas por fichero. */
export const MAXIMO_FACTURAS = 100;

/**
 * Por qué no se ha podido importar.
 *
 * Los campos se declaran y se asignan a mano en vez de con propiedades de
 * parámetro: es la misma clase, sin depender de una transformación del
 * compilador que no todos los ejecutores de TypeScript hacen.
 */
export class ImportacionRechazada extends Error {
  readonly motivo: string;
  /** Texto que se le puede enseñar a quien subió el fichero. */
  readonly detalle: string;

  constructor(motivo: string, detalle: string) {
    super(detalle);
    this.name = 'ImportacionRechazada';
    this.motivo = motivo;
    this.detalle = detalle;
  }
}

/** Lo que ha quedado guardado. */
export interface ResumenImportacion {
  readonly facturas: number;
  readonly lineas: number;
  readonly proveedoresNuevos: readonly string[];
  readonly totalCents: number;
}

/** Quita acentos y espacios de más, para comparar nombres escritos a mano. */
function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Identificador de cada proveedor del fichero, creando los que no existan.
 *
 * La comparación es laxa a propósito: «Amazon», «amazon » y «AMAZON» son el
 * mismo proveedor, y darlos de alta tres veces repartiría el gasto de uno solo
 * entre tres fichas. El nombre que se guarda al crear es el del fichero, tal
 * cual; el que ya existe conserva el suyo, porque una importación no debería
 * renombrar lo que alguien dio de alta a mano.
 */
async function resolverProveedores(
  tx: TenantDb,
  principal: Principal,
  nombres: readonly string[],
): Promise<{ ids: ReadonlyMap<string, string>; nuevos: readonly string[] }> {
  const existentes = await tx.vendor.findMany({ select: { id: true, name: true } });
  const porNombre = new Map(existentes.map((vendor) => [normalizar(vendor.name), vendor.id]));
  const nuevos: string[] = [];

  for (const nombre of nombres) {
    const clave = normalizar(nombre);
    if (porNombre.has(clave)) continue;
    const creado = await tx.vendor.create({
      data: { tenantId: principal.tenantId, name: nombre },
      select: { id: true },
    });
    porNombre.set(clave, creado.id);
    nuevos.push(nombre);

    await tx.auditLog.create({
      data: {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'vendor.created',
        entity: 'vendor',
        entityId: creado.id,
        after: { name: nombre, source: 'CSV_IMPORT' },
      },
    });
  }

  return { ids: porNombre, nuevos };
}

/** La factura importada, en los términos que entiende el alta. */
function comoEntrante(factura: FacturaImportada, vendorId: string): FacturaEntrante {
  return {
    vendorId,
    invoiceNumber: factura.invoiceNumber,
    issueDate: factura.issueDate,
    accrualDate: factura.accrualDate,
    ...(factura.dueDate === undefined ? {} : { dueDate: factura.dueDate }),
    netCents: factura.netCents,
    vatCents: factura.vatCents,
    grossCents: factura.grossCents,
    currency: factura.currency,
    lines: factura.lines.map((linea) => ({
      lineNumber: linea.lineNumber,
      description: linea.description,
      quantity: linea.quantity,
      unitPriceCents: linea.unitPriceCents,
      netCents: linea.netCents,
      costType: linea.costType,
      concept: linea.concept,
    })),
  };
}

/**
 * Mensaje para el usuario, con las filas del fichero de las que sale la
 * factura. Sin ellas, «la factura F-100 no cuadra» obliga a buscarla a mano en
 * un Excel de mil filas.
 */
function explicar(factura: FacturaImportada, motivo: string): string {
  return `Factura ${factura.invoiceNumber} de ${factura.proveedor} (filas ${factura.filas.join(', ')}): ${motivo}`;
}

function motivoDe(rechazo: {
  readonly motivo: string;
  readonly problemas?: readonly { readonly message: string }[] | undefined;
}): string {
  if (rechazo.motivo === 'duplicada') {
    return 'ya existe una factura con ese número para ese proveedor.';
  }
  if (rechazo.motivo === 'proveedor_desconocido') {
    return 'el proveedor no se ha podido resolver.';
  }
  const problemas = rechazo.problemas ?? [];
  return `no cuadra. ${problemas.map((problema) => problema.message).join(' ')}`;
}

/**
 * Da de alta todas las facturas del fichero. Lanza `ImportacionRechazada` si
 * alguna no entra, para que la transacción se deshaga entera.
 */
export async function importarADatos(
  tx: TenantDb,
  principal: Principal,
  facturas: readonly FacturaImportada[],
): Promise<ResumenImportacion> {
  if (facturas.length === 0) {
    throw new ImportacionRechazada('vacio', 'El fichero no tiene ninguna factura que importar.');
  }
  if (facturas.length > MAXIMO_FACTURAS) {
    throw new ImportacionRechazada(
      'demasiadas',
      `El fichero trae ${facturas.length} facturas y el máximo por tanda es ${MAXIMO_FACTURAS}. ` +
        'Divídelo en varios ficheros.',
    );
  }

  // Un mismo número repetido dentro del fichero no lo caza el índice único
  // hasta el segundo insert, y para entonces la transacción ya está abortada y
  // no se puede decir cuáles chocan. Se mira antes.
  const vistas = new Set<string>();
  for (const factura of facturas) {
    const clave = `${normalizar(factura.proveedor)} ${factura.invoiceNumber.toLowerCase()}`;
    if (vistas.has(clave)) {
      throw new ImportacionRechazada(
        'repetida_en_fichero',
        `La factura ${factura.invoiceNumber} de ${factura.proveedor} aparece dos veces en el fichero con datos distintos.`,
      );
    }
    vistas.add(clave);
  }

  const { ids, nuevos } = await resolverProveedores(
    tx,
    principal,
    facturas.map((factura) => factura.proveedor),
  );

  let lineas = 0;
  let totalCents = 0;

  for (const factura of facturas) {
    const vendorId = ids.get(normalizar(factura.proveedor));
    if (vendorId === undefined) {
      throw new ImportacionRechazada(
        'proveedor',
        explicar(factura, motivoDe({ motivo: 'proveedor_desconocido' })),
      );
    }

    const resultado = await altaDeFactura(
      tx,
      principal,
      comoEntrante(factura, vendorId),
      'CSV_IMPORT',
    );
    if (esRechazo(resultado)) {
      throw new ImportacionRechazada('factura', explicar(factura, motivoDe(resultado)));
    }
    lineas += resultado.lineas;
    totalCents += resultado.grossCents;
  }

  return { facturas: facturas.length, lineas, proveedoresNuevos: nuevos, totalCents };
}
