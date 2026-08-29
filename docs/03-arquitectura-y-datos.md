# ITFin360 — Arquitectura y modelo de datos

## 1. Stack

| Capa | Elección | Motivo |
|---|---|---|
| Framework | **Next.js 15** (App Router, RSC, Server Actions) + TypeScript estricto | Full-stack en un repo; es el stack con el que un agente de código produce menos fricción |
| ORM / DB | **Prisma** + **PostgreSQL 16** | Migraciones versionadas y RLS nativa para el aislamiento multi-tenant |
| API | **tRPC** para el frontend propio + **REST `/api/v1`** documentada con OpenAPI para conectores e integraciones externas | El frontend gana tipos extremo a extremo; los terceros no dependen de tRPC |
| Auth | **Auth.js v5** con organizaciones, invitaciones y SSO (OIDC/SAML) opcional en plan Enterprise | — |
| Jobs | **BullMQ** + Redis: OCR, importaciones, sincronización de conectores, cierre mensual, alertas | Trabajo pesado fuera del request |
| Ficheros | S3-compatible (AWS S3 / MinIO), URLs firmadas y de un solo uso | Los PDF de factura no se sirven nunca desde la app |
| OCR/IA | Adaptador `DocumentExtractor` con dos implementaciones: Azure Document Intelligence (modelo `prebuilt-invoice`) y LLM con visión | Poder cambiar de proveedor sin tocar el dominio |
| UI | Tailwind + shadcn/ui + Recharts | — |
| Validación | Zod, compartido cliente/servidor | — |
| Tests | Vitest (unit), Testcontainers (integración con Postgres real), Playwright (E2E) | La RLS sólo se puede probar contra Postgres de verdad |
| CI/CD | GitHub Actions → lint, typecheck, test, migraciones, build, preview | — |
| Observabilidad | OpenTelemetry + Sentry; logs estructurados sin PII | — |

**Monorepo** (pnpm workspaces + Turborepo):

```
apps/web            Next.js (UI + tRPC + REST)
apps/worker         Procesos BullMQ
packages/finance-core   Motor de cálculo puro (doc 02). Sin I/O.
packages/db             Prisma schema, migraciones, cliente con RLS
packages/connectors     Adaptadores ERP / cloud / OCR (interfaz común)
packages/ui             Componentes compartidos
packages/config         ESLint, TS, Tailwind
```

## 2. Multi-tenancy

**Un solo esquema, `tenantId` en toda tabla de negocio, aislamiento forzado por Row Level Security de Postgres.** La comprobación no puede depender de que el desarrollador (o el agente) se acuerde de filtrar.

- Cada tabla lleva `tenant_id uuid not null` y una política:
  ```sql
  alter table "invoice" enable row level security;
  alter table "invoice" force row level security;
  create policy tenant_isolation on "invoice"
    using (tenant_id = current_setting('app.current_tenant', true)::uuid);
  ```
- La aplicación se conecta con un rol **sin** `BYPASSRLS`. Un rol separado, usado sólo por las migraciones, sí puede.
- Una extensión de cliente Prisma abre transacción y ejecuta `set local app.current_tenant = $1` antes de cada operación. Fuera de un contexto de tenant, las consultas devuelven cero filas — que es el fallo correcto.
- Test de integración obligatorio: crear dos tenants con datos, y comprobar que ninguna consulta del tenant A devuelve nada de B, incluidos agregados, `count` y búsqueda de texto.

## 3. Seguridad de datos salariales

Los importes retributivos son el dato más sensible del sistema y son datos personales bajo el RGPD.

