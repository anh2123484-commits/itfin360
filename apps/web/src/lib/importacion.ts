import {
  type CivilDate,
  CONCEPT_DEFINITIONS,
  type CostType,
  DEFAULT_BASE_CURRENCY,
  lineNetCents,
  type SpendConcept,
  SPEND_CONCEPTS,
  cents,
} from '@itfin360/finance-core';

import { type FilaCsv, indicesDeCabecera, type TablaCsv, valor } from '@/lib/csv';
import { parsearCantidad, parsearImporte } from '@/lib/importes';

/**
 * De un fichero de facturas a facturas (F2-04).
 *
 * Teclear factura a factura sirve para probar la aplicación. Para meter el
 * histórico de un departamento hace falta volcar el mayor o el cuadro de
 * facturas de una vez, y eso es lo que hay aquí.
 *
 * Todo esto es puro: entra la tabla ya leída y salen facturas y errores. No
 * toca la base ni sabe qué es un tenant. Así la misma lógica se puede probar
 * con cincuenta casos raros sin levantar nada, que es justo lo que una
 * importación necesita: la mitad del trabajo es decidir bien qué se rechaza.
 *
 * ## Decisiones que gobiernan el fichero
 *
 * **Cada fila es una línea de factura.** Varias filas con el mismo proveedor y
 * el mismo número se agrupan en una factura con sus líneas. Una factura de una
 * sola partida es el caso de una fila, así que no hacen falta dos formatos.
 *
 * **Las columnas son fijas**, las de la plantilla. Sin mapeo en pantalla: es
 * una cosa menos que puede interpretarse mal, y la plantilla se descarga desde
 * la propia pantalla de importación.
 *
 * **Nada entra a medias.** Si una sola fila falla, no se importa nada. Una
 * importación parcial deja al usuario sin saber qué entró y qué no, y con un
 * fichero que ya no puede volver a subir entero sin duplicar la mitad.
 */

/** Columnas de la plantilla. El orden es el del fichero de ejemplo. */
export const COLUMNAS = {
  proveedor: 'proveedor',
  numero: 'numero_factura',
  emision: 'fecha_emision',
  devengo: 'fecha_devengo',
  vencimiento: 'fecha_vencimiento',
  descripcion: 'descripcion',
  concepto: 'concepto',
  cantidad: 'cantidad',
  precio: 'precio_unidad',
  importe: 'importe_linea',
  iva: 'iva',
  divisa: 'divisa',
} as const;

/** Columnas sin las que el fichero no se puede leer. */
export const COLUMNAS_OBLIGATORIAS: readonly string[] = [
  COLUMNAS.proveedor,
  COLUMNAS.numero,
  COLUMNAS.emision,
  COLUMNAS.descripcion,
  COLUMNAS.concepto,
  COLUMNAS.precio,
];

/** Un problema en una fila concreta del fichero. */
export interface ErrorFila {
  /** Número de línea en el fichero, el mismo que se ve en Excel. */
  readonly fila: number;
  readonly columna?: string | undefined;
  readonly mensaje: string;
}

/** Una línea lista para dar de alta. */
export interface LineaImportada {
  readonly lineNumber: number;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly netCents: number;
  readonly costType: CostType;
  readonly concept: SpendConcept;
}

/** Una factura lista para dar de alta, con el nombre del proveedor sin resolver. */
export interface FacturaImportada {
  /** Nombre tal y como viene en el fichero. La resolución a id es otra capa. */
  readonly proveedor: string;
  readonly invoiceNumber: string;
  readonly issueDate: CivilDate;
  readonly accrualDate: CivilDate;
  readonly dueDate?: CivilDate | undefined;
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
  readonly currency: string;
  readonly lines: readonly LineaImportada[];
  /** Filas del fichero de las que sale, para poder señalarlas después. */
  readonly filas: readonly number[];
}

/** Lo que sale de leer el fichero. */
export interface Importacion {
  readonly facturas: readonly FacturaImportada[];
  readonly errores: readonly ErrorFila[];
}

