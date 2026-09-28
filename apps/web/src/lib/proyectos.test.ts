import { describe, expect, it } from 'vitest';

import {
  avancePlanificado,
  avanceReal,
  baselineVigente,
  cuadroProyecto,
  duracionEnDias,
  escribirPlanificacion,
  formatearIndice,
  formatearPorcentaje,
  type HitoParaCalcular,
  parsearPlanificacion,
  PESO_TOTAL,
  pesoRestante,
  semaforo,
  siguienteVersion,
  validarPesos,
} from '@/lib/proyectos';

/**
 * Los dos criterios de aceptación de F5-01 están aquí: la re-baseline conserva
 * la versión anterior y los pesos de los hitos tienen que sumar uno.
 */

const hito = (cambios: Partial<HitoParaCalcular> = {}): HitoParaCalcular => ({
  id: 'h',
  weightBp: 10_000,
  status: 'NOT_STARTED',
  progressBp: null,
  ...cambios,
});

const BASELINE = {
  bacCents: 100_000_00,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
};

describe('validarPesos', () => {
  it('tres tercios en puntos básicos suman el proyecto entero', () => {
    // 3334 + 3333 + 3333 = 10000 clavado. Con 0,3333 repetido, no.
    const hitos = [{ weightBp: 3_334 }, { weightBp: 3_333 }, { weightBp: 3_333 }];
    expect(validarPesos(hitos)).toBe(null);
  });

  it('un solo hito con todo el peso vale', () => {
    expect(validarPesos([{ weightBp: PESO_TOTAL }])).toBe(null);
  });

  it('pesos que no llegan a uno se rechazan', () => {
    // El criterio de aceptación, literal.
    const rechazo = validarPesos([{ weightBp: 5_000 }, { weightBp: 4_000 }]);
    expect(rechazo?.motivo).toBe('no_suman_uno');
    expect(rechazo?.suma).toBe(9_000);
  });

  it('pesos que se pasan de uno también se rechazan', () => {
    const rechazo = validarPesos([{ weightBp: 6_000 }, { weightBp: 5_000 }]);
    expect(rechazo?.motivo).toBe('no_suman_uno');
    expect(rechazo?.suma).toBe(11_000);
  });

  it('un punto básico de menos ya es un rechazo', () => {
    // No hay tolerancia a propósito: el hueco lo arregla quien planifica, no el
    // redondeo, porque un hueco tolerado se acumula proyecto a proyecto.
    expect(validarPesos([{ weightBp: 9_999 }])?.motivo).toBe('no_suman_uno');
  });

  it('sin hitos se rechaza por defecto', () => {
    expect(validarPesos([])?.motivo).toBe('sin_hitos');
  });

  it('sin hitos se acepta cuando borrar la planificación es lo que se pide', () => {
    expect(validarPesos([], true)).toBe(null);
  });
});

describe('pesoRestante', () => {
  it('dice cuánto falta para el proyecto entero', () => {
    expect(pesoRestante([{ weightBp: 4_000 }, { weightBp: 2_500 }])).toBe(3_500);
  });

  it('en negativo cuando sobra', () => {
    expect(pesoRestante([{ weightBp: 12_000 }])).toBe(-2_000);
  });
});

describe('parsearPlanificacion', () => {
  it('una planificación que cuadra entra', () => {
    const resultado = parsearPlanificacion(
      'Análisis | 20 | 2026-02-28\nDesarrollo | 50\nPuesta en marcha | 30 | 2026-11-30',
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.hitos).toHaveLength(3);
    expect(resultado.hitos[0]?.weightBp).toBe(2_000);
    expect(resultado.hitos[0]?.plannedDate).toBe('2026-02-28');
    expect(resultado.hitos[1]?.plannedDate).toBe(null);
  });

  it('los decimales del peso llegan en puntos básicos', () => {
    const resultado = parsearPlanificacion('A | 33,34\nB | 33,33\nC | 33,33');
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.hitos.map((h) => h.weightBp)).toEqual([3_334, 3_333, 3_333]);
  });

  it('una planificación que no suma uno no se guarda', () => {
    // El criterio de aceptación: o cuadra y entra, o no cuadra y no entra.
    const resultado = parsearPlanificacion('Análisis | 20\nDesarrollo | 50');
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('no_suman_uno');
    expect(resultado.suma).toBe(7_000);
  });

  it('una línea mal escrita dice cuál es', () => {
    const resultado = parsearPlanificacion('Análisis | 20\nDesarrollo | mucho\nFin | 30');
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toBe('linea');
    expect(resultado.linea).toBe(2);
  });

  it('un hito sin nombre es una línea mal escrita', () => {
    expect(parsearPlanificacion(' | 100').ok).toBe(false);
  });

  it('un peso de cero no es un hito', () => {
    expect(parsearPlanificacion('A | 0\nB | 100').ok).toBe(false);
  });

  it('una fecha que no es una fecha se rechaza', () => {
    const resultado = parsearPlanificacion('A | 100 | el martes');
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.linea).toBe(1);
  });

  it('borrar la planificación entera es válido', () => {
    // Guardar cero hitos es una acción distinta de guardar unos mal hechos.
    const resultado = parsearPlanificacion('\n   \n');
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.hitos).toHaveLength(0);
  });

  it('las líneas en blanco por el medio no estorban', () => {
    const resultado = parsearPlanificacion('A | 60\n\n  \nB | 40');
    expect(resultado.ok).toBe(true);
  });
});