1. **Tabla separada** `CompensationRecord`, nunca campos en `Employee`.
2. **Cifrado a nivel de columna** con `pgcrypto` (o cifrado en aplicación con envelope encryption y clave por tenant en KMS). La clave no vive en la base de datos.
3. Acceso condicionado a `canViewCompensation`, comprobado en el servidor; **jamás** filtrado sólo en el cliente.
4. Los roles sin ese permiso reciben **bandas** (`P25/P50/P75` del rol) y agregados con supresión: si un agregado se calcula sobre **menos de 4 empleados**, se devuelve `SUPPRESSED` — si no, la media de un equipo de dos personas revela el sueldo del otro.
5. **Auditoría**: cada lectura de retribución individual genera un registro en `AuditLog` (quién, cuándo, sobre quién, desde dónde). El log es *append-only*.
6. Retención configurable y borrado/anonimización a petición (arts. 15–17 RGPD) con exportación en JSON.
7. Los logs de aplicación y las trazas nunca contienen importes retributivos ni nombres de empleado; se referencian por id.

## 4. Modelo de datos (Prisma, resumido)

> Convenciones: todos los importes `Int` en **céntimos** + `currency String @db.Char(3)`. Todas las entidades de negocio llevan `tenantId`, `createdAt`, `updatedAt`, `createdById`. Borrado lógico (`deletedAt`) en las entidades con valor contable.

