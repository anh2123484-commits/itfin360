'use client';

import { SpendConcept } from '@itfin360/db';
import { cents, CONCEPT_DEFINITIONS, lineNetCents } from '@itfin360/finance-core';
import { Button } from '@itfin360/ui';
import { useState } from 'react';

import { formatearImporte } from '@/lib/formato';
import { importeEditable, parsearCantidad, parsearImporte } from '@/lib/importes';

/**
 * Alta de factura con sus líneas.
 *
 * Es el único componente de cliente de la aplicación, y lo es por una razón:
 * las líneas se añaden y se quitan, y el descuadre hay que verlo **mientras se
 * teclea**, no después de mandar. Descubrir en el servidor que la suma no da
 * obliga a rehacer el camino entero.
 *
 * El neto de cada línea y la suma salen de `finance-core`, las mismas funciones
 * que valida el servidor. Reescribir la aritmética aquí sería tener dos motores
 * de cálculo, y el de la pantalla sería el que nadie prueba.
 */

interface Proveedor {
  readonly id: string;
  readonly name: string;
}

/** Una línea mientras se teclea: todo texto, porque a medias no es un número. */
interface LineaEditada {
  readonly clave: number;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  /** Texto plano: lo valida el servidor con el enum del esquema. */
  readonly concept: string;
}

const CONCEPTO_INICIAL = 'SAAS_SUBSCRIPTION';

function lineaVacia(clave: number): LineaEditada {
  return { clave, description: '', quantity: '1', unitPrice: '', concept: CONCEPTO_INICIAL };
}

/** Neto de la línea, o `null` si todavía no es un número. */
function netoDeLinea(linea: LineaEditada): number | null {
  const cantidad = parsearCantidad(linea.quantity);
  const precio = parsearImporte(linea.unitPrice);
  if (cantidad === null || precio === null) return null;
  // La misma función que usa el servidor: redondeo una sola vez, al final.
  return lineNetCents(cantidad, cents(precio));
}

