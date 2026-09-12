import { describe, expect, it } from 'vitest';

import {
  detectarSeparador,
  escribirCsv,
  type FilaCsv,
  indicesDeCabecera,
  parsearCsv,
  type TablaCsv,
  valor,
} from '@/lib/csv';

/** La primera fila de datos. Falla el test si no hay, en vez de silenciarlo. */
function primera(tabla: TablaCsv): FilaCsv {
  const fila = tabla.filas[0];
  if (fila === undefined) throw new Error('el CSV de prueba no tiene filas de datos');
  return fila;
}

describe('detectarSeparador', () => {
  it('reconoce el punto y coma, que es lo que escribe Excel en español', () => {
    expect(detectarSeparador('proveedor;numero;importe\nAmazon;1;10')).toBe(';');
  });

  it('reconoce la coma', () => {
    expect(detectarSeparador('proveedor,numero,importe')).toBe(',');
  });

  it('no cuenta los separadores que están dentro de comillas', () => {
    // El nombre del proveedor trae dos comas. Contando a lo bruto ganaría la
    // coma y el fichero se leería descolocado, sin dar ningún error.
    expect(detectarSeparador('"García, Pérez, S.L.";FAC-1;100')).toBe(';');
  });
});

describe('parsearCsv', () => {
  it('separa cabecera y filas, y numera como el Excel', () => {
    const tabla = parsearCsv('a;b\n1;2\n3;4');
    expect(tabla.cabeceras).toEqual(['a', 'b']);
    expect(tabla.filas).toEqual([
      { numero: 2, campos: ['1', '2'] },
      { numero: 3, campos: ['3', '4'] },
    ]);
  });

  it('pasa las cabeceras a minúsculas para no depender de cómo se escribieron', () => {
    expect(parsearCsv('Proveedor;NUMERO_FACTURA\nAmazon;1').cabeceras).toEqual([
      'proveedor',
      'numero_factura',
    ]);
  });

  it('se come el BOM que Excel pone al guardar en UTF-8', () => {
    // Sin esto la primera cabecera se llama "\uFEFFproveedor" y la columna
    // obligatoria parece que falta, con el fichero perfectamente bien.
    //
    // El BOM va escapado y no pegado en el código: un carácter invisible en el
    // fuente es justo lo que nadie ve al revisar, y el linter lo rechaza.
    expect(parsearCsv('\uFEFFproveedor;numero\nAmazon;1').cabeceras).toEqual([
      'proveedor',
      'numero',
    ]);
  });

  it('respeta el separador dentro de comillas', () => {
    const tabla = parsearCsv('a;b\n"uno;dos";tres');
    expect(tabla.filas[0]?.campos).toEqual(['uno;dos', 'tres']);
  });

  it('entiende las comillas duplicadas y los saltos de línea dentro de un campo', () => {
    const tabla = parsearCsv('a;b\n"dice ""hola""";"dos\nrenglones"');
    expect(tabla.filas[0]?.campos).toEqual(['dice "hola"', 'dos\nrenglones']);
  });

  it('acepta los finales de línea de Windows', () => {
    const tabla = parsearCsv('a;b\r\n1;2\r\n');
    expect(tabla.filas).toEqual([{ numero: 2, campos: ['1', '2'] }]);
  });

  it('descarta las filas vacías que Excel deja al final', () => {
    const tabla = parsearCsv('a;b\n1;2\n;\n\n');
    expect(tabla.filas).toHaveLength(1);
  });

  it('quita los espacios de alrededor de cada celda', () => {
    expect(parsearCsv('a;b\n  1  ;  2').filas[0]?.campos).toEqual(['1', '2']);
  });

  it('un fichero vacío no revienta', () => {
    expect(parsearCsv('')).toEqual({ cabeceras: [], filas: [] });
  });

  it('la última fila cuenta aunque no acabe en salto de línea', () => {
    expect(parsearCsv('a;b\n1;2').filas).toHaveLength(1);
  });
});

describe('lectura por nombre de columna', () => {
  const tabla = parsearCsv('proveedor;importe\nAmazon;100');
  const indices = indicesDeCabecera(tabla.cabeceras);

  it('lee la celda por su cabecera', () => {
    expect(valor(primera(tabla), indices, 'proveedor')).toBe('Amazon');
    expect(valor(primera(tabla), indices, 'importe')).toBe('100');
  });

  it('una columna que no existe da cadena vacía, no revienta', () => {
    expect(valor(primera(tabla), indices, 'inventada')).toBe('');
  });

  it('con la cabecera repetida manda la primera', () => {
    // La segunda ganando, un fichero con dos columnas «importe» dejaría de leer
    // la que la persona ve primero y no habría manera de darse cuenta.
    const indicesRepetidos = indicesDeCabecera(['importe', 'otra', 'importe']);
    expect(indicesRepetidos.get('importe')).toBe(0);
  });

  it('una fila más corta que la cabecera da cadena vacía en lo que falta', () => {
    const corta = parsearCsv('a;b;c\n1;2');
    expect(valor(primera(corta), indicesDeCabecera(corta.cabeceras), 'c')).toBe('');
  });
});

describe('escribirCsv', () => {
  it('escribe lo que parsearCsv sabe volver a leer', () => {
    const texto = escribirCsv([
      ['a', 'b'],
      ['uno;dos', 'dice "hola"'],
    ]);
    expect(parsearCsv(texto).filas[0]?.campos).toEqual(['uno;dos', 'dice "hola"']);
  });

  it('no entrecomilla lo que no hace falta', () => {
    expect(escribirCsv([['a', 'b']])).toBe('a;b');
  });
});
