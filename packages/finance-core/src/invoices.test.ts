import { describe, expect, it } from 'vitest';

import { CONCEPT_DEFINITIONS, SPEND_CONCEPTS } from './concepts.js';
import { parseIsoDate } from './dates.js';
import {
  DEFAULT_BASE_CURRENCY,
  type InvoiceIssue,
  type ValidatableInvoice,
  type ValidatableInvoiceLine,
  isCoherentInvoice,
  lineNetCents,
  linesNetCents,
  validateInvoice,
} from './invoices.js';
import { cents } from './money.js';

const linea = (overrides: Partial<ValidatableInvoiceLine> = {}): ValidatableInvoiceLine => ({
  lineNumber: 1,
  quantity: 1,
  unitPriceCents: cents(10_000),
  netCents: cents(10_000),
  concept: 'SAAS_SUBSCRIPTION',
  costType: 'OPEX_RECURRING',
  ...overrides,
});

const factura = (overrides: Partial<ValidatableInvoice> = {}): ValidatableInvoice => ({
  netCents: cents(10_000),
  vatCents: cents(2_100),
  grossCents: cents(12_100),
  currency: 'EUR',
  issueDate: parseIsoDate('2026-03-31'),
  lines: [linea()],
  ...overrides,
});

const codigos = (problemas: readonly InvoiceIssue[]): string[] => problemas.map((p) => p.code);

describe('lineNetCents', () => {
  it('redondea una sola vez, al final', () => {
    // 3 × 33,33 € = 99,99 €. Redondear el precio antes daría 100,00 €.
    expect(lineNetCents(3, cents(3_333))).toBe(9_999);
  });

  it('el medio céntimo sube, y baja igual en negativo', () => {
    expect(lineNetCents(0.5, cents(5))).toBe(3);
    expect(lineNetCents(-0.5, cents(5))).toBe(-3);
  });

  it('una cantidad no finita no se redondea a ciegas', () => {
    expect(() => lineNetCents(Number.NaN, cents(100))).toThrow(RangeError);
    expect(() => lineNetCents(Number.POSITIVE_INFINITY, cents(100))).toThrow(RangeError);
  });
});

describe('linesNetCents', () => {
  it('suma los netos declarados', () => {
    expect(
      linesNetCents([
        linea({ lineNumber: 1, netCents: cents(10_000) }),
        linea({ lineNumber: 2, netCents: cents(-2_500) }),
      ]),
    ).toBe(7_500);
  });

  it('sin líneas, cero', () => {
    expect(linesNetCents([])).toBe(0);
  });
});

