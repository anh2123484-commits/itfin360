# ITFin360

Gestión financiera 360º de un departamento IT. SaaS multi-tenant que consolida **todo** el gasto —facturas recurrentes, compras puntuales, inmovilizado, personal y sobrecoste de proyectos— y responde a una pregunta: **¿este departamento IT es financieramente viable, y dónde se está yendo el dinero?**

## Qué calcula

- **TCO por servicio IT** y coste por usuario, dispositivo y ticket.
- **Coste empresa y tarifa horaria interna** por puesto; utilización y ratio *run* vs *change*.
- **Amortización del inmovilizado** y deuda técnica de hardware.
- **Salud de proyectos** con EVM (CPI, SPI, EAC) y **coste del retraso** en euros/día, desglosado por causa.
- **IT Viability Score** (0–100) explicable hasta la factura de origen.

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/01-prd-y-alcance.md`](docs/01-prd-y-alcance.md) | Problema, usuarios, módulos, alcance y criterios de éxito |
| [`docs/02-modelo-financiero.md`](docs/02-modelo-financiero.md) | **Todas las fórmulas.** Documento normativo |
| [`docs/03-arquitectura-y-datos.md`](docs/03-arquitectura-y-datos.md) | Stack, multi-tenancy, seguridad, modelo de datos, API, pantallas |
| [`docs/04-backlog.md`](docs/04-backlog.md) | 58 tareas del tamaño de una PR con criterios de aceptación |
| [`docs/05-playbook-devin.md`](docs/05-playbook-devin.md) | Cómo operar con Devin sobre este repo |
| [`AGENTS.md`](AGENTS.md) | Reglas para agentes de código. Léelo antes de tocar nada |

## Stack

Next.js 15 · TypeScript estricto · PostgreSQL 16 con RLS · Prisma · tRPC + REST · BullMQ · Tailwind + shadcn/ui · Vitest + Testcontainers + Playwright.

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres + Redis + MinIO
pnpm db:roles       # rol de aplicación (sin BYPASSRLS) y rol de migraciones
pnpm db:migrate
pnpm db:seed        # tenant de demostración, datos ficticios
pnpm dev
```

## Entorno de desarrollo local

Requisitos: Node ≥ 20.19 (`.nvmrc`, mínimo que exige Prisma 7), pnpm 9 y Docker con el plugin `compose`.

`docker-compose.yml` levanta los tres servicios de desarrollo. Todos tienen *healthcheck*, así que
`pnpm db:up` no termina hasta que los tres están sanos, y después crea el bucket de MinIO.

| Servicio | Imagen | Puerto (por defecto) | Credenciales de desarrollo |
|---|---|---|---|
| PostgreSQL 16 | `postgres:16-alpine` | `5432` | `itfin360` / `itfin360`, base `itfin360` |
| Redis 7 | `redis:7-alpine` | `6379` | sin contraseña |
| MinIO (S3) | `minio/minio` | `9000` API · `9001` consola | `itfin360` / `itfin360dev`, bucket `itfin360-dev` |

Consola de MinIO: <http://localhost:9001>.

```bash
pnpm db:up      # arranca los tres servicios y espera a que estén sanos
pnpm db:down    # los para y elimina los contenedores (los datos persisten)
pnpm db:reset   # borra también los volúmenes y vuelve a levantar todo desde cero
```

La configuración se toma de `.env` (copia de `.env.example`, que declara **todas** las variables:
`DATABASE_URL`, `REDIS_URL`, `S3_*`, puertos y credenciales). `pnpm db:up` lo crea a partir del
ejemplo si no existe. `.env` está en `.gitignore`: nunca se comitea.

Los puertos son configurables por variable de entorno (`POSTGRES_PORT`, `REDIS_PORT`,
`MINIO_API_PORT`, `MINIO_CONSOLE_PORT`) si alguno está ocupado en tu máquina.

## Base de datos y migraciones

El esquema vive en `packages/db/prisma/schema.prisma` y el cliente Prisma tipado se exporta desde
`@itfin360/db`. El cliente se genera en `packages/db/src/generated` (ignorado por git) y `pnpm build`
lo regenera solo.

```bash
pnpm db:migrate         # prisma migrate dev: crea y aplica migraciones en desarrollo
pnpm db:migrate:deploy  # prisma migrate deploy: aplica las pendientes (despliegue/CI)
pnpm db:generate        # sólo regenera el cliente
```

### Roles de base de datos

Son dos y nunca el mismo, porque uno de ellos puede saltarse el aislamiento:

