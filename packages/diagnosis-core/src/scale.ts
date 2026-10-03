/**
 * Escalas comunes del diagnóstico (`docs/09-diagnostico-y-hoja-de-ruta.md`).
 *
 * Nada sale de este paquete con decimales. Un nivel de 1 a 5 con decimales se
 * expresa en milésimas (1,0 → 1000; 3,56 → 3556) y un porcentaje en puntos
 * básicos (100 % → 10000). El redondeo ocurre una sola vez, al final de cada
 * cálculo, con `roundHalfUp`.
 */

/** Nivel entero de 1 a 5: un voto, una respuesta o una nota por tramos. */
export type Level = 1 | 2 | 3 | 4 | 5;

/** Nivel con decimales expresado en milésimas: de 1000 a 5000. */
export type LevelMilli = number;

/** Porcentaje en puntos básicos: de 0 a 10000. */
export type BasisPoints = number;

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 5;
export const MILLI = 1000;
export const FULL_BP = 10_000;

/** Comprueba que un valor sea un nivel entero de 1 a 5. */
export function isLevel(value: unknown): value is Level {
  return (
    Number.isInteger(value) && (value as number) >= LEVEL_MIN && (value as number) <= LEVEL_MAX
  );
}

/** Igual que `isLevel`, pero lanza con un mensaje que dice qué llegó. */
export function assertLevel(value: unknown, what: string): Level {
  if (!isLevel(value)) {
    throw new RangeError(`${what}: el nivel debe ser un entero de 1 a 5, llegó ${String(value)}`);
  }
  return value;
}

/**
 * Redondeo half-up simétrico respecto al cero, el único punto donde se pierde
 * precisión. Misma regla que el motor financiero.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`No se puede redondear un valor no finito: ${value}`);
  }
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const rounded = absolute - whole >= 0.5 ? whole + 1 : whole;
  return value < 0 ? -rounded : rounded;
}

/** Convierte un nivel con decimales en milésimas. */
export function toMilli(level: number): LevelMilli {
  return roundHalfUp(level * MILLI);
}

/**
 * Comprueba que unos pesos en puntos básicos sean enteros no negativos y sumen
 * exactamente 10000. Devuelve los mismos pesos para encadenar.
 */
export function assertWeightsSumToFull<K extends string>(
  weights: Readonly<Record<K, number>>,
  what: string,
): Readonly<Record<K, number>> {
  let total = 0;
  for (const [key, weight] of Object.entries(weights) as [string, number][]) {
    if (!Number.isInteger(weight) || weight < 0) {
      throw new RangeError(`${what}: el peso de ${key} debe ser un entero no negativo`);
    }
    total += weight;
  }
  if (total !== FULL_BP) {
    throw new RangeError(`${what}: los pesos suman ${total} y deben sumar ${FULL_BP}`);
  }
  return weights;
}
