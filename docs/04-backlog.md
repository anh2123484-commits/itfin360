# ITFin360 — Backlog de construcción (tareas del tamaño de una PR)

Cada tarea es **una issue de GitHub y una PR**. `Dep:` indica las tareas que deben estar en `main` antes de empezar.
`Talla`: S ≈ medio día · M ≈ 1 día · L ≈ 2 días de agente.
Criterios de aceptación: si no se cumplen todos, la PR no se mergea.

---

## Fase 0 · Fundaciones

**F0-01 · Scaffold del monorepo** · L · Dep: —
pnpm workspaces + Turborepo con `apps/web` (Next.js 15, App Router, TS strict), `apps/worker`, `packages/{finance-core,db,connectors,ui,config}`. Tailwind + shadcn/ui. ESLint + Prettier compartidos.
*Aceptación:* `pnpm install && pnpm build` verde en limpio; `pnpm dev` sirve una home vacía; TS `strict: true` y `noUncheckedIndexedAccess: true`; sin `any` en el repo.

**F0-02 · Docker compose de desarrollo** · S · Dep: F0-01
Postgres 16, Redis 7, MinIO. Scripts `db:up`, `db:down`, `db:reset`. `.env.example` completo.
*Aceptación:* un `pnpm db:up` desde cero deja los tres servicios sanos y documentados en el README.

**F0-03 · CI en GitHub Actions** · M · Dep: F0-02
Workflow: install (cache pnpm) → lint → typecheck → test (con servicios) → build. Gate de cobertura sobre `packages/finance-core` (≥ 95 %). Comprobación automática de que toda tabla nueva de una migración tiene política RLS.
*Aceptación:* el workflow pasa en `main` y falla de verdad si se introduce un `any`, si baja la cobertura o si se crea una tabla sin RLS (añade un test que lo demuestre).

**F0-04 · Prisma + esquema base de tenancy** · M · Dep: F0-02
`packages/db` con `Tenant`, `TenantParamVersion`, `User`, `Membership`, `AuditLog`. Migración inicial.
*Aceptación:* `pnpm db:migrate` limpio; cliente Prisma exportado y tipado.

**F0-05 · RLS y contexto de tenant** · L · Dep: F0-04
Rol de aplicación sin `BYPASSRLS`; política `tenant_isolation` en cada tabla; extensión de cliente Prisma con `withTenant(tenantId, cb)` que hace `set local app.current_tenant`. Helper de migración que genera la política.
*Aceptación:* test de integración con Testcontainers: dos tenants con datos; ninguna consulta, agregado o `count` del tenant A ve nada de B; una consulta fuera de contexto devuelve 0 filas. Este test se amplía en cada fase con los modelos nuevos.

**F0-06 · Auth.js, organizaciones y RBAC** · L · Dep: F0-05
Login por email (magic link) + contraseña, alta de tenant, invitaciones, cambio de tenant activo. Middleware que resuelve el tenant y el rol. `can(permission)` en servidor. `canViewCompensation` como permiso independiente.
*Aceptación:* test por rol de la matriz de `docs/01-prd-y-alcance.md`; un usuario sin permiso recibe 403 del **servidor**, no un `hidden` en el cliente.

**F0-07 · Auditoría y log estructurado** · S · Dep: F0-06
`AuditLog` append-only (sin `UPDATE`/`DELETE` para el rol de aplicación), helper `audit()`, logger con redacción de PII.
*Aceptación:* test que intenta modificar un registro de auditoría y falla a nivel de base de datos; test que comprueba que un importe retributivo nunca aparece en el log.

**F0-08 · Cola BullMQ y worker** · M · Dep: F0-02
`apps/worker` con colas `imports`, `ocr`, `connectors`, `recalc`, `alerts`. Reintentos con backoff, cola de fallidos, panel de estado interno.
*Aceptación:* un job de prueba encolado desde web se ejecuta en el worker; un job que falla 3 veces acaba en la cola de fallidos y queda visible.

---

## Fase 1 · Motor de cálculo

**F1-01 · Primitivas monetarias** · S · Dep: F0-01
`Cents` con marca de tipo, `roundHalfUp`, conversión de divisa con tipo persistido, reparto por mayor resto.
*Aceptación:* repartir 10.001 céntimos entre 3 devuelve `[3334, 3334, 3333]` y suma exacta; propiedad probada con 1.000 casos aleatorios.

