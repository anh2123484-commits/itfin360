import { describe, expect, it } from 'vitest';

import { leerZip, listarZip, textoDe, ZipInvalido } from '@/lib/zip';

/**
 * Aquí se prueba el camino que usa Excel de verdad: las entradas comprimidas.
 *
 * Los ZIP de los otros tests van sin comprimir porque es más fácil escribirlos,
 * y eso deja sin probar justo la parte que más puede romperse. Estos se
 * comprimen con `CompressionStream`, la contraparte de lo que usa el lector.
 *
 * La segunda mitad del fichero prueba los topes. Son los que impiden que un
 * `.xlsx` de 60 KB se coma la memoria del servidor, así que se ejercitan con
 * ficheros que de verdad expanden, no con constantes leídas del módulo.
 */

function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function comprimir(datos: Uint8Array): Promise<Uint8Array> {
  const entrada = new Blob([datos as BlobPart]).stream();
  const salida = entrada.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(salida).arrayBuffer());
}

/**
 * Una entrada ya preparada para meter en el ZIP.
 *
 * `declarado` va aparte de los datos a propósito: el índice de un ZIP lo escribe
 * quien fabrica el fichero, y poder mentir aquí es lo que permite probar que el
 * lector no se fía de ese número.
 */
interface Pieza {
  readonly nombre: string;
  readonly datos: Uint8Array;
  readonly metodo: number;
  readonly crc: number;
  readonly declarado: number;
}

/** Monta un ZIP a partir de entradas ya preparadas. */
function construirZip(piezas: readonly Pieza[], entradasDeclaradas?: number): ArrayBuffer {
  const codificador = new TextEncoder();
  const locales: Uint8Array[] = [];
  const directorio: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const pieza of piezas) {
    const nombreBytes = codificador.encode(pieza.nombre);

    const local = new Uint8Array(30 + nombreBytes.length + pieza.datos.length);
    const vistaLocal = new DataView(local.buffer);
    vistaLocal.setUint32(0, 0x04034b50, true);
    vistaLocal.setUint16(4, 20, true);
    vistaLocal.setUint16(8, pieza.metodo, true);
    vistaLocal.setUint32(14, pieza.crc, true);
    vistaLocal.setUint32(18, pieza.datos.length, true);
    vistaLocal.setUint32(22, pieza.declarado, true);
    vistaLocal.setUint16(26, nombreBytes.length, true);
    local.set(nombreBytes, 30);
    local.set(pieza.datos, 30 + nombreBytes.length);
    locales.push(local);

    const entrada = new Uint8Array(46 + nombreBytes.length);
    const vistaEntrada = new DataView(entrada.buffer);
    vistaEntrada.setUint32(0, 0x02014b50, true);
    vistaEntrada.setUint16(6, 20, true);
    vistaEntrada.setUint16(10, pieza.metodo, true);
    vistaEntrada.setUint32(16, pieza.crc, true);
    vistaEntrada.setUint32(20, pieza.datos.length, true);
    vistaEntrada.setUint32(24, pieza.declarado, true);
    vistaEntrada.setUint16(28, nombreBytes.length, true);
    vistaEntrada.setUint32(42, desplazamiento, true);
    entrada.set(nombreBytes, 46);
    directorio.push(entrada);

    desplazamiento += local.length;
  }

  const tamanoDirectorio = directorio.reduce((total, e) => total + e.length, 0);
  const fin = new Uint8Array(22);
  const vistaFin = new DataView(fin.buffer);
  const cuantas = entradasDeclaradas ?? directorio.length;
  vistaFin.setUint32(0, 0x06054b50, true);
  vistaFin.setUint16(8, cuantas, true);
  vistaFin.setUint16(10, cuantas, true);
  vistaFin.setUint32(12, tamanoDirectorio, true);
  vistaFin.setUint32(16, desplazamiento, true);

  const partes = [...locales, ...directorio, fin];
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const parte of partes) {
    salida.set(parte, cursor);
    cursor += parte.length;
  }
  return salida.buffer;
}

/** Construye un ZIP a partir de texto, comprimiendo o no cada entrada. */
async function zipCon(
  entradas: Readonly<Record<string, string>>,
  comprimido: boolean,
): Promise<ArrayBuffer> {
  const codificador = new TextEncoder();
  const piezas: Pieza[] = [];
  for (const [nombre, contenido] of Object.entries(entradas)) {
    const crudos = codificador.encode(contenido);
    piezas.push({
      nombre,
      datos: comprimido ? await comprimir(crudos) : crudos,
      metodo: comprimido ? 8 : 0,
      crc: crc32(crudos),
      declarado: crudos.length,
    });
  }
  return construirZip(piezas);
}

/** Todos los nombres del ZIP, ya descomprimidos. */
async function leerTodo(zip: ArrayBuffer): Promise<ReadonlyMap<string, Uint8Array>> {
  return leerZip(zip, listarZip(zip));
}

const VEINTE_MB = 20 * 1024 * 1024;

/**
 * Un bloque que comprime muchísimo, preparado una sola vez.
 *
 * Se reutiliza entre tests porque comprimir 20 MB no es gratis y el contenido da
 * igual: lo que se prueba es cuánto ocupa al expandir, no qué pone dentro.
 */
let bloqueComprimido: { datos: Uint8Array; crc: number } | null = null;

async function bloqueDeVeinteMb(): Promise<{ datos: Uint8Array; crc: number }> {
  if (bloqueComprimido === null) {
    const crudos = new Uint8Array(VEINTE_MB).fill(0x61);
    bloqueComprimido = { datos: await comprimir(crudos), crc: crc32(crudos) };
  }
  return bloqueComprimido;
}

