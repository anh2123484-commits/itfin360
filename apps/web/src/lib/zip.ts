/**
 * Lectura de ficheros ZIP, sin dependencias (F2-04, segunda entrega).
 *
 * Un `.xlsx` es un ZIP con XML dentro, así que para leer Excel hay que saber
 * abrir un ZIP. Se escribe aquí en vez de traer una librería por dos razones:
 * la parte que hace falta es pequeña y acotada (leer, nunca escribir), y una
 * dependencia que procesa ficheros que suben usuarios es superficie de ataque
 * que hay que mantener vigilada para siempre.
 *
 * Descomprime con `DecompressionStream`, que es parte de la plataforma y existe
 * igual en el navegador y en el servidor. Por eso el mismo código sirve para la
 * previsualización y para la importación de verdad, sin dos implementaciones
 * que puedan interpretar el mismo fichero de dos maneras.
 *
 * Sólo soporta lo que usa un `.xlsx`: entradas guardadas tal cual (método 0) y
 * comprimidas con deflate (método 8). Cualquier otra cosa se rechaza en vez de
 * devolver basura.
 */

/** El ZIP no se puede leer. */
export class ZipInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ZipInvalido';
  }
}

const FIRMA_FIN_DIRECTORIO = 0x06054b50;
const FIRMA_ENTRADA_DIRECTORIO = 0x02014b50;
const FIRMA_CABECERA_LOCAL = 0x04034b50;

/** Tamaño mínimo del bloque final del ZIP, sin comentario. */
const FIN_DIRECTORIO_BYTES = 22;

/** Tope de entradas. Un `.xlsx` normal tiene decenas, no miles. */
const MAXIMO_ENTRADAS = 512;

/**
 * Tope de bytes descomprimidos en todo el ZIP, no por entrada.
 *
 * Por entrada no sirve de nada: con 512 entradas permitidas, un tope de 64 MB
 * cada una da un presupuesto de 32 GB por petición. El que cuenta es el total.
 */
const MAXIMO_DESCOMPRIMIDO = 32 * 1024 * 1024;

const MENSAJE_DEMASIADO_GRANDE =
  'El fichero comprimido expande a demasiados datos. Puede ser un fichero preparado para agotar la memoria del servidor.';

/**
 * Posición del bloque final del directorio.
 *
 * Se busca desde el final porque el ZIP permite un comentario detrás, de hasta
 * 64 KiB. Buscar desde el principio encontraría la firma dentro de los datos de
 * algún fichero comprimido, que es exactamente la clase de fallo que sólo
 * aparece con el fichero de un cliente y nunca con el de prueba.
 */
function posicionFinDirectorio(vista: DataView): number {
  const minimo = Math.max(0, vista.byteLength - FIN_DIRECTORIO_BYTES - 0xffff);
  for (let i = vista.byteLength - FIN_DIRECTORIO_BYTES; i >= minimo; i -= 1) {
    if (vista.getUint32(i, true) === FIRMA_FIN_DIRECTORIO) return i;
  }
  throw new ZipInvalido('No parece un fichero ZIP: no se encuentra su índice.');
}

/**
 * Descomprime una entrada sin pasar de `tope` bytes.
 *
 * Se lee el flujo por trozos y se corta en cuanto se pasa, en vez de volcar todo
 * a memoria y medirlo después. La diferencia importa: 1 MB de deflate expande a
 * más de 1 GB con contenido repetitivo (ratio medido 1028:1), y para cuando se
 * mide ya se ha reservado la memoria.
 *
 * El tamaño que declara el ZIP en su índice **no se usa como límite**, sólo como
 * pista para descartar entradas antes de empezar. Lo escribe quien fabrica el
 * fichero: ponerlo a cero haría pasar cualquier comprobación previa.
 */
async function descomprimir(
  datos: Uint8Array,
  metodo: number,
  declarado: number,
  tope: number,
): Promise<Uint8Array> {
  if (metodo === 0) {
    if (datos.byteLength > tope) throw new ZipInvalido(MENSAJE_DEMASIADO_GRANDE);
    return datos;
  }
  if (metodo !== 8) {
    throw new ZipInvalido(`El ZIP usa un método de compresión que no se soporta (${metodo}).`);
  }
  // Si ya lo declara demasiado grande, no hace falta ni empezar.
  if (declarado > tope) throw new ZipInvalido(MENSAJE_DEMASIADO_GRANDE);

  const entrada = new Blob([datos as BlobPart]).stream();
  // `deflate-raw` y no `deflate`: dentro de un ZIP los datos van sin la
  // cabecera zlib. Con `deflate` falla con un error de formato que no dice nada.
  const lector = entrada.pipeThrough(new DecompressionStream('deflate-raw')).getReader();

  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > tope) throw new ZipInvalido(MENSAJE_DEMASIADO_GRANDE);
      trozos.push(value);
    }
  } finally {
    // Cancelar suelta el descompresor aunque hayamos cortado a mitad.
    await lector.cancel().catch(() => undefined);
  }

  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const trozo of trozos) {
    salida.set(trozo, cursor);
    cursor += trozo.byteLength;
  }
  return salida;
}