**F1-02 · Normalización de recurrentes y devengo** · S · Dep: F1-01
`normalizeRecurring`, `accrualSpread` (prorrateo por días naturales).
*Aceptación:* factura anual de 12.000 € con servicio 15/01–14/01 reparte correctamente y la suma de los meses es exactamente el total.

**F1-03 · Amortización** · M · Dep: F1-01
`depreciationSchedule` lineal con valor residual y prorrateo del primer mes; VNC; `technicalDebt`.
*Aceptación:* servidor de 12.000 €, residual 0, 60 meses, alta el 15/03 → cuota 200 €/mes y primer mes prorrateado 200 € × 17/31 = 109,68 €; el cuadro completo suma exactamente 12.000 €.

**F1-04 · Coste empresa y tarifa horaria** · M · Dep: F1-01
`employerCost`, `internalHourlyRate`, tarifa por rol ponderada por FTE.
*Aceptación:* reproduce el caso de referencia del doc 02 (60.940 € y 49,93 €/h) al céntimo.

**F1-05 · Utilización y run/change** · S · Dep: F1-04
`utilization`, `%run`, `%change`, coste no imputado.
*Aceptación:* casos con horas parciales, bajas y empleados a tiempo parcial.

**F1-06 · TCO y reparto** · L · Dep: F1-03, F1-04
`serviceTco`, `allocate` con los 8 drivers, reparto en cascada, **detección de ciclos** con error explícito.
*Aceptación:* una configuración cíclica lanza `AllocationCycleError` nombrando las reglas implicadas; el total repartido es exactamente el total de origen.

**F1-07 · EVM** · M · Dep: F1-01
`evm` completo, null-safe cuando `AC=0` o `PV=0`; avance por hitos ponderados y regla 0/50/100.
*Aceptación:* caso de libro (BAC 100k, EV 40k, AC 50k, PV 45k → CPI 0,8; SPI 0,889; EAC 125k; VAC −25k) y casos degenerados devuelven `null`, no `Infinity`.

**F1-08 · Coste del retraso** · M · Dep: F1-04, F1-07
`costOfDelay` con los cinco componentes y acumulación día a día con la composición real del equipo.
*Aceptación:* reproduce el caso de referencia (1.662,10 €/día · 49.863 € a 30 días); un proyecto sin beneficio esperado ni legacy sólo suma equipo retenido.

**F1-09 · Forecast y escenarios** · M · Dep: F1-02, F1-03, F1-07
`forecast` (real + recurrentes restantes + ETC + amortizaciones + comprometido) y aplicación de *overrides* de escenario sin tocar datos reales.
*Aceptación:* un escenario que cancela un contrato en julio reduce el forecast exactamente en los meses restantes y deja el real intacto.

**F1-10 · IT Viability Score** · L · Dep: F1-05, F1-06, F1-07
Normalización por bandas, pesos, `INSUFFICIENT_DATA` con redistribución de pesos y `% de cobertura`, desglose con trazabilidad.
*Aceptación:* sin benchmarks cargados, los indicadores 1 y 5 quedan excluidos y el score informa de la cobertura; cada indicador devuelve valor, normalizado, peso, contribución y los ids de origen.

---

## Fase 2 · Ingesta de costes

**F2-01 · Modelo de proveedores, facturas y líneas** · M · Dep: F0-05
Migración + RLS + repositorios. Unicidad `(tenant, vendor, invoiceNumber)`.
*Aceptación:* el test de aislamiento de F0-05 ampliado a los modelos nuevos.

**F2-02 · CRUD de facturas y flujo de aprobación** · L · Dep: F2-01, F0-06
Alta/edición, estados `DRAFT → PENDING_REVIEW → APPROVED → POSTED`, rechazo, marcado de duplicado. Imputación de línea a servicio / centro de coste / proyecto / activo.
*Aceptación:* transiciones inválidas rechazadas en servidor; toda transición auditada; sólo `FINANCE`/`OWNER` aprueban.

**F2-03 · Detección de duplicados** · M · Dep: F2-02
Exacto por número de factura y difuso por `(proveedor, importe, fecha ±5 días)`.
*Aceptación:* alta de un duplicado exacto → 409 con referencia a la factura existente; el difuso avisa pero no bloquea.

**F2-04 · Importación CSV/Excel con mapeo** · L · Dep: F2-02, F0-08
Subida, detección de cabeceras, mapeo de columnas guardable como plantilla, previsualización, validación fila a fila, importación en job con informe de errores descargable.
*Aceptación:* un CSV de 5.000 filas con 12 filas inválidas importa 4.988 y devuelve el informe; la operación es reanudable y no duplica al reintentar.

