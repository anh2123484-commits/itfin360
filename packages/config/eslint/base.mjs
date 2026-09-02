import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Configuración ESLint compartida para todos los paquetes del monorepo. */
export const baseConfig = tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAnyKeyword',
          message: 'Prohibido `as any`: tipa el valor correctamente.',
        },
      ],
      // Regla dura 4 de `AGENTS.md`: el cliente Prisma crudo no sale de `packages/db`.
      // Dentro del paquete los imports son relativos, así que esta regla no le afecta.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@itfin360/db',
              importNames: ['createPrismaClient', 'PrismaClient'],
              message:
                'El cliente Prisma crudo se queda en packages/db: usa createTenantAwarePrismaClient y consulta dentro de withTenant(tenantId, cb).',
            },
          ],
          patterns: [
            {
              group: ['@itfin360/db/generated', '@itfin360/db/generated/**'],
              message:
                'El cliente Prisma generado es interno a packages/db: entra por withTenant(tenantId, cb).',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  prettier,
);

export default baseConfig;