| Rol | Variable | Atributos | Para qué |
| --- | --- | --- | --- |
| aplicación | `DATABASE_URL` | `NOBYPASSRLS`, sin DDL, sólo `SELECT/INSERT/UPDATE/DELETE` | todas las consultas de la aplicación, siempre sujetas a RLS |
| migraciones | `MIGRATION_DATABASE_URL` | `BYPASSRLS`, `USAGE, CREATE` en el esquema | `prisma migrate`, que tiene que poder tocar filas de todos los tenants |

Los crea `pnpm db:roles`, que es idempotente, a partir de `APP_DB_ROLE`, `APP_DB_PASSWORD`,
`MIGRATION_DB_ROLE` y `MIGRATION_DB_PASSWORD`, conectándose con `ADMIN_DATABASE_URL`. Ésa es la
única conexión de superusuario del proyecto y no la lee ningún otro código: crear roles es lo único
que hace. En desarrollo las cinco variables vienen en `.env.example` con valores locales y el
superusuario es el `POSTGRES_USER` del `docker-compose.yml`.

```bash
pnpm db:up      # Postgres arriba
pnpm db:roles   # itfin360_app (sin BYPASSRLS) e itfin360_migrator (con BYPASSRLS)
pnpm db:migrate # se aplica con el rol de migraciones
```

El SQL que aplica se genera en `packages/db/src/roles.ts` y está cubierto por tests. Las tablas que
cree el rol de migraciones quedan accesibles al de aplicación por `ALTER DEFAULT PRIVILEGES`, así
que no hay que volver a pasar por aquí tras cada migración.

### Aislamiento por tenant

Toda tabla con datos de tenant activa `ROW LEVEL SECURITY` (con `FORCE`) y su política
`tenant_isolation` en la misma migración que la crea, comparando cada fila contra la variable de
sesión `app.current_tenant`:

```sql
"tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
```

El `NULLIF` no es decorativo: sin él, una variable fijada a cadena vacía revienta el `::uuid` con un
error de sintaxis en lugar de devolver cero filas. Genera el bloque de una tabla nueva con
`pnpm db:rls:policy <tabla> [columna_de_tenant]` y pégalo en la migración.

Las consultas de la aplicación pasan por `withTenant`, que abre una transacción y fija la variable
con alcance local a ella, de modo que una conexión devuelta al pool no arrastra el tenant de la
petición anterior:

```ts
import { createTenantAwarePrismaClient } from '@itfin360/db';

const db = createTenantAwarePrismaClient();
const miembros = await db.withTenant(tenantId, (tx) => tx.membership.findMany());
```

Fuera de un contexto de tenant —o con la variable vacía— las consultas devuelven cero filas.
`packages/db/src/tenant-isolation.integration.test.ts` lo comprueba contra un Postgres real con el
rol de aplicación: recorre todos los modelos y verifica que ninguna consulta, agregado, `count` ni
escritura del tenant A alcanza una fila de B.

El alta de un tenant todavía necesita el rol de migraciones: el `WITH CHECK` de `tenant` exige que
`app.current_tenant` ya valga el id de la fila que se está creando. Resolverlo es F0-06; el análisis
está en la issue #68.

## Integración continua

`.github/workflows/ci.yml` se ejecuta en cada PR contra `main` y en cada push a `main`, con
Postgres 16, Redis 7 y MinIO levantados como servicios. Ejecuta, en este orden y todos
bloqueantes:

```bash
pnpm lint            # gate obligatorio: next.config.ts ignora ESLint en el build
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage   # cobertura de packages/finance-core >= 95 %
pnpm rls:check       # toda tabla creada por una migración tiene RLS y política
pnpm build
```

`pnpm rls:check` recorre `packages/db/prisma/migrations`; una tabla sin datos de tenant se exime
con un comentario `-- rls-exempt: <tabla> — <motivo>` en la propia migración.

Marca el job `lint · typecheck · test · build` como *required check* en la protección de `main`.

## Sembrar el backlog en GitHub

```bash
python3 scripts/backlog-to-json.py                       # docs/04-backlog.md -> docs/backlog.json
GITHUB_TOKEN=... python3 scripts/create-issues.py <owner>/<repo> --dry-run
GITHUB_TOKEN=... python3 scripts/create-issues.py <owner>/<repo>
```

Crea labels, un milestone por fase y las 58 issues en orden de dependencias, con las dependencias ya enlazadas por número. Es idempotente.

## Principios que no se negocian

1. Importes en **céntimos enteros**. Nunca `float`.
2. Aislamiento entre clientes por **RLS de Postgres**, probado con tests.
3. El motor de cálculo (`packages/finance-core`) es **puro** y con cobertura ≥ 95 %.
4. Todo KPI baja hasta el registro que lo origina. Un número que no se puede explicar no se muestra.
5. La retribución vive cifrada, aparte y auditada; los agregados de menos de 4 personas se suprimen.
6. Cero datos reales de cliente en el repositorio.