**F2-05 · Explorador de costes (UI)** · L · Dep: F2-02
Tabla con filtros (periodo, proveedor, servicio, tipo, estado), agrupaciones, totales y drill-down hasta el PDF.
*Aceptación:* 100.000 líneas paginadas por cursor sin degradar; los totales cuadran con la suma de la base.

---

## Fase 3 · Contratos e inmovilizado

**F3-01 · Contratos y recurrentes** · M · Dep: F2-01
Modelo, CRUD, coste normalizado, vinculación factura↔contrato, calendario de renovaciones.
*Aceptación:* un contrato trimestral de 900 € muestra 300 €/mes y 3.600 €/año.

**F3-02 · Desperdicio de licencias y subidas de precio** · M · Dep: F3-01
`licensedSeats` vs `activeSeats` → coste desperdiciado; comparación de precio contra el periodo anterior.
*Aceptación:* alerta `LICENSE_WASTE` cuando el desperdicio supera el umbral configurado; alerta `PRICE_INCREASE` con el delta y el porcentaje.

**F3-03 · Registro de activos** · M · Dep: F2-01
Modelo, CRUD, asignación a servicio/centro de coste/empleado, alta desde línea de factura, baja con resultado.
*Aceptación:* dar de alta un activo desde una línea `CAPEX` evita el doble cómputo de esa línea como OPEX (test explícito).

**F3-04 · Amortización automática mensual** · M · Dep: F3-03, F1-03
Job que genera `DepreciationEntry`; idempotente por `(asset, period)`.
*Aceptación:* ejecutar el job dos veces sobre el mismo periodo no duplica; el acumulado nunca supera la base amortizable.

**F3-05 · Panel de inmovilizado** · M · Dep: F3-04
Parque por categoría, edad, VNC, deuda técnica, próximas reposiciones y su encaje en presupuesto.
*Aceptación:* activos que superan su vida útil aparecen con el coste de reposición estimado y la fórmula usada visible.

---

## Fase 4 · Personal y productividad

**F4-01 · Puestos y empleados** · M · Dep: F0-06
Modelo, CRUD, FTE, altas y bajas con vigencias.
*Aceptación:* un empleado que causa baja a mitad de año prorratea correctamente en los cálculos anuales.

**F4-02 · Retribución cifrada y auditada** · L · Dep: F4-01, F0-07
`CompensationRecord` con cifrado de columna, vigencias, acceso tras `canViewCompensation`, auditoría por lectura.
*Aceptación:* un usuario sin permiso recibe bandas, no importes; un agregado sobre 3 empleados devuelve `SUPPRESSED`; cada lectura individual deja registro; los importes están cifrados en disco (verificado leyendo la tabla en crudo).

**F4-03 · Parámetros de coste y tarifas** · M · Dep: F4-02, F1-04
Configuración por tenant y por año (tasa SS desglosada, jornada, vacaciones, factor de productividad), cálculo de coste empresa y tarifas.
*Aceptación:* cambiar la tasa de 2027 no altera los resultados ya calculados de 2026.

**F4-04 · Imputación de horas** · L · Dep: F4-01
Alta manual, parte semanal, importación CSV, marcado de retrabajo, validación de solapes y de exceso de jornada.
*Aceptación:* no se pueden imputar más horas de las disponibles en un día sin marcarlo como extra; importación masiva idempotente.

**F4-05 · Panel de equipo** · M · Dep: F4-03, F4-04, F1-05
Utilización, run/change, coste por rol, coste no imputado, ratio de recuperación por rol y equipo.
*Aceptación:* la vista compartida no permite ordenar personas por ratio de recuperación; sólo agregados por rol/equipo.

---

## Fase 5 · Proyectos y desviaciones

**F5-01 · Proyectos, baselines e hitos** · L · Dep: F4-04
Modelo, CRUD, baseline versionada con motivo y aprobador, hitos ponderados, cálculo de avance.
*Aceptación:* una re-baseline conserva la versión anterior; los pesos de hitos deben sumar 1 o el guardado falla.

**F5-02 · Coste real de proyecto** · M · Dep: F5-01, F2-02
Agregación de horas × tarifa + facturas imputadas + activos imputados.
*Aceptación:* el AC del proyecto cuadra con la suma de sus orígenes y hace drill-down hasta cada uno.

**F5-03 · EVM en producto** · M · Dep: F5-02, F1-07
Cálculo `asOf`, curva PV/EV/AC, semáforos por CPI/SPI configurables.
*Aceptación:* la curva coincide con el motor; un proyecto sin coste imputado no rompe la vista.

