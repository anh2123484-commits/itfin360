import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/config';
import { esPublica } from '@/lib/rutas-publicas';

const { auth } = NextAuth(authConfig);

/**
 * Puerta de entrada: verifica la sesión JWT sin tocar la base de datos. Las
 * páginas sin sesión van a `/login`; las rutas API responden 401. El tenant
 * activo y el rol los resuelve el servidor en cada handler
 * (`requirePrincipal`), porque dependen de `membership` y no se confían al cliente.
 *
 * La lista de rutas públicas vive en `@/lib/rutas-publicas`, con test: es una
 * regla de seguridad, y aquí dentro no se puede probar sin levantar NextAuth.
 */
export default auth((request) => {
  const { pathname } = request.nextUrl;
  if (esPublica(pathname) || request.auth?.user?.id) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const login = new URL('/login', request.nextUrl.origin);
  login.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
