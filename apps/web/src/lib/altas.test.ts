import { describe, expect, it } from 'vitest';

import { autorizadas, puedeCrearOrganizacion } from '@/lib/altas';

describe('autorizadas', () => {
  it('separa por comas y limpia espacios', () => {
    expect(autorizadas(' a@n.example , b@n.example ')).toEqual(['a@n.example', 'b@n.example']);
  });

  it('ignora los huecos de una lista mal escrita', () => {
    // Una coma de más al final es el error de dedo más común de todos.
    expect(autorizadas('a@n.example,,b@n.example,')).toEqual(['a@n.example', 'b@n.example']);
  });

  it('sin variable, lista vacía', () => {
    expect(autorizadas(undefined)).toEqual([]);
    expect(autorizadas('')).toEqual([]);
  });
});

describe('puedeCrearOrganizacion', () => {
  it('deja pasar a quien está en la lista', () => {
    expect(puedeCrearOrganizacion('a@n.example,b@n.example', 'b@n.example')).toBe(true);
  });

  it('no mira mayúsculas ni espacios', () => {
    expect(puedeCrearOrganizacion(' A@N.Example ', 'a@n.example')).toBe(true);
  });

  it('quien no está, no pasa', () => {
    expect(puedeCrearOrganizacion('a@n.example', 'c@n.example')).toBe(false);
  });

  it('sin lista no pasa nadie', () => {
    // Es la parte importante: si la variable se pierde en un despliegue, el
    // alta se cierra. Al revés, un despiste abriría el producto entero.
    expect(puedeCrearOrganizacion(undefined, 'a@n.example')).toBe(false);
    expect(puedeCrearOrganizacion('', 'a@n.example')).toBe(false);
    expect(puedeCrearOrganizacion('   ', 'a@n.example')).toBe(false);
  });

  it('una sesión sin correo no pasa', () => {
    expect(puedeCrearOrganizacion('a@n.example', null)).toBe(false);
    expect(puedeCrearOrganizacion('a@n.example', '  ')).toBe(false);
  });

  it('no vale una dirección que sólo se parece', () => {
    expect(puedeCrearOrganizacion('a@n.example', 'a@n.example.attacker.test')).toBe(false);
    expect(puedeCrearOrganizacion('a@n.example', 'xa@n.example')).toBe(false);
  });
});
