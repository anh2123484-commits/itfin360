'use server';

import { redirect } from 'next/navigation';

import { parsearCsv } from '@/lib/csv';
import { db } from '@/lib/db';
import { importarFacturas } from '@/lib/importacion';
import {
  ImportacionRechazada,
  importarADatos,
  type ResumenImportacion,
} from '@/lib/importacion-alta';
import { requirePermission } from '@/lib/tenant-context';

/**
 * Importar el fichero (F2-04).
 *
 * La pantalla ya ha leído el fichero y ha enseñado lo que va a entrar, pero
 * aquí se vuelve a parsear el contenido desde cero. Lo que llega del navegador
 * es texto, no una decisión: si el servidor se fiara del resumen que le manda
 * la pantalla, una petición armada a mano metería facturas que nadie ha
 * validado. La previsualización es comodidad; el control está aquí.
 */

/** Tope de tamaño del fichero. Vercel corta los cuerpos grandes de todas formas. */
const MAXIMO_BYTES = 900_000;

export async function importar(formData: FormData): Promise<void> {
  const principal = await requirePermission('invoices:create');

  const contenido = formData.get('contenido');
  if (typeof contenido !== 'string' || contenido.trim() === '') {
    redirect('/facturas/importar?error=sin_fichero');
  }
  if (contenido.length > MAXIMO_BYTES) {
    redirect('/facturas/importar?error=demasiado_grande');
  }

  const { facturas, errores } = importarFacturas(parsearCsv(contenido));
  if (errores.length > 0) {
    // La pantalla ya los había enseñado. Llegar aquí con errores significa que
    // la petición no viene de la pantalla, así que no se detalla nada más.
    redirect(`/facturas/importar?error=con_errores&cuantos=${errores.length}`);
  }

  let resumen: ResumenImportacion;
  try {
    resumen = await db().withTenant(principal.tenantId, (tx) =>
      importarADatos(tx, principal, facturas),
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
