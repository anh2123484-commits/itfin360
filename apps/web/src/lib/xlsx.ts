import type { FilaCsv, TablaCsv } from '@/lib/csv';
import { leerZip, textoDe, ZipInvalido } from '@/lib/zip';

/**
 * Lectura de hojas de Excel (`.xlsx`), sin dependencias (F2-04, segunda entrega).
 *
 * Excel es lo que la gente tiene encima de la mesa. Pedirle que guarde como CSV
 * antes de subir el fichero es fricción que se paga en cada importación, y la
 * mitad de las veces acaba en un fichero con los acentos rotos.
 *
 * Devuelve la misma `TablaCsv` que el lector de CSV, así que a partir de ahí
 * todo el camino es el mismo: `importarFacturas` no sabe ni tiene por qué saber
 * de dónde salió la tabla.
 *
 * ## Lo que hace y lo que no
 *
 * Lee **la primera hoja** del libro. Un fichero con varias hojas de datos es un
 * caso que hay que resolver preguntando cuál, y eso es otra pantalla.
 *
 * Las fechas se resuelven mirando el formato de la celda, no adivinando por el
 * valor. Excel guarda las fechas como un número de días, y ese número es
 * indistinguible de un importe: sin mirar el formato, «45292» podría ser el 1 de
 * enero de 2024 o cuarenta y cinco mil euros.
 *
 * No evalúa fórmulas. Usa el último valor que Excel dejó calculado, que es lo
 * que la persona vio en pantalla al guardar.
 */

/** El fichero no se puede leer como hoja de cálculo. */
export class ExcelInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ExcelInvalido';
  }
}

/** Los cuatro primeros bytes de un ZIP, que es lo que es un `.xlsx`. */
const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Si el fichero empieza como un ZIP. Sirve para elegir lector sin fiarse del nombre. */
export function pareceExcel(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < FIRMA_ZIP.length) return false;
  const bytes = new Uint8Array(buffer);
  return FIRMA_ZIP.every((byte, indice) => bytes[indice] === byte);
}

/** Quita las entidades XML de un texto. */
function sinEntidades(texto: string): string {
  return (
    texto
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
      .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, codigo: string) =>
        String.fromCodePoint(Number.parseInt(codigo, 16)),
      )
      // La de `&` va la última: si fuera antes, «&amp;lt;» acabaría siendo «<».
      .replaceAll('&amp;', '&')
  );
}

/**
 * Textos compartidos del libro.
 *
 * Excel no repite una cadena que aparece en varias celdas: la guarda una vez
 * aquí y las celdas apuntan por posición. Un `<si>` puede venir partido en
 * varios `<r><t>` cuando dentro hay trozos con formatos distintos, y entonces
 * hay que concatenarlos o se pierde media celda.
 */
function textosCompartidos(xml: string | null): readonly string[] {
  if (xml === null) return [];
  const textos: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const contenido = item[1] ?? '';
    const trozos = [...contenido.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(
      (trozo) => trozo[1] ?? '',
    );
    textos.push(sinEntidades(trozos.join('')));
  }
  return textos;
}

/** Formatos numéricos integrados de Excel que son fechas u horas. */
const FORMATOS_FECHA_INTEGRADOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Qué estilos de celda son fechas.
 *
 * Se devuelve un conjunto de índices de `cellXfs`, que es a lo que apunta el
 * atributo `s` de cada celda.
 */
function estilosDeFecha(xml: string | null): ReadonlySet<number> {
  const fechas = new Set<number>();
  if (xml === null) return fechas;

  // Formatos que el libro define por su cuenta, del 164 en adelante.
  const personalizados = new Set<number>();
  for (const formato of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const id = Number(formato[1]);
    const codigo = sinEntidades(formato[2] ?? '');
    // Se mira fuera de los literales entre comillas: `"año "0` no es una fecha.
    const fuera = codigo.replaceAll(/"[^"]*"/g, '');
    if (/[ymdhs]/i.test(fuera)) personalizados.add(id);
  }

  const bloque = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  let indice = 0;
  for (const xf of bloque.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(xf[0] ?? '')?.[1] ?? '0');
    if (FORMATOS_FECHA_INTEGRADOS.has(id) || personalizados.has(id)) fechas.add(indice);
    indice += 1;
  }
  return fechas;
}

/** Número de columna a partir de la referencia de la celda: A → 1, AB → 28. */
function columnaDe(referencia: string): number {
  const letras = /^([A-Z]+)/.exec(referencia)?.[1] ?? '';
  let columna = 0;
  for (const letra of letras) columna = columna * 26 + (letra.charCodeAt(0) - 64);
  return columna;
}

/**
 * Número de serie de Excel a fecha `YYYY-MM-DD`.
 *
 * El origen es el 30 de diciembre de 1899 y no el 31, porque Excel arrastra un
 * error deliberado: cree que 1900 fue bisiesto para ser compatible con Lotus
 * 1-2-3. Por debajo de 61 el número es ambiguo (cae en ese hueco), así que se
 * rechaza en vez de devolver un día que puede estar corrido en uno.
 */
