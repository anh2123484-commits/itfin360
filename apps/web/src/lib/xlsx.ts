import type { FilaCsv, TablaCsv } from '@/lib/csv';
import { leerZip, listarZip, textoDe, ZipInvalido } from '@/lib/zip';

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
 * ## El XML se recorre con un escáner, no con expresiones regulares
 *
 * La primera versión de este fichero usaba `matchAll` con `[\s\S]*?` para sacar
 * cada `<si>`, cada `<row>` y cada `<c>`. Con una etiqueta sin cerrar, ese
 * patrón reintenta desde cada posición y recorre el resto de la cadena en cada
 * intento: cuadrático. Medido, 160 KB de `<si>` sin cerrar tardaban dos segundos,
 * y el tiempo se cuadruplica al doblar el tamaño, así que un fichero de 60 MB
 * (57 KB comprimidos) dejaba el proceso girando durante días.
 *
 * `bloques` hace lo mismo con `indexOf`, que nunca retrocede: el coste es lineal
 * y una etiqueta sin cerrar termina la lectura en vez de dispararla.
 *
 * ## Lo demás que hace y lo que no
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

/** Las únicas piezas del libro que hacen falta. El resto ni se descomprime. */
const PIEZAS = ['xl/sharedStrings.xml', 'xl/styles.xml'] as const;

/** Tope de filas de una hoja. Por encima, el fichero se parte en varios. */
const MAXIMO_FILAS = 20_000;

/** Si el fichero empieza como un ZIP. Sirve para elegir lector sin fiarse del nombre. */
export function pareceExcel(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < FIRMA_ZIP.length) return false;
  const bytes = new Uint8Array(buffer);
  return FIRMA_ZIP.every((byte, indice) => bytes[indice] === byte);
}

/** Un elemento XML encontrado por el escáner. */
interface Bloque {
  /** Lo que va entre el nombre de la etiqueta y el `>`, sin tocar. */
  readonly atributos: string;
  /** Lo que va entre la apertura y el cierre. Vacío si la etiqueta se cierra sola. */
  readonly contenido: string;
}

/** Caracteres que pueden seguir al nombre de una etiqueta. */
const TRAS_NOMBRE = new Set([' ', '\t', '\r', '\n', '/', '>']);

/**
 * Recorre los elementos `<etiqueta>` de un XML, de principio a fin y una sola vez.
 *
 * Usa `indexOf`, que avanza siempre, en lugar de una expresión regular perezosa,
 * que reintenta. Ver el comentario de cabecera: ésa es la diferencia entre lineal
 * y cuadrático, y entre leer un fichero y quedarse colgado con él.
 *
 * Una etiqueta que se abre y no se cierra termina el recorrido. Es lo correcto:
 * un XML así está roto, y lo que se ha podido leer antes sigue siendo válido.
 */
function* bloques(xml: string, etiqueta: string): Generator<Bloque> {
  const apertura = `<${etiqueta}`;
  const cierre = `</${etiqueta}>`;
  let desde = 0;

  for (;;) {
    const inicio = xml.indexOf(apertura, desde);
    if (inicio === -1) return;

    // `<si` no debe encontrar `<signature`: detrás del nombre tiene que venir un
    // espacio, una barra o el cierre del corchete.
    const siguiente = xml.charAt(inicio + apertura.length);
    if (!TRAS_NOMBRE.has(siguiente)) {
      desde = inicio + apertura.length;
      continue;
    }

    const finApertura = xml.indexOf('>', inicio + apertura.length);
    if (finApertura === -1) return;
    const atributos = xml.slice(inicio + apertura.length, finApertura);

    if (atributos.endsWith('/')) {
      yield { atributos: atributos.slice(0, -1), contenido: '' };
      desde = finApertura + 1;
      continue;
    }

    const finContenido = xml.indexOf(cierre, finApertura + 1);
    if (finContenido === -1) return;
    yield { atributos, contenido: xml.slice(finApertura + 1, finContenido) };
    desde = finContenido + cierre.length;
  }
}

/** El primer elemento con esa etiqueta, o `null`. */
function primerBloque(xml: string, etiqueta: string): Bloque | null {
  for (const bloque of bloques(xml, etiqueta)) return bloque;
  return null;
}

