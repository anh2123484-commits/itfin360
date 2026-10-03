# 10 · Plan de reestructuración del repositorio

Paso 2 de la plataforma modular de NovaEra Nexus. Cómo se pasa del repositorio de hoy (una aplicación
de finanzas IT) a la plataforma de los documentos `08` y `09` sin dejar de funcionar en producción ni un
día.

Versión 1, octubre de 2026.

---

## 1. Reglas del cambio

1. Producción no se rompe. Cada PR deja `main` desplegable y con el CI en verde.
2. Ninguna URL que ya existe cambia. Las rutas de hoy (`/facturas`, `/proyectos`, `/horas`...) siguen
   funcionando igual.
3. Las migraciones solo añaden. Nada se renombra ni se borra en la misma PR que lo sustituye.
4. Un cálculo nuevo nace en un paquete puro con tests antes de tener pantalla.
5. Cada tabla nueva entra con `tenantId`, política RLS y su línea en la prueba de aislamiento.
6. Seguridad antes que funciones: MFA y repositorio privado van antes que cualquier módulo nuevo.

---

## 2. Estructura de destino

```
apps/web/src/
  app/
    (shell)/           layout con navegación por módulos, cabecera con logo del cliente
    (finanzas)/        las rutas que ya existen, movidas sin cambiar la URL
    diagnostico/       módulo 0
    portafolio/        módulo 2
    talento/ bonus/    módulos 3 y 4
    proveedores/       módulo 5 (amplía lo que hay)
    recopilacion/      módulo 6
    informes/          módulo 7
    clientes/nuevo     alta de cliente (solo equipo de NovaEra Nexus)
    login/mfa          segundo factor
  modules/<módulo>/
    api.ts             consultas de lectura que otros módulos pueden usar
    queries.ts         acceso a datos del módulo
    permisos.ts        qué acción pide qué permiso
  lib/                 lo transversal: auth, tenant, auditoría, eventos

packages/
  db/                  Prisma, RLS, superficie identity (ya existe)
  finance-core/        cálculo financiero puro (ya existe)
  diagnosis-core/      madurez, votación, consenso, valoración 360, payback y ROI (nuevo)
  portfolio-core/      estados del portafolio, OPEX a tres años, charter (nuevo)
  people-core/         capacidad, competencias, bonus (nuevo)
  ui/                  componentes con la marca de NovaEra Nexus (ya existe, se amplía)
  connectors/          Drive, Jira, transcripciones (ya existe, se amplía)
  config/              eslint, prettier, tsconfig, tailwind (ya existe)
```

Los grupos de rutas de Next.js, los nombres entre paréntesis, no forman parte de la URL. Mover
`app/facturas` a `app/(finanzas)/facturas` no cambia `/facturas`. Así se reordena el código sin tocar
enlaces, marcadores ni correos ya enviados.

La regla de que un módulo no importa de otro se comprueba con una regla de ESLint
(`no-restricted-imports` sobre `@/modules/*/queries`). Solo `api.ts` se puede importar desde fuera.

---

## 3. Orden de los movimientos

| Fase | Qué se mueve o se crea | Riesgo | Cómo se controla |
|---|---|---|---|
| A | CI preparado para repositorio privado, gitleaks y Semgrep | Bajo | El CI de la propia PR |
| B | MFA: tabla de factores, alta, verificación, códigos de recuperación, middleware | Alto | Pruebas del flujo completo, revisión línea a línea, despliegue con MFA opcional una semana y luego obligatorio |
| C | `diagnosis-core` con todo el cálculo del doc `09` | Bajo | Cobertura al 95 % |
| D | Tokens de marca, shell responsive, registro de módulos por cliente (`TenantModule`) | Medio | Las rutas de hoy siguen visibles para todos los clientes |
| E | Rutas de finanzas al grupo `(finanzas)` | Bajo | Prueba de humo que recorre todas las URL de hoy |
| F | `OrgFunction`, rol `DIRECTION`, `ApprovalPolicy` | Medio | Matriz de permisos con tests |
| G | Diagnóstico: esquema, cuestionario, iniciativas, votación, informe | Medio | Por pasos, ver doc `11` |
| H | Portafolio con Valoración 360, charter | Medio | El proyecto actual se conserva; se le añaden columnas |
| I | Seguimiento: KPI y beneficio realizado | Bajo | |
| J | Recopilación, Talento, Bonus, Informes, capa de IA | Medio a alto | Doc `11` |

