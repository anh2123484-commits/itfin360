'use server';

import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { type Importacion, importarFacturas } from '@/lib/importacion';
import {
  ImportacionRechazada,
  importarADatos,
  type ResumenImportacion,
} from '@/lib/importacion-alta';
import { leerFichero } from '@/lib/lectura';
import { requirePermission } from '@/lib/tenant-context';
import { ExcelInvalido } from '@/lib/xlsx';

/**
 * Importar el fichero (F2-04).
 *
 * La pantalla ya ha leído el fichero y ha enseñado lo que va a entrar, pero
 * aquí se vuelve a leer entero desde el binario original. Lo que llega del
 * navegador es un fichero, no una decisión: si el servidor se fiara del resumen
 * que le manda la pantalla, una petición armada a mano metería facturas que
 * nadie ha validado. La previsualización es comodidad; el control está aquí.
 */

/** Tope de tamaño del fichero. Vercel corta los cuerpos grandes de todas formas. */
const MAXIMO_BYTES = 4 * 1024 * 1024;

export async function importar(formData: FormData): Promise<void> {
  const principal = await requirePermission('invoices:create');

  const fichero = formData.get('fichero');
  if (!(fichero instanceof File) || fichero.size === 0) {
    redirect('/facturas/importar?error=sin_fichero');
  }
  if (fichero.size > MAXIMO_BYTES) {
    redirect('/facturas/importar?error=demasiado_grande');
  }

  // El `redirect` de Next funciona lanzando, así que fuera de cualquier `try`:
  // dentro, el `catch` de al lado lo confundiría con un fallo de lectura.
  let lectura: Importacion;
  try {
    const { tabla } = await leerFichero(await fichero.arrayBuffer());
    lectura = importarFacturas(tabla);
  } catch (error) {
    if (error instanceof ExcelInvalido) {
      redirect(`/facturas/importar?error=ilegible&detalle=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  if (lectura.errores.length > 0) {
    // La pantalla ya los había enseñado. Llegar aquí con errores significa que
    // la petición no viene de la pantalla, así que no se detalla nada más.
    redirect(`/facturas/importar?error=con_errores&cuantos=${lectura.errores.length}`);
  }

  let resumen: ResumenImportacion;
  try {
    resumen = await db().withTenant(principal.tenantId, (tx) =>
      importarADatos(tx, principal, lectura.facturas),
    );
  } catch (error) {
    if (error instanceof ImportacionRechazada) {
      // La transacción se ha deshecho entera: no ha entrado ni una factura.
      redirect(`/facturas/importar?error=rechazada&detalle=${encodeURIComponent(error.detalle)}`);
    }
    throw error;
  }

  const parametros = new URLSearchParams({
    importadas: String(resumen.facturas),
    lineas: String(resumen.lineas),
  });
  if (resumen.proveedoresNuevos.length > 0) {
    parametros.set('proveedores', resumen.proveedoresNuevos.join(', '));
  }
  redirect(`/facturas?${parametros.toString()}`);
}