/** Valor de un atributo. Se busca sobre la cadena corta de atributos, no sobre el XML. */
function atributo(atributos: string, nombre: string): string | null {
  const marca = `${nombre}="`;
  const inicio = atributos.indexOf(marca);
  if (inicio === -1) return null;
  const fin = atributos.indexOf('"', inicio + marca.length);
  if (fin === -1) return null;
  return atributos.slice(inicio + marca.length, fin);
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

/** Todo el texto de los `<t>` que haya dentro, concatenado. */
function textoDeT(xml: string): string {
  let junto = '';
  for (const t of bloques(xml, 't')) junto += t.contenido;
  return sinEntidades(junto);
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
  for (const si of bloques(xml, 'si')) textos.push(textoDeT(si.contenido));
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
  for (const formato of bloques(xml, 'numFmt')) {
    const id = Number(atributo(formato.atributos, 'numFmtId') ?? '');
    const codigo = sinEntidades(atributo(formato.atributos, 'formatCode') ?? '');
    // Se mira fuera de los literales entre comillas: `"año "0` no es una fecha.
    const fuera = codigo.replaceAll(/"[^"]*"/g, '');
    if (Number.isFinite(id) && /[ymdhs]/i.test(fuera)) personalizados.add(id);
  }

  const bloque = primerBloque(xml, 'cellXfs');
  if (bloque === null) return fechas;

  let indice = 0;
  for (const xf of bloques(bloque.contenido, 'xf')) {
    const id = Number(atributo(xf.atributos, 'numFmtId') ?? '0');
    if (FORMATOS_FECHA_INTEGRADOS.has(id) || personalizados.has(id)) fechas.add(indice);
    indice += 1;
  }
  return fechas;
}

/** Número de columna a partir de la referencia de la celda: A → 1, AB → 28. */
function columnaDe(referencia: string): number {
  let columna = 0;
  for (const letra of referencia) {
    const codigo = letra.charCodeAt(0);
    if (codigo < 65 || codigo > 90) break;
    columna = columna * 26 + (codigo - 64);
  }
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
  celda: Bloque,
  compartidos: readonly string[],
  fechas: ReadonlySet<number>,
): string {
  const tipo = atributo(celda.atributos, 't') ?? 'n';

  if (tipo === 'inlineStr') return textoDeT(celda.contenido).trim();

  const v = primerBloque(celda.contenido, 'v');
  if (v === null) return '';
  const texto = sinEntidades(v.contenido).trim();

  if (tipo === 's') {
    const indice = Number(texto);
    return compartidos[indice] ?? '';
  }
  if (tipo === 'str' || tipo === 'e') return texto;
  if (tipo === 'b') return texto === '1' ? 'VERDADERO' : 'FALSO';

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return texto;

  const estilo = Number(atributo(celda.atributos, 's') ?? '-1');
  if (fechas.has(estilo)) {
    const fecha = fechaDeSerie(numero);
    if (fecha !== null) return fecha;
  }
  return numeroATexto(numero);
}

/** Ruta de la primera hoja dentro del ZIP. */
function rutaPrimeraHoja(nombres: readonly string[]): string {
  if (nombres.includes('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  const hojas = nombres.filter((ruta) => /^xl\/worksheets\/[^/]+\.xml$/.test(ruta)).sort();
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
 *
 * Se abre el ZIP dos veces a propósito. La primera sólo mira el índice, sin
 * descomprimir nada, para saber cómo se llama la hoja; la segunda descomprime
 * únicamente esa hoja y las tres piezas que hacen falta. Abrir el índice es
 * barato; descomprimir lo que no se va a usar, no.
 */
export async function leerExcel(buffer: ArrayBuffer): Promise<TablaCsv> {
  let rutaHoja: string;
  let ficheros: ReadonlyMap<string, Uint8Array>;
  try {
    rutaHoja = rutaPrimeraHoja(listarZip(buffer));
    ficheros = await leerZip(buffer, [...PIEZAS, rutaHoja]);
  } catch (error) {
    if (error instanceof ZipInvalido) {
      throw new ExcelInvalido(`No se ha podido abrir el Excel: ${error.message}`);
    }
    throw error;
  }

  const compartidos = textosCompartidos(textoDe(ficheros, 'xl/sharedStrings.xml'));
  const fechas = estilosDeFecha(textoDe(ficheros, 'xl/styles.xml'));
  const hoja = textoDe(ficheros, rutaHoja);
  if (hoja === null) throw new ExcelInvalido('La hoja del libro está vacía.');

  const filas: FilaCsv[] = [];
  for (const fila of bloques(hoja, 'row')) {
    if (filas.length >= MAXIMO_FILAS) {
      throw new ExcelInvalido(
        `La hoja tiene más de ${MAXIMO_FILAS.toLocaleString('es-ES')} filas. Pártela en varios ficheros.`,
      );
    }
    const numero = Number(atributo(fila.atributos, 'r') ?? '0');
    const campos: string[] = [];

    for (const celda of bloques(fila.contenido, 'c')) {
      const columna = columnaDe(atributo(celda.atributos, 'r') ?? '');
      // Excel se salta las celdas vacías. Sin rellenar el hueco, todo lo que
      // venga detrás se corre una columna y los importes acaban en la que no es.
      if (columna > 0) while (campos.length < columna - 1) campos.push('');
      campos.push(valorDeCelda(celda, compartidos, fechas));
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