describe('escribirPlanificacion', () => {
  it('vuelve al mismo texto que se puede volver a parsear', () => {
    const texto = escribirPlanificacion([
      { name: 'Análisis', weightBp: 2_000, plannedDate: new Date('2026-02-28T00:00:00.000Z') },
      { name: 'Desarrollo', weightBp: 8_000, plannedDate: null },
    ]);
    expect(texto).toBe('Análisis | 20 | 2026-02-28\nDesarrollo | 80');
    expect(parsearPlanificacion(texto).ok).toBe(true);
  });
});

describe('avanceReal', () => {
  it('sin hitos no hay avance, y eso no es cero', () => {
    // Un proyecto del que nadie ha declarado qué lleva hecho no está al 0 %:
    // está sin medir, y el comité tiene que poder distinguirlo.
    expect(avanceReal([])).toBe(null);
  });

  it('hitos terminados pesan lo suyo', () => {
    const hitos = [
      hito({ id: 'a', weightBp: 6_000, status: 'COMPLETED' }),
      hito({ id: 'b', weightBp: 4_000, status: 'NOT_STARTED' }),
    ];
    expect(avanceReal(hitos)).toBeCloseTo(0.6, 10);
  });

  it('un hito en curso sin avance declarado cuenta cero', () => {
    const hitos = [
      hito({ id: 'a', weightBp: 5_000, status: 'COMPLETED' }),
      hito({ id: 'b', weightBp: 5_000, status: 'IN_PROGRESS' }),
    ];
    expect(avanceReal(hitos)).toBeCloseTo(0.5, 10);
  });

  it('el avance declarado de un hito en curso sí cuenta', () => {
    const hitos = [
      hito({ id: 'a', weightBp: 5_000, status: 'COMPLETED' }),
      hito({ id: 'b', weightBp: 5_000, status: 'IN_PROGRESS', progressBp: 4_000 }),
    ];
    expect(avanceReal(hitos)).toBeCloseTo(0.7, 10);
  });

  it('la regla 0/50/100 ignora el avance declarado', () => {
    const hitos = [
      hito({ id: 'a', weightBp: 5_000, status: 'COMPLETED' }),
      hito({ id: 'b', weightBp: 5_000, status: 'IN_PROGRESS', progressBp: 9_000 }),
    ];
    expect(avanceReal(hitos, 'ZERO_FIFTY_HUNDRED')).toBeCloseTo(0.75, 10);
  });
});

describe('avancePlanificado', () => {
  it('antes de empezar es cero', () => {
    expect(avancePlanificado(BASELINE, new Date('2025-12-01T00:00:00.000Z'))).toBe(0);
  });

  it('pasado el fin es uno, no más de uno', () => {
    expect(avancePlanificado(BASELINE, new Date('2027-06-01T00:00:00.000Z'))).toBe(1);
  });

  it('a mitad de camino va por la mitad', () => {
    const mitad = new Date((BASELINE.startDate.getTime() + BASELINE.endDate.getTime()) / 2);
    expect(avancePlanificado(BASELINE, mitad)).toBeCloseTo(0.5, 6);
  });

  it('un proyecto de un solo día no divide entre cero', () => {
    const dia = new Date('2026-03-10T00:00:00.000Z');
    expect(avancePlanificado({ bacCents: 100, startDate: dia, endDate: dia }, dia)).toBe(0);
  });
});

