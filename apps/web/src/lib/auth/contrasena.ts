import { z } from 'zod';

import { HttpError } from '@/lib/http';

import { hashPassword, verifyPassword } from './password';

/**
 * Poner o cambiar la contraseña de la propia cuenta.
 *
 * Antes esto se hacía desde fuera, en un registro público que creaba la cuenta
 * con una contraseña sobre un correo que nadie había comprobado. Eso permitía
 * apuntarse con el correo de otra persona y quedarse dentro de su cuenta el día
 * que ella entrara por el enlace del correo, porque al entrar se marcaba el
 * correo como verificado y la contraseña del intruso pasaba a valer.
 *
 * Aquí no puede pasar: hace falta una sesión, y la sesión sólo se consigue
 * abriendo el enlace que llega al buzón. Quien pone la contraseña es, por
 * construcción, quien lee ese buzón.
 */

export const contrasenaSchema = z.object({
  /** Obligatoria si ya había una. Vacía cuando se pone la primera. */
  actual: z.string().max(256).optional(),
  nueva: z.string().min(12).max(256),
});
export type ContrasenaInput = z.infer<typeof contrasenaSchema>;

/**
 * Lo que hace falta de la capa de identidad, y nada más.
 *
 * Se pide como parámetro en vez de llamar a `db()` aquí dentro para poder
 * probar esta función con un doble. Lo que decide si una contraseña se puede
 * cambiar o no merece tests, y una función que se conecta sola a la base de
 * datos no los tiene.
 */
export interface IdentidadContrasena {
  findUserById(id: string): Promise<{ email: string; emailVerified: Date | null } | null>;
  findPasswordHashByEmail(email: string): Promise<{ hash: string } | null>;
  updateUser(id: string, data: { passwordHash: string }): Promise<unknown>;
}

/**
 * Cambia la contraseña del usuario de la sesión.
 *
 * Si ya tenía una, se pide la anterior. No es por trámite: sin eso, un rato de
 * descuido delante de una pantalla abierta basta para cambiar la contraseña y
 * dejar fuera a su dueño.
 */
export async function establecerContrasena(
  identity: IdentidadContrasena,
  userId: string,
  input: ContrasenaInput,
): Promise<void> {
  const user = await identity.findUserById(userId);
  if (user === null) throw new HttpError(401, 'sin_sesion');
  // Coherente con el login: sin correo verificado no hay contraseña que valga,
  // así que tampoco se deja poner una.
  if (user.emailVerified === null) throw new HttpError(403, 'correo_sin_verificar');

  const existente = await identity.findPasswordHashByEmail(user.email);
  if (existente !== null) {
    const actual = input.actual ?? '';
    if (actual === '' || !(await verifyPassword(actual, existente.hash))) {
      throw new HttpError(403, 'contrasena_actual_no_coincide');
    }
  }

  await identity.updateUser(userId, { passwordHash: await hashPassword(input.nueva) });
}