/** Una entrada del índice del ZIP, sin descomprimir todavía. */
interface EntradaIndice {
  readonly nombre: string;
  readonly metodo: number;
  readonly inicioDatos: number;
  readonly comprimido: number;
  readonly descomprimido: number;
}

/**
 * Recorre el índice del ZIP sin descomprimir nada.
 *
 * Se recorre el directorio central, no las cabeceras locales encadenadas: el
 * directorio es el índice de verdad del formato, y las cabeceras locales pueden
 * mentir sobre el tamaño cuando el ZIP se escribió en streaming.
 */
function indiceDelZip(buffer: ArrayBuffer): readonly EntradaIndice[] {
  if (buffer.byteLength < FIN_DIRECTORIO_BYTES) {
    throw new ZipInvalido('El fichero está vacío o cortado.');
  }
  const vista = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const fin = posicionFinDirectorio(vista);

  const totalEntradas = vista.getUint16(fin + 10, true);
  if (totalEntradas > MAXIMO_ENTRADAS) {
    throw new ZipInvalido(`El ZIP trae ${totalEntradas} ficheros, demasiados para un .xlsx.`);
  }

  const decodificador = new TextDecoder('utf-8');
  const entradas: EntradaIndice[] = [];
  let cursor = vista.getUint32(fin + 16, true);

  for (let i = 0; i < totalEntradas; i += 1) {
    if (
      cursor + 46 > buffer.byteLength ||
      vista.getUint32(cursor, true) !== FIRMA_ENTRADA_DIRECTORIO
    ) {
      throw new ZipInvalido('El índice del ZIP está corrupto.');
    }
    const metodo = vista.getUint16(cursor + 10, true);
    const comprimido = vista.getUint32(cursor + 20, true);
    const descomprimido = vista.getUint32(cursor + 24, true);
    const largoNombre = vista.getUint16(cursor + 28, true);
    const largoExtra = vista.getUint16(cursor + 30, true);
    const largoComentario = vista.getUint16(cursor + 32, true);
    const inicioLocal = vista.getUint32(cursor + 42, true);
    const nombre = decodificador.decode(bytes.subarray(cursor + 46, cursor + 46 + largoNombre));

    if (
      inicioLocal + 30 > buffer.byteLength ||
      vista.getUint32(inicioLocal, true) !== FIRMA_CABECERA_LOCAL
    ) {
      throw new ZipInvalido(`La entrada "${nombre}" apunta fuera del fichero.`);
    }
    // Los tamaños de nombre y extra de la cabecera local pueden no coincidir
    // con los del directorio, así que los datos se localizan con los de aquí.
    const localNombre = vista.getUint16(inicioLocal + 26, true);
    const localExtra = vista.getUint16(inicioLocal + 28, true);
    const inicioDatos = inicioLocal + 30 + localNombre + localExtra;
    if (inicioDatos + comprimido > buffer.byteLength) {
      throw new ZipInvalido(`Los datos de "${nombre}" están cortados.`);
    }

    // Las carpetas entran en el directorio como entradas vacías. No son ficheros.
    if (!nombre.endsWith('/')) {
      entradas.push({ nombre, metodo, inicioDatos, comprimido, descomprimido });
    }
    cursor += 46 + largoNombre + largoExtra + largoComentario;
  }

  return entradas;
}

/**
 * Nombres de los ficheros que hay dentro, sin descomprimir ni uno.
 *
 * Sirve para decidir qué hace falta antes de gastar nada. Leer el índice cuesta
 * lo que mide el índice; descomprimir lo que no se va a usar es trabajo regalado
 * a quien suba el fichero.
 */
export function listarZip(buffer: ArrayBuffer): readonly string[] {
  return indiceDelZip(buffer).map((entrada) => entrada.nombre);
}

/**
 * Descomprime las entradas pedidas y las devuelve por nombre.
 *
 * Todas comparten un mismo presupuesto de bytes: lo que gasta una se lo quita a
 * las siguientes. Con un tope por entrada no serviría de nada, porque basta
 * repetir la misma entrada las veces que permita el índice.
 */
export async function leerZip(
  buffer: ArrayBuffer,
  cuales: readonly string[],
): Promise<ReadonlyMap<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const pedidas = new Set(cuales);
  const ficheros = new Map<string, Uint8Array>();
  let presupuesto = MAXIMO_DESCOMPRIMIDO;

  for (const entrada of indiceDelZip(buffer)) {
    if (!pedidas.has(entrada.nombre)) continue;
    const crudos = bytes.subarray(entrada.inicioDatos, entrada.inicioDatos + entrada.comprimido);
    const salida = await descomprimir(crudos, entrada.metodo, entrada.descomprimido, presupuesto);
    presupuesto -= salida.byteLength;
    ficheros.set(entrada.nombre, salida);
  }

  return ficheros;
}

/** Un fichero del ZIP como texto, o `null` si no está. */
export function textoDe(ficheros: ReadonlyMap<string, Uint8Array>, ruta: string): string | null {
  const datos = ficheros.get(ruta);
  if (datos === undefined) return null;
  return new TextDecoder('utf-8').decode(datos);
}
