import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/config';

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ['/login', '/registro', '/api/auth'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Puerta de entrada: verifica la sesión JWT sin tocar la base de datos. Las
 * páginas sin sesión van a `/login`; las rutas API responden 401. El tenant
 * activo y el rol los resuelve el servidor en cada handler
 * (`requirePrincipal`), porque dependen de `membership` y no se confían al cliente.
 */
export default auth((request) => {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname) || request.auth?.user?.id) return NextResponse.next();

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
