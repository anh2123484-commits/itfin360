import { describe, expect, it } from 'vitest';

import { esPublica, PUBLIC_PATHS } from '@/lib/rutas-publicas';

describe('rutas públicas', () => {
  it('la lista es exactamente ésta', () => {
    // El test se escribe a mano a propósito: si alguien añade una ruta pública,
    // tiene que venir aquí y justificarla. Una lista que se autocompleta sola
    // deja de ser un control.
    expect([...PUBLIC_PATHS]).toEqual(['/login', '/registro', '/api/auth', '/api/health']);
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
