import { describe, expect, it } from 'vitest';

import {
  FOREIGN_KEY_CONSTRAINT,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT,
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueConstraintViolation,
  prismaErrorCode,
  uniqueConstraintFields,
} from './errors.js';

/** Un error tal y como lo devuelve el cliente Prisma sobre PostgreSQL. */
const prismaError = (code: string, target?: unknown): unknown =>
  Object.assign(new Error('mensaje del cliente'), {
    code,
    ...(target === undefined ? {} : { meta: { target } }),
  });

describe('prismaErrorCode', () => {
  it('saca el código de un error del cliente', () => {
    expect(prismaErrorCode(prismaError(UNIQUE_CONSTRAINT))).toBe(UNIQUE_CONSTRAINT);
  });

  it('cualquier otra cosa no tiene código', () => {
    expect(prismaErrorCode(new Error('vaya'))).toBe(null);
    expect(prismaErrorCode(null)).toBe(null);
    expect(prismaErrorCode(undefined)).toBe(null);
    expect(prismaErrorCode('P2002')).toBe(null);
    expect(prismaErrorCode({ code: 500 })).toBe(null);
  });
});

describe('reconocer el error', () => {
  it('distingue los tres que importan', () => {
    expect(isUniqueConstraintViolation(prismaError(UNIQUE_CONSTRAINT))).toBe(true);
    expect(isForeignKeyViolation(prismaError(FOREIGN_KEY_CONSTRAINT))).toBe(true);
    expect(isRecordNotFound(prismaError(RECORD_NOT_FOUND))).toBe(true);
  });

  it('no se confunden entre sí', () => {
    const unico = prismaError(UNIQUE_CONSTRAINT);
    expect(isForeignKeyViolation(unico)).toBe(false);
    expect(isRecordNotFound(unico)).toBe(false);
  });

  it('un error cualquiera no es ninguno de los tres', () => {
    // Si esto devolviera `true`, un fallo de conexión saldría como 409 y
    // nadie se enteraría de que la base está caída.
    for (const valor of [new Error('conexión perdida'), null, undefined, {}, 'P2002']) {
      expect(isUniqueConstraintViolation(valor)).toBe(false);
      expect(isForeignKeyViolation(valor)).toBe(false);
      expect(isRecordNotFound(valor)).toBe(false);
    }
  });
});

describe('uniqueConstraintFields', () => {
  it('devuelve las columnas del índice violado', () => {
    const e = prismaError(UNIQUE_CONSTRAINT, ['tenant_id', 'tax_id']);
    expect(uniqueConstraintFields(e)).toEqual(['tenant_id', 'tax_id']);
  });

  it('acepta también el formato de una sola columna', () => {
    expect(uniqueConstraintFields(prismaError(UNIQUE_CONSTRAINT, 'tax_id'))).toEqual(['tax_id']);
  });

  it('sin `meta`, lista vacía en vez de excepción', () => {
    // El mensaje será más pobre, pero la petición no se cae por eso.
    expect(uniqueConstraintFields(prismaError(UNIQUE_CONSTRAINT))).toEqual([]);
  });

  it('descarta lo que no sean nombres de columna', () => {
    const e = prismaError(UNIQUE_CONSTRAINT, ['tenant_id', 7, null]);
    expect(uniqueConstraintFields(e)).toEqual(['tenant_id']);
  });

  it('un error que no es de unicidad no tiene columnas', () => {
    expect(uniqueConstraintFields(prismaError(FOREIGN_KEY_CONSTRAINT, ['vendor_id']))).toEqual([]);
    expect(uniqueConstraintFields(new Error('vaya'))).toEqual([]);
  });
});