```prisma
// ---------- Tenancy e identidad ----------
model Tenant {
  id            String   @id @default(uuid())
  name          String
  baseCurrency  String   @db.Char(3)
  fiscalYearStartMonth Int @default(1)
  settings      Json     // parámetros del doc 02, versionados en TenantParamVersion
  plan          Plan     @default(TRIAL)
}
model TenantParamVersion { id String @id; tenantId String; effectiveFrom DateTime; params Json; createdById String }
model User        { id String @id; email String @unique; name String; }
model Membership  { id String @id; tenantId String; userId String; role Role; canViewCompensation Boolean @default(false); @@unique([tenantId, userId]) }
enum Role { OWNER FINANCE IT_MANAGER PROJECT_MANAGER CONTRIBUTOR VIEWER }

// ---------- Organización analítica ----------
model CostCenter   { id String @id; tenantId String; code String; name String; parentId String? }
model BusinessUnit { id String @id; tenantId String; code String; name String; headcount Int?; revenueCents BigInt?; }
model ITService    { id String @id; tenantId String; code String; name String; category ServiceCategory; ownerId String?; criticality Criticality; activeUsers Int? }
enum ServiceCategory { INFRASTRUCTURE END_USER_COMPUTING APPLICATIONS SECURITY NETWORK DATA SUPPORT GOVERNANCE }

// ---------- Proveedores, contratos y facturas ----------
model Vendor   { id String @id; tenantId String; name String; taxId String?; country String?; criticality Criticality }
model Contract {
  id String @id; tenantId String; vendorId String; name String
  type ContractType; periodicity Periodicity; amountCents Int; currency String
  startDate DateTime; endDate DateTime?; renewalDate DateTime?
  noticeDays Int?; autoRenew Boolean @default(false)
  licensedSeats Int?; activeSeats Int?          // para el cálculo de desperdicio
  serviceId String?; costCenterId String?
}
enum ContractType { SUBSCRIPTION_SAAS LICENSE MAINTENANCE SUPPORT HOSTING CLOUD TELCO OUTSOURCING CONSULTING INSURANCE OTHER }
enum Periodicity  { ONE_OFF MONTHLY QUARTERLY SEMIANNUAL ANNUAL BIENNIAL USAGE_BASED }

model Invoice {
  id String @id; tenantId String; vendorId String
  invoiceNumber String; issueDate DateTime; accrualDate DateTime; dueDate DateTime?
  serviceStart DateTime?; serviceEnd DateTime?      // para devengo prorrateado
  netCents Int; vatCents Int; grossCents Int; currency String; fxRate Decimal?
  status InvoiceStatus; source InvoiceSource
  fileKey String?; extraction Json?; extractionConfidence Float?
  contractId String?; projectId String?
  @@unique([tenantId, vendorId, invoiceNumber])
}
enum InvoiceStatus { DRAFT PENDING_REVIEW APPROVED POSTED REJECTED DUPLICATE }
enum InvoiceSource { MANUAL CSV_IMPORT OCR ERP_SYNC CLOUD_CONNECTOR API }

model InvoiceLine {
  id String @id; tenantId String; invoiceId String
  description String; quantity Decimal; unitPriceCents Int; netCents Int
  costType CostType; category String
  serviceId String?; costCenterId String?; projectId String?; assetId String?
}
enum CostType { OPEX_RECURRING OPEX_ONE_OFF CAPEX PERSONNEL_EXTERNAL PROJECT_COST PENALTY }

// ---------- Inmovilizado ----------
model Asset {
  id String @id; tenantId String; tag String; name String; category AssetCategory
  vendorId String?; invoiceLineId String?
  acquisitionDate DateTime; acquisitionCents Int; residualCents Int @default(0)
  usefulLifeMonths Int; method DepreciationMethod @default(STRAIGHT_LINE)
  status AssetStatus; serviceId String?; costCenterId String?; assignedEmployeeId String?
  disposalDate DateTime?; disposalCents Int?
}
enum AssetCategory { SERVER STORAGE NETWORK WORKSTATION LAPTOP MOBILE PERIPHERAL SOFTWARE_LICENSE_PERPETUAL INTANGIBLE_DEV OTHER }
enum AssetStatus { IN_USE SPARE IN_REPAIR RETIRED DISPOSED }
model DepreciationEntry { id String @id; tenantId String; assetId String; period String; cents Int; accumulatedCents Int; @@unique([assetId, period]) }

// ---------- Personal ----------
model Position { id String @id; tenantId String; title String; level String; costCenterId String?; marketRateCentsPerHour Int? }
model Employee {
  id String @id; tenantId String; employeeCode String; displayName String
  positionId String; costCenterId String; fteRatio Decimal @default(1.0)
  startDate DateTime; endDate DateTime?; contractType String
}
model CompensationRecord {              // CIFRADA · acceso auditado
  id String @id; tenantId String; employeeId String
  effectiveFrom DateTime; effectiveTo DateTime?
  grossAnnualCents Int; variableAnnualCents Int @default(0)
  benefitsAnnualCents Int @default(0); trainingAnnualCents Int @default(0)
  employerSsRate Decimal                       // congelado en el momento del registro
}
model TimeEntry {
  id String @id; tenantId String; employeeId String; date DateTime; hours Decimal
  activityType ActivityType; projectId String?; serviceId String?
  isRework Boolean @default(false); source String  // MANUAL | JIRA | CLOCKIFY | CSV
}
enum ActivityType { RUN_OPERATIONS RUN_SUPPORT CHANGE_PROJECT ADMIN TRAINING ABSENCE }

// ---------- Proyectos ----------
model Project {
  id String @id; tenantId String; code String; name String; sponsorId String?; managerId String?
  status ProjectStatus; startDate DateTime; plannedEndDate DateTime; actualEndDate DateTime?
  expectedAnnualBenefitCents Int?          // para el coste de oportunidad
  legacyRunCostMonthlyCents Int?           // para el coste puente operativo
  penaltyPerDayCents Int @default(0)
}
enum ProjectStatus { PLANNED ACTIVE ON_HOLD DELIVERED CANCELLED }
model ProjectBaseline { id String @id; tenantId String; projectId String; version Int; bacCents Int; endDate DateTime; approvedAt DateTime; approvedById String; reason String?; @@unique([projectId, version]) }
model Milestone  { id String @id; tenantId String; projectId String; name String; weight Decimal; plannedDate DateTime; actualDate DateTime?; progressPct Decimal @default(0) }
model DelayEvent { id String @id; tenantId String; projectId String; from DateTime; to DateTime?; cause DelayCause; description String; fteHeld Decimal; computedCostCents Int? }
enum DelayCause { SCOPE_CHANGE RESOURCE_UNAVAILABLE VENDOR_DELAY DEPENDENCY_BLOCKED QUALITY_REWORK APPROVAL_DELAY ESTIMATION_ERROR EXTERNAL }
model ChangeRequest { id String @id; tenantId String; projectId String; description String; costImpactCents Int; scheduleImpactDays Int; status ApprovalStatus; decidedAt DateTime? }

// ---------- Presupuesto y reparto ----------
model BudgetPeriod { id String @id; tenantId String; year Int; status BudgetStatus }
model BudgetLine   { id String @id; tenantId String; budgetPeriodId String; costCenterId String?; serviceId String?; projectId String?; category String; monthlyCents Int[] }  // 12 posiciones
model AllocationRule { id String @id; tenantId String; name String; sourceScope Json; driver AllocationDriver; params Json; order Int }
enum AllocationDriver { HEADCOUNT ACTIVE_USERS DEVICES TICKETS STORAGE_GB COMPUTE_UNITS REVENUE FIXED_PERCENT }
model Scenario { id String @id; tenantId String; name String; baseYear Int; overrides Json; createdById String }

// ---------- Métricas operativas y referencias ----------
model OperationalMetric {   // alimenta unit economics y los drivers de reparto
  id String @id; tenantId String; period String        // "2026-08"
  metric OperationalMetricType; value Decimal
  businessUnitId String?; serviceId String?
  @@unique([tenantId, period, metric, businessUnitId, serviceId])
}
enum OperationalMetricType { ACTIVE_USERS MANAGED_DEVICES TICKETS_RESOLVED STORAGE_GB COMPUTE_UNITS HEADCOUNT COMPANY_REVENUE }

model Benchmark {          // bandas de referencia cargadas por el tenant. NUNCA hardcodeadas
  id String @id; tenantId String; indicator String     // "IT_SPEND_RATIO" | "COST_PER_USER" | ...
  sector String?; sizeBand String?
  goodValue Decimal; badValue Decimal; unit String; source String
  @@unique([tenantId, indicator, sector, sizeBand])
}
model ScoreSnapshot { id String @id; tenantId String; period String; score Decimal; coveragePct Decimal; breakdown Json; @@unique([tenantId, period]) }

// ---------- Hechos, cierre y auditoría ----------
model CostFact {            // tabla de hechos desnormalizada que alimenta los dashboards
  id String @id; tenantId String; period String            // "2026-08"
  costType CostType; amountCents Int; currency String
  serviceId String?; costCenterId String?; businessUnitId String?; projectId String?
  vendorId String?; employeeId String?; assetId String?
  sourceTable String; sourceId String                      // trazabilidad hasta el origen
  @@index([tenantId, period, serviceId])
}
model PeriodClose { id String @id; tenantId String; period String; closedAt DateTime; closedById String; snapshot Json; @@unique([tenantId, period]) }
model AuditLog   { id String @id; tenantId String; actorId String; action String; entity String; entityId String; before Json?; after Json?; ip String?; at DateTime @default(now()) }
model ImportJob  { id String @id; tenantId String; type String; status JobStatus; fileKey String?; mapping Json?; stats Json?; errors Json? }
model Alert      { id String @id; tenantId String; type AlertType; severity Severity; entity String; entityId String; message String; dueAt DateTime?; acknowledgedAt DateTime? }
enum AlertType { CONTRACT_RENEWAL PRICE_INCREASE LICENSE_WASTE BUDGET_OVERRUN PROJECT_CPI_LOW ASSET_END_OF_LIFE DUPLICATE_INVOICE UNGOVERNED_SPEND }

// ---------- Enums auxiliares ----------
enum Plan               { TRIAL STARTER PRO ENTERPRISE }
enum Criticality        { LOW MEDIUM HIGH CRITICAL }
enum DepreciationMethod { STRAIGHT_LINE DECLINING_BALANCE UNITS_OF_USE }
enum ApprovalStatus     { DRAFT PENDING APPROVED REJECTED }
enum BudgetStatus       { DRAFT APPROVED LOCKED }
enum JobStatus          { QUEUED RUNNING SUCCEEDED FAILED PARTIAL }
enum Severity           { INFO WARNING CRITICAL }
```

