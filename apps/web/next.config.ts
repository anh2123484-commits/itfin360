import type { NextConfig } from 'next';

import { CABECERAS_SEGURIDAD } from './src/lib/cabeceras';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  eslint: {
    // El lint del monorepo lo ejecuta `pnpm lint` con la config compartida.
    ignoreDuringBuilds: true,
  },
  // Se aplican a todo, incluidos los ficheros estáticos y las páginas de error.
  // Son justo las rutas que se quedan fuera cuando esto se pone en el
  // middleware, y una página de error sin `frame-ancestors` se puede meter en
  // un iframe igual que cualquier otra.
  async headers() {
    return [{ source: '/:path*', headers: [...CABECERAS_SEGURIDAD] }];
  },
};

export default nextConfig;