describe('leerZip', () => {
  it('lee entradas guardadas sin comprimir', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola', 'dos.txt': 'adiós' }, false);
    const ficheros = await leerTodo(zip);
    expect(textoDe(ficheros, 'uno.txt')).toBe('hola');
    expect(textoDe(ficheros, 'dos.txt')).toBe('adiós');
  });

  it('lee entradas comprimidas con deflate, que es lo que escribe Excel', async () => {
    // Un texto largo y repetitivo para que deflate tenga algo que comprimir de
    // verdad y no acabe guardándolo tal cual.
    const largo = 'proveedor;numero;importe\n'.repeat(200);
    const zip = await zipCon({ 'hoja.xml': largo }, true);
    const ficheros = await leerZip(zip, ['hoja.xml']);
    expect(textoDe(ficheros, 'hoja.xml')).toBe(largo);
  });

  it('conserva los acentos de los nombres de fichero y del contenido', async () => {
    const zip = await zipCon({ 'año.txt': 'Telefónica S.A.' }, true);
    expect(textoDe(await leerZip(zip, ['año.txt']), 'año.txt')).toBe('Telefónica S.A.');
  });

  it('no descomprime lo que no se le pide', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola', 'dos.txt': 'adiós' }, true);
    const ficheros = await leerZip(zip, ['uno.txt']);
    expect(textoDe(ficheros, 'uno.txt')).toBe('hola');
    expect(textoDe(ficheros, 'dos.txt')).toBeNull();
  });

  it('una ruta que no está devuelve null, no revienta', async () => {
    const ficheros = await leerZip(await zipCon({ 'uno.txt': 'hola' }, false), ['xl/styles.xml']);
    expect(textoDe(ficheros, 'xl/styles.xml')).toBeNull();
  });

  it('un fichero que no es un ZIP se rechaza', async () => {
    const basura = new TextEncoder().encode('a;b\n1;2').buffer as ArrayBuffer;
    await expect(leerZip(basura, ['uno.txt'])).rejects.toThrow(ZipInvalido);
  });

  it('un fichero vacío se rechaza', async () => {
    await expect(leerZip(new ArrayBuffer(0), [])).rejects.toThrow(/vacío o cortado/);
  });

  it('un ZIP con el índice apuntando a cualquier sitio se rechaza', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola' }, false);
    const bytes = new Uint8Array(zip);
    const vista = new DataView(zip);
    // Se mueve el inicio del directorio a un sitio donde no hay nada.
    vista.setUint32(bytes.length - 22 + 16, 3, true);
    await expect(leerZip(zip, ['uno.txt'])).rejects.toThrow(/corrupto/);
  });
});

describe('listarZip', () => {
  it('devuelve los nombres sin descomprimir nada', async () => {
    const zip = await zipCon(
      { 'xl/workbook.xml': '<a/>', 'xl/worksheets/sheet1.xml': '<b/>' },
      true,
    );
    expect(listarZip(zip)).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  });

  it('un ZIP roto se rechaza igual que al leerlo', () => {
    const basura = new TextEncoder().encode('a;b\n1;2').buffer as ArrayBuffer;
    expect(() => listarZip(basura)).toThrow(ZipInvalido);
  });
});

describe('topes contra ficheros preparados para reventar el servidor', () => {
  it('rechaza un ZIP que dice traer más ficheros de los que cabe esperar', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola' }, false);
    const vista = new DataView(zip);
    // Se toca sólo lo que dice el índice: el guarda tiene que actuar antes de
    // recorrer nada, así que no hace falta escribir 513 entradas de verdad.
    vista.setUint16(zip.byteLength - 22 + 10, 513, true);
    expect(() => listarZip(zip)).toThrow(/demasiados para un \.xlsx/);
  });

  it(
    'el presupuesto de bytes descomprimidos es de todo el ZIP, no de cada entrada',
    async () => {
      const bloque = await bloqueDeVeinteMb();
      const pieza = (nombre: string): Pieza => ({
        nombre,
        datos: bloque.datos,
        metodo: 8,
        crc: bloque.crc,
        declarado: VEINTE_MB,
      });
      const zip = construirZip([pieza('a.bin'), pieza('b.bin')]);

      // 20 MB pasan. Los siguientes 20 ya no caben en lo que queda, aunque por
      // separado cada entrada esté dentro del tope.
      await expect(leerZip(zip, ['a.bin', 'b.bin'])).rejects.toThrow(/demasiados datos/);
      expect((await leerZip(zip, ['a.bin'])).get('a.bin')?.byteLength).toBe(VEINTE_MB);
    },
    30_000,
  );

  it(
    'el tamaño que el ZIP declara no sirve para colarse',
    async () => {
      const bloque = await bloqueDeVeinteMb();
      // Declarar cero es lo que haría quien fabrica el fichero para saltarse una
      // comprobación previa. Lo que corta es medir mientras se descomprime.
      const pieza = (nombre: string): Pieza => ({
        nombre,
        datos: bloque.datos,
        metodo: 8,
        crc: bloque.crc,
        declarado: 0,
      });
      const zip = construirZip([pieza('a.bin'), pieza('b.bin')]);

      await expect(leerZip(zip, ['a.bin', 'b.bin'])).rejects.toThrow(/demasiados datos/);
    },
    30_000,
  );

  it('un método de compresión que no es el de Excel se rechaza', async () => {
    const datos = new TextEncoder().encode('hola');
    const zip = construirZip([
      { nombre: 'uno.txt', datos, metodo: 12, crc: crc32(datos), declarado: datos.length },
    ]);
    await expect(leerZip(zip, ['uno.txt'])).rejects.toThrow(/método de compresión/);
  });
});
