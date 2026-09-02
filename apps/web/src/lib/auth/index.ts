import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import type { Provider } from 'next-auth/providers';
import { z } from 'zod';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

import { identityAdapter } from './adapter';
import { authConfig } from './config';
import { verifyPassword } from './password';

const credentialsSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(256),
});

/**
 * Auth.js completo (runtime Node): magic link por email y contraseña.
 *
 * - Magic link (`Nodemailer`): Auth.js crea el usuario si no existe y marca
 *   `emailVerified` al consumir el enlace.
 * - Contraseña (`Credentials`): sólo entra quien ya tiene `passwordHash`
 *   (registro en `POST /api/auth/register`). Cualquier fallo devuelve `null`,
 *   sin distinguir «no existe» de «contraseña incorrecta».
 */
export const { handlers, auth, signIn, signOut } = NextAuth((): NextAuthConfig => {
  const config = env();
  // `NodemailerConfig` declara `server?: T` y el tipo `Provider` exige `T | undefined`
  // explícito con `exactOptionalPropertyTypes`: la conversión sólo reconcilia eso.
  const nodemailer = Nodemailer({
    server: config.EMAIL_SERVER,
    from: config.EMAIL_FROM,
    maxAge: 15 * 60,
  }) as Provider;
  return {
    ...authConfig,
    secret: config.AUTH_SECRET,
    trustHost: true,
    adapter: identityAdapter(db().identity),
    providers: [
      nodemailer,
      Credentials({
        credentials: { email: {}, password: {} },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const identity = db().identity;
          const stored = await identity.findPasswordHashByEmail(parsed.data.email);
          if (!stored) return null;
          if (!(await verifyPassword(parsed.data.password, stored.hash))) return null;
          const user = await identity.findUserById(stored.id);
          if (!user) return null;
          return { id: user.id, email: user.email, name: user.name };
        },
      }),
    ],
  };
});

/** Id del usuario autenticado, o `null`. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
