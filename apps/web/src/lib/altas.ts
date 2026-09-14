/**
 * Quién puede dar de alta una organización.
 *
 * Hasta ahora, cualquiera con sesión. `/tenants/nuevo` sólo comprobaba que
 * hubiera usuario, y el enlace estaba en la portada para todo el mundo. En un
 * producto donde la cuenta sólo nace de una invitación, eso deja un hueco raro:
 * quien entra invitado a la organización de un cliente puede montarse las suyas
 * propias al margen, con su propio OWNER, dentro de la misma instalación.
 *
 * El alta de organización la autoriza NovaEra Nexus, y punto. Se resuelve con
 * una lista de direcciones en la variable `ALTAS_ORGANIZACION`, separadas por
 * comas. Quien no esté en ella recibe un 403 del servidor, no un enlace
 * escondido.
 *
 * ## Por qué una variable y no una columna
 *
 * Una columna en `user` sería más bonita y es a donde hay que llegar, con su
 * pantalla y su entrada de auditoría. Pero eso es migración, y el hueco está
 * abierto hoy. Una variable de entorno lo cierra ahora, no se puede cambiar
 * desde dentro de la aplicación, y no añade nada al esquema que luego haya que
 * deshacer.
 *
 * ## Por qué vacío significa nadie
 *
 * Porque es el único valor por defecto que no sorprende. Si la variable falta,
 * está mal escrita o se pierde en un despliegue, lo que pasa es que no se puede
 * crear ninguna organización: alguien se queja y se arregla. Al revés, un fallo
 * de configuración abriría el alta a todo el mundo sin que nadie se entere.
 */

/** Normaliza una dirección para compararla: sin espacios y en minúsculas. */
function normalizar(direccion: string): string {
  return direccion.trim().toLowerCase();
}

/** Las direcciones autorizadas, tal y como vienen de la variable de entorno. */
export function autorizadas(lista: string | undefined): readonly string[] {
  if (lista === undefined) return [];
  return lista
    .split(',')
    .map(normalizar)
    .filter((direccion) => direccion.length > 0);
}

/**
 * ¿Puede esta dirección dar de alta una organización?
 *
 * Sin lista, nadie. Sin dirección, tampoco: una sesión sin correo no es un
 * caso que haya que resolver aquí con buena voluntad.
 */
export function puedeCrearOrganizacion(lista: string | undefined, email: string | null): boolean {
  if (email === null) return false;
  const objetivo = normalizar(email);
  if (objetivo.length === 0) return false;
  return autorizadas(lista).includes(objetivo);
}
