/**
 * Registro de lo que pasa al entrar.
 *
 * Antes no quedaba rastro de nada: ni de los intentos fallidos, ni de los
 * bloqueos, ni de a quién se le mandó un enlace. Sin eso, un ataque por fuerza
 * bruta es invisible mientras ocurre y no se puede reconstruir después, que es
 * justo cuando hace falta.
 *
 * Sale como una línea de JSON por la salida estándar, que es lo que recoge
 * Vercel. No es el registro definitivo: eso pide una tabla con su política de
 * retención, y va con la capa de dato personal. Esto es lo que se puede tener
 * hoy sin tocar el esquema, y ya permite ver una ráfaga en los registros.
 *
 * ## Qué no lleva dentro
 *
 * Ni correos, ni contraseñas, ni nada que identifique a una persona. Sólo el
 * identificador corto de `intentos.ts`, que es un hash. Un registro de accesos
 * se guarda mucho tiempo, se copia a herramientas de terceros y lo lee gente
 * que no tiene por qué ver la lista de direcciones de tus clientes.
 */

export type EventoAuth =
  | 'login.ok'
  | 'login.credenciales_malas'
  | 'login.sin_verificar'
  | 'login.bloqueado'
  | 'login.ocupado'
  | 'enlace.enviado'
  | 'enlace.rechazado';

/** Una línea por evento, en JSON, sin datos personales. */
export function registrarEventoAuth(evento: EventoAuth, id: string, extra?: string): void {
  const linea: Record<string, string> = { auth: evento, id };
  if (extra !== undefined) linea['detalle'] = extra;
  console.warn(JSON.stringify(linea));
}
