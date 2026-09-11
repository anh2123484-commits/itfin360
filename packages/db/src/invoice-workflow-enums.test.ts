/**
 * Correspondencia entre los literales del flujo de aprobación y los enums del
 * esquema (F2-02).
 *
 * `invoice-workflow.ts` declara los estados y los roles como literales para no
 * depender del cliente generado: así la máquina de estados se puede razonar, y
 * testear, sin haber ejecutado `prisma generate`. El precio de esa decisión es
 * que las dos listas pueden separarse, y un estado que existe en la base pero
 * no en la máquina de estados se traduciría en una factura que nadie puede
 * mover. Este test paga ese precio.
 */

import { describe, expect, it } from 'vitest';

import { InvoiceStatus, Role } from './generated/prisma/enums.js';
import { INVOICE_ROLES, INVOICE_STATUSES, INVOICE_TRANSITIONS } from './invoice-workflow.js';

describe('flujo de aprobación ↔ esquema', () => {
  it('los estados son exactamente los del enum `InvoiceStatus`', () => {
    expect([...INVOICE_STATUSES].sort()).toEqual(Object.keys(InvoiceStatus).sort());
  });

  it('los roles son exactamente los del enum `Role`', () => {
    expect([...INVOICE_ROLES].sort()).toEqual(Object.keys(Role).sort());
  });

  it('toda transición se mueve entre estados que existen en el esquema', () => {
    const validos = new Set<string>(Object.keys(InvoiceStatus));
    for (const rule of Object.values(INVOICE_TRANSITIONS)) {
      for (const from of rule.from) expect(validos.has(from), from).toBe(true);
      expect(validos.has(rule.to), rule.to).toBe(true);
    }
  });

  it('toda transición la puede pedir algún rol que existe en el esquema', () => {
    const validos = new Set<string>(Object.keys(Role));
    for (const [action, rule] of Object.entries(INVOICE_TRANSITIONS)) {
      expect(rule.roles.length, action).toBeGreaterThan(0);
      for (const role of rule.roles) expect(validos.has(role), role).toBe(true);
    }
  });

  it('todo estado del esquema es alcanzable o es el inicial', () => {
    // Si un estado existe en la base y ninguna transición lleva a él, o es el
    // estado de alta o es un estado muerto que alguien olvidó conectar.
    const alcanzables = new Set(Object.values(INVOICE_TRANSITIONS).map((rule) => rule.to));
    for (const status of Object.keys(InvoiceStatus)) {
      expect(
        alcanzables.has(status as (typeof INVOICE_STATUSES)[number]) || status === 'DRAFT',
        status,
      ).toBe(true);
    }
  });
});
