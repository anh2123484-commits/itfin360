import { describe, expect, it } from 'vitest';

import { whereDeProveedores } from '@/lib/vendor-query';

describe('whereDeProveedores', () => {
  it('sin búsqueda ni cursor, sin condiciones: RLS ya limita al tenant', () => {
    expect(whereDeProveedores('', undefined)).toEqual({});
  });

  it('la búsqueda por nombre no distingue mayúsculas', () => {
    expect(whereDeProveedores('acme', undefined)).toEqual({
      name: { contains: 'acme', mode: 'insensitive' },
    });
  });

  it('el cursor pide lo que viene después, no un desplazamiento', () => {
    // Por `skip`, dar de alta un proveedor mientras alguien recorre la lista le
    // haría saltarse una fila sin enterarse.
    expect(whereDeProveedores('', 'Beta')).toEqual({ name: { gt: 'Beta' } });
  });

  it('buscar y paginar a la vez conserva las dos condiciones', () => {
    // Escritas como dos claves `name` separadas, la segunda pisaba a la primera
    // en silencio y la segunda página de una búsqueda enseñaba proveedores que
    // no cumplían el texto buscado.
    expect(whereDeProveedores('acme', 'Beta')).toEqual({
      name: { contains: 'acme', mode: 'insensitive', gt: 'Beta' },
    });
  });
});
