import { describe, expect, it } from 'vitest';

import { esPublica, PUBLIC_PATHS } from '@/lib/rutas-publicas';

describe('rutas públicas', () => {
  it('la lista es exactamente ésta', () => {
    // El test se escribe a mano a propósito: si alguien añade una ruta pública,
    // tiene que venir aquí y justificarla. Una lista que se autocompleta sola
    // deja de ser un control.
    expect([...PUBLIC_PATHS]).toEqual(['/login', '/invitacion', '/api/auth', '/api/health']);
  });

  it('el enlace de invitación se abre sin sesión, pero la gestión no', () => {
    // Son dos rutas que se parecen y hacen cosas opuestas. `/invitacion` es el
    // enlace que recibe quien todavía no tiene cuenta; `/invitaciones` es donde
    // se crean y se revocan, y eso pide sesión y permiso.
    expect(esPublica('/invitacion/aceptar')).toBe(true);
    expect(esPublica('/invitacion/4f0c9f7e-0000-4000-8000-000000000000/token')).toBe(true);
    expect(esPublica('/invitaciones')).toBe(false);
    expect(esPublica('/invitaciones/nueva')).toBe(false);
  });

  it('no hay alta pública', () => {
    // Estuvo abierta, y por ahí se podía poner una contraseña sobre el correo
    // de otra persona. Ahora una cuenta sólo nace de una invitación y la
    // contraseña se pone desde dentro, con sesión.
    expect(esPublica('/registro')).toBe(false);
    expect(esPublica('/cuenta/contrasena')).toBe(false);
  });

  it('el healthcheck responde sin sesión', () => {
    // Detrás de login, la sonda externa ve siempre un 401 y no vigila nada.
    expect(esPublica('/api/health')).toBe(true);
  });

  it('abre las subrutas de lo que es público', () => {
    expect(esPublica('/login/enviado')).toBe(true);
    expect(esPublica('/api/auth/callback/credentials')).toBe(true);
  });

  it('no abre rutas que sólo empiezan igual', () => {
    expect(esPublica('/loginadmin')).toBe(false);
    expect(esPublica('/api/healthz')).toBe(false);
    expect(esPublica('/api/authorised')).toBe(false);
  });

  it('el resto de la aplicación pide sesión', () => {
    for (const ruta of [
      '/',
      '/facturas',
      '/facturas/nueva',
      '/proveedores',
      '/api/invoices',
      '/api/me',
      '/api/tenants',
    ]) {
      expect(esPublica(ruta)).toBe(false);
    }
  });
});
