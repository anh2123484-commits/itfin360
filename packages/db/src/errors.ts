/**
 * Errores del cliente Prisma, traducidos a preguntas que el resto del código
 * pueda hacer sin importar el cliente generado.
 *
 * Distinguir «ese proveedor ya existe» de «se ha caído la base» se puede hacer
 * con `error instanceof Prisma.PrismaClientKnownRequestError`, pero
 * `instanceof` falla **en silencio** cuando hay más de una copia del cliente
 * generado en el árbol de dependencias, que en un monorepo es cuestión de
 * tiempo. Un fallo así convierte un 409 en un 500 sin que nadie se entere.
 *
 * Aquí se mira el `code`, que es parte del contrato público y documentado de
 * Prisma, comprobando la forma del objeto. Y se hace una vez, en el paquete
 * dueño del cliente, en vez de repetir el `instanceof` en cada ruta.
 */

/** Violación de índice único. */
export const UNIQUE_CONSTRAINT = 'P2002';

/** Violación de clave ajena. */
export const FOREIGN_KEY_CONSTRAINT = 'P2003';

/** La fila que se iba a actualizar o borrar no existe. */
export const RECORD_NOT_FOUND = 'P2025';

interface ErrorConCodigo {
  readonly code: string;
  readonly meta?: { readonly target?: unknown } | undefined;
}

function conCodigo(error: unknown): ErrorConCodigo | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string') return null;
  return error as ErrorConCodigo;
}

/** Código de error conocido de Prisma, o `null` si no lo es. */
export function prismaErrorCode(error: unknown): string | null {
  return conCodigo(error)?.code ?? null;
}

/** Si el error es el rechazo de un índice único. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return prismaErrorCode(error) === UNIQUE_CONSTRAINT;
}

/** Si el error es el rechazo de una clave ajena. */
export function isForeignKeyViolation(error: unknown): boolean {
  return prismaErrorCode(error) === FOREIGN_KEY_CONSTRAINT;
}

/** Si el error es «la fila no existe». */
export function isRecordNotFound(error: unknown): boolean {
  return prismaErrorCode(error) === RECORD_NOT_FOUND;
}

/**
 * Campos del índice único que se ha violado.
 *
 * En PostgreSQL, Prisma pone en `meta.target` la lista de columnas. Es lo que
 * permite responder «ya hay un proveedor con ese NIF» en vez de un «ya existe»
 * que obliga a adivinar. Si el driver no lo trae, se devuelve la lista vacía:
 * el mensaje será más pobre, pero la petición no se cae por eso.
 */
export function uniqueConstraintFields(error: unknown): readonly string[] {
  if (!isUniqueConstraintViolation(error)) return [];
  const target = conCodigo(error)?.meta?.target;
  if (typeof target === 'string') return [target];
  if (!Array.isArray(target)) return [];
  return target.filter((campo): campo is string => typeof campo === 'string');
}
