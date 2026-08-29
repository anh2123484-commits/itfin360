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
pnpm db:up          # Postgres + Redis + MinIO
pnpm db:migrate
pnpm db:seed        # tenant de demostración, datos ficticios
pnpm dev
```

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
