import { describe, expect, it } from 'vitest';

import {
  formatearDuracion,
  formatearHora,
  type ImputacionParaValidar,
  jornadaDiaria,
  resumenHoras,
  solapan,
  validarImputacion,
} from '@/lib/horas';

/**
 * Los dos criterios de aceptación de F4-04 están aquí: no se imputan más horas
 * de las disponibles sin marcarlo como extra, y el solape se detecta cuando se
 * puede detectar.
 */

const BASE: ImputacionParaValidar = {
  minutes: 60,
  startMinute: null,
  isOvertime: false,
  activity: 'RUN',
};

const imp = (cambios: Partial<ImputacionParaValidar>): ImputacionParaValidar => ({
  ...BASE,
  ...cambios,
});

describe('jornadaDiaria', () => {
  it('jornada completa son ocho horas', () => {
    expect(jornadaDiaria(10_000)).toBe(480);
  });

  it('la parcial escala', () => {
    expect(jornadaDiaria(5_000)).toBe(240);
    expect(jornadaDiaria(3_750)).toBe(180);
  });
});

describe('solapan', () => {
  it('dos tramos que se pisan', () => {
    const a = imp({ startMinute: 540, minutes: 120 });
    const b = imp({ startMinute: 600, minutes: 60 });
    expect(solapan(a, b)).toBe(true);
    expect(solapan(b, a)).toBe(true);
  });

  it('pegados no se pisan', () => {
    // De nueve a once y de once a doce es un día normal, no un error.
    const a = imp({ startMinute: 540, minutes: 120 });
    const b = imp({ startMinute: 660, minutes: 60 });
    expect(solapan(a, b)).toBe(false);
  });

  it('uno dentro de otro sí se pisa', () => {
    const a = imp({ startMinute: 540, minutes: 240 });
    const b = imp({ startMinute: 600, minutes: 30 });
    expect(solapan(a, b)).toBe(true);
  });

  it('sin hora de inicio no se inventa un solape', () => {
    // Hay equipos que apuntan «tres horas al proyecto X» sin decir cuáles.
    // Rechazar eso por un solape imaginario haría que nadie rellenara el parte.
    const a = imp({ startMinute: 540, minutes: 120 });
    const b = imp({ startMinute: null, minutes: 120 });
    expect(solapan(a, b)).toBe(false);
  });
});

describe('validarImputacion', () => {
  it('un día normal pasa', () => {
    const existentes = [imp({ minutes: 240 })];
    expect(validarImputacion(imp({ minutes: 180 }), existentes, 10_000)).toBe(null);
  });

  it('justo la jornada pasa', () => {
    const existentes = [imp({ minutes: 240 })];
    expect(validarImputacion(imp({ minutes: 240 }), existentes, 10_000)).toBe(null);
  });

  it('pasarse de jornada sin marcarlo se rechaza', () => {
    // El criterio de aceptación, literal.
    const existentes = [imp({ minutes: 480 })];
    const rechazo = validarImputacion(imp({ minutes: 60 }), existentes, 10_000);
    expect(rechazo?.motivo).toBe('excede_jornada');
    expect(rechazo?.totalMinutos).toBe(540);
    expect(rechazo?.disponibles).toBe(480);
  });

  it('pasarse de jornada marcándolo como extra sí pasa', () => {
    // Las horas extra existen. Un sistema que las rechaza consigue que se
    // apunten repartidas por otros días, y entonces ya no se pueden contar.
    const existentes = [imp({ minutes: 480 })];
    expect(validarImputacion(imp({ minutes: 60, isOvertime: true }), existentes, 10_000)).toBe(
      null,
    );
  });

  it('media jornada tiene medio tope', () => {
    const existentes = [imp({ minutes: 180 })];
    const rechazo = validarImputacion(imp({ minutes: 120 }), existentes, 5_000);
    expect(rechazo?.motivo).toBe('excede_jornada');
    expect(rechazo?.disponibles).toBe(240);
  });

  it('una ausencia no consume jornada', () => {
    // Un día de vacaciones no son ocho horas trabajadas; sumarlo al tope haría
    // que no se pudiera imputar nada ese día.
    const existentes = [imp({ minutes: 480, activity: 'ABSENCE' })];
    expect(validarImputacion(imp({ minutes: 60 }), existentes, 10_000)).toBe(null);
  });

  it('el solape se rechaza aunque quepa en la jornada', () => {
    const existentes = [imp({ startMinute: 540, minutes: 120 })];
    const rechazo = validarImputacion(imp({ startMinute: 600, minutes: 60 }), existentes, 10_000);
    expect(rechazo?.motivo).toBe('solape');
  });

  it('el solape manda sobre el exceso de jornada', () => {
    // Si las dos cosas fallan, el mensaje útil es el del solape: arreglarlo
    // suele arreglar también el total.
    const existentes = [imp({ startMinute: 540, minutes: 480 })];
    const rechazo = validarImputacion(imp({ startMinute: 600, minutes: 120 }), existentes, 10_000);
    expect(rechazo?.motivo).toBe('solape');
  });

  it('editar una imputación no choca consigo misma', () => {
    const existentes = [{ ...imp({ startMinute: 540, minutes: 120 }), id: 'x' }];
    const editada = { ...imp({ startMinute: 540, minutes: 180 }), id: 'x' };
    expect(validarImputacion(editada, existentes, 10_000)).toBe(null);
  });

  it('un día vacío admite la primera imputación', () => {
    expect(validarImputacion(imp({ minutes: 480 }), [], 10_000)).toBe(null);
  });
});

