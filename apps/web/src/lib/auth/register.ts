import { z } from 'zod';

import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';

import { hashPassword } from './password';

export const registerSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(256),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Registro con contraseña. Si el email ya existe, sólo su propia sesión
 * (entró por magic link) puede añadirle una contraseña; cualquier otro caso es
 * 409 sin más detalle, para no confirmar qué emails existen.
 */
export async function registerWithPassword(
  input: RegisterInput,
  sessionUserId: string | null,
): Promise<{ userId: string; created: boolean }> {
  const identity = db().identity;
  const passwordHash = await hashPassword(input.password);

  const existing = await identity.findUserByEmail(input.email);
  if (existing) {
    if (sessionUserId !== existing.id || (await identity.findPasswordHashByEmail(input.email))) {
      throw new HttpError(409, 'already_registered');
    }
    await identity.updateUser(existing.id, { passwordHash, name: input.name });
    return { userId: existing.id, created: false };
  }

  const created = await identity.createUser({ email: input.email, name: input.name, passwordHash });
  return { userId: created.id, created: true };
}
