import { describe, expect, it } from 'vitest';

import { CABECERAS_SEGURIDAD, POLITICA_CSP } from '@/lib/cabeceras';

/**
 * Una cabecera de seguridad se borra en un descuido y no la echa nadie de menos:
 * la aplicación sigue funcionando exactamente igual. Por eso están aquí las que
 * no pueden faltar, y por eso se prueba también lo que la política **no** debe
 * permitir nunca.
 */

function valor(nombre: string): string | undefined {
  return CABECERAS_SEGURIDAD.find((cabecera) => cabecera.key === nombre)?.value;
}

describe('CABECERAS_SEGURIDAD', () => {
  it('están todas las que no pueden faltar', () => {
    expect(CABECERAS_SEGURIDAD.map((cabecera) => cabecera.key)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'X-DNS-Prefetch-Control',
    ]);
  });

  it('HSTS dura lo suficiente para valer de algo', () => {
    // Menos de seis meses no lo acepta ni la lista de precarga, y una ventana
    // corta deja al usuario volviendo por http cada poco.
    const hsts = valor('Strict-Transport-Security') ?? '';
    const segundos = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? '0');
    expect(segundos).toBeGreaterThan(15_552_000);
    expect(hsts).toContain('includeSubDomains');
  });

  it('no se puede meter la aplicación en un iframe ajeno', () => {
    expect(POLITICA_CSP).toContain("frame-ancestors 'none'");
    expect(valor('X-Frame-Options')).toBe('DENY');
  });
});

describe('POLITICA_CSP', () => {
  it('no deja cargar nada de dominios de fuera', () => {
    // Si algún día entra un dominio externo en la política, que sea una
    // decisión y no un copiar y pegar: aquí se rompe el test.
    expect(POLITICA_CSP).not.toMatch(/https?:\/\//);
  });

  it('cierra las tres cosas que convierten una inyección en un robo', () => {
    // Sin `form-action` el formulario manda a otro sitio; sin `base-uri` una
    // etiqueta `<base>` mueve todos los scripts relativos; sin `object-src` se
    // puede embeber contenido que ejecuta.
    expect(POLITICA_CSP).toContain("form-action 'self'");
    expect(POLITICA_CSP).toContain("base-uri 'self'");
    expect(POLITICA_CSP).toContain("object-src 'none'");
  });

  it('las peticiones del navegador sólo pueden ir al propio servidor', () => {
    expect(POLITICA_CSP).toContain("connect-src 'self'");
  });

  it('los estilos en línea se permiten; ejecutar código de fuera, no', () => {
    expect(POLITICA_CSP).toContain("style-src 'self' 'unsafe-inline'");
    // `unsafe-eval` es lo que no puede aparecer nunca: con él, una cadena de
    // texto que llegue de la base de datos se puede acabar ejecutando.
    expect(POLITICA_CSP).not.toMatch(/unsafe-eval/);
  });
});
