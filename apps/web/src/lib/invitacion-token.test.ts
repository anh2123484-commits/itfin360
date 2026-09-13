import { describe, expect, it } from 'vitest';

import {
  deserializarInvitacion,
  esInvitacionValida,
  serializarInvitacion,
} from '@/lib/invitacion-token';

/**
 * Lo que se prueba aquí es una frontera: el valor de esta cookie lo escribe el
 * navegador, o sea quien quiera. De aquí sale un `tenantId` que acaba en
 * `withTenant`, así que lo que no tenga la forma exacta no puede pasar.
 */

const TENANT = '4f0c9f7e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const TOKEN = 'a'.repeat(43);

describe('esInvitacionValida', () => {
  it('acepta un uuid y un token de 43 caracteres', () => {
    expect(esInvitacionValida(TENANT, TOKEN)).toBe(true);
  });

  it('rechaza lo que no es un uuid', () => {
    expect(esInvitacionValida('novaera', TOKEN)).toBe(false);
    expect(esInvitacionValida(`${TENANT}x`, TOKEN)).toBe(false);
    // Comillas y punto y coma: lo que se probaría para tocar la consulta.
    expect(esInvitacionValida("' OR 1=1 --", TOKEN)).toBe(false);
  });

  it('rechaza un token de otra longitud o con otros caracteres', () => {
    expect(esInvitacionValida(TENANT, 'a'.repeat(42))).toBe(false);
    expect(esInvitacionValida(TENANT, 'a'.repeat(44))).toBe(false);
    // El token es base64url: ni `+`, ni `/`, ni `=`.
    expect(esInvitacionValida(TENANT, `${'a'.repeat(42)}+`)).toBe(false);
  });
});

describe('cookie de invitación', () => {
  it('lo que se guarda se vuelve a leer igual', () => {
    const valor = serializarInvitacion({ tenantId: TENANT, token: TOKEN });
    expect(deserializarInvitacion(valor)).toEqual({ tenantId: TENANT, token: TOKEN });
  });

  it('sin cookie no hay invitación', () => {
    expect(deserializarInvitacion(undefined)).toBeNull();
    expect(deserializarInvitacion('')).toBeNull();
  });

  it('un valor manipulado no cuela', () => {
    expect(deserializarInvitacion(`${TENANT}.${TOKEN}extra`)).toBeNull();
    expect(deserializarInvitacion(`otro-tenant.${TOKEN}`)).toBeNull();
    expect(deserializarInvitacion(TENANT)).toBeNull();
    expect(deserializarInvitacion(`.${TOKEN}`)).toBeNull();
  });

  it('el separador es el primer punto, no el último', () => {
    // Un token no lleva puntos, pero si algún día los llevara, partir por el
    // último dejaría el tenant con un trozo de token pegado.
    const raro = `${TENANT}.${TOKEN}`;
    expect(deserializarInvitacion(raro)?.tenantId).toBe(TENANT);
  });
});
