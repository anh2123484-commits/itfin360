import type { Config } from 'tailwindcss';

import preset from '@itfin360/config/tailwind';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
