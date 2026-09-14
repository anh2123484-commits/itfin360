import { describe, expect, it } from 'vitest';

import { type BorradoRetencion, purgador } from '@/lib/retencion';

/**
 * El reloj entra por parámetro, así que estos tests no esperan a nada.
 */

function borradoQueCuenta(resultado: number | Error = 0) {
  const limites: Date[] = [];
  const borrado: BorradoRetencion = {
    borrarTokensCaducados: (limite) => {
      limites.push(limite);
      return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado);
    },
  };
  return { borrado, limites };
}

describe('purgador', () => {
  it('la primera vez barre', async () => {
    const { borrado, limites } = borradoQueCuenta(3);
    const p = purgador(borrado, 1_000);

    expect(await p.quizaPurgar(new Date(0))).toBe(3);
    expect(limites).toHaveLength(1);
  });

  it('borra lo caducado a día de hoy, no lo que caduca mañana', async () => {
    const { borrado, limites } = borradoQueCuenta();
    const p = purgador(borrado, 1_000);
    const ahora = new Date(1_700_000_000_000);

    await p.quizaPurgar(ahora);

    // El límite es el instante actual: un token que todavía vale no se toca.
    expect(limites[0]?.getTime()).toBe(ahora.getTime());
  });

  it('no barre dos veces dentro del intervalo', async () => {
    const { borrado, limites } = borradoQueCuenta();
    const p = purgador(borrado, 1_000);

    await p.quizaPurgar(new Date(0));
    expect(await p.quizaPurgar(new Date(500))).toBe(null);
    expect(await p.quizaPurgar(new Date(999))).toBe(null);
    expect(limites).toHaveLength(1);
  });

  it('vuelve a barrer cuando pasa el intervalo', async () => {
    const { borrado, limites } = borradoQueCuenta();
    const p = purgador(borrado, 1_000);

    await p.quizaPurgar(new Date(0));
    await p.quizaPurgar(new Date(1_000));
    expect(limites).toHaveLength(2);
  });

  it('dos a la vez sólo barren una vez', async () => {
    let soltar = (): void => {};
    const espera = new Promise<number>((resolve) => {
      soltar = () => resolve(0);
    });
    let llamadas = 0;
    const borrado: BorradoRetencion = {
      borrarTokensCaducados: () => {
        llamadas += 1;
        return espera;
      },
    };
    const p = purgador(borrado, 1_000);

    const primera = p.quizaPurgar(new Date(0));
    // La segunda llega mientras la primera sigue dentro de la consulta.
    expect(await p.quizaPurgar(new Date(0))).toBe(null);

    soltar();
    await primera;
    expect(llamadas).toBe(1);
  });

  it('si el borrado falla, no revienta y devuelve null', async () => {
    // Es mantenimiento. Que falle no puede impedir que salga el enlace.
    const { borrado } = borradoQueCuenta(new Error('base caída'));
    const p = purgador(borrado, 1_000);

    expect(await p.quizaPurgar(new Date(0))).toBe(null);
  });

  it('un fallo no deja la purga bloqueada para siempre', async () => {
    let fallar = true;
    let llamadas = 0;
    const borrado: BorradoRetencion = {
      borrarTokensCaducados: () => {
        llamadas += 1;
        if (fallar) return Promise.reject(new Error('base caída'));
        return Promise.resolve(2);
      },
    };
    const p = purgador(borrado, 1_000);

    await p.quizaPurgar(new Date(0));
    fallar = false;
    expect(await p.quizaPurgar(new Date(1_000))).toBe(2);
    expect(llamadas).toBe(2);
  });

  it('un intervalo que no es un número de milisegundos es un error de programación', () => {
    const { borrado } = borradoQueCuenta();
    expect(() => purgador(borrado, -1)).toThrow();
    expect(() => purgador(borrado, Number.NaN)).toThrow();
  });
});
