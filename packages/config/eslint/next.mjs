import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.mjs';

/** Configuración ESLint para aplicaciones Next.js (App Router). */
export const nextConfig = tseslint.config({ ignores: ['next-env.d.ts'] }, ...baseConfig, {
  files: ['**/*.{ts,tsx}'],
  plugins: {
    '@next/next': nextPlugin,
    'react-hooks': reactHooks,
  },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
    ...reactHooks.configs['recommended-latest'].rules,
  },
});

export default nextConfig;
