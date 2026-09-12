import { describe, expect, it } from 'vitest';

import { parsearCsv } from '@/lib/csv';
import {
  conceptoDesdeTexto,
  fechaDesdeTexto,
  type FacturaImportada,
  importarFacturas,
} from '@/lib/importacion';

const CABECERA =
  'proveedor;numero_factura;fecha_emision;fecha_devengo;fecha_vencimiento;' +
  'descripcion;concepto;cantidad;precio_unidad;importe_linea;iva;divisa';

function importar(...filas: readonly string[]) {
  return importarFacturas(parsearCsv([CABECERA, ...filas].join('\n')));
}

/** La única factura del resultado. Falla el test si no hay exactamente una. */
function unica(resultado: ReturnType<typeof importar>): FacturaImportada {
  const factura = resultado.facturas[0];
  if (factura === undefined || resultado.facturas.length !== 1) {
    throw new Error(`se esperaba una factura, hay ${resultado.facturas.length}`);
  }
  return factura;
}

describe('fechaDesdeTexto', () => {
  it('acepta ISO y el formato de aquí', () => {
    expect(fechaDesdeTexto('2026-03-31')).toEqual({ year: 2026, month: 3, day: 31 });
    expect(fechaDesdeTexto('31/03/2026')).toEqual({ year: 2026, month: 3, day: 31 });
    expect(fechaDesdeTexto('31-03-2026')).toEqual({ year: 2026, month: 3, day: 31 });
  });

  it('rechaza un día que no existe en ese mes', () => {
    // El 31 de febrero pasaría cualquier comprobación contra 31, y entraría un
    // devengo de un día que no existe.
    expect(fechaDesdeTexto('31/02/2026')).toBeNull();
    expect(fechaDesdeTexto('2026-02-30')).toBeNull();
  });

  it('el año bisiesto sí tiene 29 de febrero', () => {
    expect(fechaDesdeTexto('29/02/2024')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(fechaDesdeTexto('29/02/2026')).toBeNull();
  });

  it('no adivina el formato americano', () => {
    // 03/31/2026 no se interpreta como marzo: con las dos convenciones en
    // juego, 04/05/2026 son dos fechas y adivinar mueve el gasto de mes.
    expect(fechaDesdeTexto('03/31/2026')).toBeNull();
  });

  it('rechaza lo que no es una fecha', () => {
    expect(fechaDesdeTexto('')).toBeNull();
    expect(fechaDesdeTexto('marzo')).toBeNull();
    expect(fechaDesdeTexto('2026/03')).toBeNull();
  });
});

describe('conceptoDesdeTexto', () => {
  it('acepta el código del enum', () => {
    expect(conceptoDesdeTexto('SAAS_SUBSCRIPTION')).toBe('SAAS_SUBSCRIPTION');
  });

  it('acepta la etiqueta que se ve en la aplicación', () => {
    // Quien rellena la plantilla copia lo que ve en el desplegable.
    expect(conceptoDesdeTexto('Suscripción SaaS')).toBe('SAAS_SUBSCRIPTION');
    expect(conceptoDesdeTexto('Material para reventa a cliente')).toBe('RESALE_GOODS');
  });

  it('no distingue acentos ni mayúsculas', () => {
    expect(conceptoDesdeTexto('suscripcion saas')).toBe('SAAS_SUBSCRIPTION');
    expect(conceptoDesdeTexto('  FORMACIÓN ')).toBe('TRAINING');
  });

  it('lo que no reconoce devuelve null, no un concepto por defecto', () => {
    // Caer en OTHER en silencio metería gasto en la categoría equivocada sin
    // que nadie se enterase.
    expect(conceptoDesdeTexto('software')).toBeNull();
    expect(conceptoDesdeTexto('')).toBeNull();
  });
});

describe('importarFacturas · una fila, una factura', () => {
  it('lee la factura entera', () => {
    const resultado = importar(
      'Amazon;FAC-1;2026-03-31;;;Portátil;Puesto de trabajo (portátiles y sobremesa);2;500,00;1000,00;210,00;EUR',
    );
    expect(resultado.errores).toEqual([]);

    const factura = unica(resultado);
    expect(factura.proveedor).toBe('Amazon');
    expect(factura.invoiceNumber).toBe('FAC-1');
    expect(factura.issueDate).toEqual({ year: 2026, month: 3, day: 31 });
    expect(factura.netCents).toBe(100_000);
    expect(factura.vatCents).toBe(21_000);
    expect(factura.grossCents).toBe(121_000);
    expect(factura.lines).toHaveLength(1);
    expect(factura.lines[0]?.concept).toBe('HARDWARE_ENDUSER');
    expect(factura.lines[0]?.costType).toBe('CAPEX');
  });

  it('sin fecha de devengo, devenga el día que se emite', () => {
    const factura = unica(
      importar('Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;'),
    );
    expect(factura.accrualDate).toEqual(factura.issueDate);
  });

  it('sin cantidad, es una', () => {
    const factura = unica(
      importar('Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;;100,00;;;'),
    );
    expect(factura.lines[0]?.quantity).toBe(1);
    expect(factura.netCents).toBe(10_000);
  });

  it('sin divisa, euros', () => {
    expect(
      unica(importar('Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;'))
        .currency,
    ).toBe('EUR');
  });

  it('sin IVA, cero, y el bruto es el neto', () => {
    const factura = unica(
      importar('Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;'),
    );
    expect(factura.vatCents).toBe(0);
    expect(factura.grossCents).toBe(factura.netCents);
  });

  it('el importe de línea se calcula si no viene', () => {
    const factura = unica(
      importar('Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;3;33,33;;;'),
    );
    expect(factura.lines[0]?.netCents).toBe(9999);
  });

  it('si el importe viene y no cuadra, se dice y no entra', () => {
    // Un descuadre entre lo que pone el ERP y lo que sale de multiplicar suele
    // ser un decimal o un signo mal puestos, y hay que verlo antes de importar.
    const resultado = importar(
      'Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;2;100,00;150,00;;',
    );
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores[0]?.columna).toBe('importe_linea');
    expect(resultado.errores[0]?.fila).toBe(2);
  });
});

