import { describe, expect, it } from 'vitest';

import { parsearCsv } from '@/lib/csv';
import { importarFacturas } from '@/lib/importacion';
import { CABECERAS_PLANTILLA, conceptosParaAyuda, plantillaCsv } from '@/lib/plantilla';

describe('plantilla de importación', () => {
  it('la propia plantilla se importa sin un solo error', () => {
    // Es el test que importa: si la plantilla que damos no pasa por el lector,
    // estamos mandando a la gente a rellenar un fichero que no vale.
    const resultado = importarFacturas(parsearCsv(plantillaCsv()));
    expect(resultado.errores).toEqual([]);
    expect(resultado.facturas).toHaveLength(2);
  });

  it('el ejemplo enseña una factura de dos líneas sin tener que leer nada', () => {
    const facturas = importarFacturas(parsearCsv(plantillaCsv())).facturas;
    const dell = facturas.find((factura) => factura.invoiceNumber === 'F-100');
    expect(dell?.lines).toHaveLength(2);
    expect(dell?.netCents).toBe(420_000);
    // El IVA se repite en las dos filas y cuenta una sola vez.
    expect(dell?.vatCents).toBe(88_200);
  });

  it('lleva el BOM para que Excel no rompa los acentos', () => {
    expect(plantillaCsv().charCodeAt(0)).toBe(0xfeff);
    // Y aun con el BOM, la primera cabecera se lee bien.
    expect(parsearCsv(plantillaCsv()).cabeceras[0]).toBe('proveedor');
  });

  it('las cabeceras son las que el lector exige', () => {
    const tabla = parsearCsv(plantillaCsv());
    expect(tabla.cabeceras).toEqual([...CABECERAS_PLANTILLA]);
  });

  it('la lista de ayuda trae todos los conceptos con su etiqueta', () => {
    const conceptos = conceptosParaAyuda();
    expect(conceptos.length).toBeGreaterThan(20);
    expect(conceptos.some((c) => c.codigo === 'RESALE_GOODS')).toBe(true);
    for (const concepto of conceptos) expect(concepto.etiqueta.length).toBeGreaterThan(0);
  });
});
