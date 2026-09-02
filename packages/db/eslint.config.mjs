import { baseConfig } from '@itfin360/config/eslint/base';

export default [
  // Cliente Prisma generado: no se edita a mano.
  { ignores: ['src/generated/**'] },
  ...baseConfig,
  // Este paquete es el dueño del cliente crudo: aquí se construye y se envuelve
  // en `withTenant`. La prohibición de la config compartida aplica al resto del
  // monorepo, y su glob no encaja cuando el lint corre desde este directorio.
  { rules: { 'no-restricted-imports': 'off' } },
];