describe('una factura que cuadra', () => {
  it('no da ningún problema', () => {
    expect(validateInvoice(factura())).toEqual([]);
    expect(isCoherentInvoice(factura())).toBe(true);
  });

  it('acepta el IVA a cero: exento, intracomunitario o inversión del sujeto pasivo', () => {
    const f = factura({ vatCents: cents(0), grossCents: cents(10_000) });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('acepta un abono entero en negativo', () => {
    const f = factura({
      netCents: cents(-10_000),
      vatCents: cents(-2_100),
      grossCents: cents(-12_100),
      lines: [linea({ quantity: -1, netCents: cents(-10_000) })],
    });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('acepta una línea de descuento dentro de una factura positiva', () => {
    // Un descuento es una línea negativa, no un abono: la cabecera sigue siendo
    // positiva y la suma es la que manda.
    const f = factura({
      netCents: cents(9_000),
      vatCents: cents(1_890),
      grossCents: cents(10_890),
      lines: [
        linea({ lineNumber: 1 }),
        linea({
          lineNumber: 2,
          quantity: 1,
          unitPriceCents: cents(-1_000),
          netCents: cents(-1_000),
        }),
      ],
    });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('la fecha de devengo anterior a la de emisión no es un error', () => {
    // El servicio de enero se factura en febrero. Es lo normal.
    const f = factura({
      issueDate: parseIsoDate('2026-02-05'),
      serviceStart: parseIsoDate('2026-01-01'),
      serviceEnd: parseIsoDate('2026-01-31'),
      dueDate: parseIsoDate('2026-03-07'),
    });
    expect(validateInvoice(f)).toEqual([]);
  });
});

describe('importes que no cuadran', () => {
  it('la suma de las líneas tiene que ser la base de la cabecera', () => {
    const f = factura({ lines: [linea({ netCents: cents(9_000), unitPriceCents: cents(9_000) })] });
    expect(codigos(validateInvoice(f))).toContain('NET_MISMATCH');
  });

  it('base más IVA tiene que ser el total', () => {
    const f = factura({ grossCents: cents(12_000) });
    expect(codigos(validateInvoice(f))).toContain('GROSS_MISMATCH');
  });

  it('el mensaje dice los dos importes, para poder corregirlo sin abrir la base', () => {
    const f = factura({ grossCents: cents(12_000) });
    const problema = validateInvoice(f).find((p) => p.code === 'GROSS_MISMATCH');
    expect(problema?.message).toContain('12000');
    expect(problema?.message).toContain('12100');
  });

  it('base e IVA con signos contrarios: o es factura, o es abono', () => {
    const f = factura({ vatCents: cents(-2_100), grossCents: cents(7_900) });
    expect(codigos(validateInvoice(f))).toContain('VAT_SIGN_MISMATCH');
  });

  it('una factura sin líneas no se puede imputar a nada', () => {
    const f = factura({ lines: [] });
    const problemas = codigos(validateInvoice(f));
    expect(problemas).toContain('NO_LINES');
    // Sin líneas no se acusa además de descuadre: el problema es uno, no dos.
    expect(problemas).not.toContain('NET_MISMATCH');
  });
});

describe('problemas de línea', () => {
  it('la línea declara lo que dan cantidad y precio', () => {
    const f = factura({
      netCents: cents(9_000),
      vatCents: cents(1_890),
      grossCents: cents(10_890),
      lines: [linea({ quantity: 3, unitPriceCents: cents(3_000), netCents: cents(9_500) })],
    });
    const problema = validateInvoice(f).find((p) => p.code === 'LINE_NET_MISMATCH');
    expect(problema?.lineNumber).toBe(1);
  });

  it('dos líneas con el mismo número se detectan antes de que las rechace la base', () => {
    const f = factura({
      netCents: cents(20_000),
      vatCents: cents(4_200),
      grossCents: cents(24_200),
      lines: [linea({ lineNumber: 1 }), linea({ lineNumber: 1 })],
    });
    expect(codigos(validateInvoice(f))).toContain('DUPLICATE_LINE_NUMBER');
  });

  it('una cantidad de cero o no numérica no vale', () => {
    for (const quantity of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = factura({ lines: [linea({ quantity })] });
      expect(codigos(validateInvoice(f)), String(quantity)).toContain('INVALID_QUANTITY');
    }
  });

  it('una cantidad inválida no arrastra además un descuadre de línea', () => {
    const f = factura({ lines: [linea({ quantity: 0 })] });
    expect(codigos(validateInvoice(f))).not.toContain('LINE_NET_MISMATCH');
  });

  it('el concepto se valida con la misma regla que el resto del motor', () => {
    const f = factura({ lines: [linea({ costType: 'CAPEX' })] });
    const problema = validateInvoice(f).find((p) => p.code === 'COST_TYPE_MISMATCH');
    expect(problema?.lineNumber).toBe(1);
  });

  it('un activo colgado de un concepto que no capitaliza se señala en su línea', () => {
    const f = factura({ lines: [linea({ assetId: 'act-1' })] });
    expect(codigos(validateInvoice(f))).toContain('ASSET_ON_NON_CAPEX');
  });

  it('todo problema de línea lleva su número de línea', () => {
    const f = factura({
      netCents: cents(20_000),
      vatCents: cents(4_200),
      grossCents: cents(24_200),
      lines: [linea({ lineNumber: 7, costType: 'CAPEX' }), linea({ lineNumber: 9, quantity: 0 })],
    });
    for (const problema of validateInvoice(f)) {
      if (problema.code === 'NET_MISMATCH') continue;
      expect([7, 9], problema.code).toContain(problema.lineNumber);
    }
  });
});

describe('fechas', () => {
  it('el vencimiento no puede ser anterior a la emisión', () => {
    const f = factura({ dueDate: parseIsoDate('2026-03-30') });
    expect(codigos(validateInvoice(f))).toContain('DUE_BEFORE_ISSUE');
  });

  it('vencer el mismo día de la emisión es válido', () => {
    const f = factura({ dueDate: parseIsoDate('2026-03-31') });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('el periodo de servicio no termina antes de empezar', () => {
    const f = factura({
      serviceStart: parseIsoDate('2026-04-01'),
      serviceEnd: parseIsoDate('2026-03-01'),
    });
    expect(codigos(validateInvoice(f))).toContain('SERVICE_PERIOD_REVERSED');
  });

  it('un periodo de servicio de un solo día es válido', () => {
    const f = factura({
      serviceStart: parseIsoDate('2026-03-01'),
      serviceEnd: parseIsoDate('2026-03-01'),
    });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('medio periodo declarado no se juzga', () => {
    expect(validateInvoice(factura({ serviceStart: parseIsoDate('2026-04-01') }))).toEqual([]);
    expect(validateInvoice(factura({ serviceEnd: parseIsoDate('2026-01-01') }))).toEqual([]);
  });
});

describe('divisa y tipo de cambio', () => {
  it('la divisa por defecto es el euro', () => {
    expect(DEFAULT_BASE_CURRENCY).toBe('EUR');
  });

  it('una factura en otra divisa necesita el tipo con el que se contabilizó', () => {
    const f = factura({ currency: 'USD' });
    expect(codigos(validateInvoice(f))).toContain('FX_RATE_MISSING');
  });

  it('con el tipo puesto, cuadra', () => {
    const f = factura({ currency: 'USD', fxRate: 0.92 });
    expect(validateInvoice(f)).toEqual([]);
  });

  it('un tipo de cero o negativo no es un tipo', () => {
    for (const fxRate of [0, -1, Number.NaN]) {
      const f = factura({ currency: 'USD', fxRate });
      expect(codigos(validateInvoice(f)), String(fxRate)).toContain('FX_RATE_NOT_POSITIVE');
    }
  });

  it('una factura en la divisa propia no lleva tipo', () => {
    // Guardar un tipo distinto de 1 sobre la divisa propia hace que la misma
    // factura valga dos importes según quién la lea.
    const f = factura({ fxRate: 1.05 });
    expect(codigos(validateInvoice(f))).toContain('FX_RATE_ON_BASE_CURRENCY');
  });

  it('un tipo de 1 sobre la divisa propia es redundante pero no incoherente', () => {
    expect(validateInvoice(factura({ fxRate: 1 }))).toEqual([]);
  });

  it('un tipo inválido no se acusa además de sobrante', () => {
    const problemas = codigos(validateInvoice(factura({ fxRate: 0 })));
    expect(problemas).toContain('FX_RATE_NOT_POSITIVE');
    expect(problemas).not.toContain('FX_RATE_ON_BASE_CURRENCY');
  });

  it('el tenant puede contabilizar en otra divisa', () => {
    const opciones = { baseCurrency: 'USD' };
    expect(validateInvoice(factura({ currency: 'USD' }), opciones)).toEqual([]);
    expect(codigos(validateInvoice(factura({ currency: 'EUR' }), opciones))).toContain(
      'FX_RATE_MISSING',
    );
  });
});

describe('recorrido completo', () => {
  it('todo concepto del plan cuadra con su propio tipo de coste', () => {
    // Si un concepto nuevo entra en el plan con una definición incoherente,
    // esto lo enseña antes de que llegue a una factura real.
    for (const concept of SPEND_CONCEPTS) {
      const f = factura({
        lines: [linea({ concept, costType: CONCEPT_DEFINITIONS[concept].costType })],
      });
      expect(validateInvoice(f), concept).toEqual([]);
    }
  });

  it('una factura con varios problemas los devuelve todos, cabecera antes que líneas', () => {
    const f = factura({
      grossCents: cents(1),
      currency: 'USD',
      dueDate: parseIsoDate('2026-01-01'),
      lines: [linea({ quantity: 0 })],
    });
    const orden = codigos(validateInvoice(f));
    expect(orden).toEqual([
      'GROSS_MISMATCH',
      'DUE_BEFORE_ISSUE',
      'FX_RATE_MISSING',
      'INVALID_QUANTITY',
    ]);
    expect(isCoherentInvoice(f)).toBe(false);
  });
});