export function FormularioFactura({
  proveedores,
  accion,
  error,
}: {
  readonly proveedores: readonly Proveedor[];
  readonly accion: (formData: FormData) => Promise<void>;
  readonly error?: string | undefined;
}) {
  const [lineas, setLineas] = useState<LineaEditada[]>([lineaVacia(1)]);
  const [vatTexto, setVatTexto] = useState('');
  const [siguienteClave, setSiguienteClave] = useState(2);
  const [vendorId, setVendorId] = useState(proveedores[0]?.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [accrualDate, setAccrualDate] = useState('');

  const netos = lineas.map(netoDeLinea);
  const completas = netos.every((neto) => neto !== null);
  const base = netos.reduce<number>((total, neto) => total + (neto ?? 0), 0);
  const iva = parsearImporte(vatTexto) ?? 0;
  const total = base + iva;

  type Campo = 'description' | 'quantity' | 'unitPrice' | 'concept';

  const cambiar = (clave: number, campo: Campo, valor: string): void => {
    setLineas((actuales) =>
      actuales.map((linea) => (linea.clave === clave ? { ...linea, [campo]: valor } : linea)),
    );
  };

  const anadir = (): void => {
    setLineas((actuales) => [...actuales, lineaVacia(siguienteClave)]);
    setSiguienteClave((n) => n + 1);
  };

  const quitar = (clave: number): void => {
    setLineas((actuales) =>
      actuales.length === 1 ? actuales : actuales.filter((linea) => linea.clave !== clave),
    );
  };

  const listo =
    vendorId !== '' &&
    invoiceNumber.trim() !== '' &&
    issueDate !== '' &&
    accrualDate !== '' &&
    completas &&
    (vatTexto.trim() === '' || parsearImporte(vatTexto) !== null) &&
    lineas.every((linea) => linea.description.trim() !== '');

  /**
   * Lo que se manda al servidor, con los importes ya en céntimos.
   *
   * El servidor lo vuelve a validar entero con el mismo esquema: esto es
   * comodidad para quien teclea, no un control. Un cuerpo tocado a mano se
   * estrella igual contra `altaFactura` y contra `validateInvoice`.
   */
  const payload = JSON.stringify({
    vendorId,
    invoiceNumber: invoiceNumber.trim(),
    issueDate,
    accrualDate,
    netCents: base,
    vatCents: iva,
    grossCents: total,
    lines: lineas.map((linea, indice) => ({
      lineNumber: indice + 1,
      description: linea.description.trim(),
      quantity: parsearCantidad(linea.quantity) ?? 0,
      unitPriceCents: parsearImporte(linea.unitPrice) ?? 0,
      netCents: netos[indice] ?? 0,
      concept: linea.concept,
      costType: CONCEPT_DEFINITIONS[linea.concept as keyof typeof CONCEPT_DEFINITIONS].costType,
    })),
  });

  return (
    <form action={accion} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />
      {error !== undefined && error !== '' ? (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
      ) : null}

      <section className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Proveedor
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-56 rounded border px-3 py-2"
          >
            {proveedores.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.id}>
                {proveedor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Número de factura
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            maxLength={100}
            className="w-44 rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Emisión
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Devengo
          <input
            type="date"
            value={accrualDate}
            onChange={(e) => setAccrualDate(e.target.value)}
            className="rounded border px-3 py-2"
          />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Líneas</h2>
        {lineas.map((linea, indice) => (
          <div key={linea.clave} className="flex flex-wrap items-end gap-2 border-b pb-3">
            <label className="flex flex-col gap-1 text-sm">
              Descripción
              <input
                value={linea.description}
                onChange={(e) => cambiar(linea.clave, 'description', e.target.value)}
                maxLength={500}
                className="w-56 rounded border px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Concepto
              <select
                value={linea.concept}
                onChange={(e) => cambiar(linea.clave, 'concept', e.target.value)}
                className="w-52 rounded border px-3 py-2"
              >
                {Object.keys(SpendConcept).map((concepto) => (
                  <option key={concepto} value={concepto}>
                    {CONCEPT_DEFINITIONS[concepto as keyof typeof CONCEPT_DEFINITIONS].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cantidad
              <input
                value={linea.quantity}
                onChange={(e) => cambiar(linea.clave, 'quantity', e.target.value)}
                className="w-20 rounded border px-3 py-2 text-right"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Precio unidad
              <input
                value={linea.unitPrice}
                onChange={(e) => cambiar(linea.clave, 'unitPrice', e.target.value)}
                placeholder="0,00"
                className="w-28 rounded border px-3 py-2 text-right"
              />
            </label>
            <p className="min-w-[7rem] pb-2 text-right text-sm tabular-nums">
              {netos[indice] === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                formatearImporte(netos[indice] ?? 0, 'EUR')
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => quitar(linea.clave)}
              disabled={lineas.length === 1}
            >
              Quitar
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={anadir}>
            Añadir línea
          </Button>
        </div>
        {/* El tipo de coste no se teclea: sale del concepto, y el servidor lo
            vuelve a comprobar con `validateLineConcept`. Dejar elegir los dos
            por separado es dejar que no encajen. */}
        <p className="text-muted-foreground text-xs">
          El tipo de coste lo decide el concepto. No se elige por separado.
        </p>
      </section>

      <section className="flex flex-wrap items-end gap-6">
        <label className="flex flex-col gap-1 text-sm">
          IVA
          <input
            value={vatTexto}
            onChange={(e) => setVatTexto(e.target.value)}
            placeholder="0,00"
            className="w-28 rounded border px-3 py-2 text-right"
          />
        </label>
        <div className="text-sm">
          <p>
            Base <strong className="tabular-nums">{formatearImporte(base, 'EUR')}</strong>
          </p>
          <p>
            IVA <strong className="tabular-nums">{formatearImporte(iva, 'EUR')}</strong>
          </p>
          <p>
            Total <strong className="tabular-nums">{formatearImporte(total, 'EUR')}</strong>
          </p>
        </div>
        {vatTexto.trim() !== '' && parsearImporte(vatTexto) === null ? (
          <p className="text-sm text-red-700">
            El IVA no se entiende. Escríbelo como 210,00 y con dos decimales como mucho.
          </p>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!listo}>
          Guardar como borrador
        </Button>
        <span className="text-muted-foreground text-sm">
          {listo
            ? `La factura cuadra: ${formatearImporte(base, 'EUR')} de base.`
            : 'Faltan datos por rellenar.'}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        Se guarda en borrador. Para que cuente como gasto hay que mandarla a revisión y aprobarla, y
        cada paso queda auditado. El importe de ejemplo se escribe {importeEditable(123_456)}.
      </p>
    </form>
  );
}
