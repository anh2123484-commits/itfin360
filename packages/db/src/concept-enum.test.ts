/**
 * Correspondencia entre el plan de conceptos de `@itfin360/finance-core` y el
 * enum `SpendConcept` del esquema (F2-01).
 *
 * El vocabulario vive en dos sitios por una razón deliberada: `finance-core` no
 * puede importar de `packages/db` (regla dura 2 de `AGENTS.md`: nada de I/O ni
 * de Prisma en el motor de cálculo), y el esquema no puede depender del motor
 * para generar el cliente. Lo que no puede pasar es que se separen en silencio:
 * un concepto que existe en un lado y no en el otro hace que una línea de
 * factura no se pueda clasificar, o que se clasifique con un valor que el motor
 * no sabe tratar.
 *
 * Este test lee los dos ficheros como texto, sin importar ninguno de los dos
 * paquetes, y compara las listas. Si alguien añade un concepto en uno de los
 * dos, falla aquí y no en producción.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCHEMA = join(process.cwd(), 'prisma', 'schema.prisma');
const CONCEPTS = join(process.cwd(), '..', 'finance-core', 'src', 'concepts.ts');

/** Valores del enum `SpendConcept` del esquema, en orden de declaración. */
function enumDelEsquema(): string[] {
  const prisma = readFileSync(SCHEMA, 'utf8');
  const bloque = /enum SpendConcept \{([^}]*)\}/.exec(prisma)?.[1];
  if (bloque === undefined) throw new Error('No se encontró `enum SpendConcept` en schema.prisma');
  return bloque
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => /^[A-Z][A-Z0-9_]*$/.test(linea));
}

/** Valores de `SPEND_CONCEPTS` en `finance-core`, en orden de declaración. */
function conceptosDelMotor(): string[] {
  const fuente = readFileSync(CONCEPTS, 'utf8');
  const bloque = /export const SPEND_CONCEPTS = \[([^\]]*)\] as const;/.exec(fuente)?.[1];
  if (bloque === undefined) throw new Error('No se encontró `SPEND_CONCEPTS` en concepts.ts');
  return [...bloque.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1] ?? '');
}

describe('plan de conceptos: esquema ↔ finance-core', () => {
  it('el esquema declara el enum y el motor la lista', () => {
    expect(enumDelEsquema().length).toBeGreaterThan(0);
    expect(conceptosDelMotor().length).toBeGreaterThan(0);
  });

  it('los dos tienen exactamente los mismos conceptos, en el mismo orden', () => {
    expect(enumDelEsquema()).toEqual(conceptosDelMotor());
  });

  it('ningún concepto está repetido', () => {
    const valores = enumDelEsquema();
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('la línea de factura usa el enum, no texto libre', () => {
    const prisma = readFileSync(SCHEMA, 'utf8');
    const modelo = /model InvoiceLine \{([^}]*)\}/.exec(prisma)?.[1] ?? '';
    expect(modelo).toMatch(/concept\s+SpendConcept/);
    expect(modelo).not.toMatch(/category\s+String/);
  });
});
