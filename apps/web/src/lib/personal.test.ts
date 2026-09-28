import { describe, expect, it } from 'vitest';

import {
  activoEn,
  diasActivosEn,
  diasDelAnio,
  type EmpleadoParaCalcular,
  fteEfectivo,
  proporcionDelAnio,
  resumenPlantilla,
} from '@/lib/personal';

/**
 * El criterio de aceptación de F4-01 es uno y está aquí: quien causa baja a
 * mitad de año tiene que prorratear bien en los cálculos anuales.
 */

const BASE: EmpleadoParaCalcular = {
  id: 'e1',
  fteBp: 10_000,
  hireDate: new Date(Date.UTC(2020, 0, 1)),
  terminationDate: null,
};

const empleado = (cambios: Partial<EmpleadoParaCalcular>): EmpleadoParaCalcular => ({
  ...BASE,
  ...cambios,
});

describe('diasDelAnio', () => {
  it('cuenta el bisiesto', () => {
    expect(diasDelAnio(2026)).toBe(365);
    expect(diasDelAnio(2028)).toBe(366);
  });
});

describe('diasActivosEn', () => {
  it('un año entero son todos los días del año', () => {
    expect(diasActivosEn(BASE, 2026)).toBe(365);
  });

  it('los dos extremos cuentan', () => {
    // Quien entra el 1 de enero y se va el 31 de diciembre ha estado el año
    // entero, no el año menos un día.
    const anual = empleado({
      hireDate: new Date(Date.UTC(2026, 0, 1)),
      terminationDate: new Date(Date.UTC(2026, 11, 31)),
    });
    expect(diasActivosEn(anual, 2026)).toBe(365);
  });

  it('entrar y salir el mismo día es un día, no cero', () => {
    // Ese día se le paga.
    const fugaz = empleado({
      hireDate: new Date(Date.UTC(2026, 5, 15)),
      terminationDate: new Date(Date.UTC(2026, 5, 15)),
    });
    expect(diasActivosEn(fugaz, 2026)).toBe(1);
  });

  it('antes de entrar no cuenta nada', () => {
    const futuro = empleado({ hireDate: new Date(Date.UTC(2027, 2, 1)) });
    expect(diasActivosEn(futuro, 2026)).toBe(0);
    expect(activoEn(futuro, 2026)).toBe(false);
  });

  it('después de irse tampoco', () => {
    const antiguo = empleado({ terminationDate: new Date(Date.UTC(2025, 11, 31)) });
    expect(diasActivosEn(antiguo, 2026)).toBe(0);
  });
});

describe('proporcionDelAnio', () => {
  it('quien causa baja el 30 de junio cuenta media', () => {
    // El criterio de aceptación, literal. Del 1 de enero al 30 de junio de 2026
    // son 181 días de 365.
    const baja = empleado({ terminationDate: new Date(Date.UTC(2026, 5, 30)) });
    expect(diasActivosEn(baja, 2026)).toBe(181);
    expect(proporcionDelAnio(baja, 2026)).toBeCloseTo(181 / 365, 10);
  });

  it('quien entra el 1 de octubre cuenta un trimestre', () => {
    const alta = empleado({ hireDate: new Date(Date.UTC(2026, 9, 1)) });
    expect(diasActivosEn(alta, 2026)).toBe(92);
  });

  it('por días y no por meses', () => {
    // Irse el 2 de julio y irse el 30 de julio no cuesta lo mismo. Redondear a
    // meses es lo que hace que el coste de personal no cuadre con la nómina.
    const temprano = empleado({ terminationDate: new Date(Date.UTC(2026, 6, 2)) });
    const tarde = empleado({ terminationDate: new Date(Date.UTC(2026, 6, 30)) });
    expect(proporcionDelAnio(tarde, 2026)).toBeGreaterThan(proporcionDelAnio(temprano, 2026));
  });
});

describe('fteEfectivo', () => {
  it('la jornada parcial cuenta lo que es', () => {
    const media = empleado({ fteBp: 5_000 });
    expect(fteEfectivo(media, 2026)).toBeCloseTo(0.5, 10);
  });

  it('jornada parcial y baja a mitad de año se multiplican', () => {
    // Media jornada hasta el 30 de junio es un cuarto de año-persona, no medio.
    const media = empleado({ fteBp: 5_000, terminationDate: new Date(Date.UTC(2026, 5, 30)) });
    expect(fteEfectivo(media, 2026)).toBeCloseTo(0.5 * (181 / 365), 10);
  });

  it('una jornada del 37,5 % no se va en decimales', () => {
    const parcial = empleado({ fteBp: 3_750 });
    expect(fteEfectivo(parcial, 2026)).toBeCloseTo(0.375, 10);
  });
});

describe('resumenPlantilla', () => {
  const anio = 2026;

  it('distingue la gente que ha pasado de la que se paga', () => {
    // Dieciocho personas distintas a lo largo del año con doce jornadas
    // efectivas no cuestan lo que dieciocho, pero tampoco se gestionan como doce.
    const plantilla = [
      empleado({ id: 'a' }),
      empleado({ id: 'b' }),
      empleado({ id: 'c', terminationDate: new Date(Date.UTC(anio, 5, 30)) }),
      empleado({ id: 'd', hireDate: new Date(Date.UTC(anio, 6, 1)) }),
    ];
    const resumen = resumenPlantilla(plantilla, anio);

    expect(resumen.personas).toBe(4);
    expect(resumen.personasAlCierre).toBe(3);
    expect(resumen.fteEfectivo).toBeCloseTo(2 + 181 / 365 + 184 / 365, 10);
  });

  it('quien ya se fue el año anterior no aparece', () => {
    const plantilla = [
      empleado({ id: 'viejo', terminationDate: new Date(Date.UTC(2024, 11, 31)) }),
      empleado({ id: 'actual' }),
    ];
    expect(resumenPlantilla(plantilla, anio).personas).toBe(1);
  });

  it('el FTE contratado mira sólo a quien sigue', () => {
    const plantilla = [
      empleado({ id: 'sigue', fteBp: 10_000 }),
      empleado({
        id: 'se-fue',
        fteBp: 10_000,
        terminationDate: new Date(Date.UTC(anio, 2, 31)),
      }),
    ];
    const resumen = resumenPlantilla(plantilla, anio);
    expect(resumen.fteContratado).toBeCloseTo(1, 10);
    expect(resumen.fteEfectivo).toBeGreaterThan(1);
  });

  it('una plantilla vacía no revienta', () => {
    const resumen = resumenPlantilla([], anio);
    expect(resumen.personas).toBe(0);
    expect(resumen.fteEfectivo).toBe(0);
  });
});
