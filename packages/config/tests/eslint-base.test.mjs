import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { baseConfig } from '../eslint/base.mjs';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });

async function ruleIds(code) {
  const [result] = await eslint.lintText(code, { filePath: 'gate.ts' });
  return result.messages.map((message) => message.ruleId);
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

  it('prohíbe el cliente Prisma crudo fuera de packages/db', async () => {
    const code =
      "import { createPrismaClient } from '@itfin360/db';\nexport const db = createPrismaClient();";

    expect(await ruleIds(code)).toContain('no-restricted-imports');
  });

  it('prohíbe importar el cliente Prisma generado', async () => {
    const code =
      "import { PrismaClient } from '@itfin360/db/generated/prisma/client.js';\nexport const make = (c: PrismaClient): PrismaClient => c;";

    expect(await ruleIds(code)).toContain('no-restricted-imports');
  });

  it('acepta la puerta de entrada con contexto de tenant', async () => {
    const code = "import { withTenant } from '@itfin360/db';\nexport const run = withTenant;";

    expect(await ruleIds(code)).toEqual([]);
  });
});