describe('importarFacturas · varias filas, una factura', () => {
  const dosLineas = [
    'Dell;F-100;2026-01-15;;2026-02-15;Servidor;Servidores;1;3000,00;;840,00;EUR',
    'Dell;F-100;2026-01-15;;2026-02-15;Discos;Almacenamiento;4;250,00;;840,00;EUR',
  ] as const;

  it('agrupa por proveedor y número, y suma el neto', () => {
    const factura = unica(importar(...dosLineas));
    expect(factura.lines).toHaveLength(2);
    expect(factura.netCents).toBe(400_000);
    expect(factura.vatCents).toBe(84_000);
    expect(factura.grossCents).toBe(484_000);
  });

  it('numera las líneas en el orden del fichero', () => {
    const factura = unica(importar(...dosLineas));
    expect(factura.lines.map((linea) => linea.lineNumber)).toEqual([1, 2]);
    expect(factura.lines.map((linea) => linea.description)).toEqual(['Servidor', 'Discos']);
  });

  it('recuerda de qué filas del fichero sale', () => {
    expect(unica(importar(...dosLineas)).filas).toEqual([2, 3]);
  });

  it('el IVA se cuenta una vez, no una por línea', () => {
    // Repetir el IVA en cada fila es lo natural al exportar un mayor. Sumarlo
    // dos veces doblaría el impuesto de todas las facturas de varias partidas.
    expect(unica(importar(...dosLineas)).vatCents).toBe(84_000);
  });

  it('dos filas de la misma factura con fechas distintas no entran', () => {
    const resultado = importar(
      'Dell;F-100;2026-01-15;;;Servidor;Servidores;1;3000,00;;;',
      'Dell;F-100;2026-01-16;;;Discos;Almacenamiento;1;1000,00;;;',
    );
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores[0]?.fila).toBe(3);
    expect(resultado.errores[0]?.columna).toBe('fecha_emision');
  });

  it('dos filas de la misma factura con IVA distinto no entran', () => {
    const resultado = importar(
      'Dell;F-100;2026-01-15;;;Servidor;Servidores;1;3000,00;;630,00;',
      'Dell;F-100;2026-01-15;;;Discos;Almacenamiento;1;1000,00;;210,00;',
    );
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores[0]?.columna).toBe('iva');
  });

  it('el mismo número en proveedores distintos son dos facturas', () => {
    // Los números de factura los pone cada proveedor: que Dell y Amazon usen
    // el 1 es normal, y fundirlas sería inventar una factura que no existe.
    const resultado = importar(
      'Dell;1;2026-01-15;;;Servidor;Servidores;1;3000,00;;;',
      'Amazon;1;2026-01-15;;;Cables;Consumibles y material fungible;1;50,00;;;',
    );
    expect(resultado.errores).toEqual([]);
    expect(resultado.facturas).toHaveLength(2);
  });
});

