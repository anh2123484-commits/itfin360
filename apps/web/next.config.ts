import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  eslint: {
    // El lint del monorepo lo ejecuta `pnpm lint` con la config compartida.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
