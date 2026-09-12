import { describe, expect, it } from 'vitest';

import { fechaDeSerie, leerExcel, pareceExcel } from '@/lib/xlsx';

/**
 * Los `.xlsx` de prueba se construyen aquí, byte a byte.
 *
 * La alternativa era meter ficheros binarios en el repositorio, y un binario en
 * un repositorio es algo que nadie vuelve a mirar: no se puede revisar en un
 * diff y no se sabe qué contiene hasta que falla. Construirlos en el test deja
 * a la vista exactamente qué hoja se está leyendo.
 */

function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Construye un ZIP con las entradas guardadas sin comprimir. */
function comoZip(entradas: Readonly<Record<string, string>>): ArrayBuffer {
  const codificador = new TextEncoder();
  const locales: Uint8Array[] = [];
  const directorio: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const [nombre, contenido] of Object.entries(entradas)) {
    const nombreBytes = codificador.encode(nombre);
    const datos = codificador.encode(contenido);
    const suma = crc32(datos);

    const local = new Uint8Array(30 + nombreBytes.length + datos.length);
    const vistaLocal = new DataView(local.buffer);
    vistaLocal.setUint32(0, 0x04034b50, true);
    vistaLocal.setUint16(4, 20, true);
    vistaLocal.setUint16(8, 0, true);
    vistaLocal.setUint32(14, suma, true);
    vistaLocal.setUint32(18, datos.length, true);
    vistaLocal.setUint32(22, datos.length, true);
    vistaLocal.setUint16(26, nombreBytes.length, true);
    local.set(nombreBytes, 30);
    local.set(datos, 30 + nombreBytes.length);
    locales.push(local);

    const entrada = new Uint8Array(46 + nombreBytes.length);
    const vistaEntrada = new DataView(entrada.buffer);
    vistaEntrada.setUint32(0, 0x02014b50, true);
    vistaEntrada.setUint16(6, 20, true);
    vistaEntrada.setUint16(10, 0, true);
    vistaEntrada.setUint32(16, suma, true);
    vistaEntrada.setUint32(20, datos.length, true);
    vistaEntrada.setUint32(24, datos.length, true);
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

/** Un libro con la hoja que se le pase, más los textos y estilos que haga falta. */
function libro(hoja: string, extras: Readonly<Record<string, string>> = {}): ArrayBuffer {
  return comoZip({
    '[Content_Types].xml': '<Types/>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${hoja}</sheetData></worksheet>`,
    ...extras,
  });
}

/** Celda de texto en línea, que es como se escribe sin tabla de compartidos. */
function texto(referencia: string, valor: string): string {
  return `<c r="${referencia}" t="inlineStr"><is><t>${valor}</t></is></c>`;
}

function numero(referencia: string, valor: number, estilo?: number): string {
  const s = estilo === undefined ? '' : ` s="${estilo}"`;
  return `<c r="${referencia}"${s}><v>${valor}</v></c>`;
}

describe('pareceExcel', () => {
  it('reconoce un ZIP por sus primeros bytes', () => {
    expect(pareceExcel(libro(''))).toBe(true);
  });

  it('un CSV no lo es', () => {
    expect(pareceExcel(new TextEncoder().encode('a;b\n1;2').buffer as ArrayBuffer)).toBe(false);
  });

  it('un fichero vacío no lo es, y no revienta', () => {
    expect(pareceExcel(new ArrayBuffer(0))).toBe(false);
  });
});

describe('fechaDeSerie', () => {
  it('convierte el número de días de Excel', () => {
    // 45292 es el 1 de enero de 2024 en cualquier Excel.
    expect(fechaDeSerie(45_292)).toBe('2024-01-01');
    expect(fechaDeSerie(46_112)).toBe('2026-03-31');
  });

  it('rechaza el tramo ambiguo del año 1900', () => {
    // Excel cree que 1900 fue bisiesto. Por debajo de 61 el día puede estar
    // corrido en uno, y una fecha corrida mueve el gasto de mes.
    expect(fechaDeSerie(60)).toBeNull();
    expect(fechaDeSerie(1)).toBeNull();
  });

  it('rechaza lo que no es una fecha posible', () => {
    expect(fechaDeSerie(-5)).toBeNull();
    expect(fechaDeSerie(9_999_999)).toBeNull();
    expect(fechaDeSerie(Number.NaN)).toBeNull();
  });
});

describe('leerExcel', () => {
  it('lee cabeceras y filas, con los números de fila de Excel', async () => {
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'Proveedor')}${texto('B1', 'Importe')}</row>` +
          `<row r="2">${texto('A2', 'Amazon')}${numero('B2', 100)}</row>`,
      ),
    );
    expect(tabla.cabeceras).toEqual(['proveedor', 'importe']);
    expect(tabla.filas).toEqual([{ numero: 2, campos: ['Amazon', '100'] }]);
  });

  it('resuelve los textos compartidos, que es como Excel guarda las cadenas', async () => {
    const compartidos = '<sst><si><t>Proveedor</t></si><si><t>Suscripción SaaS</t></si></sst>';
    const tabla = await leerExcel(
      libro(
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c></row>',
        { 'xl/sharedStrings.xml': compartidos },
      ),
    );
    expect(tabla.cabeceras).toEqual(['proveedor']);
    expect(tabla.filas[0]?.campos).toEqual(['Suscripción SaaS']);
  });

  it('junta un texto partido en varios trozos con formatos distintos', async () => {
    // Poner una palabra en negrita dentro de la celda parte el texto en dos.
    // Quedándose con el primero se perdería media descripción.
    const compartidos = '<sst><si><r><t>Servidor </t></r><r><t>Dell</t></r></si></sst>';
    const tabla = await leerExcel(
      libro('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', {
        'xl/sharedStrings.xml': compartidos,
      }),
    );
    expect(tabla.cabeceras).toEqual(['servidor dell']);
  });

  it('deshace las entidades XML, incluida la del ampersand', async () => {
    const tabla = await leerExcel(
      libro(`<row r="1">${texto('A1', 'García &amp; Pérez &lt;S.L.&gt;')}</row>`),
    );
    expect(tabla.cabeceras).toEqual(['garcía & pérez <s.l.>']);
  });

  it('una fecha con formato de fecha sale como fecha, no como número', async () => {
    // El 14 es el formato de fecha corta que trae Excel de serie.
    const estilos =
      '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>';
    const tabla = await leerExcel(
      libro(`<row r="1">${texto('A1', 'fecha')}</row><row r="2">${numero('A2', 46_112, 1)}</row>`, {
        'xl/styles.xml': estilos,
      }),
    );
    expect(tabla.filas[0]?.campos).toEqual(['2026-03-31']);
  });

  it('el mismo número sin formato de fecha sigue siendo un número', async () => {
    // Ésta es la razón de mirar el formato: 46112 puede ser una fecha o un
    // importe de cuarenta y seis mil euros, y por el valor no hay forma de saberlo.
    const estilos = '<styleSheet><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>';
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'importe')}</row><row r="2">${numero('A2', 46_112, 0)}</row>`,
        { 'xl/styles.xml': estilos },
      ),
    );
    expect(tabla.filas[0]?.campos).toEqual(['46112']);
  });

  it('reconoce un formato de fecha definido por el propio libro', async () => {
    const estilos =
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>';
    const tabla = await leerExcel(
      libro(`<row r="1">${texto('A1', 'f')}</row><row r="2">${numero('A2', 45_292, 0)}</row>`, {
        'xl/styles.xml': estilos,
      }),
    );
    expect(tabla.filas[0]?.campos).toEqual(['2024-01-01']);
  });

  it('un formato con letras dentro de comillas no es una fecha', async () => {
    // `"año "0` lleva una eñe y una a, pero es un número con un rótulo delante.
    const estilos =
      '<styleSheet><numFmts><numFmt numFmtId="165" formatCode="&quot;año &quot;0"/></numFmts>' +
      '<cellXfs><xf numFmtId="165"/></cellXfs></styleSheet>';
    const tabla = await leerExcel(
      libro(`<row r="1">${texto('A1', 'n')}</row><row r="2">${numero('A2', 45_292, 0)}</row>`, {
        'xl/styles.xml': estilos,
      }),
    );
    expect(tabla.filas[0]?.campos).toEqual(['45292']);
  });

  it('quita el ruido del coma flotante de los importes', async () => {
    // Excel guarda 12,60 así más veces de las que parece. Tal cual, el lector de
    // importes lo rechazaría por tener demasiados decimales.
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'precio')}</row>` +
          '<row r="2"><c r="A2"><v>12.600000000000001</v></c></row>',
      ),
    );
    expect(tabla.filas[0]?.campos).toEqual(['12.6']);
  });

  it('rellena el hueco de las celdas vacías que Excel se salta', async () => {
    // Excel no escribe las celdas vacías. Sin rellenar, todo lo que venga detrás
    // se corre una columna y los importes acaban en la que no es.
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'a')}${texto('B1', 'b')}${texto('C1', 'c')}</row>` +
          `<row r="2">${texto('A2', 'uno')}${texto('C2', 'tres')}</row>`,
      ),
    );
    expect(tabla.filas[0]?.campos).toEqual(['uno', '', 'tres']);
  });

  it('entiende las celdas que se escriben cerradas en sí mismas', async () => {
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'a')}${texto('B1', 'b')}</row>` +
          `<row r="2">${texto('A2', 'uno')}<c r="B2"/></row>`,
      ),
    );
    expect(tabla.filas[0]?.campos).toEqual(['uno', '']);
  });

  it('usa el valor que Excel dejó calculado de una fórmula', async () => {
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'total')}</row>` +
          '<row r="2"><c r="A2"><f>SUM(B1:B3)</f><v>250</v></c></row>',
      ),
    );
    expect(tabla.filas[0]?.campos).toEqual(['250']);
  });

  it('salta las filas del todo vacías', async () => {
    const tabla = await leerExcel(
      libro(
        `<row r="1">${texto('A1', 'a')}</row><row r="2"><c r="A2"/></row>` +
          `<row r="3">${texto('A3', 'uno')}</row>`,
      ),
    );
    expect(tabla.filas).toEqual([{ numero: 3, campos: ['uno'] }]);
  });

  it('una hoja vacía no revienta', async () => {
    expect(await leerExcel(libro(''))).toEqual({ cabeceras: [], filas: [] });
  });

  it('un fichero que no es un ZIP se rechaza con un mensaje legible', async () => {
    const basura = new TextEncoder().encode('esto no es un Excel').buffer as ArrayBuffer;
    await expect(leerExcel(basura)).rejects.toThrow(/no se ha podido abrir el excel/i);
  });

  it('un ZIP sin hoja de cálculo dentro se rechaza', async () => {
    const sinHoja = comoZip({ '[Content_Types].xml': '<Types/>' });
    await expect(leerExcel(sinHoja)).rejects.toThrow(/ninguna hoja/i);
  });

  it('una hoja con más filas de las que tiene sentido subir se rechaza', async () => {
    const filas = [`<row r="1">${texto('A1', 'proveedor')}</row>`];
    for (let i = 2; i <= 20_002; i += 1) filas.push(`<row r="${i}">${texto(`A${i}`, 'x')}</row>`);
    await expect(leerExcel(libro(filas.join('')))).rejects.toThrow(/más de 20\.000 filas/);
  });

  it('un XML con etiquetas sin cerrar se termina de leer, no se queda dando vueltas', async () => {
    // Esto no es un fichero roto por accidente: es la forma barata de colgar un
    // lector que busque cada cierre desde el principio. 800 KB de `<si>` sin
    // cerrar caben en un `.xlsx` de unos pocos KB comprimido, y con una lectura
    // cuadrática el servidor se queda ahí minutos sin responder a nadie más.
    const maligno = `<sst>${'<si>'.repeat(200_000)}`;
    const empezo = Date.now();
    const tabla = await leerExcel(
      libro('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', {
        'xl/sharedStrings.xml': maligno,
      }),
    );
    // Sin texto compartido que resolver, la celda queda vacía y la fila se salta.
    expect(tabla.filas).toEqual([]);
    expect(Date.now() - empezo).toBeLessThan(5_000);
  }, 20_000);
});
