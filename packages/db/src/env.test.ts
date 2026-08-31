import { describe, expect, it } from 'vitest';

import { databaseUrl, migrationDatabaseUrl } from './env.js';

const APP_URL = 'postgresql://app@localhost:5432/itfin360';
const MIGRATION_URL = 'postgresql://migrator@localhost:5432/itfin360';

describe('cadenas de conexión', () => {
  it('exige DATABASE_URL', () => {
    expect(() => databaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => databaseUrl({ DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/);
  });

  it('usa el rol de migraciones cuando está definido', () => {
    expect(
      migrationDatabaseUrl({ DATABASE_URL: APP_URL, MIGRATION_DATABASE_URL: MIGRATION_URL }),
    ).toBe(MIGRATION_URL);
  });

  it('cae al rol de aplicación si no hay rol de migraciones', () => {
    expect(migrationDatabaseUrl({ DATABASE_URL: APP_URL })).toBe(APP_URL);
  });
});
