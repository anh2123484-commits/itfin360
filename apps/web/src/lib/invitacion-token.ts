/**
 * La invitación en curso, tal y como viaja en la cookie.
 *
 * Esto es sólo el formato y la validación, sin tocar cookies ni base de datos,
 * para poder probarlo. Lo que lee y escribe la cookie está en
 * `lib/invitacion-cookie.ts`.
 *
 * Por qué existe la cookie: el token de invitación es una credencial, y
 * viajando en la ruta de la URL acaba en el historial del navegador, en los
 * registros de acceso del proveedor y, si la página carga cualquier recurso
 * externo, en la cabecera `Referer`. Además se copiaba tal cual al redirigir al
 * login, así que el token quedaba también en el query string de `/login`.
 *
 * El enlace del correo tiene que llevarlo, eso no hay forma de evitarlo. Lo que
 * sí se puede es que dure una sola petición: la página del enlace lo guarda en
 * la cookie y manda a una dirección limpia.
 */

/** El tenant y el token de una invitación que se está aceptando. */
export interface InvitacionEnCurso {
  readonly tenantId: string;
  readonly token: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Si el par tiene la forma de un enlace de invitación de verdad. */
export function esInvitacionValida(tenantId: string, token: string): boolean {
  return UUID.test(tenantId) && TOKEN.test(token);
}

/**
 * `tenantId.token`. El punto sirve de separador porque no aparece ni en un UUID
 * ni en base64url, así que no hay nada que escapar.
 */
export function serializarInvitacion(invitacion: InvitacionEnCurso): string {
  return `${invitacion.tenantId}.${invitacion.token}`;
}

/**
 * Lee el valor de la cookie, o `null` si no tiene la forma esperada.
 *
 * Se valida aquí y no sólo al consultar la base de datos porque lo que llega en
 * una cookie lo escribe quien quiera: es entrada de fuera, igual que el query
 * string. Un `tenantId` inventado iría a parar a `withTenant`, y eso es lo que
 * no debe llegar a pasar.
 */
export function deserializarInvitacion(valor: string | undefined): InvitacionEnCurso | null {
  if (valor === undefined) return null;
  const punto = valor.indexOf('.');
  if (punto === -1) return null;
  const tenantId = valor.slice(0, punto);
  const token = valor.slice(punto + 1);
  if (!esInvitacionValida(tenantId, token)) return null;
  return { tenantId, token };
}