export function fechaDeSerie(serie: number): string | null {
  if (!Number.isFinite(serie) || serie < 61 || serie > 2_958_465) return null;
  const dias = Math.floor(serie);
  const fecha = new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000);
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  return `${fecha.getUTCFullYear()}-${mes}-${dia}`;
}

/**
 * Número a texto, sin el ruido del coma flotante.
 *
 * Excel guarda 12,60 como 12.600000000000001 más veces de las que parece.
 * Escribirlo tal cual haría que el lector de importes lo rechazara por tener
 * demasiados decimales, y el usuario vería un error en una celda que está bien.
 */
function numeroATexto(valor: number): string {
  if (!Number.isFinite(valor)) return '';
  return String(Number(valor.toPrecision(15)));
}

/** Valor de una celda, ya como el texto que vería quien mira la hoja. */
function valorDeCelda(
  celda: string,
  compartidos: readonly string[],
  fechas: ReadonlySet<number>,
): string {
  const tipo = /\bt="([^"]*)"/.exec(celda)?.[1] ?? 'n';

  if (tipo === 'inlineStr') {
    const trozos = [...celda.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((trozo) => trozo[1] ?? '');
    return sinEntidades(trozos.join('')).trim();
  }

  const crudo = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(celda)?.[1];
  if (crudo === undefined) return '';
  const texto = sinEntidades(crudo).trim();

  if (tipo === 's') {
    const indice = Number(texto);
    return compartidos[indice] ?? '';
  }
  if (tipo === 'str') return texto;
  if (tipo === 'b') return texto === '1' ? 'VERDADERO' : 'FALSO';
  if (tipo === 'e') return texto;

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return texto;

  const estilo = Number(/\bs="(\d+)"/.exec(celda)?.[1] ?? '-1');
  if (fechas.has(estilo)) {
    const fecha = fechaDeSerie(numero);
    if (fecha !== null) return fecha;
  }
  return numeroATexto(numero);
}

/** Ruta de la primera hoja dentro del ZIP. */
function rutaPrimeraHoja(ficheros: ReadonlyMap<string, Uint8Array>): string {
  if (ficheros.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  const hojas = [...ficheros.keys()]
    .filter((ruta) => /^xl\/worksheets\/[^/]+\.xml$/.test(ruta))
    .sort();
  const primera = hojas[0];
  if (primera === undefined) {
    throw new ExcelInvalido('El fichero no tiene ninguna hoja de cálculo dentro.');
  }
  return primera;
}

/**
 * Lee la primera hoja del libro como una tabla, con la misma forma que devuelve
 * el lector de CSV.
 *
 * Los números de fila son los de Excel, tomados del atributo `r` de cada fila y
 * no de la posición: así, si la hoja tiene filas ocultas o borradas, el número
 * que se enseña al señalar un error sigue siendo el que la persona ve.
 */
export async function leerExcel(buffer: ArrayBuffer): Promise<TablaCsv> {
  let ficheros: ReadonlyMap<string, Uint8Array>;
  try {
    ficheros = await leerZip(buffer);
  } catch (error) {
    if (error instanceof ZipInvalido) {
      throw new ExcelInvalido(`No se ha podido abrir el Excel: ${error.message}`);
    }
    throw error;
  }

  const compartidos = textosCompartidos(textoDe(ficheros, 'xl/sharedStrings.xml'));
  const fechas = estilosDeFecha(textoDe(ficheros, 'xl/styles.xml'));
  const hoja = textoDe(ficheros, rutaPrimeraHoja(ficheros));
  if (hoja === null) throw new ExcelInvalido('La hoja del libro está vacía.');

  const filas: FilaCsv[] = [];
  for (const fila of hoja.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numero = Number(/\br="(\d+)"/.exec(fila[1] ?? '')?.[1] ?? '0');
    const campos: string[] = [];

    for (const celda of (fila[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const referencia = /\br="([A-Z]+\d+)"/.exec(celda[1] ?? '')?.[1] ?? '';
      const columna = columnaDe(referencia);
      // Excel se salta las celdas vacías. Sin rellenar el hueco, todo lo que
      // venga detrás se corre una columna y los importes acaban en la que no es.
      if (columna > 0) while (campos.length < columna - 1) campos.push('');
      campos.push(valorDeCelda(celda[0] ?? '', compartidos, fechas));
    }

    if (campos.some((campo) => campo !== '')) {
      filas.push({ numero: numero > 0 ? numero : filas.length + 1, campos });
    }
  }

  const primera = filas[0];
  if (primera === undefined) return { cabeceras: [], filas: [] };

  return {
    cabeceras: primera.campos.map((cabecera) => cabecera.trim().toLowerCase()),
    filas: filas.slice(1),
  };
}
