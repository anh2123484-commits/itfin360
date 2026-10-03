# 11 · Backlog de la plataforma modular

Paso 3. Una tarea es una sesión de trabajo y una PR. Cada tarea dice qué entrega, cómo se comprueba y de
qué depende. "Mig" marca las que traen migración y "Seg" las que tocan seguridad: esas se revisan línea
a línea antes de fusionar.

Estimación en sesiones: 1 es una PR de tamaño normal (hasta unas 600 líneas con tests).

Versión 1, octubre de 2026. El backlog de finanzas del doc `04` sigue vigente para lo que queda de ese
módulo (F4-02 cifrado de retribución, entre otras).

---

## Bloque S · Seguridad base

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| S-01 | CI listo para repositorio privado: gitleaks bloqueante, Semgrep informativo, CodeQL solo en público | | Sí | | 1 |
| S-02 | MFA TOTP: factor cifrado, alta con clave manual, verificación, códigos de recuperación, middleware | Sí | Sí | S-01 | 2 |
| S-03 | MFA obligatorio y reautenticación a los 15 minutos para acciones sensibles | | Sí | S-02 | 1 |
| S-04 | Semgrep bloqueante tras revisar su primera ejecución; acciones de GitHub fijadas por SHA | | Sí | S-01 | 1 |
| S-05 | Registro de auditoría solo de añadir (punto 7 de la auditoría) | Sí | Sí | | 1 |

Criterios de aceptación:

- S-01: una PR con un secreto de prueba falla; `.env.example` no da falso positivo; CodeQL aparece como
  omitido si el repositorio es privado.
- S-02: el secreto TOTP nunca se guarda en claro ni sale en logs; un código vale una sola vez dentro de
  su ventana; cinco fallos seguidos bloquean 15 minutos; cada código de recuperación vale una vez; la
  sesión sin segundo factor solo llega a `/login/mfa`; tests de RFC 6238 con los vectores del anexo B.
- S-03: sin factor dado de alta no se entra a ninguna pantalla de datos; cambiar rol, exportar o ver
  retribución pide el código si han pasado 15 minutos.

## Bloque D · Diagnóstico, hoja de ruta y seguimiento (módulo 0)

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| D-01 | `diagnosis-core`: madurez, agregación de votos, consenso, ROC, tramos, valor, viabilidad, cuadrante | | | | 1 |
| D-02 | `diagnosis-core`: PERT, flujos de caja y completo, payback, ROI a 36 meses, secuencia | | | D-01 | 1 |
| D-03 | Catálogo de NovaEra Nexus: nueve dimensiones, preguntas y descriptores, criterios 360 | | | D-01 | 1 |
| D-04 | Esquema: Assessment, madurez, hallazgos, líneas, iniciativas, estimaciones | Sí | | D-03, F-02 | 1 |
| D-05 | Pantallas: diagnóstico, cuestionario por dimensión con evidencia, objetivos | | | D-04 | 2 |
| D-06 | Hallazgos, DAFO y mapa de oportunidades | | | D-04 | 1 |
| D-07 | Fichas de iniciativa con estimación en tres puntos | | | D-04, D-02 | 1 |
| D-08 | Esquema y pantallas de votación: rondas, votos, quórum, voto secreto | Sí | Sí | D-07, F-03 | 2 |
| D-09 | Matriz de priorización interactiva y simulador | | | D-08 | 1 |
| D-10 | Informe interactivo `/diagnostico/[id]/informe` | | | D-09 | 2 |
| D-11 | Exportación del informe a PDF con marca | | | D-10, F-01 | 1 |
| D-12 | Aprobar iniciativa: pasa a proyecto y a partidas de presupuesto | Sí | | D-08, P-01 | 1 |
| D-13 | KPI, lecturas y beneficio realizado; alertas del doc `09` §7.1 | Sí | | D-12 | 2 |
| D-14 | Reevaluación trimestral y vista de evolución | | | D-05 | 1 |

