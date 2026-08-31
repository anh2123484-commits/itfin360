import { baseConfig } from '@itfin360/config/eslint/base';

export default [
  // Cliente Prisma generado: no se edita a mano.
  { ignores: ['src/generated/**'] },
  ...baseConfig,
];