**Trazabilidad KPI → dato.** Cada indicador del doc 02 tiene su origen en este modelo: coste de oportunidad → `Project.expectedAnnualBenefitCents`; coste puente → `Project.legacyRunCostMonthlyCents`; penalización → `Project.penaltyPerDayCents`; retrabajo → `TimeEntry.isRework`; desperdicio de licencias → `Contract.licensedSeats`/`activeSeats`; ratio de recuperación → `Position.marketRateCentsPerHour`; unit economics y drivers → `OperationalMetric`; bandas del score → `Benchmark`. **Si un KPI no tiene campo de origen, no se implementa: se abre issue para añadirlo al modelo primero.**

## 5. Motor de cálculo y flujo de datos

```
Facturas / Contratos / Activos / Horas
        │  (validadas y aprobadas)
        ▼
  Job "recalculate(period, tenant)"  ── idempotente, re-ejecutable
        │  usa packages/finance-core (puro)
        ▼
     CostFact  ──►  Allocation (reparto en cascada)  ──►  KPIs / Score / Dashboards
        │
        └──►  PeriodClose (congela el periodo; cambios posteriores = ajuste con fecha)
```

El recálculo es **idempotente y determinista**: mismos datos de entrada + mismos parámetros = mismo resultado. Se dispara al aprobar una factura, al cerrar un mes o a mano, y su duración se registra.

