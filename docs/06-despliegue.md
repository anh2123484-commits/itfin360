# 06 · Despliegue en Vercel + Supabase

Pasos en orden. Cada uno se hace una sola vez, salvo que se diga lo contrario.

Esta guía se escribió antes de desplegar y se ha reescrito después, con lo que
falló de verdad. Donde pone "esto no funciona así" es porque se probó.

## Lo que puede salir mal en silencio

Supabase da una cadena de conexión con un rol privilegiado. Si esa cadena se
usa como `DATABASE_URL`, la aplicación se conecta con un rol que **salta las
políticas RLS** y el aislamiento entre clientes deja de existir: sin error, sin
aviso, cada tenant empieza a ver las filas de los demás.

El paso 3 crea los dos roles que evitan eso. No se puede saltar. Y el paso 9
comprueba que de verdad funcionan, que no es lo mismo.

---

## 1 · Crear el proyecto en Supabase

1. https://supabase.com → **New project**.
2. Región: **Frankfurt (eu-central-1)**. Los datos se quedan en la UE.
3. Apunta la contraseña de la base que te pide. La necesitas en el paso 3.
4. **Connect** (arriba del todo) y copia las cadenas de conexión.

### Sobre qué cadena usar para qué

Aquí es donde se pierde la primera hora, así que va explicado:

La **conexión directa** (`db.<ref>.supabase.co`) sólo resuelve por IPv6. Si tu
red o tu contenedor no tienen IPv6, no conecta, y el error no dice eso: dice que
no encuentra el servidor. Casi siempre es más rápido no usarla.

Lo que funciona en los dos casos es el **pooler** (`aws-*.pooler.supabase.com`),
que tiene dos puertos y **no son intercambiables**:

- Puerto **5432**, modo sesión: mantiene la sesión abierta. Sirve para DDL, o
  sea para migraciones y para el script de roles.
- Puerto **6543**, modo transacción: no mantiene sesión. Sirve para la
  aplicación, y **no** aplica migraciones. Si mandas migraciones por aquí fallan
  con errores que no mencionan el pooler por ningún lado.

En el pooler, el usuario **no** es `itfin360_app` sino `itfin360_app.<project-ref>`,
con el punto y la referencia del proyecto. Sin esa parte la autenticación falla
diciendo que la contraseña no es válida, que es mentira.

## 2 · Un secreto de sesión

```bash
openssl rand -base64 32
```

Guárdalo. Es `AUTH_SECRET`.

## 3 · Crear los dos roles de base de datos

En tu máquina, con el repo clonado:

```bash
export ADMIN_DATABASE_URL="<pooler, puerto 5432, usuario postgres.<ref>>"
export APP_DB_ROLE=itfin360_app
export APP_DB_PASSWORD="<inventa una larga>"
export MIGRATION_DB_ROLE=itfin360_migrator
export MIGRATION_DB_PASSWORD="<inventa otra larga>"

pnpm install
pnpm db:roles
```

Crea dos roles: el de aplicación sin `BYPASSRLS` ni permisos de DDL, y el de
migraciones con ambos. Es idempotente: se puede repetir.

Si no quieres instalar nada, el mismo SQL se puede pegar en el editor SQL de
Supabase. Lo imprime `packages/db/src/roles.ts`.

**El script termina avisando de que hay que volver a ejecutarlo** (paso 5). No es
una formalidad: los permisos sobre las funciones `provision_tenant` y
`user_memberships` sólo se pueden dar cuando esas funciones existen, y las crea
una migración. En una instalación nueva la primera pasada los salta y lo dice por
pantalla.

`ADMIN_DATABASE_URL` no vuelve a usarse después del paso 5. No la pongas en Vercel.

## 4 · Aplicar las migraciones contra la base real

Todavía en tu máquina:

```bash
export MIGRATION_DATABASE_URL="<pooler, puerto 5432, usuario itfin360_migrator.<ref>>"
pnpm db:migrate:deploy
```

Esto aplica las migraciones escritas a mano y nos dice si tienen deriva.

Si sale un error de deriva, párate y avisa antes de seguir.

## 5 · Volver a ejecutar el script de roles

```bash
pnpm db:roles
```

Ahora sí existen las funciones, y esta pasada les da el permiso que faltaba.
Saltarse este paso deja la aplicación aparentemente bien hasta que alguien
intenta crear su empresa: entonces sale un error genérico de servidor, sin nada
en pantalla que apunte a un permiso.

Para comprobar que han quedado dadas, en el editor SQL de Supabase:

```sql
SELECT has_function_privilege(
  'itfin360_app', 'public.provision_tenant(text, char(3), uuid)', 'EXECUTE'
) AS puede_ejecutar;
SELECT has_function_privilege(
  'itfin360_app', 'public.user_memberships(uuid)', 'EXECUTE'
) AS puede_ejecutar;
```

Las dos tienen que dar `true`.

## 6 · Conectar el repo en Vercel

