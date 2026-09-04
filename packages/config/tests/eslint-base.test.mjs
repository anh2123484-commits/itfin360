import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { baseConfig } from '../eslint/base.mjs';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });

async function ruleIds(code, filePath = 'gate.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
}

async function messages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.message);
}

describe('gate de lint', () => {
  it('rechaza una anotación `any`', async () => {
    expect(await ruleIds('export const parse = (input: any): string => String(input);')).toContain(
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('rechaza un `as any`', async () => {
    expect(await ruleIds('export const total = (JSON.parse("{}") as any).cents;')).toContain(
      'no-restricted-syntax',
    );
  });

  it('acepta código correctamente tipado', async () => {
    expect(await ruleIds('export const parse = (input: string): string => input.trim();')).toEqual(
      [],
    );
  });
});

/**
 * Regla dura 4 de `AGENTS.md`: el cliente Prisma crudo consulta sin contexto de
 * tenant, así que sólo `packages/db` puede tocarlo. Aquí se comprueba que la
 * prohibición es de herramienta y no de disciplina.
 */
describe('gate del cliente Prisma crudo', () => {
  const web = 'apps/web/app/page.ts';
  const worker = 'apps/worker/src/jobs/recalcular.ts';
  const db = 'packages/db/src/tenant-context.ts';

  it('rechaza importar createPrismaClient fuera de packages/db', async () => {
    const code =
      "import { createPrismaClient } from '@itfin360/db';\n" +
      'export const db = createPrismaClient();\n';

    expect(await ruleIds(code, web)).toEqual(['no-restricted-imports']);
    expect(await messages(code, web)).toEqual([expect.stringContaining('withTenant')]);
  });

  it('rechaza importar PrismaClient fuera de packages/db, incluso como tipo', async () => {
    expect(await ruleIds("import type { PrismaClient } from '@itfin360/db';", worker)).toContain(
      'no-restricted-imports',
    );
  });

  it('rechaza llegar al cliente generado por cualquier ruta', async () => {
    const rutas = [
      "import { PrismaClient } from '@itfin360/db/generated/prisma/client.js';",
      "import { PrismaClient } from '@itfin360/db/dist/client.js';",
      "import { PrismaClient } from '../../../packages/db/src/generated/prisma/client.js';",
      "export { PrismaClient } from '@itfin360/db/generated';",
    ];

    for (const ruta of rutas) {
      expect(await ruleIds(ruta, web)).toContain('no-restricted-imports');
    }
  });

  it('deja pasar lo que sí es acceso con contexto de tenant', async () => {
    const code =
      "import { createTenantAwarePrismaClient, withTenant } from '@itfin360/db';\n" +
      'export const db = createTenantAwarePrismaClient();\n' +
      'export const conTenant = withTenant;\n';

    expect(await ruleIds(code, web)).toEqual([]);
  });

  it('no estorba dentro de packages/db, que es el dueño del cliente', async () => {
    const code =
      "import { createPrismaClient, type PrismaClient } from '@itfin360/db';\n" +
      'export const crear = (): PrismaClient => createPrismaClient();\n';

    expect(await ruleIds(code, db)).toEqual([]);
  });
});
