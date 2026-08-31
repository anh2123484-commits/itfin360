import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['subject.mjs'],
      reporter: ['text'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
