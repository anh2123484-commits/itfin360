import { createHash } from 'node:crypto';

/**
 * Control de intentos de entrada, en memoria del proceso.
 *
 * Hace dos cosas. Corta el goteo de pruebas contra una misma cuenta, y —esto
 * importa más— evita el trabajo caro: si una dirección está bloqueada, no se
 * llega a derivar la contraseña, que es lo que reserva 32 MB cada vez.
 *
 * ## Lo que esto no es
 *
 * No es un límite de intentos de verdad. Vive en la memoria de cada instancia,
 * y en Vercel hay varias y se reciclan, así que quien reparta los intentos
 * entre instancias se lo salta. El límite serio necesita un contador
 * compartido, y eso va con la tarea del registro de eventos de autenticación,
 * que además hay que guardar en algún sitio.
 *
 * Mientras tanto esto ya quita el caso fácil y, sobre todo, pone techo a lo que
 * una sola instancia se deja robar de memoria.
 *
 * ## Por qué no se guarda el correo
 *
 * La clave es un hash del correo, no el correo. En una lista de intentos
 * fallidos hay direcciones de gente, y una lista de direcciones que han
 * fallado al entrar es justo la clase de dato que no hace falta tener. Con el
 * hash se puede contar por dirección, que es lo único que se necesita.
 */

/** Identificador estable de una dirección, sin la dirección dentro. */
export function identificador(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('base64url').slice(0, 12);
}

export interface OpcionesIntentos {
  /** Fallos seguidos que se toleran dentro de la ventana. */
  readonly maximo: number;
  /** Cuánto se mira hacia atrás, en milisegundos. */
  readonly ventanaMs: number;
  /** Cuánto se bloquea al pasarse. */
  readonly bloqueoMs: number;
  /**
   * Cuántas direcciones distintas se recuerdan como mucho.
   *
   * Sin tope, un ataque con direcciones inventadas llena la memoria del proceso:
   * la defensa se convierte en el agujero. Al llegar al tope se olvida la
   * entrada más vieja que no esté bloqueada.
   */
  readonly maximoClaves: number;
}

export const OPCIONES_POR_DEFECTO: OpcionesIntentos = {
  maximo: 5,
  ventanaMs: 15 * 60 * 1000,
  bloqueoMs: 15 * 60 * 1000,
  maximoClaves: 10_000,
};

interface Estado {
  fallos: number;
  ultimoMs: number;
  bloqueadoHastaMs: number;
}

export interface ControlDeIntentos {
  /** Milisegundos que faltan para poder reintentar, o 0 si se puede ahora. */
  esperaMs(clave: string, ahoraMs: number): number;
  /** Anota un fallo. Devuelve los fallos acumulados en la ventana. */
  fallo(clave: string, ahoraMs: number): number;
  /** Anota una entrada correcta y olvida los fallos de esa clave. */
  acierto(clave: string): void;
  /** Cuántas claves se recuerdan. Para tests. */
  readonly claves: number;
}

export function controlDeIntentos(
  opciones: OpcionesIntentos = OPCIONES_POR_DEFECTO,
): ControlDeIntentos {
  const estados = new Map<string, Estado>();

  function limpiar(ahoraMs: number): void {
    for (const [clave, estado] of estados) {
      const caducado =
        estado.bloqueadoHastaMs <= ahoraMs && ahoraMs - estado.ultimoMs > opciones.ventanaMs;
      if (caducado) estados.delete(clave);
    }
    // Si aún sobran, se van las más viejas que no estén bloqueadas. `Map`
    // conserva el orden de inserción, así que la primera que cumple es la que
    // lleva más tiempo sin tocarse.
    //
    // Las bloqueadas no se tocan, y esto es lo que evita un truco evidente: si
    // hacer ruido con direcciones inventadas echara a las bloqueadas de la
    // tabla, quien se hubiera ganado un bloqueo se lo quitaría de encima
    // llenándola. Cuando todas están bloqueadas se deja de vaciar y la tabla
    // pasa del tope, que es preferible: son unas pocas decenas de bytes por
    // entrada y se sueltan solas al caducar el bloqueo.
    while (estados.size > opciones.maximoClaves) {
      let candidata: string | null = null;
      for (const [clave, estado] of estados) {
        if (estado.bloqueadoHastaMs <= ahoraMs) {
          candidata = clave;
          break;
        }
      }
      if (candidata === null) break;
      estados.delete(candidata);
    }
  }

  return {
    get claves() {
      return estados.size;
    },

    esperaMs(clave, ahoraMs) {
      const estado = estados.get(clave);
      if (estado === undefined) return 0;
      return Math.max(0, estado.bloqueadoHastaMs - ahoraMs);
    },

    fallo(clave, ahoraMs) {
      const estado = estados.get(clave);
      // Un fallo después de mucho tiempo empieza la cuenta de cero: lo que se
      // persigue es la ráfaga, no a quien se equivoca dos veces en un año.
      const dentroDeVentana =
        estado !== undefined && ahoraMs - estado.ultimoMs <= opciones.ventanaMs;
      const fallos = dentroDeVentana ? estado.fallos + 1 : 1;
      const bloqueadoHastaMs =
        fallos >= opciones.maximo ? ahoraMs + opciones.bloqueoMs : (estado?.bloqueadoHastaMs ?? 0);

      estados.delete(clave);
      estados.set(clave, { fallos, ultimoMs: ahoraMs, bloqueadoHastaMs });
      limpiar(ahoraMs);
      return fallos;
    },

    acierto(clave) {
      estados.delete(clave);
    },
  };
}