1. https://vercel.com → **Add New → Project** → importa `anh2123484-commits/itfin360`.
2. **Root Directory**: `apps/web`. Dejarlo en la raíz del repositorio **no
   funciona**: el build falla con `No Next.js version detected`, porque Vercel
   busca la dependencia de Next en el `package.json` de la carpeta raíz y allí
   no está, está en el de la aplicación.
3. Framework Preset: **Next.js**. Output Directory: `.next`.
4. No despliegues todavía: primero las variables.

El `vercel.json` de la raíz del repositorio **manda sobre lo que pongas en el
panel**. Si cambias un comando en la interfaz y no cambia nada en el build, es
esto. Los comandos que trae usan `pnpm -w` para correr desde la raíz del
workspace; un `cd ../..` delante no sirve, Vercel se lo quita.

## 7 · Variables de entorno en Vercel

**Settings → Environment Variables**, todas en _Production_ y _Preview_:

| Variable                 | Valor                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`           | Pooler, puerto **6543**, usuario `itfin360_app.<ref>`, con `?pgbouncer=true&connection_limit=1` al final                   |
| `MIGRATION_DATABASE_URL` | Pooler, puerto **5432**, usuario `itfin360_migrator.<ref>`                                                                |
| `AUTH_SECRET`            | El del paso 2                                                                                                             |
| `APP_URL`                | `https://<tu-dominio>.vercel.app`                                                                                         |
| `EMAIL_SERVER`           | SMTP del enlace mágico, p. ej. `smtp://resend:<api-key>@smtp.resend.com:587`                                               |
| `EMAIL_FROM`             | `ITFin360 <no-reply@tu-dominio>`                                                                                          |

`ADMIN_DATABASE_URL` **no** va aquí. Si aparece, algo se ha hecho mal.

**`NODE_ENV` tampoco.** Vercel ya la pone. Declararla a mano como `production`
hace que pnpm se salte las `devDependencies`, y con ellas desaparecen `turbo`,
`prisma` y `typescript`: el build se cae diciendo que no encuentra un comando,
sin explicar por qué. En el log se ve la línea
`devDependencies: skipped because NODE_ENV is set to production`.

`?pgbouncer=true` es obligatorio: sin él Prisma usa sentencias preparadas que el
pooler en modo transacción no mantiene, y las consultas fallan de forma
intermitente, que es la peor manera de fallar.

Sobre `EMAIL_FROM`: con el remitente de pruebas de Resend (`onboarding@resend.dev`)
sólo se pueden enviar correos **a la dirección con la que te registraste en
Resend**. Para que entren otros usuarios hace falta verificar un dominio propio.
Y mira en spam: el primer enlace mágico suele acabar ahí.

## 8 · Desplegar

**Deployments → Redeploy**. El build aplica las migraciones y luego compila.

Comprueba:

```bash
curl https://<tu-dominio>.vercel.app/api/health
# {"ok":true,"commit":"..."}
```

Si devuelve `{"error":"unauthorized"}`, el healthcheck está detrás del login y no
vigila nada. Tiene que estar en la lista de `apps/web/src/lib/rutas-publicas.ts`.

Después entra en la aplicación, crea una organización, da de alta un proveedor y
registra una factura. Eso confirma que la base responde con el rol correcto.

## 9 · Comprobar que RLS está de verdad activo

Es la comprobación que importa y cuesta dos minutos. En el editor SQL de
Supabase:

```sql
SET ROLE itfin360_app;
SELECT count(*) FROM tenant;
```

Tiene que devolver **0**, porque `app.current_tenant` no está fijada. Si
devuelve un número mayor que cero, el rol tiene `BYPASSRLS` y hay que repetir el
paso 3.

```sql
RESET ROLE;
```

Si el `SET ROLE` falla con `permission denied to set role`, es que el script de
roles no se ha llegado a ejecutar entero: el `GRANT ... WITH SET TRUE` que
permite esta comprobación está dentro.

## A partir de aquí

Cada merge a `main` despliega solo. Las migraciones nuevas se aplican en el
build del despliegue.

## Lo que queda pendiente

- Dominio propio y correo saliente de verdad. Mientras no lo haya, el enlace
  mágico sólo llega a la dirección de la cuenta de Resend.
- Cabeceras de seguridad y CSP: es F8-05, todavía sin hacer.
- Copias de seguridad: Supabase las hace en su plan, conviene mirar la retención.
- El plan gratuito de Supabase **pausa el proyecto tras siete días sin tráfico**.
  Se reanuda a mano desde el panel, pero mientras está pausado la aplicación no
  responde.
- El paso 5 es manual y se puede olvidar. Lo suyo es que el propio despliegue
  vuelva a ejecutar el script de roles después de migrar; hoy no lo hace porque
  eso metería `ADMIN_DATABASE_URL` en Vercel, que es justo lo que esta guía
  prohíbe. Hay que resolverlo, no dejarlo en una nota.
