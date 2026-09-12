import Link from 'next/link';

import { Shell } from '@/components/shell';
import { COLUMNAS_OBLIGATORIAS } from '@/lib/importacion';
import { MAXIMO_FACTURAS } from '@/lib/importacion-alta';
import { CABECERAS_PLANTILLA, conceptosParaAyuda } from '@/lib/plantilla';
import { requirePermission } from '@/lib/tenant-context';

import { importar } from './acciones';
import { Importador } from './importador';

/**
 * Importación de facturas desde un fichero (F2-04).
 *
 * Teclear factura a factura sirve para probar. Para meter el histórico de un
 * departamento hace falta volcar el mayor de una vez, y esta pantalla es la
 * puerta.
 *
 * La ayuda está en la propia pantalla y no en un manual: la lista de conceptos
 * válidos es la que usa el lector, generada del mismo sitio, así que no puede
 * quedarse desfasada mientras alguien la copia en un Excel.
 */

const MENSAJE: Readonly<Record<string, string>> = {
  sin_fichero: 'No has elegido ningún fichero.',
  demasiado_grande: 'El fichero es demasiado grande. Divídelo en varias tandas.',
  con_errores: 'El fichero tiene errores. No se ha importado nada.',
  ilegible: 'No se ha podido leer el fichero.',
  rechazada: 'No se ha importado nada.',
};

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

export default async function ImportarPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('invoices:create');
  const parametros = await searchParams;
  const error = texto(parametros['error']);
  const detalle = texto(parametros['detalle']);
  const conceptos = conceptosParaAyuda();

  return (
    <Shell actual="/facturas">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/facturas" className="text-muted-foreground text-sm underline">
            Volver a facturas
          </Link>
          <h1 className="text-2xl font-semibold">Importar facturas</h1>
          <p className="text-muted-foreground text-sm">
            Una fila por línea de factura. Si una factura tiene varias partidas, repite el proveedor
            y el número en cada fila y se agrupan solas.
          </p>
        </div>

        {error !== '' ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {MENSAJE[error] ?? 'No se ha podido importar.'}
            {detalle === '' ? null : <span className="block pt-1 text-xs">{detalle}</span>}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 rounded border p-4">
          <h2 className="text-lg font-medium">Antes de empezar</h2>
          <p className="text-sm">
            Descarga la plantilla, pega tus datos y vuelve aquí. Puedes subirla como CSV o guardarla
            como Excel, da igual.{' '}
            <a className="underline" href="/api/plantilla-facturas">
              Descargar plantilla
            </a>
          </p>
          <p className="text-muted-foreground text-sm">
            Las columnas tienen que llamarse como en la plantilla. Obligatorias:{' '}
            <span className="font-mono text-xs">{COLUMNAS_OBLIGATORIAS.join(', ')}</span>. El resto
            se pueden dejar vacías: sin fecha de devengo se usa la de emisión, sin cantidad se
            entiende una, sin divisa euros, y el importe de línea se calcula si no viene.
          </p>
          <p className="text-muted-foreground text-sm">
            Orden completo de las columnas:{' '}
            <span className="font-mono text-xs">{CABECERAS_PLANTILLA.join(', ')}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Las fechas van como <span className="font-mono text-xs">2026-03-31</span> o{' '}
            <span className="font-mono text-xs">31/03/2026</span>. En Excel también valen las celdas
            con formato de fecha. Los importes en euros, con coma o con punto. Máximo{' '}
            {MAXIMO_FACTURAS} facturas por fichero.
          </p>
          <p className="text-muted-foreground text-sm">
            Los proveedores que no tengas dados de alta se crean solos, y al terminar se te dice
            cuáles.
          </p>
        </section>

        <Importador importar={importar} />

        <details className="rounded border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Conceptos válidos ({conceptos.length})
          </summary>
          <p className="text-muted-foreground pt-2 text-sm">
            En la columna <span className="font-mono text-xs">concepto</span> vale cualquiera de los
            dos: la etiqueta o el código. No distingue mayúsculas ni acentos.
          </p>
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b">
                  <th className="p-2 font-medium">Etiqueta</th>
                  <th className="p-2 font-medium">Código</th>
                </tr>
              </thead>
              <tbody>
                {conceptos.map((concepto) => (
                  <tr key={concepto.codigo} className="border-b">
                    <td className="p-2">{concepto.etiqueta}</td>
                    <td className="p-2 font-mono text-xs">{concepto.codigo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Shell>
  );
}
