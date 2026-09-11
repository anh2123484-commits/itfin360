/**
 * Importes tecleados por una persona, en euros, convertidos a céntimos.
 *
 * Nadie teclea céntimos. Se teclea «1.234,56», o «1234,56», o «1234.56» si el
 * teclado numérico pone punto. Las tres son el mismo importe y las tres tienen
 * que entrar: rechazar una factura por el separador decimal es la clase de
 * fricción que devuelve a la gente al Excel.
 *
 * Devuelve `null` cuando no hay un importe válido, en vez de un cero. Quien
 * llama decide si eso es un campo vacío o un error, y así un campo sin rellenar
 * nunca se convierte en «0,00 €» sin que nadie lo haya escrito.
 */

/** Espacios de cualquier tipo (`\s` incluye los duros) y el símbolo de euro. */
const SOBRANTES = /[\s€]/g;

function cuenta(texto: string, caracter: string): number {
  let total = 0;
  for (const letra of texto) if (letra === caracter) total += 1;
  return total;
}

/**
 * Posición del separador decimal, o `-1` si el número es entero.
 *
 * Con los dos separadores presentes manda el último, que es el decimal en
 * cualquiera de las dos convenciones. Con uno solo hay que adivinar, y se
 * adivina por la forma: tres cifras detrás de un único punto es agrupación de
 * millares («1.234» son mil doscientos treinta y cuatro), y más de un
 * separador del mismo tipo sólo puede ser agrupación.
 */
function posicionDecimal(cuerpo: string): number {
  const coma = cuerpo.lastIndexOf(',');
  const punto = cuerpo.lastIndexOf('.');

  if (coma >= 0 && punto >= 0) return Math.max(coma, punto);
  if (coma >= 0) return cuenta(cuerpo, ',') > 1 ? -1 : coma;
  if (punto >= 0) {
    const decimales = cuerpo.length - punto - 1;
    return cuenta(cuerpo, '.') > 1 || decimales === 3 ? -1 : punto;
  }
  return -1;
}

/** Euros tecleados a céntimos enteros, o `null` si no es un importe. */
export function parsearImporte(texto: string): number | null {
  const limpio = texto.replace(SOBRANTES, '');
  if (limpio === '') return null;

  const negativo = limpio.startsWith('-');
  const cuerpo = negativo ? limpio.slice(1) : limpio;
  if (!/^[\d.,]+$/.test(cuerpo)) return null;

  const decimal = posicionDecimal(cuerpo);
  const enteroCrudo = decimal === -1 ? cuerpo : cuerpo.slice(0, decimal);
  // La parte entera es todo dígitos, o grupos de tres separados. Sin esto,
  // «1.2.3,4,5» se salvaría como 1234,50 en vez de rechazarse, que es como una
  // errata al teclear acaba siendo un importe plausible que nadie revisa.
  if (!/^\d*$/.test(enteroCrudo) && !/^\d{1,3}([.,]\d{3})+$/.test(enteroCrudo)) return null;

  const entero = enteroCrudo.replace(/[.,]/g, '');
  const fraccion = decimal === -1 ? '' : cuerpo.slice(decimal + 1);

  if (!/^\d*$/.test(fraccion)) return null;
  if (entero === '' && fraccion === '') return null;
  // Más de dos decimales se rechaza en vez de redondear. Redondear en silencio
  // el importe que alguien ha escrito es perder dinero sin avisar, y el único
  // redondeo del sistema vive en `finance-core`.
  if (fraccion.length > 2) return null;

  const centimos = Number(entero === '' ? '0' : entero) * 100 + Number(fraccion.padEnd(2, '0'));
  if (!Number.isSafeInteger(centimos)) return null;
  return negativo ? -centimos : centimos;
}

/**
 * Céntimos al texto que se pone dentro de un campo editable.
 *
 * Sin símbolo y sin separador de millares: lo que se ve es lo que se vuelve a
 * teclear. El formato bonito es para leer, no para editar.
 */
export function importeEditable(centimos: number): string {
  const signo = centimos < 0 ? '-' : '';
  const absoluto = Math.abs(centimos);
  const entero = Math.floor(absoluto / 100);
  const fraccion = String(absoluto % 100).padStart(2, '0');
  return `${signo}${entero},${fraccion}`;
}

/** Cantidades de línea: 2, 2,5 o 0,25. Devuelve `null` si no es un número. */
export function parsearCantidad(texto: string): number | null {
  const limpio = texto.replace(SOBRANTES, '').replace(',', '.');
  if (limpio === '' || !/^-?\d*\.?\d*$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : null;
}
