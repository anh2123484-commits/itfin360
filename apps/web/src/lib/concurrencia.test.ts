import { describe, expect, it } from 'vitest';

import { DemasiadoOcupado, semaforo } from '@/lib/concurrencia';

/**
 * Lo que importa de esto es el techo. Si el semáforo dejara pasar a todos, la
 * memoria que se puede pedir a la vez no tendría límite, que es exactamente el
 * problema que viene a resolver.
 */

/** Una tarea que se queda parada hasta que la sueltan a mano. */
function tareaControlada() {
  let soltar = (): void => {};
  const terminada = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  return { soltar, ejecutar: () => terminada };
}

/** Deja correr los `then` pendientes sin avanzar el reloj. */
const respirar = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('semaforo', () => {
  it('deja pasar hasta el máximo y hace esperar al resto', async () => {
    const s = semaforo(2, 1_000);
    const a = tareaControlada();
    const b = tareaControlada();
    const c = tareaControlada();

    void s.ejecutar(a.ejecutar);
    void s.ejecutar(b.ejecutar);
    const tercera = s.ejecutar(c.ejecutar);
    await respirar();

    expect(s.dentro).toBe(2);
    expect(s.esperando).toBe(1);

    a.soltar();
    await respirar();
    expect(s.esperando).toBe(0);

    b.soltar();
    c.soltar();
    await tercera;
  });

  it('el turno se cede al siguiente, no se suma uno más', async () => {
    const s = semaforo(1, 1_000);
    const a = tareaControlada();
    const b = tareaControlada();

    void s.ejecutar(a.ejecutar);
    const segunda = s.ejecutar(b.ejecutar);
    await respirar();
    expect(s.dentro).toBe(1);

    a.soltar();
    await respirar();
    // Si al ceder el turno se contara otra entrada, aquí habría dos dentro con
    // un máximo de uno, y el tope no serviría de nada.
    expect(s.dentro).toBe(1);

    b.soltar();
    await segunda;
    await respirar();
    expect(s.dentro).toBe(0);
  });

  it('quien espera demasiado recibe una negativa, no se queda colgado', async () => {
    const s = semaforo(1, 20);
    const a = tareaControlada();
    void s.ejecutar(a.ejecutar);

    await expect(s.ejecutar(async () => 'nunca')).rejects.toThrow(DemasiadoOcupado);
    // Y al rendirse deja de ocupar sitio en la cola.
    expect(s.esperando).toBe(0);

    a.soltar();
  });

  it('libera el turno aunque la tarea reviente', async () => {
    const s = semaforo(1, 1_000);
    await expect(s.ejecutar(() => Promise.reject(new Error('falló')))).rejects.toThrow('falló');
    expect(s.dentro).toBe(0);
    expect(await s.ejecutar(() => Promise.resolve('sigue funcionando'))).toBe('sigue funcionando');
  });

  it('un máximo que no es un entero positivo es un error de programación', () => {
    expect(() => semaforo(0, 100)).toThrow();
    expect(() => semaforo(-1, 100)).toThrow();
    expect(() => semaforo(1.5, 100)).toThrow();
  });
});