describe('resumenHoras', () => {
  const entradas = [
    { ...imp({ minutes: 300, activity: 'RUN' }), isRework: false, isBillable: false },
    { ...imp({ minutes: 180, activity: 'CHANGE' }), isRework: true, isBillable: true },
    { ...imp({ minutes: 60, activity: 'INTERNAL' }), isRework: false, isBillable: false },
    { ...imp({ minutes: 480, activity: 'ABSENCE' }), isRework: false, isBillable: false },
  ];

  it('separa explotación, proyecto, interno y ausencia', () => {
    const r = resumenHoras(entradas, 40);
    expect(r.runMinutos).toBe(300);
    expect(r.changeMinutos).toBe(180);
    expect(r.internoMinutos).toBe(60);
    expect(r.ausenciaMinutos).toBe(480);
  });

  it('la ausencia no cuenta como tiempo imputado', () => {
    expect(resumenHoras(entradas, 40).totalMinutos).toBe(540);
  });

  it('cuenta el retrabajo y lo facturable', () => {
    const r = resumenHoras(entradas, 40);
    expect(r.retrabajoMinutos).toBe(180);
    expect(r.facturableMinutos).toBe(180);
  });

  it('el reparto run/change sale del motor', () => {
    const r = resumenHoras(entradas, 40);
    expect(r.reparto.bookedHours).toBe(8);
    expect(r.reparto.runShare).toBeCloseTo(300 / 480, 10);
    expect(r.reparto.changeShare).toBeCloseTo(180 / 480, 10);
  });

  it('las horas disponibles que no se imputan salen como no imputadas', () => {
    // Es el coste invisible: lo que se paga y no aparece en ningún sitio.
    const r = resumenHoras(entradas, 40);
    expect(r.reparto.unbookedHours).toBe(32);
  });

  it('un periodo sin imputaciones no revienta', () => {
    const r = resumenHoras([], 40);
    expect(r.totalMinutos).toBe(0);
    expect(r.reparto.runShare).toBe(null);
  });
});

describe('formato', () => {
  it('los minutos se leen como horas y minutos', () => {
    expect(formatearDuracion(450)).toBe('7 h 30 min');
    expect(formatearDuracion(480)).toBe('8 h');
    expect(formatearDuracion(45)).toBe('45 min');
  });

  it('la hora del día sale con dos cifras', () => {
    expect(formatearHora(540)).toBe('09:00');
    expect(formatearHora(0)).toBe('00:00');
    expect(formatearHora(1_439)).toBe('23:59');
    expect(formatearHora(null)).toBe('');
  });
});
