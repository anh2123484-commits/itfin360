/**
 * Un semáforo: deja pasar como mucho N a la vez, y el resto espera su turno.
 *
 * Existe por una cuenta muy concreta. Derivar una contraseña con scrypt reserva
 * unos 32 MB. Cada intento de login hace uno, y nadie tiene que acertar la
 * contraseña para provocarlo: basta con enviar intentos. Unas decenas a la vez
 * y el proceso se queda sin memoria, que es una forma barata de tirar la
 * aplicación para todo el mundo.
 *
 * Con el semáforo, la memoria que se puede pedir a la vez tiene techo. Lo que
 * llega de más espera, y si espera demasiado se le dice que no en vez de
 * dejarlo colgado: una cola infinita es el mismo problema con otra cara.
 *
 * Esto protege a cada instancia de sí misma. No es un límite de intentos ni
 * pretende serlo: contra un ataque repartido entre muchas instancias hace falta
 * un contador compartido, que va en otra tarea.
 */

/** Lo que se lanza cuando la cola no se despeja a tiempo. */
export class DemasiadoOcupado extends Error {
  constructor() {
    super('El servidor está ocupado. Inténtalo de nuevo en un momento.');
    this.name = 'DemasiadoOcupado';
  }
}

export interface Semaforo {
  /** Ejecuta `tarea` cuando haya sitio. Lanza `DemasiadoOcupado` si se agota la espera. */
  ejecutar<T>(tarea: () => Promise<T>): Promise<T>;
  /** Cuántos están dentro ahora mismo. Para tests. */
  readonly dentro: number;
  /** Cuántos esperan turno. Para tests. */
  readonly esperando: number;
}

/**
 * Crea un semáforo.
 *
 * `esperaMaximaMs` se cuenta desde que se pide turno, no desde que se entra:
 * lo que importa es cuánto tarda en responder la petición, no cuánto ocupa la
 * tarea una vez dentro.
 */
export function semaforo(maximo: number, esperaMaximaMs: number): Semaforo {
  if (!Number.isInteger(maximo) || maximo < 1) {
    throw new Error('El máximo de un semáforo es un entero mayor que cero.');
  }

  interface EnEspera {
    readonly admitir: () => void;
    readonly temporizador: ReturnType<typeof setTimeout>;
  }

  let dentro = 0;
  const cola: EnEspera[] = [];

  function siguiente(): void {
    const primero = cola.shift();
    if (primero === undefined) {
      dentro -= 1;
      return;
    }
    clearTimeout(primero.temporizador);
    primero.admitir();
  }

  function turno(): Promise<void> {
    if (dentro < maximo) {
      dentro += 1;
      return Promise.resolve();
    }
    return new Promise((admitir, rechazar) => {
      const entrada: EnEspera = {
        admitir: () => admitir(),
        temporizador: setTimeout(() => {
          const indice = cola.indexOf(entrada);
          if (indice !== -1) cola.splice(indice, 1);
          rechazar(new DemasiadoOcupado());
        }, esperaMaximaMs),
      };
      cola.push(entrada);
    });
  }

  return {
    get dentro() {
      return dentro;
    },
    get esperando() {
      return cola.length;
    },
    async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
      await turno();
      try {
        return await tarea();
      } finally {
        siguiente();
      }
    },
  };
}
