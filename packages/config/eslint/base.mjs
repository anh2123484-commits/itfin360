import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Importaciones que saltan el contexto de tenant: el cliente Prisma crudo y el
 * cliente generado. Quien las use consulta sin `app.current_tenant` fijada, así
 * que RLS le devuelve cero filas o —si el rol tuviera `BYPASSRLS`— las de todos
 * los tenants. La regla dura 4 de `AGENTS.md` deja de ser una convención y pasa
 * a ser un error de lint.
 */
const clienteCrudo = {
  paths: [
    {
      name: '@itfin360/db',
      importNames: ['createPrismaClient', 'PrismaClient'],
      message:
        'El cliente Prisma crudo consulta sin contexto de tenant. Usa ' +
        'createTenantAwarePrismaClient() y withTenant(tenantId, cb) (AGENTS.md, regla dura 4).',
    },
  ],
  patterns: [
    {
      group: [
        '@itfin360/db/generated',
        '@itfin360/db/generated/*',
        '@itfin360/db/dist/*',
        '**/db/src/generated/*',
        '**/db/dist/*',
      ],
      message:
        'El cliente Prisma generado no sale de packages/db. Usa withTenant(tenantId, cb) ' +
        'sobre @itfin360/db (AGENTS.md, regla dura 4).',
    },
  ],
};

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
      'no-restricted-imports': ['error', clienteCrudo],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // `packages/db` es el dueño del cliente: ahí sí se construye y se envuelve.
    // Cuando el lint corre dentro del paquete la ruta es relativa y no encaja
    // con este glob, así que su `eslint.config.mjs` repite la excepción.
    files: ['**/packages/db/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
);

export default baseConfig;
