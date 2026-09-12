import { describe, expect, it } from 'vitest';

import {
  diasDelMes,
  esMesValido,
  mesAnterior,
  mesDe,
  mismoMesAnoAnterior,
  nombreMes,
  parsearMes,
  periodoDelMes,
  textoMes,
} from '@/lib/periodos';

describe('diasDelMes', () => {
  it('sabe los meses de 30 y 31', () => {
    expect(diasDelMes({ anio: 2026, mes: 1 })).toBe(31);
    expect(diasDelMes({ anio: 2026, mes: 4 })).toBe(30);
    expect(diasDelMes({ anio: 2026, mes: 12 })).toBe(31);
  });

  it('sabe los febreros', () => {
    expect(diasDelMes({ anio: 2026, mes: 2 })).toBe(28);
    expect(diasDelMes({ anio: 2024, mes: 2 })).toBe(29);
  });

  it('aplica la regla del siglo, no sólo la de los cuatro años', () => {
    // 1900 no fue bisiesto y 2000 sí. Es el mismo despiste que arrastra Excel.
    expect(diasDelMes({ anio: 1900, mes: 2 })).toBe(28);
    expect(diasDelMes({ anio: 2000, mes: 2 })).toBe(29);
  });
});

describe('periodoDelMes', () => {
  it('va del día uno al último, ambos incluidos', () => {
    expect(periodoDelMes({ anio: 2026, mes: 3 })).toEqual({
      desde: { year: 2026, month: 3, day: 1 },
      hasta: { year: 2026, month: 3, day: 31 },
    });
  });

  it('el último día de febrero es el que toca', () => {
    expect(periodoDelMes({ anio: 2024, mes: 2 }).hasta.day).toBe(29);
  });
});

describe('mesAnterior', () => {
  it('resta uno', () => {
    expect(mesAnterior({ anio: 2026, mes: 3 })).toEqual({ anio: 2026, mes: 2 });
  });

  it('cruza el año', () => {
    expect(mesAnterior({ anio: 2026, mes: 1 })).toEqual({ anio: 2025, mes: 12 });
  });
});

describe('mismoMesAnoAnterior', () => {
  it('retrocede un año dejando el mes', () => {
    expect(mismoMesAnoAnterior({ anio: 2026, mes: 3 })).toEqual({ anio: 2025, mes: 3 });
  });
});

describe('parsearMes', () => {
  it('lee lo que viaja en la URL', () => {
    expect(parsearMes('2026-03')).toEqual({ anio: 2026, mes: 3 });
    expect(parsearMes(' 2026-3 ')).toEqual({ anio: 2026, mes: 3 });
  });

  it('devuelve null en vez de inventarse un mes', () => {
    // Lo de la URL lo escribe cualquiera. Corrigiendo el 13 a diciembre, la
    // pantalla enseñaría el gasto de otro mes sin decirlo.
    expect(parsearMes('2026-13')).toBeNull();
    expect(parsearMes('2026-00')).toBeNull();
    expect(parsearMes('marzo')).toBeNull();
    expect(parsearMes('')).toBeNull();
  });
});

describe('textoMes y nombreMes', () => {
  it('el texto de la URL lleva el mes con dos cifras', () => {
    expect(textoMes({ anio: 2026, mes: 3 })).toBe('2026-03');
  });

  it('parsear y volver a escribir da lo mismo', () => {
    expect(textoMes(parsearMes('2026-03') ?? { anio: 0, mes: 0 })).toBe('2026-03');
  });

  it('el nombre se lee en castellano', () => {
    expect(nombreMes({ anio: 2026, mes: 3 })).toBe('marzo de 2026');
    expect(nombreMes({ anio: 2025, mes: 12 })).toBe('diciembre de 2025');
  });
});

describe('esMesValido', () => {
  it('acepta los doce meses y rechaza el resto', () => {
    expect(esMesValido({ anio: 2026, mes: 1 })).toBe(true);
    expect(esMesValido({ anio: 2026, mes: 12 })).toBe(true);
    expect(esMesValido({ anio: 2026, mes: 0 })).toBe(false);
    expect(esMesValido({ anio: 2026, mes: 13 })).toBe(false);
    expect(esMesValido({ anio: 2026, mes: 1.5 })).toBe(false);
  });
});

describe('mesDe', () => {
  it('lee el instante en UTC', () => {
    // La fecha se guarda a medianoche UTC. Leída en hora local al este de
    // Greenwich, el último día del mes caería en el mes siguiente.
    expect(mesDe(new Date('2026-03-31T00:00:00Z'))).toEqual({ anio: 2026, mes: 3 });
    expect(mesDe(new Date('2026-01-01T00:00:00Z'))).toEqual({ anio: 2026, mes: 1 });
  });
});
