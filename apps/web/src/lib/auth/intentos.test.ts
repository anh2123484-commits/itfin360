import { describe, expect, it } from 'vitest';

import { controlDeIntentos, identificador, type OpcionesIntentos } from '@/lib/auth/intentos';

/**
 * El reloj entra por parámetro en todas las funciones, así que estos tests no
 * esperan a nada: se mueve el tiempo a mano. Un test que duerme quince minutos
 * no lo corre nadie.
 */

const OPCIONES: OpcionesIntentos = {
  maximo: 3,
  ventanaMs: 10_000,
  bloqueoMs: 60_000,
  maximoClaves: 5,
};

describe('identificador', () => {
  it('la misma dirección da siempre lo mismo, escrita como se escriba', () => {
    expect(identificador('Anh@Empresa.example')).toBe(identificador('  anh@empresa.example '));
  });

  it('direcciones distintas dan identificadores distintos', () => {
    expect(identificador('a@empresa.example')).not.toBe(identificador('b@empresa.example'));
  });

  it('no lleva la dirección dentro', () => {
    // Es lo que permite registrar intentos sin acabar con una lista de correos
    // de gente que ha fallado al entrar.
    const id = identificador('anh@empresa.example');
    expect(id).not.toContain('anh');
    expect(id).not.toContain('@');
  });
});

describe('controlDeIntentos', () => {
  it('una clave nueva puede intentarlo', () => {
    const control = controlDeIntentos(OPCIONES);
    expect(control.esperaMs('a', 0)).toBe(0);
  });

  it('bloquea al llegar al máximo de fallos', () => {
    const control = controlDeIntentos(OPCIONES);
    expect(control.fallo('a', 0)).toBe(1);
    expect(control.esperaMs('a', 0)).toBe(0);
    expect(control.fallo('a', 1_000)).toBe(2);
    expect(control.esperaMs('a', 1_000)).toBe(0);
    expect(control.fallo('a', 2_000)).toBe(3);
    expect(control.esperaMs('a', 2_000)).toBe(60_000);
  });

  it('el bloqueo se acaba solo', () => {
    const control = controlDeIntentos(OPCIONES);
    control.fallo('a', 0);
    control.fallo('a', 0);
    control.fallo('a', 0);
    expect(control.esperaMs('a', 59_000)).toBe(1_000);
    expect(control.esperaMs('a', 60_000)).toBe(0);
  });

  it('bloquear a una dirección no bloquea a las demás', () => {
    const control = controlDeIntentos(OPCIONES);
    control.fallo('a', 0);
    control.fallo('a', 0);
    control.fallo('a', 0);
    expect(control.esperaMs('b', 0)).toBe(0);
  });

  it('fallos muy separados no se acumulan', () => {
    // Equivocarse hoy y dentro de un mes no es una ráfaga, y tratarlo como tal
    // acabaría echando de su cuenta a quien simplemente tiene mala memoria.
    const control = controlDeIntentos(OPCIONES);
    expect(control.fallo('a', 0)).toBe(1);
    expect(control.fallo('a', 20_000)).toBe(1);
    expect(control.fallo('a', 40_000)).toBe(1);
    expect(control.esperaMs('a', 40_000)).toBe(0);
  });

  it('entrar bien borra la cuenta de fallos', () => {
    const control = controlDeIntentos(OPCIONES);
    control.fallo('a', 0);
    control.fallo('a', 100);
    control.acierto('a');
    expect(control.fallo('a', 200)).toBe(1);
    expect(control.esperaMs('a', 200)).toBe(0);
  });

  it('no se recuerdan más direcciones de las que caben', () => {
    // Sin este tope, mandar intentos con direcciones inventadas llena la
    // memoria del proceso: la defensa se convierte en el ataque.
    const control = controlDeIntentos(OPCIONES);
    for (let i = 0; i < 50; i += 1) control.fallo(`clave-${i}`, i);
    expect(control.claves).toBeLessThan(10);
  });

  it('un bloqueo activo no se olvida por hacer sitio', () => {
    const control = controlDeIntentos(OPCIONES);
    control.fallo('victima', 0);
    control.fallo('victima', 0);
    control.fallo('victima', 0);
    expect(control.esperaMs('victima', 0)).toBe(60_000);

    // Llega mucho ruido con direcciones nuevas, dentro de la ventana.
    for (let i = 0; i < 50; i += 1) control.fallo(`ruido-${i}`, 1_000);

    // El bloqueo sigue en pie: si se pudiera borrar llenando la tabla, bastaría
    // con hacer ruido para levantarse el propio castigo.
    expect(control.esperaMs('victima', 2_000)).toBeGreaterThan(0);
  });
});
