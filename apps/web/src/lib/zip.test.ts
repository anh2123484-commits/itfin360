import { describe, expect, it } from 'vitest';

import { leerZip, textoDe, ZipInvalido } from '@/lib/zip';

/**
 * Aquí se prueba el camino que usa Excel de verdad: las entradas comprimidas.
 *
 * Los ZIP de los otros tests van sin comprimir porque es más fácil escribirlos,
 * y eso deja sin probar justo la parte que más puede romperse. Estos se
 * comprimen con `CompressionStream`, la contraparte de lo que usa el lector.
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

/** Construye un ZIP, comprimiendo o no cada entrada. */
async function zipCon(
  entradas: Readonly<Record<string, string>>,
  comprimido: boolean,
): Promise<ArrayBuffer> {
  const codificador = new TextEncoder();
  const locales: Uint8Array[] = [];
  const directorio: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const [nombre, contenido] of Object.entries(entradas)) {
    const nombreBytes = codificador.encode(nombre);
    const crudos = codificador.encode(contenido);
    const datos = comprimido ? await comprimir(crudos) : crudos;
    const suma = crc32(crudos);
    const metodo = comprimido ? 8 : 0;

    const local = new Uint8Array(30 + nombreBytes.length + datos.length);
    const vistaLocal = new DataView(local.buffer);
    vistaLocal.setUint32(0, 0x04034b50, true);
    vistaLocal.setUint16(4, 20, true);
    vistaLocal.setUint16(8, metodo, true);
    vistaLocal.setUint32(14, suma, true);
    vistaLocal.setUint32(18, datos.length, true);
    vistaLocal.setUint32(22, crudos.length, true);
    vistaLocal.setUint16(26, nombreBytes.length, true);
    local.set(nombreBytes, 30);
    local.set(datos, 30 + nombreBytes.length);
    locales.push(local);

    const entrada = new Uint8Array(46 + nombreBytes.length);
    const vistaEntrada = new DataView(entrada.buffer);
    vistaEntrada.setUint32(0, 0x02014b50, true);
    vistaEntrada.setUint16(6, 20, true);
    vistaEntrada.setUint16(10, metodo, true);
    vistaEntrada.setUint32(16, suma, true);
    vistaEntrada.setUint32(20, datos.length, true);
    vistaEntrada.setUint32(24, crudos.length, true);
    vistaEntrada.setUint16(28, nombreBytes.length, true);
    vistaEntrada.setUint32(42, desplazamiento, true);
    entrada.set(nombreBytes, 46);
    directorio.push(entrada);

    desplazamiento += local.length;
  }

  const tamanoDirectorio = directorio.reduce((total, e) => total + e.length, 0);
  const fin = new Uint8Array(22);
  const vistaFin = new DataView(fin.buffer);
  vistaFin.setUint32(0, 0x06054b50, true);
  vistaFin.setUint16(8, directorio.length, true);
  vistaFin.setUint16(10, directorio.length, true);
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

describe('leerZip', () => {
  it('lee entradas guardadas sin comprimir', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola', 'dos.txt': 'adiós' }, false);
    const ficheros = await leerZip(zip);
    expect(textoDe(ficheros, 'uno.txt')).toBe('hola');
    expect(textoDe(ficheros, 'dos.txt')).toBe('adiós');
  });

  it('lee entradas comprimidas con deflate, que es lo que escribe Excel', async () => {
    // Un texto largo y repetitivo para que deflate tenga algo que comprimir de
    // verdad y no acabe guardándolo tal cual.
    const largo = 'proveedor;numero;importe\n'.repeat(200);
    const zip = await zipCon({ 'hoja.xml': largo }, true);
    const ficheros = await leerZip(zip);
    expect(textoDe(ficheros, 'hoja.xml')).toBe(largo);
  });

  it('conserva los acentos de los nombres de fichero y del contenido', async () => {
    const zip = await zipCon({ 'año.txt': 'Telefónica S.A.' }, true);
    expect(textoDe(await leerZip(zip), 'año.txt')).toBe('Telefónica S.A.');
  });

  it('una ruta que no está devuelve null, no revienta', async () => {
    const ficheros = await leerZip(await zipCon({ 'uno.txt': 'hola' }, false));
    expect(textoDe(ficheros, 'xl/styles.xml')).toBeNull();
  });

  it('un fichero que no es un ZIP se rechaza', async () => {
    const basura = new TextEncoder().encode('a;b\n1;2').buffer as ArrayBuffer;
    await expect(leerZip(basura)).rejects.toThrow(ZipInvalido);
  });

  it('un fichero vacío se rechaza', async () => {
    await expect(leerZip(new ArrayBuffer(0))).rejects.toThrow(/vacío o cortado/);
  });

  it('un ZIP con el índice apuntando a cualquier sitio se rechaza', async () => {
    const zip = await zipCon({ 'uno.txt': 'hola' }, false);
    const bytes = new Uint8Array(zip);
    const vista = new DataView(zip);
    // Se mueve el inicio del directorio a un sitio donde no hay nada.
    vista.setUint32(bytes.length - 22 + 16, 3, true);
    await expect(leerZip(zip)).rejects.toThrow(/corrupto/);
  });
});