**F5-04 · Eventos de retraso y coste del retraso** · L · Dep: F5-03, F1-08
Registro de eventos con causa y FTE retenido, cálculo día a día, CoD acumulado, agrupación por causa.
*Aceptación:* reproduce el caso de referencia; el desglose muestra los cinco componentes por separado; los eventos solapados no cuentan dos veces el equipo retenido.

**F5-05 · Change requests** · M · Dep: F5-01
Alta con impacto en coste y plazo, flujo de aprobación, efecto en baseline al aprobarse.
*Aceptación:* aprobar un CR genera una nueva baseline vinculada al CR y deja la desviación contra la baseline inicial intacta.

---

## Fase 6 · Consolidación, presupuesto y viabilidad

**F6-00 · Métricas operativas y benchmarks del tenant** · M · Dep: F0-05
`OperationalMetric` (usuarios activos, dispositivos, tickets, GB, headcount, facturación de la empresa) con carga manual y por API, y `Benchmark` con las bandas de referencia que carga el propio tenant.
*Aceptación:* sin métricas cargadas, los KPI que dependen de ellas devuelven `INSUFFICIENT_DATA` en lugar de un número inventado; ningún benchmark está escrito en el código.

**F6-01 · Tabla de hechos y job de recálculo** · L · Dep: F2-02, F3-04, F4-04, F5-02
`CostFact` alimentada por un job idempotente y determinista por `(tenant, periodo)`, con trazabilidad al origen.
*Aceptación:* dos ejecuciones seguidas producen exactamente el mismo conjunto de hechos; el tiempo de recálculo de 18 meses con 50.000 registros se mide y se registra.

**F6-02 · Reglas de reparto en producto** · M · Dep: F6-01, F1-06
CRUD de reglas, orden, previsualización del reparto antes de aplicar.
*Aceptación:* la previsualización coincide con la aplicación; un ciclo se detecta en la previsualización, no en producción.

**F6-03 · Presupuesto y variaciones** · L · Dep: F6-01
Presupuesto anual por centro de coste/servicio/categoría con reparto mensual, real vs presupuesto vs forecast.
*Aceptación:* la suma de las 12 posiciones cuadra con el total de la línea; alerta `BUDGET_OVERRUN` al superar el umbral.

**F6-04 · Escenarios** · M · Dep: F6-03, F1-09
Crear, comparar y clonar escenarios; comparativa lado a lado.
*Aceptación:* ningún escenario escribe en tablas reales (test que lo comprueba tras aplicar overrides).

**F6-05 · Cierre de periodo** · M · Dep: F6-01
`PeriodClose` que congela el periodo; los cambios posteriores generan ajuste fechado, no reescritura.
*Aceptación:* modificar una factura de un mes cerrado crea un ajuste en el mes abierto y deja el cerrado intacto; sólo `FINANCE`/`OWNER` cierran.

**F6-06 · Viability Score en producto** · L · Dep: F6-00, F6-02, F1-10
Cálculo por periodo, tarjeta de score, desglose por indicador, drill-down, gestión de bandas y benchmarks del tenant.
*Aceptación:* cada indicador llega hasta los registros que lo forman; sin benchmarks, la cobertura se muestra explícitamente.

**F6-07 · Panel de dirección** · L · Dep: F6-06
Una pantalla: score, TCO, forecast, run/change, top desviaciones, coste de retraso acumulado, alertas.
*Aceptación:* carga en menos de 2 s con el dataset semilla de 18 meses; todos los números clicables.

**F6-08 · Chargeback por unidad de negocio** · M · Dep: F6-02
Coste por BU y por servicio con la regla aplicada visible y exportable.
*Aceptación:* la suma de lo repartido a las BU es exactamente el coste de origen.

---

## Fase 7 · Automatización de la ingesta

**F7-01 · Almacenamiento de documentos** · M · Dep: F0-02
S3/MinIO, subida con URL firmada, antivirus opcional, límite de tamaño y tipo, descarga de un solo uso.
*Aceptación:* un fichero no es accesible sin firma; la firma caduca.

**F7-02 · Interfaz `DocumentExtractor` + implementación** · L · Dep: F7-01, F0-08
Adaptador con dos implementaciones (Azure Document Intelligence y LLM con visión), salida normalizada con **confianza por campo** y coste de la llamada registrado.
*Aceptación:* con un fichero de prueba (facturas ficticias generadas en el propio repo) la extracción devuelve el esquema completo; cambiar de implementación no toca el dominio.

