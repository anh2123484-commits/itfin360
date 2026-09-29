import { describe, expect, it } from 'vitest';

import { generarDemo, MARCA, MESES_DE_HISTORIA, PREFIJOS, tamanoDemo } from '@/lib/demo';

/**
 * Lo que se comprueba aquí es que el conjunto de demostración es coherente:
 * los importes cuadran, los pesos suman uno, nada se pisa y todo lleva la marca
 * que permite borrarlo. Un conjunto de prueba con cifras que no cuadran haría
 * que las pantallas mintieran, y entonces no sirve para probarlas.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTRO_TENANT = '22222222-2222-4222-8222-222222222222';
const HOY = new Date('2026-09-29T00:00:00.000Z');

const datos = generarDemo(TENANT, HOY);

describe('reproducibilidad', () => {
  it('la misma organización produce siempre el mismo conjunto', () => {
    const otra = generarDemo(TENANT, HOY);
    expect(otra.facturas.map((f) => f.id)).toEqual(datos.facturas.map((f) => f.id));
    expect(otra.facturas.map((f) => f.netCents)).toEqual(datos.facturas.map((f) => f.netCents));
  });

  it('organizaciones distintas no comparten un solo identificador', () => {
    // Los identificadores son únicos en toda la base: dos organizaciones que
    // sembraran los mismos chocarían en la clave primaria.
    const otros = generarDemo(OTRO_TENANT, HOY);
    const mios = new Set(datos.facturas.map((f) => f.id));
    expect(otros.facturas.some((f) => mios.has(f.id))).toBe(false);
  });

  it('no hay identificadores repetidos dentro del conjunto', () => {
    const todos = [
      ...datos.puestos.map((f) => f.id),
      ...datos.empleados.map((f) => f.id),
      ...datos.proveedores.map((f) => f.id),
      ...datos.facturas.map((f) => f.id),
      ...datos.lineas.map((f) => f.id),
      ...datos.contratos.map((f) => f.id),
      ...datos.activos.map((f) => f.id),
      ...datos.proyectos.map((f) => f.id),
      ...datos.baselines.map((f) => f.id),
      ...datos.hitos.map((f) => f.id),
      ...datos.imputaciones.map((f) => f.id),
    ];
    expect(new Set(todos).size).toBe(todos.length);
  });
});

describe('marca de borrado', () => {
  it('cada tabla lleva su marca en un campo filtrable', () => {
    // Si algo se sembrara sin marca, el borrado lo dejaría dentro para siempre.
    expect(datos.puestos.every((f) => f.name.startsWith(PREFIJOS.nombre))).toBe(true);
    expect(datos.proveedores.every((f) => f.name.startsWith(PREFIJOS.nombre))).toBe(true);
    expect(datos.contratos.every((f) => f.name.startsWith(PREFIJOS.nombre))).toBe(true);
    expect(datos.activos.every((f) => f.serialNumber.startsWith(PREFIJOS.serie))).toBe(true);
    expect(datos.facturas.every((f) => f.invoiceNumber.startsWith(PREFIJOS.factura))).toBe(true);
    expect(datos.empleados.every((f) => f.employeeCode.startsWith(PREFIJOS.empleado))).toBe(true);
    expect(datos.proyectos.every((f) => f.code.startsWith(PREFIJOS.proyecto))).toBe(true);
    expect(datos.imputaciones.every((f) => f.externalKey.startsWith(PREFIJOS.imputacion))).toBe(
      true,
    );
  });

  it('la marca es la misma en todas partes', () => {
    expect(PREFIJOS.nombre.startsWith(MARCA)).toBe(true);
    expect(PREFIJOS.factura.startsWith(MARCA)).toBe(true);
  });
});

describe('proveedores', () => {
  it('ninguno es una empresa que exista', () => {
    // Una factura ficticia a nombre de alguien real es un documento falso,
    // aunque esté en una base de datos de pruebas.
    const reales = ['microsoft', 'telefónica', 'telefonica', 'amazon', 'google', 'dell', 'aws'];
    for (const proveedor of datos.proveedores) {
      const nombre = proveedor.name.toLowerCase();
      expect(
        reales.some((real) => nombre.includes(real)),
        proveedor.name,
      ).toBe(false);
    }
  });
});

describe('facturas', () => {
  it('el neto de la factura es la suma de sus líneas', () => {
    const porFactura = new Map<string, number>();
    for (const linea of datos.lineas) {
      porFactura.set(linea.invoiceId, (porFactura.get(linea.invoiceId) ?? 0) + linea.netCents);
    }
    for (const factura of datos.facturas) {
      expect(porFactura.get(factura.id), factura.invoiceNumber).toBe(factura.netCents);
    }
  });

  it('el total es el neto más el IVA', () => {
    for (const factura of datos.facturas) {
      expect(factura.grossCents).toBe(factura.netCents + factura.vatCents);
    }
  });

  it('las líneas de una factura se numeran desde uno y sin saltos', () => {
    const porFactura = new Map<string, number[]>();
    for (const linea of datos.lineas) {
      porFactura.set(linea.invoiceId, [
        ...(porFactura.get(linea.invoiceId) ?? []),
        linea.lineNumber,
      ]);
    }
    for (const numeros of porFactura.values()) {
      const ordenados = [...numeros].sort((a, b) => a - b);
      expect(ordenados).toEqual(ordenados.map((_, i) => i + 1));
    }
  });

  it('el tipo de coste de cada línea es el que le corresponde a su concepto', () => {
    // Si no coincidiera, la validación de conceptos rechazaría los propios datos
    // de demostración, que es la peor forma de descubrir que el conjunto está mal.
    const capex = datos.lineas.filter((l) => l.concept === 'HARDWARE_SERVER');
    expect(capex.every((l) => l.costType === 'CAPEX')).toBe(true);
    const reventa = datos.lineas.filter((l) => l.concept === 'RESALE_GOODS');
    expect(reventa.every((l) => l.costType === 'COGS')).toBe(true);
  });

  it('hay historia suficiente para comparar meses', () => {
    const meses = new Set(datos.facturas.map((f) => f.accrualDate.toISOString().slice(0, 7)));
    expect(meses.size).toBe(MESES_DE_HISTORIA);
  });

  it('el número de factura no se repite', () => {
    const numeros = datos.facturas.map((f) => f.invoiceNumber);
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});

describe('contratos', () => {
  it('hay uno con desperdicio de licencias y uno con subida de precio', () => {
    expect(datos.contratos.some((c) => (c.licensedSeats ?? 0) > (c.activeSeats ?? 0))).toBe(true);
    expect(datos.contratos.some((c) => c.previousAmountCents !== null)).toBe(true);
  });

  it('hay uno cancelado, para comprobar que no genera avisos', () => {
    expect(datos.contratos.some((c) => c.status === 'CANCELLED')).toBe(true);
  });
});

describe('activos', () => {
  it('hay activos pasados de vida útil', () => {
    const viejos = datos.activos.filter((a) => {
      const meses =
        (HOY.getUTCFullYear() - a.inServiceDate.getUTCFullYear()) * 12 +
        (HOY.getUTCMonth() - a.inServiceDate.getUTCMonth());
      return meses > a.usefulLifeMonths;
    });
    expect(viejos.length).toBeGreaterThan(0);
  });

  it('el número de serie no se repite', () => {
    const series = datos.activos.map((a) => a.serialNumber);
    expect(new Set(series).size).toBe(series.length);
  });
});

describe('proyectos', () => {
  it('los pesos de los hitos de cada proyecto suman el proyecto entero', () => {
    const porProyecto = new Map<string, number>();
    for (const hito of datos.hitos) {
      porProyecto.set(hito.projectId, (porProyecto.get(hito.projectId) ?? 0) + hito.weightBp);
    }
    for (const proyecto of datos.proyectos) {
      expect(porProyecto.get(proyecto.id), proyecto.code).toBe(10_000);
    }
  });

  it('cada proyecto tiene una sola baseline vigente', () => {
    for (const proyecto of datos.proyectos) {
      const vigentes = datos.baselines.filter((b) => b.projectId === proyecto.id && b.isCurrent);
      expect(vigentes.length, proyecto.code).toBe(1);
    }
  });

  it('hay un proyecto re-baselinado que conserva la versión anterior', () => {
    const conDos = datos.proyectos.filter(
      (p) => datos.baselines.filter((b) => b.projectId === p.id).length > 1,
    );
    expect(conDos.length).toBeGreaterThan(0);
    const anteriores = datos.baselines.filter((b) => !b.isCurrent);
    expect(anteriores.every((b) => b.version === 1)).toBe(true);
  });

  it('la baseline nunca acaba antes de empezar', () => {
    for (const baseline of datos.baselines) {
      expect(baseline.endDate.getTime()).toBeGreaterThanOrEqual(baseline.startDate.getTime());
    }
  });

  it('sólo los hitos terminados llevan fecha real', () => {
    for (const hito of datos.hitos) {
      if (hito.status === 'COMPLETED') expect(hito.actualDate).not.toBe(null);
      else expect(hito.actualDate).toBe(null);
    }
  });
});

describe('imputaciones', () => {
  it('ninguna se sale del día', () => {
    for (const imputacion of datos.imputaciones) {
      expect(imputacion.startMinute + imputacion.minutes).toBeLessThanOrEqual(1_440);
      expect(imputacion.minutes).toBeGreaterThan(0);
    }
  });

  it('nadie se pisa consigo mismo el mismo día', () => {
    // Es la regla que la propia aplicación impone al guardar: si los datos de
    // demostración la incumplieran, no se podrían volver a introducir a mano.
    const porPersonaYDia = new Map<string, { inicio: number; fin: number }[]>();
    for (const i of datos.imputaciones) {
      const clave = `${i.employeeId}|${i.entryDate.toISOString().slice(0, 10)}`;
      const tramos = porPersonaYDia.get(clave) ?? [];
      for (const tramo of tramos) {
        const solapa = i.startMinute < tramo.fin && tramo.inicio < i.startMinute + i.minutes;
        expect(solapa, clave).toBe(false);
      }
      tramos.push({ inicio: i.startMinute, fin: i.startMinute + i.minutes });
      porPersonaYDia.set(clave, tramos);
    }
  });

  it('nadie imputa después de su baja', () => {
    const bajas = new Map(datos.empleados.map((e) => [e.id, e.terminationDate]));
    for (const i of datos.imputaciones) {
      const baja = bajas.get(i.employeeId) ?? null;
      if (baja !== null) expect(i.entryDate.getTime()).toBeLessThanOrEqual(baja.getTime());
    }
  });

  it('hay explotación y hay proyecto, que es de donde sale el ratio run/change', () => {
    expect(datos.imputaciones.some((i) => i.activity === 'RUN')).toBe(true);
    expect(datos.imputaciones.some((i) => i.activity === 'CHANGE')).toBe(true);
    expect(datos.imputaciones.some((i) => i.activity === 'ABSENCE')).toBe(true);
  });

  it('las horas de proyecto cuelgan de un proyecto de verdad', () => {
    const ids = new Set(datos.proyectos.map((p) => p.id));
    for (const i of datos.imputaciones) {
      if (i.projectId !== null) expect(ids.has(i.projectId)).toBe(true);
    }
  });

  it('la clave externa no se repite, para que reimportar no duplique', () => {
    const claves = datos.imputaciones.map((i) => i.externalKey);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('tamaño', () => {
  it('el conjunto cabe en una siembra de unos pocos segundos', () => {
    // El tope no es estético: esto se escribe desde una acción de servidor con
    // un tiempo máximo, y un conjunto que no quepa deja la siembra a medias.
    const total = tamanoDemo(datos);
    expect(total).toBeGreaterThan(300);
    expect(total).toBeLessThan(1_500);
  });
});
