/** Proyecto de juguete: `uncovered` no tiene test, así que la cobertura baja del 95 %. */
export const covered = (n) => n + 1;

export const uncovered = (n) => {
  if (n < 0) return 0;
  return n * 2;
};
