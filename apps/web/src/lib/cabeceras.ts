/**
 * Cabeceras de seguridad de la aplicación.
 *
 * Viven aquí y no dentro de `next.config.ts` por la misma razón que la lista de
 * rutas públicas: son una regla de seguridad, y una regla de seguridad que no se
 * puede probar acaba cambiando sin que nadie se entere. Desde el fichero de
 * configuración de Next no se puede escribir un test; desde aquí sí.
 *
 * Lo que cierra cada una:
 *
 * - **HSTS** obliga al navegador a volver siempre por HTTPS. Sin ella, el primer
 *   `http://` de la mañana viaja en claro con la cookie de sesión dentro.
 * - **frame-ancestors / X-Frame-Options** impiden meter la aplicación dentro de
 *   un iframe ajeno, que es como se roba un clic de «aprobar factura».
 * - **form-action** impide que un formulario inyectado mande los datos a otro
 *   sitio. **base-uri** impide que una etiqueta `<base>` inyectada redirija a
 *   otro servidor todos los scripts relativos de la página.
 * - **nosniff** evita que un fichero subido se ejecute porque el navegador crea
 *   adivinar que era JavaScript.
 * - **Referrer-Policy** evita que la URL de una factura viaje a un tercero en la
 *   cabecera `Referer` al pinchar un enlace de salida.
 *
 * ## Lo que todavía no cierra
 *
 * `script-src` lleva `'unsafe-inline'`. Next inyecta scripts en línea para
 * hidratar la página, y quitarlo obliga a firmar cada uno con un `nonce` que
 * genera el middleware en cada petición. Es el siguiente paso y hay que
 * comprobarlo contra el despliegue de verdad, así que se hace aparte y no
 * mezclado con esto: una cabecera mal puesta deja la aplicación en blanco sin
 * un solo error en el servidor.
 *
 * Aun con esa concesión, la política sirve: sin `script-src` no habría nada que
 * impidiera cargar un script de otro dominio, y `connect-src 'self'` deja sin
 * destino a cualquier intento de mandar datos fuera.
 */

/** Política de contenido, en el formato de la cabecera. */
export const POLITICA_CSP: string = [
  "default-src 'self'",
  // 'unsafe-inline' es la concesión explicada arriba. No se añade ningún
  // dominio externo: no hay analítica, ni fuentes, ni etiquetas de terceros.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind y Next escriben estilos en línea. Un estilo no ejecuta código.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Las peticiones del navegador sólo pueden ir al propio servidor. Es lo que
  // deja sin salida a un intento de sacar datos de la pantalla.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** Una cabecera, en el formato que espera Next. */
export interface Cabecera {
  readonly key: string;
  readonly value: string;
}

export const CABECERAS_SEGURIDAD: readonly Cabecera[] = [
  { key: 'Content-Security-Policy', value: POLITICA_CSP },
  // Dos años, subdominios incluidos. Sin `preload`: eso se pide una vez y no se
  // puede deshacer deprisa, y es una decisión del dominio, no del código.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Redundante con `frame-ancestors`, para navegadores que no la entienden.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No se usa ninguna de estas capacidades. Apagarlas evita que las use algo
  // que se cuele dentro de la página.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];
