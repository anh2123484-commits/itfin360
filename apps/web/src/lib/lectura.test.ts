import { describe, expect, it } from 'vitest';

import { importarFacturas } from '@/lib/importacion';
import { decodificarTexto, leerFichero } from '@/lib/lectura';

/** Lo mismo que hace `xlsx.test.ts`: un `.xlsx` de verdad, construido aquí. */
function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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

function celda(referencia: string, valor: string): string {
  return `<c r="${referencia}" t="inlineStr"><is><t>${valor}</t></is></c>`;
}

/** Una hoja con las columnas de la plantilla y una factura de dos líneas. */
function excelDeFacturas(): ArrayBuffer {
  const cabeceras = [
    'proveedor',
    'numero_factura',
    'fecha_emision',
    'fecha_devengo',
    'fecha_vencimiento',
    'descripcion',
    'concepto',
    'cantidad',
    'precio_unidad',
    'importe_linea',
    'iva',
    'divisa',
  ];
  const letras = 'ABCDEFGHIJKL';
  const fila = (numero: number, valores: readonly string[]): string =>
    `<row r="${numero}">${valores
      .map((valor, indice) => celda(`${letras[indice]}${numero}`, valor))
      .join('')}</row>`;

  return comoZip({
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      fila(1, cabeceras) +
      fila(2, [
        'Dell',
        'F-100',
        '2026-02-10',
        '',
        '',
        'Servidor',
        'Servidores',
        '1',
        '3200,00',
        '',
        '882,00',
        'EUR',
      ]) +
      fila(3, [
        'Dell',
        'F-100',
        '2026-02-10',
        '',
        '',
        'Discos',
        'Almacenamiento',
        '4',
        '250,00',
        '',
        '882,00',
        'EUR',
      ]) +
      '</sheetData></worksheet>',
  });
}

describe('decodificarTexto', () => {
  it('lee UTF-8', () => {
    const bytes = new TextEncoder().encode('Telefónica;100').buffer as ArrayBuffer;
    expect(decodificarTexto(bytes)).toBe('Telefónica;100');
  });

  it('vuelve a Windows-1252 cuando el UTF-8 no cuadra', () => {
    // Así guarda Excel en español un «CSV» a secas. Sin esto, el nombre del
    // proveedor llega roto y se da de alta un proveedor nuevo con el nombre mal.
    const latin1 = new Uint8Array([0x54, 0x65, 0x6c, 0x65, 0x66, 0xf3, 0x6e, 0x69, 0x63, 0x61]);
    expect(decodificarTexto(latin1.buffer as ArrayBuffer)).toBe('Telefónica');
  });
});

describe('leerFichero', () => {
  it('reconoce un CSV y lo lee', async () => {
    const csv = new TextEncoder().encode('a;b\n1;2').buffer as ArrayBuffer;
    const { formato, tabla } = await leerFichero(csv);
    expect(formato).toBe('csv');
    expect(tabla.cabeceras).toEqual(['a', 'b']);
  });

  it('reconoce un Excel por su contenido, no por el nombre', async () => {
    const { formato } = await leerFichero(excelDeFacturas());
    expect(formato).toBe('excel');
  });

  it('un Excel llega a las mismas facturas que el CSV equivalente', async () => {
    // Es lo que importa de todo esto: el formato del fichero no cambia lo que
    // entra. Si estas dos rutas se separan, una acabará aceptando lo que la
    // otra rechaza y nadie lo verá hasta que los números no cuadren.
    const desdeExcel = importarFacturas((await leerFichero(excelDeFacturas())).tabla);

    const csv = [
      'proveedor;numero_factura;fecha_emision;fecha_devengo;fecha_vencimiento;descripcion;concepto;cantidad;precio_unidad;importe_linea;iva;divisa',
      'Dell;F-100;2026-02-10;;;Servidor;Servidores;1;3200,00;;882,00;EUR',
      'Dell;F-100;2026-02-10;;;Discos;Almacenamiento;4;250,00;;882,00;EUR',
    ].join('\n');
    const desdeCsv = importarFacturas(
      (await leerFichero(new TextEncoder().encode(csv).buffer as ArrayBuffer)).tabla,
    );

    expect(desdeExcel.errores).toEqual([]);
    expect(desdeExcel.facturas).toEqual(desdeCsv.facturas);
    expect(desdeExcel.facturas[0]?.netCents).toBe(420_000);
    expect(desdeExcel.facturas[0]?.vatCents).toBe(88_200);
    expect(desdeExcel.facturas[0]?.lines).toHaveLength(2);
  });

  it('los números de fila del Excel son los que se ven en Excel', async () => {
    const { tabla } = await leerFichero(excelDeFacturas());
    expect(tabla.filas.map((fila) => fila.numero)).toEqual([2, 3]);
  });
});
