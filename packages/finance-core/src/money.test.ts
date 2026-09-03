import { describe, expect, it } from 'vitest';

import {
  addCents,
  allocateByLargestRemainder,
  cents,
  convert,
  currencyCode,
  money,
  multiplyCents,
  roundHalfUp,
  subtractCents,
  ZERO_CENTS,
} from './money.js';

const EUR = currencyCode('EUR');
const USD = currencyCode('USD');

describe('cents', () => {
  it('acepta un entero', () => {
    expect(cents(1234)).toBe(1234);
    expect(ZERO_CENTS).toBe(0);
  });

  it('rechaza un decimal', () => {
    expect(() => cents(12.5)).toThrow(/entero/);
  });

  it('rechaza un entero fuera del rango seguro', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 2)).toThrow(/rango/);
  });
});

describe('roundHalfUp', () => {
  it('sube en la mitad exacta', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it('no sube por debajo de la mitad', () => {
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(0.49999999999999994)).toBe(0);
  });

  it('es simétrico respecto al cero', () => {
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(-2.4)).toBe(-2);
  });

  it('deja los enteros como están', () => {
    expect(roundHalfUp(7)).toBe(7);
    expect(roundHalfUp(-7)).toBe(-7);
  });

  it('rechaza un valor no finito', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(/no finito/);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(/no finito/);
  });
});

describe('aritmética', () => {
  it('suma y resta', () => {
    expect(addCents(cents(100), cents(23), cents(-3))).toBe(120);
    expect(addCents()).toBe(0);
    expect(subtractCents(cents(1000), cents(1))).toBe(999);
  });

  it('multiplica redondeando una sola vez', () => {
    expect(multiplyCents(cents(4200000), 0.32)).toBe(1344000);
    expect(multiplyCents(cents(101), 0.5)).toBe(51);
  });

  it('rechaza un factor no finito', () => {
    expect(() => multiplyCents(cents(100), Number.NaN)).toThrow(/Factor/);
  });
});

describe('divisa', () => {
  it('valida el código ISO', () => {
    expect(currencyCode('EUR')).toBe('EUR');
    expect(() => currencyCode('eur')).toThrow(/divisa/);
    expect(() => currencyCode('EURO')).toThrow(/divisa/);
  });

  it('convierte con el tipo persistido', () => {
    const importe = money(cents(100000), USD);
    const convertido = convert(importe, { from: USD, to: EUR, rate: 0.9231, asOf: '2026-08-31' });

    expect(convertido).toEqual({ cents: 92310, currency: EUR });
  });

  it('rechaza convertir desde otra divisa', () => {
    expect(() =>
      convert(money(cents(100), EUR), { from: USD, to: EUR, rate: 1, asOf: '2026-08-31' }),
    ).toThrow(/está en EUR/);
  });

  it('rechaza un tipo no válido', () => {
    expect(() =>
      convert(money(cents(100), USD), { from: USD, to: EUR, rate: 0, asOf: '2026-08-31' }),
    ).toThrow(/Tipo de cambio/);
  });
});

describe('allocateByLargestRemainder', () => {
  it('reparte 10.001 céntimos entre 3 sin perder ninguno', () => {
    const partes = allocateByLargestRemainder(cents(10001), [1, 1, 1]);

    expect(partes).toEqual([3334, 3334, 3333]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it('respeta pesos distintos', () => {
    const partes = allocateByLargestRemainder(cents(1000), [3, 1]);

    expect(partes).toEqual([750, 250]);
  });

  it('da cero a un peso cero', () => {
    expect(allocateByLargestRemainder(cents(100), [1, 0])).toEqual([100, 0]);
  });

  it('reparte un importe negativo manteniendo el signo', () => {
    const partes = allocateByLargestRemainder(cents(-10001), [1, 1, 1]);

    expect(partes).toEqual([-3334, -3334, -3333]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(-10001);
  });

  it('reparte cero', () => {
    expect(allocateByLargestRemainder(ZERO_CENTS, [1, 2])).toEqual([0, 0]);
  });

  it('rechaza una lista vacía, un peso negativo y una suma nula', () => {
    expect(() => allocateByLargestRemainder(cents(1), [])).toThrow(/al menos un peso/);
    expect(() => allocateByLargestRemainder(cents(1), [1, -1])).toThrow(/Peso no válido/);
    expect(() => allocateByLargestRemainder(cents(1), [Number.NaN])).toThrow(/Peso no válido/);
    expect(() => allocateByLargestRemainder(cents(1), [0, 0])).toThrow(/mayor que cero/);
  });

  it('cuadra en 1.000 repartos aleatorios', () => {
    // Generador determinista: un fallo tiene que poder reproducirse.
    let seed = 20260903;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let caso = 0; caso < 1000; caso += 1) {
      const total = cents(Math.floor((random() - 0.3) * 5_000_000));
      const partesCount = 1 + Math.floor(random() * 12);
      const weights = Array.from({ length: partesCount }, () => Math.floor(random() * 1000));
      // Sin `every(w => w === 0)`: TS lo infiere como predicado de tipo y estrecha
      // `weights` a `0[]`, con lo que la asignación siguiente deja de compilar.
      if (weights.reduce((a, b) => a + b, 0) === 0) weights[0] = 1;

      const partes = allocateByLargestRemainder(total, weights);
      const suma = partes.reduce((a, b) => a + b, 0);
      const weightSum = weights.reduce((a, b) => a + b, 0);

      expect(suma).toBe(total);
      expect(partes).toHaveLength(partesCount);
      partes.forEach((parte, index) => {
        // Ninguna parte se aleja más de un céntimo de su proporción exacta.
        const exacta = (Math.abs(total) * (weights[index] ?? 0)) / weightSum;
        expect(Math.abs(Math.abs(parte) - exacta)).toBeLessThan(1);
        expect(Number.isInteger(parte)).toBe(true);
      });
    }
  });
});
