'use client';

import { Button } from '@itfin360/ui';
import { useMemo, useState } from 'react';

import { parsearCsv } from '@/lib/csv';
import { formatearImporte } from '@/lib/formato';
import { importarFacturas } from '@/lib/importacion';

/**
 * Lectura del fichero y previsualización, en el navegador (F2-04).
 *
 * El fichero se lee y se analiza aquí, sin subirlo: los errores salen mientras
 * se elige el fichero, no después de una vuelta al servidor. Puede hacerse
 * porque `importarFacturas` es puro y no toca la base; el servidor vuelve a
 * hacer exactamente lo mismo antes de escribir nada, así que esto es comodidad
 * y no control.
 *
 * Nada de aquí importa `@itfin360/db`: ese paquete arrastra el cliente Prisma y
 * `pg`, y `pg` pide `fs` y `dns`, que en un navegador no existen.
 */

/** Cuántos errores se pintan antes de resumir. Mil filas malas no se leen. */
const ERRORES_VISIBLES = 25;

export function Importador({
  importar,
}: {
  readonly importar: (formData: FormData) => Promise<void>;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  const analisis = useMemo(
    () => (texto === null ? null : importarFacturas(parsearCsv(texto))),
    [texto],
  );

  const totalCents =
    analisis?.facturas.reduce((suma, factura) => suma + factura.grossCents, 0) ?? 0;
  const lineas = analisis?.facturas.reduce((suma, factura) => suma + factura.lines.length, 0) ?? 0;
  const divisas = new Set(analisis?.facturas.map((factura) => factura.currency) ?? []);
  const sePuedeImportar =
    analisis !== null && analisis.errores.length === 0 && analisis.facturas.length > 0;

  async function elegir(archivo: File | undefined): Promise<void> {
    if (archivo === undefined) {
      setTexto(null);
      return;
    }
    setLeyendo(true);
    try {
      setTexto(await archivo.text());
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2 text-sm">
        Fichero CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(evento) => void elegir(evento.target.files?.[0])}
          className="rounded border px-3 py-2"
        />
      </label>

      {leyendo ? <p className="text-muted-foreground text-sm">Leyendo el fichero…</p> : null}

      {analisis === null ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Lo que se va a importar</h2>

          <div className="flex flex-wrap gap-3">
            <Dato titulo="Facturas" valor={String(analisis.facturas.length)} />
            <Dato titulo="Líneas" valor={String(lineas)} />
            <Dato
              titulo="Total"
              valor={
                divisas.size > 1
                  ? 'varias divisas'
                  : formatearImporte(totalCents, [...divisas][0] ?? 'EUR')
              }
            />
            <Dato titulo="Errores" valor={String(analisis.errores.length)} />
          </div>

          {analisis.errores.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                No se importa nada mientras quede un error. Corrige el fichero y vuelve a elegirlo.
                Los números de fila son los mismos que ves en Excel.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left">
                    <tr className="border-b">
                      <th className="p-2 font-medium">Fila</th>
                      <th className="p-2 font-medium">Columna</th>
                      <th className="p-2 font-medium">Qué pasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analisis.errores.slice(0, ERRORES_VISIBLES).map((error, indice) => (
                      <tr
                        key={`${error.fila}-${error.columna ?? ''}-${indice}`}
                        className="border-b"
                      >
                        <td className="p-2 tabular-nums">{error.fila}</td>
                        <td className="p-2 font-mono text-xs">{error.columna ?? '—'}</td>
                        <td className="p-2">{error.mensaje}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analisis.errores.length > ERRORES_VISIBLES ? (
                <p className="text-muted-foreground text-xs">
                  Y {analisis.errores.length - ERRORES_VISIBLES} más. Suelen ser el mismo fallo
                  repetido: arregla estos y vuelve a subirlo.
                </p>
              ) : null}
            </div>
          ) : null}

          {analisis.errores.length === 0 && analisis.facturas.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b">
                    <th className="p-2 font-medium">Proveedor</th>
                    <th className="p-2 font-medium">Número</th>
                    <th className="p-2 font-medium">Devengo</th>
                    <th className="p-2 text-right font-medium">Líneas</th>
                    <th className="p-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {analisis.facturas.map((factura) => (
                    <tr key={`${factura.proveedor}-${factura.invoiceNumber}`} className="border-b">
                      <td className="p-2">{factura.proveedor}</td>
                      <td className="p-2 font-mono text-xs">{factura.invoiceNumber}</td>
                      <td className="p-2 tabular-nums">
                        {`${factura.accrualDate.year}-${String(factura.accrualDate.month).padStart(2, '0')}-${String(factura.accrualDate.day).padStart(2, '0')}`}
                      </td>
                      <td className="p-2 text-right tabular-nums">{factura.lines.length}</td>
                      <td className="p-2 text-right tabular-nums">
                        {formatearImporte(factura.grossCents, factura.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      )}

      <form action={importar} className="flex items-center gap-3">
        <input type="hidden" name="contenido" value={texto ?? ''} />
        <Button type="submit" disabled={!sePuedeImportar}>
          Importar
        </Button>
        <span className="text-muted-foreground text-xs">
          Todo entra en borrador. Para que cuente como gasto hay que mandarlo a revisión y
          aprobarlo, factura a factura.
        </span>
      </form>
    </div>
  );
}

function Dato({ titulo, valor }: { readonly titulo: string; readonly valor: string }) {
  return (
    <div className="min-w-28 rounded border p-3">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className="text-sm font-medium">{valor}</p>
    </div>
  );
}
