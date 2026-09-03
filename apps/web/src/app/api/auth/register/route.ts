import { NextResponse } from 'next/server';

import { currentUserId } from '@/lib/auth';
import { registerSchema, registerWithPassword } from '@/lib/auth/register';
import { parseJson, route } from '@/lib/http';

/** Registro con contraseña. La respuesta nunca devuelve el email ni el nombre. */
export const POST = route(async (request: Request) => {
  const input = await parseJson(request, registerSchema);
  const result = await registerWithPassword(input, await currentUserId());
  return NextResponse.json({ userId: result.userId }, { status: result.created ? 201 : 200 });
});
