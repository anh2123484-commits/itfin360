/**
 * Qué rutas se sirven sin sesión.
 *
 * Vive fuera del middleware para poder tener test: la lista es una regla de
 * seguridad, y una regla de seguridad sin test se amplía sola con el tiempo.
 * Cada entrada de aquí es una puerta abierta a internet, así que la lista es
 * corta a propósito y cada línea dice por qué está.
 *
 * La comparación es por segmento completo, nunca por prefijo de texto:
 * `/login` abre `/login` y `/login/enviado`, pero no `/loginadmin`. Con un
 * `startsWith` a pelo, una ruta futura que empezara igual quedaría pública sin
 * que nadie lo hubiera decidido.
 */

export const PUBLIC_PATHS: readonly string[] = [
  // Entrada y alta.
  '/login',
  '/registro',
  // Callbacks de NextAuth: el enlace mágico llega sin sesión, por definición.
  '/api/auth',
  // Señal de vida del proceso. Tiene que responder sin sesión o la sonda
  // externa ve siempre un 401 y no vigila nada. No toca la base de datos ni
  // devuelve nada del tenant: sólo si el proceso sirve peticiones.
  '/api/health',
];

/** Si la ruta se sirve sin sesión. */
export function esPublica(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
