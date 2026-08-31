import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los ficheros de `tests/fixtures` son proyectos de prueba que se ejecutan
    // en un vitest hijo, no tests de este paquete.
    include: ['tests/*.test.mjs'],
    testTimeout: 120_000,
  },
});
