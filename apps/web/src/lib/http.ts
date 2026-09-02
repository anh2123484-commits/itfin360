import { NextResponse } from 'next/server';
import { z } from 'zod';

/** Error con código HTTP que las rutas convierten en respuesta JSON. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export const unauthorized = (): HttpError => new HttpError(401, 'unauthorized');
export const forbidden = (code = 'forbidden'): HttpError => new HttpError(403, code);

/** Cuerpo de error estándar. Nunca lleva valores de entrada ni datos personales. */
export interface ErrorBody {
  readonly error: string;
  readonly issues?: readonly { path: string; code: string }[];
}

/**
 * Convierte cualquier excepción en respuesta. Los errores inesperados se
 * registran sólo por nombre (regla dura 12: cero PII en trazas) y se devuelven
 * como 500 genérico.
 */
export function errorResponse(error: unknown): NextResponse<ErrorBody> {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
    return NextResponse.json({ error: 'invalid_input', issues }, { status: 400 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[api] error inesperado: ${name}`);
  return NextResponse.json({ error: 'internal_error' }, { status: 500 });
}

/** Envuelve un handler para que toda excepción salga como JSON de error. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Lee y valida el JSON de la petición con el esquema dado. */
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  return schema.parse(raw);
}
