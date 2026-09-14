/**
 * Purga de los tokens de verificación que ya no sirven.
 *
 * `verification_token` guarda la dirección de correo de quien pide un enlace
 * para entrar. El token vale unas horas; la fila se queda para siempre. Quien
 * no llega a entrar nunca, o quien pide tres enlaces y usa uno, deja su correo
 * ahí sin que nadie vuelva a mirarlo. Con el tiempo esa tabla es una lista de
 * direcciones de gente que ni siquiera es usuaria, guardada sin ningún motivo.
 *
 * Un dato que ya no sirve para nada no se guarda. No es una opinión: es la
 * regla dura 15, y hoy la incumple el esquema entero. Esto cierra el trozo que
 * se puede cerrar sin tocar la base de datos, porque `verification_token` es
 * una tabla global y la aplicación puede borrar en ella. Las invitaciones
 * caducadas necesitan una función `SECURITY DEFINER`, porque llevan RLS y el
 * rol de la aplicación sólo ve las de su tenant: van con la migración de la
 * capa de dato personal.
 *
 * ## Por qué aquí y no en un cron
 *
 * Un cron es lo suyo cuando hay varias tablas y plazos distintos. Para una sola
 * tabla sale más barato aprovechar el momento en que se escribe en ella: cada
 * vez que alguien pide un enlace, se aprovecha para barrer lo caducado. Si no
 * pide enlaces nadie, tampoco se acumula nada.
 *
 * Con un límite, eso sí: barrer en cada petición sería una consulta de borrado
 * por cada enlace enviado, y no hace falta. Se barre como mucho una vez cada
 * intervalo.
 *
 * ## Qué pasa si falla
 *
 * Nada que el usuario note. La purga es mantenimiento; si la base de datos está
 * lenta o la consulta falla, el enlace tiene que salir igual. Se registra en el
 * log y se sigue.
 */

/** Lo que la purga necesita saber hacer. Una interfaz para poder probarla. */
export interface BorradoRetencion {
  /** Borra los tokens cuya caducidad es anterior a `limite`. Devuelve cuántos. */
  borrarTokensCaducados(limite: Date): Promise<number>;
}

export interface Purgador {
  /** Barre si toca. Devuelve cuántas filas borró, o `null` si no tocaba. */
  quizaPurgar(ahora: Date): Promise<number | null>;
}

/** Una vez por hora es de sobra para una tabla que crece de enlace en enlace. */
export const INTERVALO_PURGA_MS = 60 * 60 * 1000;

export function purgador(
  borrado: BorradoRetencion,
  intervaloMs: number = INTERVALO_PURGA_MS,
): Purgador {
  if (!Number.isFinite(intervaloMs) || intervaloMs < 0) {
    throw new Error('El intervalo de purga es un número de milisegundos no negativo.');
  }

  let proxima = Number.NEGATIVE_INFINITY;
  let enCurso = false;

  return {
    async quizaPurgar(ahora: Date): Promise<number | null> {
      // Dos peticiones a la vez no tienen por qué barrer las dos: la segunda no
      // encontraría nada y se habría pagado la consulta igual.
      if (enCurso || ahora.getTime() < proxima) return null;

      enCurso = true;
      // La marca se mueve antes de empezar, no después: si la consulta tarda,
      // lo que no queremos es que mientras tanto entren más a intentarlo.
      proxima = ahora.getTime() + intervaloMs;
      try {
        const borradas = await borrado.borrarTokensCaducados(ahora);
        if (borradas > 0) {
          console.warn(JSON.stringify({ retencion: 'tokens_caducados', borradas }));
        }
        return borradas;
      } catch (error) {
        console.warn(
          JSON.stringify({
            retencion: 'tokens_caducados',
            error: error instanceof Error ? error.name : 'desconocido',
          }),
        );
        return null;
      } finally {
        enCurso = false;
      }
    },
  };
}
