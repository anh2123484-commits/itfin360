/**
 * Pesos de los criterios (`docs/09-diagnostico-y-hoja-de-ruta.md` §5.4).
 *
 * Si el cliente prefiere ordenar los criterios en vez de repartir porcentajes,
 * el orden se convierte en pesos con el centroide del orden (ROC, Barron y
 * Barrett, 1996):
 *
 *     peso_k = (1/n) · Σ_{i=k..n} 1/i
 *
 * Los pesos salen en puntos básicos enteros y suman exactamente 10000: el
 * redondeo se reparte por restos mayores, como el resto de repartos del motor.
 */

import { FULL_BP } from './scale.js';

/** Pesos ROC exactos, con decimales, para `n` criterios ordenados. */
export function rocWeights(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`El número de criterios debe ser un entero positivo: ${n}`);
  }
  const weights: number[] = [];
  for (let k = 1; k <= n; k += 1) {
    let sum = 0;
    for (let i = k; i <= n; i += 1) sum += 1 / i;
    weights.push(sum / n);
  }
  return weights;
}

/**
 * Reparte 10000 puntos básicos en proporción a unos pesos con decimales, sin
 * perder ni ganar un punto. Los empates en el resto se resuelven por orden.
 */
export function toBasisPoints(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || total <= 0 || weights.some((weight) => weight < 0)) {
    throw new RangeError('Los pesos deben ser no negativos y sumar más de cero');
  }
  const exact = weights.map((weight) => (weight * FULL_BP) / total);
  const floors = exact.map((value) => Math.floor(value));
  const missing = FULL_BP - floors.reduce((sum, value) => sum + value, 0);
  const bumped = new Set(
    exact
      .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, missing)
      .map((entry) => entry.index),
  );
  return floors.map((value, index) => (bumped.has(index) ? value + 1 : value));
}

/**
 * Convierte un orden de criterios (el primero, el más importante) en pesos en
 * puntos básicos que suman 10000.
 */
export function rocWeightsFromRanking<K extends string>(ranking: readonly K[]): Record<K, number> {
  if (new Set(ranking).size !== ranking.length) {
    throw new RangeError('Un criterio no puede aparecer dos veces en el orden');
  }
  const basisPoints = toBasisPoints(rocWeights(ranking.length));
  return Object.fromEntries(
    ranking.map((criterion, index) => [criterion, basisPoints[index]]),
  ) as Record<K, number>;
}
