import { NextResponse } from 'next/server';

/**
 * Señal de vida del proceso.
 *
 * No consulta la base de datos a propósito. Un healthcheck que depende de la
 * base convierte un parpadeo de la base en un reinicio del proceso, y entonces
 * hay dos cosas caídas en vez de una. Esto responde a una pregunta concreta:
 * si el proceso está sirviendo peticiones.
 *
 * Que la base responde se comprueba entrando en la aplicación, que es donde
 * importa. Y no se expone aquí porque este endpoint no pide sesión: una sonda
 * pública que abre conexiones a la base es una forma barata de tumbarla.
 */

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      // Vercel expone el commit desplegado; en local no existe y no pasa nada.
      commit: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
