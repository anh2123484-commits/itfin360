import { parsearCsv, type TablaCsv } from '@/lib/csv';
import { leerExcel, pareceExcel } from '@/lib/xlsx';

/**
 * De un fichero subido a una tabla, elija el formato que elija quien lo sube.
 *
 * Es el único sitio que decide si algo es un CSV o un Excel, y lo decide por el
 * contenido, no por la extensión: un `.csv` renombrado a `.xlsx` y un `.xlsx`
 * guardado sin extensión tienen que acabar igual. Fiarse del nombre es fiarse
 * de lo que teclea alguien con prisa.
 *
 * Lo usan la previsualización del navegador y la importación del servidor. Que
 * sea el mismo código es lo que permite que lo que se ve antes de importar sea
 * de verdad lo que se va a importar.
 */

/** Cómo se ha leído el fichero, para poder decirlo en pantalla. */
export type FormatoFichero = 'csv' | 'excel';

/** La tabla y de qué formato salió. */
export interface FicheroLeido {
  readonly formato: FormatoFichero;
  readonly tabla: TablaCsv;
}

/**
 * Texto de un fichero, adivinando la codificación.
 *
 * Se intenta UTF-8 y, si sale el carácter de reemplazo, se reintenta con
 * Windows-1252, que es lo que escribe Excel en español cuando se guarda como
 * «CSV» a secas. Sin esto, un fichero perfectamente válido llega con las eñes y
 * los acentos rotos, y lo primero que rompe es el nombre de los proveedores.
 */
export function decodificarTexto(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return utf8;
  }
}

/** Lee el fichero. Lanza `ExcelInvalido` si dice ser un Excel y no lo es. */
export async function leerFichero(buffer: ArrayBuffer): Promise<FicheroLeido> {
  if (pareceExcel(buffer)) {
    return { formato: 'excel', tabla: await leerExcel(buffer) };
  }
  return { formato: 'csv', tabla: parsearCsv(decodificarTexto(buffer)) };
}
