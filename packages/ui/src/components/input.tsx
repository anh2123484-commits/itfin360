import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Campo de formulario.
 *
 * Existe por un fallo real: los recuadros se pintaban con el borde de 1 píxel
 * del color de los separadores de tabla, casi blanco sobre blanco. En un
 * formulario con dos campos seguidos, el segundo no se veía, y la gente
 * escribía la contraseña en la casilla del correo.
 *
 * Por eso el borde es de 2 píxeles y usa `--input`, que es un gris con
 * contraste suficiente contra el fondo. Un campo tiene que verse sin
 * buscarlo: es donde la persona tiene que escribir.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'border-input bg-background flex h-10 w-full rounded-md border-2 px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
