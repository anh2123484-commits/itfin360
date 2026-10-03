import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Gate de CI exigido por AGENTS.md §4: cobertura >= 95 %.
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
