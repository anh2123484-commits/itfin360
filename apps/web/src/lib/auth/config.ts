import type { NextAuthConfig } from 'next-auth';

/**
 * Parte de la configuración de Auth.js que puede ejecutarse en el runtime
 * edge (`middleware.ts`): sin adaptador, sin proveedores, sin acceso a datos.
 * La sesión es JWT: el middleware la verifica con `AUTH_SECRET` sin tocar la
 * base de datos. El tenant activo NO va en el JWT: lo resuelve el servidor en
 * cada petición contra `membership` (ver `tenant-context.ts`).
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', verifyRequest: '/login/enviado', error: '/login' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  // Auth.js registra por defecto el error completo; aquí sólo el nombre/código
  // para que jamás salga un email en una traza (regla dura 12).
  logger: {
    error(error) {
      console.error(`[auth] ${error.name}`);
    },
    warn(code) {
      console.warn(`[auth] ${code}`);
    },
    debug() {},
  },
} satisfies NextAuthConfig;