/** Quita acentos y pasa a minúsculas, para comparar lo que escribe una persona. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Conceptos aceptados: el código del enum y la etiqueta en español.
 *
 * Quien rellena la plantilla copia lo que ve en la aplicación, que es
 * «Suscripción SaaS», no `SAAS_SUBSCRIPTION`. Aceptar sólo el código obligaría
 * a tener una tabla de equivalencias al lado del Excel, y a equivocarse.
 */
const CONCEPTOS_POR_NOMBRE: ReadonlyMap<string, SpendConcept> = new Map(
  SPEND_CONCEPTS.flatMap((concepto) => [
    [normalizar(concepto), concepto] as const,
    [normalizar(CONCEPT_DEFINITIONS[concepto].label), concepto] as const,
  ]),
);

/** Concepto a partir de lo escrito en la celda, o `null`. */
export function conceptoDesdeTexto(texto: string): SpendConcept | null {
  return CONCEPTOS_POR_NOMBRE.get(normalizar(texto)) ?? null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const EUROPEA = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/**
 * Fecha de una celda: `2026-03-31` o `31/03/2026`.
 *
 * No se acepta `03/31/2026`. Con el formato americano en juego, `04/05/2026` es
 * dos fechas distintas y no hay forma de saber cuál, así que se prefiere
 * rechazar a adivinar: una fecha de devengo mal leída mueve el gasto de mes.
 */
export function fechaDesdeTexto(texto: string): CivilDate | null {
  const limpio = texto.trim();

  const iso = ISO.exec(limpio);
  const europea = EUROPEA.exec(limpio);
  const partes = iso
    ? { year: iso[1], month: iso[2], day: iso[3] }
    : europea
      ? { year: europea[3], month: europea[2], day: europea[1] }
      : null;
  if (partes === null) return null;

  const year = Number(partes.year);
  const month = Number(partes.month);
  const day = Number(partes.day);
  if (month < 1 || month > 12 || day < 1) return null;
  // Se comprueba contra el calendario, no contra 31: el 31 de febrero se
  // colaría, y con él un devengo que no existe.
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > ultimo) return null;

  return { year, month, day };
}