---

## 4. Base de datos

### 4.1 Migraciones

Siguen entrando por `migraciones.yml` al fusionar en `main`, con el rol de migraciones. Cada migración
nueva:

- solo crea tablas, columnas con valor por defecto o índices;
- crea su política `tenant_isolation` y `FORCE ROW LEVEL SECURITY`;
- concede permisos al rol de aplicación, que sigue sin `BYPASSRLS`;
- añade la tabla a la lista de la prueba de aislamiento entre clientes.

Lo que se deja de usar se marca como obsoleto en el esquema y se borra en una PR posterior, cuando
ningún código lo lee.

### 4.2 Catálogos de NovaEra Nexus

Las dimensiones de madurez, las preguntas, los criterios de la Valoración 360 y sus descriptores son
catálogo de NovaEra Nexus. Viven en código (`diagnosis-core/catalogo`) con versión. Al dar de alta un
cliente se copian a sus tablas. Así cada cliente puede adaptar su copia sin tocar a los demás, y no hace
falta una tabla global fuera de RLS.

### 4.3 Supabase

Para datos reales hace falta el plan de pago y el contrato de tratamiento (doc `07`). Las copias de
seguridad diarias y la restauración a un punto en el tiempo se comprueban una vez antes del piloto
restaurando en un proyecto aparte.

---

## 5. Vercel

| Cambio | Cuándo | Quién |
|---|---|---|
| Protección de despliegues en vistas previas | Antes de datos reales | Titular de la cuenta |
| `MFA_KEY` (opcional, si no se deriva de `AUTH_SECRET`) | Con la fase B | Titular de la cuenta |
| Reconectar el repositorio si Vercel pierde acceso al pasar a privado | Al cambiar la visibilidad | Titular de la cuenta |

Nada más cambia en Vercel. La región sigue en Frankfurt.

---

## 6. Repositorio privado

En el plan gratuito de GitHub, un repositorio privado tiene alertas de Dependabot y 2.000 minutos de
Actions al mes, pero pierde las ramas protegidas y CodeQL. Orden para no quedarse sin red:

1. PR de la fase A: CodeQL solo corre mientras el repositorio sea público; gitleaks y Semgrep corren
   siempre. gitleaks bloquea; Semgrep informa hasta revisar su primera ejecución y después bloquea.
2. GitHub Pro en la cuenta personal, para tener ramas protegidas en privado.
3. Cambio de visibilidad en Settings, General, Danger Zone, Change visibility.
4. Comprobación: Vercel sigue desplegando, `migraciones.yml` sigue aplicando, los minutos de Actions del
   mes no pasan del 70 %.

Con unas diez PR a la semana y unos ocho minutos por PR entre los dos workflows, el consumo ronda los 350
minutos al mes. Cabe en el plan gratuito con margen.

---

## 7. Pruebas

| Tipo | Qué cubre | Dónde |
|---|---|---|
| Unitarias de paquetes puros | Todo el cálculo, cobertura del 95 % | `finance-core`, `diagnosis-core`, `portfolio-core`, `people-core` |
| Aislamiento entre clientes | Todas las tablas con datos de cliente | `packages/db`, contra Postgres real en CI |
| Puerta RLS | Ninguna migración sin política | `pnpm rls:check` |
| Permisos | Matriz de permisos por rol y función | `apps/web/src/lib/permissions.test.ts` y por módulo |
| Flujo MFA | Alta, verificación, código caducado, recuperación, bloqueo por intentos | Fase B |
| Humo de rutas | Todas las URL de hoy responden después de mover carpetas | Fase E |
| Barandillas de agentes | Un agente no lee otro cliente, ni retribución, ni escribe fuera de propuesta | Con la capa de IA |
| Secretos | Ningún secreto en el código ni en el historial de la PR | gitleaks, fase A |

---

## 8. Qué no se hace

- No se cambia de framework, de base de datos ni de proveedor de despliegue.
- No se reescribe lo que funciona: finanzas se mueve de carpeta, no se rehace.
- No se cargan datos de clientes desde el repositorio, ni de prueba ni reales.
