import { baseConfig } from './eslint/base.mjs';

/** Los ficheros de `tests/fixtures` son código de juguete para probar los gates de CI. */
export default [{ ignores: ['tests/fixtures/**'] }, ...baseConfig];
