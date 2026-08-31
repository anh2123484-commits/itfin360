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
pnpm db:migrate
pnpm db:seed        # tenant de demostración, datos ficticios
pnpm dev
```

## Entorno de desarrollo local

Requisitos: Node ≥ 20.11 (`.nvmrc`), pnpm 9 y Docker con el plugin `compose`.

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

Las migraciones usan `MIGRATION_DATABASE_URL` (rol con permisos de DDL) y la aplicación
`DATABASE_URL` (rol sin `BYPASSRLS`); en desarrollo ambas apuntan al mismo Postgres.

Toda tabla con datos de tenant activa `ROW LEVEL SECURITY` (con `FORCE`) y su política
`tenant_isolation` contra `current_setting('app.current_tenant')` en la misma migración que la crea.
Mientras nadie fije esa variable de sesión —lo hará `withTenant` en F0-05— las consultas no ven
ninguna fila.

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
