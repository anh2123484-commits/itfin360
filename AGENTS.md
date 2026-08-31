# AGENTS.md — instrucciones para agentes de código (Devin, Claude Code, Copilot)

Este fichero es la fuente de verdad operativa del repositorio. Léelo entero antes de tocar código.
La especificación funcional está en `docs/`. **Si el código y `docs/02-modelo-financiero.md` discrepan, manda el documento.**

## 0. Qué se construye

`ITFin360`: SaaS multi-tenant de gestión financiera de un departamento IT. Ver `docs/01-prd-y-alcance.md`.

## 1. Reglas duras (rechazo automático de PR si se incumplen)

1. **Dinero en céntimos, siempre `Int`.** Prohibido `float`/`number` decimal para importes. El nombre del campo termina en `Cents`.
2. **Nada de I/O en `packages/finance-core`.** Sin Prisma, sin `fetch`, sin `Date.now()`: la fecha se pasa como parámetro.
3. **Todo modelo de negocio lleva `tenantId` y política RLS.** Una migración que crea una tabla sin su política no pasa CI.
4. **Consultas sólo dentro del contexto de tenant** (`withTenant(tenantId, cb)`). Prohibido usar el cliente Prisma crudo en código de aplicación.
5. **Retribución**: sólo en `CompensationRecord`, cifrada, tras `canViewCompensation`, con entrada en `AuditLog`. Agregados de menos de 4 empleados → `SUPPRESSED`.
6. **Sin `any`.** TypeScript en modo `strict`. Sin `@ts-ignore` sin justificación en comentario y aprobación en la PR.
7. **Toda entrada externa se valida con Zod** en el límite (route handler, server action, worker).
8. **Ningún dato real de cliente** en fixtures, seeds, tests o capturas. Datos ficticios y evidentemente ficticios.
9. **Sin secretos en el repo.** Todo por variable de entorno, declarada en `.env.example`.
10. **Migraciones aditivas.** Nada de `DROP COLUMN` sin una PR previa de despliegue en dos fases.
11. **Minimización.** No se recoge ni se persiste ningún dato personal que no exija una fórmula de `docs/02-modelo-financiero.md` o una obligación legal. Todo campo personal nuevo se justifica en la PR.
12. **Cero PII en logs, trazas y mensajes de error.** El logger redacta por defecto. Se registran identificadores, nunca valores.
13. **Ningún dato de cliente sale del tenant.** Prohibido enviar contenido de facturas, nóminas o documentos a un servicio externo —modelos de IA incluidos— sin consentimiento explícito del tenant registrado en `AuditLog` y sin garantía contractual de no entrenamiento. El extractor por defecto es local.
14. **Cifrado en reposo para toda categoría personal**, no sólo retribución: mismo patrón que `CompensationRecord`.
15. **Retención declarada.** Todo modelo con datos personales declara su periodo de retención y su ruta de borrado (RGPD art. 17). Un modelo sin ambas cosas no pasa revisión.

## 2. Flujo de trabajo

- Una **issue = una PR**. Si la issue no cabe en ~400 líneas de diff útil, párate, coméntalo en la issue y propón el troceo.
- Rama: `feat/<nº-issue>-<slug>`, `fix/...`, `chore/...`.
- Commits en formato **Conventional Commits**.
- La PR debe abrirse contra `main`, enlazar la issue con `Closes #N` y rellenar la plantilla.
- **Antes de abrir la PR ejecuta y deja pasar**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. No abras una PR con CI en rojo.
- Si una decisión no está en `docs/`, **no la inventes en silencio**: implementa la opción más conservadora, y escribe en la PR una sección `## Decisiones tomadas` explicando qué asumiste y por qué. Si la decisión es estructural (modelo de datos, seguridad, fórmula), abre la PR en *draft* y pregunta antes.

## 3. Comandos

```bash
pnpm install
pnpm db:up            # Postgres + Redis + MinIO vía docker compose
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # datos ficticios: 2 tenants, 18 meses de historia
pnpm dev              # apps/web en :3000
pnpm worker           # apps/worker
pnpm test             # vitest (unit + integración con Testcontainers)
pnpm test:e2e         # playwright
pnpm lint typecheck build
```

## 4. Tests exigidos

- `packages/finance-core`: **cobertura ≥ 95 %**, gate de CI. Cada fórmula del doc 02 con su test, incluidos los dos casos numéricos de referencia (coste empresa 60.940 € / tarifa 49,93 €/h, y CoD 1.662,10 €/día).
- Aislamiento multi-tenant: test de integración contra Postgres real que recorre **todos** los modelos y verifica fuga cero entre dos tenants.
- Permisos: test por rol de la matriz de `docs/01`, incluida la supresión de agregados salariales.
- E2E del camino crítico: alta de tenant → carga de facturas → alta de activos → imputación de horas → cierre de mes → el Viability Score sale y hace drill-down.

## 5. Cómo se maneja el dinero (patrón obligatorio)

```ts
// packages/finance-core/src/money.ts
export type Cents = number & { readonly __brand: 'Cents' };
export const cents = (n: number): Cents => { /* valida entero */ };
export const roundHalfUp = (n: number): Cents => /* redondeo explícito, un único punto */;
```
Los repartos proporcionales usan **el método del mayor resto** para que la suma de las partes sea exactamente el total. Un test debe comprobarlo con importes que no dividen exacto (p. ej. 100,01 € entre 3).

## 6. Orden de construcción

Sigue el backlog de `docs/04-backlog.md`. No adelantes fases: cada una asume la anterior terminada y en `main`.

## 7. Qué NO hacer

- No añadir dependencias pesadas sin justificarlo en la PR.
- No introducir un ORM, framework de estado o librería de gráficos alternativos a los del doc 03.
- No "mejorar" las fórmulas del doc 02 por tu cuenta. Si crees que una está mal, abre una issue con el razonamiento.
- No inventar benchmarks sectoriales ni tipos de cotización: son configuración del tenant.
- No dejar `TODO` sin issue asociada.