Criterios de aceptación principales:

- D-01 y D-02: el ejemplo del doc `09` §5.4 da 3,56 de media geométrica y 0,61 de consenso; el de §6.2
  da 122 meses de payback de caja y 12,2 completo; todo con enteros a la salida; cobertura al 95 %.
- D-08: un voto no se edita, se sustituye y queda historial; nadie ve votos ajenos salvo el consultor;
  una ronda sin quórum no calcula matriz.
- D-10: solo usuarios del cliente con permiso; ningún enlace público; responsive de 360 px en adelante.

## Bloque F · Shell y marca

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| F-01 | Tokens de marca NovaEra Nexus, tipografía, logos, modo oscuro, componentes de informe | | | | 2 |
| F-02 | `TenantModule` y navegación por módulos activos, menú de móvil | Sí | | F-01 | 1 |
| F-03 | `OrgFunction`, rol `DIRECTION`, pesos de decisión, `ApprovalPolicy` | Sí | Sí | | 2 |
| F-04 | Alta de cliente `/clientes/nuevo` con logo, módulos y consentimiento de IA externa | Sí | Sí | F-02, F-03 | 1 |
| F-05 | Rutas de finanzas al grupo `(finanzas)` y prueba de humo de URL | | | F-02 | 1 |
| F-06 | Portada por rol: dirección, finanzas e IT | | | F-05 | 1 |

## Bloque P · Portafolio

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| P-01 | Estados A, B y C y Valoración 360 en proyectos | Sí | | D-01 | 1 |
| P-02 | Project Charter con política de aprobación | Sí | | P-01, F-03 | 2 |
| P-03 | OPEX a tres años por proyecto desde contratos | | | P-01 | 1 |

## Bloque R · Recopilación

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| R-01 | Bandeja de validación con huella sha256 | Sí | | | 1 |
| R-02 | Google Drive por cliente con cuenta de servicio | | Sí | R-01 | 2 |
| R-03 | Transcripciones de Plaud, Fathom y Teams como texto | | Sí | R-01 | 2 |
| R-04 | Lectura de Jira (proyectos y horas) | | Sí | R-01 | 1 |

## Bloque T · Talento y Bonus

Empiezan después de F4-02 (cifrado de retribución). Sin eso no entra ningún dato de personas.

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| T-01 | `people-core`: capacidad y competencias | | | | 1 |
| T-02 | Ficha de persona, evaluación inicial, itinerario, reevaluación | Sí | Sí | T-01 | 3 |
| T-03 | Bonus: modelo, simulador, cálculo sobre salario bruto cifrado | Sí | Sí | T-02, F4-02 | 3 |

## Bloque A · Capa de IA

| ID | Tarea | Mig | Seg | Depende de | Sesiones |
|---|---|---|---|---|---|
| A-01 | `DomainEvent` con outbox y reglas de automatización | Sí | | | 2 |
| A-02 | Agentes con propuestas y barandillas, tests de barandillas | Sí | Sí | A-01 | 3 |
| A-03 | Asistente conversacional que crea peticiones como propuestas | | Sí | A-02 | 2 |

---

## Orden

1. S-01, S-02, S-03. Nada nuevo se abre antes de tener MFA.
2. D-01, D-02, D-03 (paquete puro, sin migraciones, puede ir en paralelo con S-02).
3. F-01, F-02, F-03, F-04, F-05.
4. D-04 a D-11. Con esto ya se entrega el primer informe de diagnóstico.
5. P-01, D-12, D-13, D-14. Con esto empieza el seguimiento continuo.
6. R-01 a R-04, P-02, P-03, F-06.
7. F4-02, T-01 a T-03.
8. A-01 a A-03.

Total aproximado: 56 sesiones. Los pasos 1 a 4 son unas 25 y dejan la plataforma lista para el primer
diagnóstico de un cliente real, con las condiciones previas del doc `08` §16.3 cumplidas.
