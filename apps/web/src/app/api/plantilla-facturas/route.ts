import { plantillaCsv } from '@/lib/plantilla';
import { requireAnyPermission } from '@/lib/tenant-context';

/**
 * La plantilla de importación, en CSV (F2-04).
 *
 * Se genera en cada descarga a partir de las columnas y del plan de conceptos,
 * en vez de servir un fichero guardado en `public/`. Un fichero suelto se queda
 * desfasado en cuanto se añade un concepto, y la gente lo descubre después de
 * rellenarlo entero.
 *
 * Pide sesión aunque no lleve datos de nadie: es la misma puerta que el resto
 * de la aplicación, y abrir una excepción por comodidad es cómo se acumulan.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  await requireAnyPermission(['invoices:create']);

  return new Response(plantillaCsv(), {
    headers: {
      // `charset=utf-8` más el BOM de abajo: Excel en Windows abre el CSV como
      // ANSI si no ve ninguna de las dos cosas, y los acentos salen rotos.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="plantilla-facturas-itfin360.csv"',
      'cache-control': 'no-store',
    },
  });
}