## 6. API REST pública (`/api/v1`)

Autenticación por API key con ámbito de tenant, `Idempotency-Key` obligatoria en POST, paginación por cursor, respuesta de error RFC 7807, límite de tasa por tenant.

```
POST   /invoices                     alta (usada por conectores)
POST   /invoices/import              importación por lotes CSV/JSON
GET    /invoices?period=&status=
POST   /invoices/{id}/approve
GET    /contracts  POST /contracts   PATCH /contracts/{id}
GET    /assets     POST /assets      GET /assets/{id}/depreciation
POST   /time-entries/bulk
GET    /projects/{id}/evm?asOf=
GET    /projects/{id}/cost-of-delay
GET    /services/{id}/tco?period=
GET    /kpis?period=                 unit economics + run/change
GET    /viability-score?period=      con desglose por indicador
POST   /allocations/run
POST   /periods/{period}/close
GET    /export/{format}              xlsx | csv | pdf
```

## 7. Pantallas (v1)

1. **Panel de dirección** — Viability Score con desglose, TCO del año, forecast, run/change, top 5 desviaciones, alertas.
2. **Costes** — explorador de facturas y recurrentes con filtros, drill-down y detección de duplicados.
3. **Bandeja de validación** — documentos con OCR pendientes: PDF a la izquierda, campos extraídos editables a la derecha, confianza por campo resaltada.
4. **Contratos y renovaciones** — calendario de renovaciones, preavisos, desperdicio de licencias.
5. **Inmovilizado** — parque, amortización, edad, deuda técnica, próximas reposiciones.
6. **Equipo** — plantilla, coste por rol, tarifas, utilización, run/change, coste no imputado. Sin importes individuales salvo permiso.
7. **Proyectos** — lista con CPI/SPI en semáforo; ficha con curva EVM, baselines, eventos de retraso y CoD acumulado por causa.
8. **Presupuesto** — real vs presupuesto vs forecast por centro de coste y escenarios.
9. **Chargeback** — coste por unidad de negocio y por servicio, con la regla de reparto aplicada visible.
10. **Configuración** — parámetros del doc 02, bandas del score, reglas de reparto, conectores, usuarios y permisos.

## 8. Decisiones de diseño que no se negocian

1. Céntimos enteros. Ningún `float` en importes.
2. Nada de datos de facturación cruzando tenants: RLS activa y probada.
3. El motor de cálculo es puro y testeado al 95 %; si un KPI no tiene test con caso numérico, no se entrega.
4. Todo KPI baja hasta el registro de origen. Un número que no se puede explicar no se muestra.
5. La retribución vive cifrada, aparte y auditada, y se agrega con supresión por debajo de 4 empleados.
6. Los datos semilla son ficticios y evidentemente ficticios. Nunca datos reales de un cliente en el repositorio.