describe('duracionEnDias', () => {
  it('cuenta los dos extremos', () => {
    const dia = new Date('2026-03-10T00:00:00.000Z');
    expect(duracionEnDias({ bacCents: 0, startDate: dia, endDate: dia })).toBe(1);
  });

  it('un año no bisiesto son 365 días', () => {
    expect(duracionEnDias(BASELINE)).toBe(365);
  });
});

describe('cuadroProyecto', () => {
  const mitadDeAnio = new Date('2026-07-02T00:00:00.000Z');
  const hitos = [
    hito({ id: 'a', weightBp: 5_000, status: 'COMPLETED' }),
    hito({ id: 'b', weightBp: 5_000, status: 'NOT_STARTED' }),
  ];

  it('el valor ganado sale del avance, no del gasto', () => {
    const cuadro = cuadroProyecto(BASELINE, hitos, 60_000_00, mitadDeAnio);
    expect(cuadro.avanceReal).toBeCloseTo(0.5, 10);
    expect(cuadro.evm.evCents).toBe(50_000_00);
    expect(cuadro.evm.acCents).toBe(60_000_00);
  });

  it('gastar más de lo avanzado da CPI por debajo de uno', () => {
    const cuadro = cuadroProyecto(BASELINE, hitos, 60_000_00, mitadDeAnio);
    expect(cuadro.evm.cpi).toBeCloseTo(50 / 60, 6);
    expect(cuadro.evm.cvCents).toBe(-10_000_00);
  });

  it('un proyecto sin coste imputado no rompe la vista', () => {
    const cuadro = cuadroProyecto(BASELINE, hitos, 0, mitadDeAnio);
    expect(cuadro.evm.cpi).toBe(null);
    expect(cuadro.evm.eacCents).toBe(null);
  });

  it('sin hitos el valor ganado es cero y se ve', () => {
    const cuadro = cuadroProyecto(BASELINE, [], 20_000_00, mitadDeAnio);
    expect(cuadro.avanceReal).toBe(null);
    expect(cuadro.evm.evCents).toBe(0);
    expect(cuadro.evm.cpi).toBe(0);
  });

  it('el valor planificado sigue el calendario de la baseline', () => {
    const cuadro = cuadroProyecto(BASELINE, hitos, 10_000_00, mitadDeAnio);
    expect(cuadro.evm.pvCents).toBeGreaterThan(49_000_00);
    expect(cuadro.evm.pvCents).toBeLessThan(51_000_00);
  });
});

describe('siguienteVersion', () => {
  it('el primer presupuesto es la versión uno', () => {
    expect(siguienteVersion([])).toBe(1);
  });

  it('una re-baseline no reutiliza la versión anterior', () => {
    // El criterio de aceptación: la versión anterior se conserva, la nueva va
    // detrás. Nunca se sobrescribe el número contra el que se mide.
    expect(siguienteVersion([{ version: 1 }, { version: 2 }])).toBe(3);
  });

  it('no depende del orden en que vengan', () => {
    expect(siguienteVersion([{ version: 3 }, { version: 1 }, { version: 2 }])).toBe(4);
  });
});

describe('baselineVigente', () => {
  it('devuelve la marcada como vigente, no la última escrita', () => {
    const baselines = [
      { id: 'v1', isCurrent: false },
      { id: 'v2', isCurrent: true },
      { id: 'v3', isCurrent: false },
    ];
    expect(baselineVigente(baselines)?.id).toBe('v2');
  });

  it('un proyecto sin presupuesto aprobado devuelve null', () => {
    expect(baselineVigente([])).toBe(null);
  });
});

describe('semaforo', () => {
  it('sin índice no es verde, es sin datos', () => {
    expect(semaforo(null)).toBe('sin_datos');
  });

  it('al ritmo previsto, bien', () => {
    expect(semaforo(1)).toBe('bien');
    expect(semaforo(1.2)).toBe('bien');
  });

  it('un poco por debajo, atención', () => {
    expect(semaforo(0.9)).toBe('atencion');
  });

  it('muy por debajo, mal', () => {
    expect(semaforo(0.7)).toBe('mal');
  });
});

describe('formato', () => {
  it('la proporción se lee como porcentaje', () => {
    expect(formatearPorcentaje(0.5)).toBe('50,0 %');
    expect(formatearPorcentaje(null)).toBe('—');
  });

  it('el índice se lee con dos decimales', () => {
    expect(formatearIndice(0.8333)).toBe('0,83');
    expect(formatearIndice(null)).toBe('—');
  });
});
