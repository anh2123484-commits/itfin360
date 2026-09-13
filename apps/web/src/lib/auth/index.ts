import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import type { Provider } from 'next-auth/providers';
import { z } from 'zod';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { invitacionEnCursoPara } from '@/lib/invitations';

import { identityAdapter } from './adapter';
import { authConfig } from './config';
import { registrarEventoAuth } from './eventos';
import { controlDeIntentos, identificador } from './intentos';
import { verifyPassword } from './password';

/**
 * El control de intentos vive en el módulo, no dentro del handler, para que
 * dure lo que dure la instancia. Cada instancia lleva su propia cuenta; el
 * contador compartido entre todas necesita almacenamiento y va aparte.
 */
const intentos = controlDeIntentos();

const credentialsSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(256),
});

/**
 * Auth.js completo (runtime Node): magic link por email y contraseña.
 *
 * - Magic link (`Nodemailer`): Auth.js crea el usuario si no existe y marca
 *   `emailVerified` al consumir el enlace. Es la única forma que hay de
 *   demostrar que el buzón es tuyo.
 * - Contraseña (`Credentials`): entra quien tiene `passwordHash` **y** el
 *   correo verificado. La contraseña se pone desde dentro de la cuenta, en
 *   `/cuenta/contrasena`. Cualquier fallo devuelve `null`, sin distinguir «no
 *   existe» de «contraseña incorrecta».
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
    callbacks: {
      ...authConfig.callbacks,
      /**
       * A quién se le manda el enlace por correo.
       *
       * Sólo a quien ya tiene cuenta, o a quien tiene una invitación abierta
       * para esa misma dirección. Sin esto, el formulario de entrada es un
       * relé para mandar correo a cualquier dirección del mundo con nuestro
       * remite, y además crea una cuenta a quien nadie ha invitado.
       *
       * Se comprueba sólo al pedir el enlace (`verificationRequest`), no al
       * consumirlo. Si se comprobara también al consumirlo, abrir el correo
       * desde el móvil no funcionaría: la invitación vive en una cookie del
       * navegador desde el que se pidió.
       *
       * Ante cualquier error, no se manda. Es preferible que alguien tenga que
       * repetir a que esto se convierta en una puerta abierta el día que la
       * base de datos falle.
       */
      async signIn({ user, email }) {
        if (email?.verificationRequest !== true) return true;
        const direccion = user.email?.trim().toLowerCase();
        if (direccion === undefined || direccion === '') return false;
        const id = identificador(direccion);
        try {
          const existente = await db().identity.findUserByEmail(direccion);
          const permitido = existente !== null || (await invitacionEnCursoPara(direccion));
          registrarEventoAuth(permitido ? 'enlace.enviado' : 'enlace.rechazado', id);
          return permitido;
        } catch {
          registrarEventoAuth('enlace.rechazado', id, 'error');
          return false;
        }
      },
    },
    providers: [
      nodemailer,
      Credentials({
        credentials: { email: {}, password: {} },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;

          const id = identificador(parsed.data.email);
          const ahora = Date.now();

          // Primero el bloqueo, antes de tocar la base de datos y antes de
          // derivar nada. Es lo que hace que una ráfaga de intentos no cueste
          // ni memoria ni consultas: el trabajo caro no llega a empezar.
          const espera = intentos.esperaMs(id, ahora);
          if (espera > 0) {
            registrarEventoAuth('login.bloqueado', id, `${Math.ceil(espera / 1000)}s`);
            return null;
          }

          const identity = db().identity;
          const stored = await identity.findPasswordHashByEmail(parsed.data.email);
          if (!stored) {
            // Se cuenta igual que una contraseña mala. Si no, el número de
            // intentos que aguanta una dirección diría si existe o no.
            intentos.fallo(id, ahora);
            registrarEventoAuth('login.credenciales_malas', id);
            return null;
          }

          let coincide: boolean;
          try {
            coincide = await verifyPassword(parsed.data.password, stored.hash);
          } catch {
            // El servidor está saturado de derivaciones. No es culpa de quien
            // entra, así que no cuenta como intento fallido.
            registrarEventoAuth('login.ocupado', id);
            return null;
          }
          if (!coincide) {
            const fallos = intentos.fallo(id, ahora);
            registrarEventoAuth('login.credenciales_malas', id, `${fallos}`);
            return null;
          }

          const user = await identity.findUserById(stored.id);
          if (!user) {
            intentos.fallo(id, ahora);
            registrarEventoAuth('login.credenciales_malas', id);
            return null;
          }
          // Sin correo verificado no se entra, aunque la contraseña sea buena.
          // Es lo que impide que alguien ponga una contraseña sobre el correo de
          // otra persona y se quede dentro de su cuenta el día que ella entre
          // por el enlace. Hoy la contraseña sólo se puede poner desde dentro de
          // una cuenta ya verificada, así que esta comprobación es la red de
          // seguridad de la de allí, no la única.
          if (user.emailVerified === null) {
            registrarEventoAuth('login.sin_verificar', id);
            return null;
          }

          intentos.acierto(id);
          registrarEventoAuth('login.ok', id);
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
