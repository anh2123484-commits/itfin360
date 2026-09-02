import { z } from 'zod';

/**
 * Variables de entorno de la aplicación web, validadas en el arranque (regla
 * dura 7). Todas declaradas en `.env.example`; ninguna con valor por defecto
 * secreto.
 */
const schema = z.object({
  APP_URL: z.url().default('http://localhost:3000'),
  /** Firma de la sesión JWT de Auth.js (`npx auth secret`). */
  AUTH_SECRET: z.string().min(32),
  /** SMTP para el magic link, en forma de URL (`smtp://user:pass@host:587`). */
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
});

export type WebEnv = z.infer<typeof schema>;

let cached: WebEnv | undefined;

export function env(source: NodeJS.ProcessEnv = process.env): WebEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const faltan = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Variables de entorno inválidas o ausentes: ${faltan} (ver .env.example).`);
  }
  cached = parsed.data;
  return cached;
}