describe('importarFacturas · lo que rechaza', () => {
  it('sin las columnas obligatorias no lee ni una fila, y dice cuáles faltan', () => {
    const resultado = importarFacturas(parsearCsv('proveedor;numero_factura\nAmazon;1'));
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]?.mensaje).toContain('fecha_emision');
    expect(resultado.errores[0]?.mensaje).toContain('concepto');
  });

  it('un fichero sin filas de datos lo dice', () => {
    expect(importarFacturas(parsearCsv(CABECERA)).errores[0]?.mensaje).toContain('ninguna fila');
  });

  it('señala la fila y la columna de cada problema', () => {
    const resultado = importar(
      'Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;',
      ';FAC-2;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;',
      'Amazon;FAC-3;no es fecha;;;Algo;Consumibles y material fungible;1;100,00;;;',
    );
    expect(resultado.errores).toHaveLength(2);
    expect(resultado.errores[0]).toMatchObject({ fila: 3, columna: 'proveedor' });
    expect(resultado.errores[1]).toMatchObject({ fila: 4, columna: 'fecha_emision' });
  });

  it('los errores salen ordenados por fila, como se lee el Excel', () => {
    const resultado = importar(
      'Amazon;FAC-1;2026-03-31;;;Algo;Concepto inventado;1;100,00;;;',
      'Amazon;FAC-2;no es fecha;;;Algo;Consumibles y material fungible;1;100,00;;;',
    );
    expect(resultado.errores.map((error) => error.fila)).toEqual([2, 3]);
  });

  it('un concepto que no existe se rechaza y se dice cuál era', () => {
    const resultado = importar('Amazon;FAC-1;2026-03-31;;;Algo;Software;1;100,00;;;');
    expect(resultado.errores[0]?.columna).toBe('concepto');
    expect(resultado.errores[0]?.mensaje).toContain('Software');
  });

  it('una fila con error no arrastra a las demás facturas', () => {
    // Cada fila se juzga sola. Lo que decide si se importa o no es la pantalla,
    // que no importa nada mientras quede un solo error.
    const resultado = importar(
      'Amazon;FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;',
      'Amazon;FAC-2;no es fecha;;;Algo;Consumibles y material fungible;1;100,00;;;',
    );
    expect(resultado.facturas).toHaveLength(1);
    expect(resultado.errores).toHaveLength(1);
  });

  it('una descripción más larga de lo que acepta el alta manual se rechaza', () => {
    // La importación es la otra puerta de entrada de texto. Sin este tope, un
    // fichero puede dejar en la base algo que la aplicación no habría aceptado
    // tecleado, y que después hay que pintar en pantallas y en informes.
    const larga = 'x'.repeat(501);
    const resultado = importar(
      `Amazon;FAC-1;2026-03-31;;;${larga};Consumibles y material fungible;1;100,00;;;`,
    );
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores[0]).toMatchObject({ fila: 2, columna: 'descripcion' });
  });

  it('justo en el límite todavía entra', () => {
    const justa = 'x'.repeat(500);
    const resultado = importar(
      `Amazon;FAC-1;2026-03-31;;;${justa};Consumibles y material fungible;1;100,00;;;`,
    );
    expect(resultado.errores).toEqual([]);
  });

  it('un número de factura desmesurado se rechaza', () => {
    const resultado = importar(
      `Amazon;${'9'.repeat(101)};2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;`,
    );
    expect(resultado.errores[0]).toMatchObject({ fila: 2, columna: 'numero_factura' });
  });

  it('un proveedor desmesurado se rechaza', () => {
    const resultado = importar(
      `${'A'.repeat(201)};FAC-1;2026-03-31;;;Algo;Consumibles y material fungible;1;100,00;;;`,
    );
    expect(resultado.errores[0]).toMatchObject({ fila: 2, columna: 'proveedor' });
  });

  it('una factura con más líneas de las que caben se rechaza entera', () => {
    // Pasa de verdad cuando el fichero trae el mismo número de factura en filas
    // que son de facturas distintas: se agruparían todas en una.
    const filas = Array.from(
      { length: 501 },
      (_, i) => `Dell;F-1;2026-01-15;;;Linea ${i};Servidores;1;10,00;;;`,
    );
    const resultado = importar(...filas);
    expect(resultado.facturas).toEqual([]);
    expect(resultado.errores[0]?.mensaje).toContain('501 líneas');
  });

  it('acepta el CSV con comas si el fichero es coherente', () => {
    const conComas = [
      CABECERA.replaceAll(';', ','),
      'Amazon,FAC-1,2026-03-31,,,Algo,Consumibles y material fungible,1,"100.00",,,',
    ].join('\n');
    const resultado = importarFacturas(parsearCsv(conComas));
    expect(resultado.errores).toEqual([]);
    expect(unica(resultado).netCents).toBe(10_000);
  });
});
