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
});
