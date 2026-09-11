# 06 · Despliegue en Vercel + Supabase

Pasos en orden. Cada uno se hace una sola vez, salvo que se diga lo contrario.

## Lo que puede salir mal en silencio

Supabase da una cadena de conexión con un rol privilegiado. Si esa cadena se
usa como `DATABASE_URL`, la aplicación se conecta con un rol que **salta las
políticas RLS** y el aislamiento entre clientes deja de existir: sin error, sin
aviso, cada tenant empieza a ver las filas de los demás.

El paso 3 crea los dos roles que evitan eso. No se puede saltar.

---

## 1 · Crear el proyecto en Supabase

1. https://supabase.com → **New project**.
2. Región: **Frankfurt (eu-central-1)**. Los datos se quedan en la UE.
3. Apunta la contraseña de la base que te pide. La necesitas en el paso 3.
4. **Project Settings → Database → Connection string** y copia las dos:
   - **Session pooler** o **Transaction pooler** (puerto `6543`) → para la aplicación.
   - **Direct connection** (puerto `5432`) → para migraciones y para el paso 3.

El pooler en modo transacción no aplica DDL. Las migraciones van siempre por la
conexión directa; si se mandan por el pooler fallan con errores que no dicen eso.

## 2 · Un secreto de sesión

```bash
openssl rand -base64 32
```

Guárdalo. Es `AUTH_SECRET`.

## 3 · Crear los dos roles de base de datos

En tu máquina, con el repo clonado:

```bash
export ADMIN_DATABASE_URL="<conexión directa del paso 1, puerto 5432>"
export APP_DB_ROLE=itfin360_app
export APP_DB_PASSWORD="<inventa una larga>"
export MIGRATION_DB_ROLE=itfin360_migrator
export MIGRATION_DB_PASSWORD="<inventa otra larga>"

pnpm install
pnpm db:roles
```

Crea dos roles: el de aplicación sin `BYPASSRLS` ni permisos de DDL, y el de
migraciones con ambos. Es idempotente: se puede repetir.

`ADMIN_DATABASE_URL` no vuelve a usarse después de esto. No la pongas en Vercel.

## 4 · Comprobar las migraciones contra la base real

Todavía en tu máquina:

```bash
export MIGRATION_DATABASE_URL="<conexión directa, pero con el usuario itfin360_migrator>"
pnpm db:migrate:deploy
```

Esto aplica las migraciones y nos dice si las tres escritas a mano tienen
deriva. Es la única parte del proyecto sin verificar hasta ahora.

Si sale un error de deriva, párate y avísame antes de seguir.

## 5 · Conectar el repo en Vercel

1. https://vercel.com → **Add New → Project** → importa `anh2123484-commits/itfin360`.
2. **Root Directory**: déjalo en la raíz del repositorio. El `vercel.json` del
   repo ya trae el comando de instalación, el de build y la carpeta de salida.
3. No despliegues todavía: primero las variables.

Si el build falla quejándose de que no encuentra Next.js, pon **Root Directory**
en `apps/web` y borra los tres comandos de `vercel.json`. Es la alternativa
conocida; no la he podido probar sin la cuenta.

## 6 · Variables de entorno en Vercel

**Settings → Environment Variables**, todas en _Production_ y _Preview_:

| Variable                 | Valor                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Conexión **del pooler** (`6543`), con el usuario `itfin360_app` y su contraseña, y `?pgbouncer=true&connection_limit=1` al final |
| `MIGRATION_DATABASE_URL` | Conexión **directa** (`5432`), con el usuario `itfin360_migrator` y su contraseña                                                |
| `AUTH_SECRET`            | El del paso 2                                                                                                                    |
| `APP_URL`                | `https://<tu-dominio>.vercel.app`                                                                                                |
| `EMAIL_SERVER`           | SMTP del enlace mágico, p. ej. `smtp://usuario:clave@smtp.resend.com:587`                                                        |
| `EMAIL_FROM`             | `ITFin360 <no-reply@tu-dominio>`                                                                                                 |
| `NODE_ENV`               | `production`                                                                                                                     |

`ADMIN_DATABASE_URL` **no** va aquí. Si aparece, algo se ha hecho mal.

`?pgbouncer=true` es obligatorio: sin él Prisma usa sentencias preparadas que el
pooler en modo transacción no mantiene, y las consultas fallan de forma
intermitente, que es la peor manera de fallar.

## 7 · Desplegar

**Deployments → Redeploy**. El build aplica las migraciones y luego compila.

Comprueba:

```bash
curl https://<tu-dominio>.vercel.app/api/health
# {"ok":true,"commit":"..."}
```

Después entra en la aplicación, crea una organización, da de alta un proveedor y
registra una factura. Eso confirma que la base responde con el rol correcto.

## 8 · Comprobar que RLS está de verdad activo

Es la comprobación que importa y cuesta dos minutos. En el editor SQL de
Supabase, con el rol de aplicación:

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

## A partir de aquí

Cada merge a `main` despliega solo. Las migraciones nuevas se aplican en el
build del despliegue.

## Lo que queda pendiente

- Dominio propio y correo saliente de verdad (ahora mismo el enlace mágico
  depende del SMTP que pongas).
- Cabeceras de seguridad y CSP: es F8-05, todavía sin hacer.
- Copias de seguridad: Supabase las hace en su plan, conviene mirar la retención.
