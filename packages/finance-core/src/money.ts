/**
 * Primitivas monetarias (F1-01).
 *
 * Regla dura 1 de `AGENTS.md`: el dinero son céntimos enteros. Ningún importe
 * viaja como decimal, y todo redondeo ocurre en un único punto explícito.
 */

/** Importe en céntimos enteros. La marca impide pasar un `number` cualquiera. */
export type Cents = number & { readonly __brand: 'Cents' };

/** Código ISO 4217 en mayúsculas. */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Construye un importe validando que sea un entero seguro. */
export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Un importe en céntimos debe ser entero: ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Importe fuera del rango de enteros seguros: ${value}`);
  }
  return value as Cents;
}

/** Cero, para no repetir el `as Cents` por todo el código. */
export const ZERO_CENTS: Cents = 0 as Cents;

/**
 * Redondeo half-up al céntimo, el único punto donde se pierde precisión.
 *
 * Es **simétrico respecto al cero**: 2,5 → 3 y −2,5 → −3. Un abono de −X tiene
 * que redondear igual que la factura de X; si no, cada rectificativa deja un
 * céntimo de descuadre en la conciliación.
 *
 * No se usa `Math.round(x + 0.5)` porque falla con los flotantes justo por
 * debajo de la mitad; se compara la parte fraccionaria directamente.
 */
export function roundHalfUp(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new RangeError(`No se puede redondear un valor no finito: ${value}`);
  }
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const rounded = absolute - whole >= 0.5 ? whole + 1 : whole;
  return cents(value < 0 ? -rounded : rounded);
}

/** Suma de importes; el resultado sigue siendo un entero seguro. */
export function addCents(...values: readonly Cents[]): Cents {
  return cents(values.reduce<number>((total, value) => total + value, 0));
}

/** Resta de importes. */
export function subtractCents(minuend: Cents, subtrahend: Cents): Cents {
  return cents(minuend - subtrahend);
}

/**
 * Multiplica un importe por un factor (un porcentaje, un ratio, un tipo de
 * cambio) y redondea una sola vez al final.
 */
export function multiplyCents(amount: Cents, factor: number): Cents {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Factor no finito: ${factor}`);
  }
  return roundHalfUp(amount * factor);
}

/** Importe con divisa. */
export interface Money {
  readonly cents: Cents;
  readonly currency: CurrencyCode;
}

/** Valida un código de divisa ISO 4217. */
export function currencyCode(value: string): CurrencyCode {
  if (!CURRENCY_PATTERN.test(value)) {
    throw new RangeError(`Código de divisa no válido: ${JSON.stringify(value)}`);
  }
  return value as CurrencyCode;
}

/** Construye un importe con divisa. */
export function money(amount: Cents, currency: CurrencyCode): Money {
  return { cents: amount, currency };
}

/**
 * Tipo de cambio **persistido**: se guarda junto al importe convertido.
 *
 * La conversión histórica no puede cambiar porque hoy el euro valga otra cosa,
 * así que la función nunca consulta una fuente externa: recibe el tipo que se
 * aplicó y la fecha con la que se guardó.
 */
export interface ExchangeRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Unidades de `to` por cada unidad de `from`. */
  readonly rate: number;
  /** Fecha del tipo, en formato `YYYY-MM-DD`. Se persiste con el importe. */
  readonly asOf: string;
}

/** Convierte un importe aplicando un tipo persistido. */
export function convert(amount: Money, rate: ExchangeRate): Money {
  if (amount.currency !== rate.from) {
    throw new RangeError(
      `El tipo convierte desde ${rate.from}, pero el importe está en ${amount.currency}`,
    );
  }
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    throw new RangeError(`Tipo de cambio no válido: ${rate.rate}`);
  }
  return { cents: multiplyCents(amount.cents, rate.rate), currency: rate.to };
}

/**
 * Reparto por el método del **mayor resto**: cada parte recibe su suelo y los
 * céntimos sobrantes van a los restos más grandes, empatando por orden.
 *
 * La suma de las partes es **exactamente** el total. Repartir con redondeos
 * independientes descuadraría, y en un chargeback el descuadre se factura.
 */
export function allocateByLargestRemainder(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.length === 0) {
    throw new RangeError('El reparto necesita al menos un peso.');
  }
  let weightSum = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Peso no válido en el reparto: ${weight}`);
    }
    weightSum += weight;
  }
  if (weightSum <= 0) {
    throw new RangeError('La suma de los pesos debe ser mayor que cero.');
  }

  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const exact = weights.map((weight) => (absolute * weight) / weightSum);
  const remainder = absolute - exact.reduce((sum, value) => sum + Math.floor(value), 0);

  // Los céntimos sobrantes van a los restos mayores; los empates, al primero.
  const conCentimoExtra = new Set(
    exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
      .slice(0, remainder)
      .map((entry) => entry.index),
  );

  return exact.map((value, index) =>
    cents(sign * (Math.floor(value) + (conCentimoExtra.has(index) ? 1 : 0))),
  );
}
