import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const vitestBin = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const fixture = fileURLToPath(new URL('./fixtures/coverage-gate', import.meta.url));

/** Ejecuta un vitest hijo sobre el proyecto de juguete, con el gate al 95 %. */
function runFixture(args) {
  return spawnSync(
    process.execPath,
    [
      vitestBin,
      'run',
      '--coverage',
      '--root',
      fixture,
      '--config',
      join(fixture, 'vitest.config.mjs'),
      ...args,
    ],
    { cwd: fixture, encoding: 'utf8' },
  );
}

describe('gate de cobertura', () => {
  it('falla cuando la cobertura baja del 95 %', () => {
    const { status, stdout, stderr } = runFixture([]);

    expect(status).not.toBe(0);
    expect(`${stdout}${stderr}`).toMatch(/coverage.+threshold/i);
  });

  it('pasa con los mismos tests si el umbral es alcanzable', () => {
    const thresholds = ['lines', 'statements', 'functions', 'branches'].map(
      (metric) => `--coverage.thresholds.${metric}=10`,
    );

    expect(runFixture(thresholds).status).toBe(0);
  });
});