**F7-03 · Bandeja de validación humana** · L · Dep: F7-02
PDF a la izquierda, campos editables a la derecha, confianza resaltada, aprobar/corregir/rechazar. **Nada llega a `POSTED` sin validación humana** cuando el origen es OCR.
*Aceptación:* una factura extraída no puede saltarse la revisión; las correcciones quedan auditadas y alimentan métricas de precisión del extractor.

**F7-04 · Interfaz de conectores + conector ERP de referencia** · L · Dep: F2-02, F0-08
`Connector` con `authenticate/listInvoices/pullSince`, sincronización incremental con cursor, mapeo de plan contable, reintentos. Una implementación completa (Holded u Odoo).
*Aceptación:* sincronización incremental idempotente; una interrupción a mitad se reanuda sin duplicar.

**F7-05 · Conector de coste cloud** · L · Dep: F7-04
Azure Cost Management y/o AWS Cost Explorer: coste diario por servicio y etiquetas → recurrentes.
*Aceptación:* el coste importado de un mes cuadra con el informe del proveedor con desviación < 0,5 %.

**F7-06 · Conector de licencias M365/Google** · M · Dep: F7-04
Licencias contratadas vs activas → alimenta el cálculo de desperdicio.
*Aceptación:* el desperdicio calculado coincide con contratadas − activas × coste unitario.

---

## Fase 8 · Cierre de producto

**F8-01 · Motor de alertas** · M · Dep: F6-03, F3-02
Evaluación programada de los ocho tipos de alerta, deduplicación, reconocimiento, notificación por email.
*Aceptación:* una alerta ya reconocida no se vuelve a emitir mientras persista la misma causa.

**F8-02 · Exportación e informes programados** · M · Dep: F6-07
Excel y PDF de los cuadros de mando; envío programado por email.
*Aceptación:* el Excel exportado abre sin avisos y sus totales cuadran con la pantalla.

**F8-03 · API pública v1 + OpenAPI** · L · Dep: F6-01
Endpoints del doc 03, API keys por tenant, `Idempotency-Key`, límite de tasa, errores RFC 7807, documentación generada.
*Aceptación:* dos POST con la misma clave de idempotencia crean un solo recurso; el spec OpenAPI valida.

**F8-04 · Datos semilla y modo demo** · M · Dep: F6-07
Tenant de demostración: 35 empleados, 18 meses, ~2.500 facturas, 400 activos, 12 proyectos (dos con retraso severo), todo ficticio y reproducible con semilla fija.
*Aceptación:* `pnpm db:seed` produce siempre el mismo dataset y el Viability Score sale en la banda esperada por el test.

**F8-05 · Endurecimiento y RGPD** · L · Dep: F8-03
Cabeceras de seguridad, CSP, límite de tasa global, exportación y borrado de datos personales, política de retención, revisión de dependencias.
*Aceptación:* `pnpm audit` sin vulnerabilidades altas; la exportación de un empleado devuelve todos sus datos en JSON y el borrado los anonimiza dejando los agregados históricos coherentes.

**F8-06 · Rendimiento y despliegue** · M · Dep: F8-04
Índices revisados, plan de consultas de los dashboards, Dockerfile de producción, migraciones en despliegue, healthchecks.
*Aceptación:* el panel de dirección responde en < 2 s (p95) con el dataset de demo; el contenedor arranca y pasa el healthcheck.

---

## Resumen

| Fase | Tareas | Estimación agente |
|---|---|---|
| 0 · Fundaciones | 8 | ~8 días |
| 1 · Motor de cálculo | 10 | ~9 días |
| 2 · Ingesta | 5 | ~7 días |
| 3 · Contratos e inmovilizado | 5 | ~6 días |
| 4 · Personal | 5 | ~7 días |
| 5 · Proyectos | 5 | ~7 días |
| 6 · Consolidación | 9 | ~12 días |
| 7 · Automatización | 6 | ~9 días |
| 8 · Cierre | 6 | ~8 días |
| **Total** | **59** | **~73 días-agente** |

**Camino crítico hasta un producto demostrable:** Fase 0 → Fase 1 → F2-01/02/04/05 → F3-01/03/04 → F4-01/03/04 → F5-01/02/03/04 → F6-00/01/06/07 → F8-04. Todo lo demás (OCR, conectores, escenarios, API pública) es ampliación sobre una base que ya funciona.

**Paralelizable desde el día 1:** la Fase 1 completa no depende de nada más que de F0-01, así que puede ir en un hilo de Devin distinto al de la Fase 0 desde el principio.
