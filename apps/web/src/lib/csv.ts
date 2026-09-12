/**
 * Lectura de CSV, sin dependencias (F2-04).
 *
 * Escrito a mano por una razón concreta: los ficheros que va a subir la gente
 * salen de Excel en español, y eso significa separador `;`, BOM al principio,
 * saltos de línea `\r\n` y campos entre comillas con puntos y comas dentro. Un
 * `split(',')` se traga un fichero así y devuelve columnas descolocadas sin dar
 * ningún error, que es la peor forma de fallar en una importación: los importes
 * acaban en la columna equivocada y la factura cuadra igual.
 *
 * Funciones puras. Quien lea el fichero del disco o de la petición vive fuera.
 */

/** Una fila del fichero, con el número de línea para poder señalarla. */
export interface FilaCsv {
  /** Número de línea en el fichero, contando la cabecera como 1. */
  readonly numero: number;
  readonly campos: readonly string[];
}

/** El fichero leído: cabecera y filas de datos. */
export interface TablaCsv {
  readonly cabeceras: readonly string[];
  readonly filas: readonly FilaCsv[];
}

/** Separadores que se reconocen, en orden de preferencia al empatar. */
const SEPARADORES = [';', ',', '\t'] as const;

/** Separador de un CSV. */
export type SeparadorCsv = (typeof SEPARADORES)[number];

/**
 * Adivina el separador contando cuál aparece más veces fuera de comillas en la
 * primera línea.
 *
 * Contar fuera de comillas importa: `"García, S.L.";FAC-1;100` tiene dos comas
 * y dos puntos y coma, y la coma está dentro de un nombre de proveedor. Contando
 * a lo bruto el empate se resolvería mal la mitad de las veces.
 */
export function detectarSeparador(texto: string): SeparadorCsv {
  const primeraLinea = sinBom(texto).split(/\r?\n/, 1)[0] ?? '';
  let mejor: SeparadorCsv = ';';
  let maximo = 0;

  for (const separador of SEPARADORES) {
    let cuenta = 0;
    let entreComillas = false;
    for (const caracter of primeraLinea) {
      if (caracter === '"') entreComillas = !entreComillas;
      else if (caracter === separador && !entreComillas) cuenta += 1;
    }
    if (cuenta > maximo) {
      maximo = cuenta;
      mejor = separador;
    }
  }
  return mejor;
}

/** Excel escribe una marca de orden de bytes al guardar en UTF-8. */
function sinBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Lee el fichero entero.
 *
 * Acepta comillas dobles con el separador dentro, comillas escapadas por
 * duplicación (`""`) y saltos de línea dentro de un campo entrecomillado, que
 * es como Excel guarda una descripción de dos renglones.
 *
 * Las filas completamente vacías se descartan: un CSV de Excel casi siempre
 * acaba con una o con varias, y una fila vacía no es un error del usuario.
 */
export function parsearCsv(texto: string, separador?: SeparadorCsv): TablaCsv {
  const contenido = sinBom(texto);
  const sep = separador ?? detectarSeparador(contenido);

  const filasCrudas: string[][] = [];
  let campos: string[] = [];
  let campo = '';
  let entreComillas = false;

  const cerrarCampo = (): void => {
    campos.push(campo);
    campo = '';
  };
  const cerrarFila = (): void => {
    cerrarCampo();
    filasCrudas.push(campos);
    campos = [];
  };

  for (let i = 0; i < contenido.length; i += 1) {
    // `charAt` y no `[i]`: con `noUncheckedIndexedAccess` el índice devuelve
    // `string | undefined` y el acumulador acabaría concatenando «undefined».
    const caracter = contenido.charAt(i);

    if (entreComillas) {
      if (caracter === '"') {
        // Dos comillas seguidas dentro de un campo entrecomillado son una
        // comilla literal, no el cierre del campo.
        if (contenido.charAt(i + 1) === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += caracter;
      }
      continue;
    }

    if (caracter === '"' && campo === '') {
      entreComillas = true;
    } else if (caracter === sep) {
      cerrarCampo();
    } else if (caracter === '\n') {
      cerrarFila();
    } else if (caracter !== '\r') {
      campo += caracter;
    }
  }

  // Lo que quede pendiente es la última fila, que puede no llevar salto final.
  if (campo !== '' || campos.length > 0) cerrarFila();

  const conContenido = filasCrudas
    .map((valores, indice) => ({ numero: indice + 1, campos: valores.map((v) => v.trim()) }))
    .filter((fila) => fila.campos.some((valor) => valor !== ''));

  const primera = conContenido[0];
  if (primera === undefined) return { cabeceras: [], filas: [] };

  return {
    cabeceras: primera.campos.map((cabecera) => cabecera.toLowerCase()),
    filas: conContenido.slice(1),
  };
}

/**
 * Índice de cada cabecera, para poder leer una fila por nombre de columna.
 *
 * Si una cabecera se repite manda la primera. Con la segunda ganando, un
 * fichero con dos columnas `importe` dejaría de leer la que la gente ve
 * primero, y eso es imposible de diagnosticar mirando el Excel.
 */
export function indicesDeCabecera(cabeceras: readonly string[]): ReadonlyMap<string, number> {
  const indices = new Map<string, number>();
  cabeceras.forEach((cabecera, indice) => {
    if (!indices.has(cabecera)) indices.set(cabecera, indice);
  });
  return indices;
}

/** Valor de una columna en una fila, o cadena vacía si la columna no está. */
export function valor(
  fila: FilaCsv,
  indices: ReadonlyMap<string, number>,
  columna: string,
): string {
  const indice = indices.get(columna);
  if (indice === undefined) return '';
  return fila.campos[indice] ?? '';
}

/**
 * Escribe un CSV. Se usa para la plantilla de ejemplo que se descarga.
 *
 * Entrecomilla siempre que haga falta y duplica las comillas de dentro, para
 * que la plantilla se pueda volver a leer con `parsearCsv` sin sorpresas.
 */
export function escribirCsv(
  filas: readonly (readonly string[])[],
  separador: SeparadorCsv = ';',
): string {
  const escapar = (valorCampo: string): string =>
    /["\n\r]/.test(valorCampo) || valorCampo.includes(separador)
      ? `"${valorCampo.replaceAll('"', '""')}"`
      : valorCampo;
  return filas.map((fila) => fila.map(escapar).join(separador)).join('\r\n');
}
