/**
 * Punto de entrada del worker de ITFin360.
 *
 * Las colas BullMQ (`imports`, `ocr`, `connectors`, `recalc`, `alerts`)
 * llegan en F0-08; de momento el proceso sólo arranca y queda vivo.
 */
export function main(): void {
  console.log('[itfin360:worker] arrancado; sin colas registradas todavía');
}

main();