function mismaFecha(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function textoFecha(fecha: CivilDate): string {
  const mes = String(fecha.month).padStart(2, '0');
  const dia = String(fecha.day).padStart(2, '0');
  return `${fecha.year}-${mes}-${dia}`;
}

/** Una fila ya interpretada, antes de agruparla en facturas. */
interface FilaLeida {
  readonly fila: number;
  readonly proveedor: string;
  readonly invoiceNumber: string;
  readonly issueDate: CivilDate;
  readonly accrualDate: CivilDate;
  readonly dueDate: CivilDate | null;
  readonly vatCents: number;
  readonly currency: string;
  readonly linea: Omit<LineaImportada, 'lineNumber'>;
}

function leerFila(
  fila: FilaCsv,
  indices: ReadonlyMap<string, number>,
  errores: ErrorFila[],
): FilaLeida | null {
  const falla = (columna: string, mensaje: string): null => {
    errores.push({ fila: fila.numero, columna, mensaje });
    return null;
  };
  const celda = (columna: string): string => valor(fila, indices, columna);

  const proveedor = celda(COLUMNAS.proveedor);
  if (proveedor === '') return falla(COLUMNAS.proveedor, 'Falta el proveedor.');

  const invoiceNumber = celda(COLUMNAS.numero);
  if (invoiceNumber === '') return falla(COLUMNAS.numero, 'Falta el número de factura.');

  const issueDate = fechaDesdeTexto(celda(COLUMNAS.emision));
  if (issueDate === null) {
    return falla(COLUMNAS.emision, 'Fecha de emisión no válida. Usa 2026-03-31 o 31/03/2026.');
  }

  // Sin devengo, se devenga el día que se emite. Es lo que hace la mayoría de
  // las facturas y evita obligar a rellenar una columna que casi siempre repite.
  const devengoTexto = celda(COLUMNAS.devengo);
  const accrualDate = devengoTexto === '' ? issueDate : fechaDesdeTexto(devengoTexto);
  if (accrualDate === null) {
    return falla(COLUMNAS.devengo, 'Fecha de devengo no válida. Usa 2026-03-31 o 31/03/2026.');
  }

  const vencimientoTexto = celda(COLUMNAS.vencimiento);
  const dueDate = vencimientoTexto === '' ? null : fechaDesdeTexto(vencimientoTexto);
  if (vencimientoTexto !== '' && dueDate === null) {
    return falla(COLUMNAS.vencimiento, 'Fecha de vencimiento no válida.');
  }

  const description = celda(COLUMNAS.descripcion);
  if (description === '') return falla(COLUMNAS.descripcion, 'Falta la descripción de la línea.');

  const concept = conceptoDesdeTexto(celda(COLUMNAS.concepto));
  if (concept === null) {
    return falla(
      COLUMNAS.concepto,
      `Concepto no reconocido: "${celda(COLUMNAS.concepto)}". Mira la lista de la plantilla.`,
    );
  }

  const cantidadTexto = celda(COLUMNAS.cantidad);
  const quantity = cantidadTexto === '' ? 1 : parsearCantidad(cantidadTexto);
  if (quantity === null) return falla(COLUMNAS.cantidad, 'Cantidad no válida.');

  const unitPriceCents = parsearImporte(celda(COLUMNAS.precio));
  if (unitPriceCents === null) return falla(COLUMNAS.precio, 'Precio por unidad no válido.');

  // El importe de línea se puede traer del origen o dejar que se calcule. Si
  // viene y no cuadra, se dice: un descuadre entre lo que pone el ERP y lo que
  // sale de multiplicar suele ser un signo o un decimal mal puestos.
  const importeTexto = celda(COLUMNAS.importe);
  const calculado = lineNetCents(quantity, cents(unitPriceCents));
  // Anotado como `number` a propósito: `lineNetCents` devuelve `Cents`, que es
  // una marca de tipo, y lo que viene de la celda todavía no lo es.
  let netCents: number = calculado;
  if (importeTexto !== '') {
    const declarado = parsearImporte(importeTexto);
    if (declarado === null) return falla(COLUMNAS.importe, 'Importe de línea no válido.');
    if (declarado !== calculado) {
      return falla(
        COLUMNAS.importe,
        `El importe de línea no cuadra: ${importeTexto} frente a ${quantity} × ${celda(COLUMNAS.precio)}.`,
      );
    }
    netCents = declarado;
  }

  const ivaTexto = celda(COLUMNAS.iva);
  const vatCents = ivaTexto === '' ? 0 : parsearImporte(ivaTexto);
  if (vatCents === null) return falla(COLUMNAS.iva, 'IVA no válido.');

  const divisaTexto = celda(COLUMNAS.divisa);
  if (divisaTexto !== '' && !/^[A-Za-z]{3}$/.test(divisaTexto)) {
    return falla(COLUMNAS.divisa, 'Divisa no válida. Son tres letras, como EUR.');
  }
  const currency = divisaTexto === '' ? DEFAULT_BASE_CURRENCY : divisaTexto.toUpperCase();

  return {
    fila: fila.numero,
    proveedor,
    invoiceNumber,
    issueDate,
    accrualDate,
    dueDate,
    vatCents,
    currency,
    linea: {
      description,
      quantity,
      unitPriceCents,
      netCents,
      costType: CONCEPT_DEFINITIONS[concept].costType,
      concept,
    },
  };
}

/** Clave de agrupación: un proveedor y un número son una factura. */
function clave(fila: FilaLeida): string {
  return `${normalizar(fila.proveedor)} ${fila.invoiceNumber.trim().toLowerCase()}`;
}

/**
 * Comprueba que las filas de una misma factura no se contradicen.
 *
 * Las fechas, el IVA y la divisa son de la cabecera, pero en un fichero plano
 * se repiten en cada fila. Si dos filas de la misma factura dicen cosas
 * distintas, alguien ha copiado mal una celda, y tomar la primera en silencio
 * dejaría entrar una factura con la fecha de otra.
 */
function contradicciones(grupo: readonly FilaLeida[]): ErrorFila[] {
  const primera = grupo[0];
  if (primera === undefined) return [];
  const errores: ErrorFila[] = [];

  for (const fila of grupo.slice(1)) {
    if (!mismaFecha(fila.issueDate, primera.issueDate)) {
      errores.push({
        fila: fila.fila,
        columna: COLUMNAS.emision,
        mensaje: `La factura ${primera.invoiceNumber} tiene otra fecha de emisión en la fila ${primera.fila}: ${textoFecha(primera.issueDate)}.`,
      });
    }
    if (!mismaFecha(fila.accrualDate, primera.accrualDate)) {
      errores.push({
        fila: fila.fila,
        columna: COLUMNAS.devengo,
        mensaje: `La factura ${primera.invoiceNumber} tiene otra fecha de devengo en la fila ${primera.fila}.`,
      });
    }
    if (fila.vatCents !== primera.vatCents) {
      errores.push({
        fila: fila.fila,
        columna: COLUMNAS.iva,
        mensaje: `El IVA de la factura ${primera.invoiceNumber} ya venía en la fila ${primera.fila} y no coincide. Ponlo una sola vez, o el mismo en todas.`,
      });
    }
    if (fila.currency !== primera.currency) {
      errores.push({
        fila: fila.fila,
        columna: COLUMNAS.divisa,
        mensaje: `La factura ${primera.invoiceNumber} está en ${primera.currency} en la fila ${primera.fila}.`,
      });
    }
  }
  return errores;
}

/** Faltan columnas obligatorias: se dice cuáles y no se lee ni una fila. */
function columnasQueFaltan(cabeceras: readonly string[]): string[] {
  return COLUMNAS_OBLIGATORIAS.filter((columna) => !cabeceras.includes(columna));
}

/**
 * Lee la tabla entera.
 *
 * El orden de las líneas dentro de cada factura es el del fichero, y se numeran
 * a partir de 1. Reordenarlas por cualquier criterio rompería la
 * correspondencia con el origen, que es lo que permite cuadrar la importación
 * contra el mayor del que salió.
 */
export function importarFacturas(tabla: TablaCsv): Importacion {
  const faltan = columnasQueFaltan(tabla.cabeceras);
  if (faltan.length > 0) {
    return {
      facturas: [],
      errores: [
        {
          fila: 1,
          mensaje: `Faltan columnas obligatorias: ${faltan.join(', ')}. Descarga la plantilla y usa sus cabeceras.`,
        },
      ],
    };
  }
  if (tabla.filas.length === 0) {
    return { facturas: [], errores: [{ fila: 1, mensaje: 'El fichero no tiene ninguna fila.' }] };
  }

  const indices = indicesDeCabecera(tabla.cabeceras);
  const errores: ErrorFila[] = [];
  const grupos = new Map<string, FilaLeida[]>();

  for (const fila of tabla.filas) {
    const leida = leerFila(fila, indices, errores);
    if (leida === null) continue;
    const existente = grupos.get(clave(leida));
    if (existente === undefined) grupos.set(clave(leida), [leida]);
    else existente.push(leida);
  }

  const facturas: FacturaImportada[] = [];
  for (const grupo of grupos.values()) {
    const problemas = contradicciones(grupo);
    if (problemas.length > 0) {
      errores.push(...problemas);
      continue;
    }
    const primera = grupo[0];
    if (primera === undefined) continue;

    const lines = grupo.map((fila, indice) => ({ lineNumber: indice + 1, ...fila.linea }));
    const netCents = lines.reduce((total, linea) => total + linea.netCents, 0);

    facturas.push({
      proveedor: primera.proveedor,
      invoiceNumber: primera.invoiceNumber,
      issueDate: primera.issueDate,
      accrualDate: primera.accrualDate,
      ...(primera.dueDate === null ? {} : { dueDate: primera.dueDate }),
      netCents,
      vatCents: primera.vatCents,
      grossCents: netCents + primera.vatCents,
      currency: primera.currency,
      lines,
      filas: grupo.map((fila) => fila.fila),
    });
  }

  // Los errores se ordenan por fila para que se lean como se lee el Excel.
  errores.sort((a, b) => a.fila - b.fila);
  return { facturas, errores };
}
