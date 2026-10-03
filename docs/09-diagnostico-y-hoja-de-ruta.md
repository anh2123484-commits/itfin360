# 09 · Diagnóstico, hoja de ruta y seguimiento

Módulo 0 de la plataforma de NovaEra Nexus. Es lo primero que vive un cliente nuevo y lo que se le
entrega como informe: dónde está en tecnología, ciberseguridad e IA, qué iniciativas le convienen, cuánto
cuestan en OPEX y CAPEX, cuándo se recuperan y cómo se va a medir que el impacto llega.

Versión 1, octubre de 2026. Complementa al documento `08` (módulos y modelo común). Donde los dos
hablan de puntuar proyectos, manda este.

---

## 1. Por qué este módulo va primero

NovaEra Nexus trabaja con el cliente de forma continua. El diagnóstico abre la relación y fija la línea
base contra la que se mide todo lo que viene después: madurez por dimensión, gasto IT de partida, riesgo
de partida y cartera de iniciativas valoradas en euros.

El recorrido de cada cliente queda así:

```
Alta del cliente → Diagnóstico → Informe y votación → Hoja de ruta aprobada
      → Portafolio (las iniciativas aprobadas pasan a proyecto) → Seguimiento mensual
      → Reevaluación trimestral de madurez → Revisión anual de la hoja de ruta
```

Las cinco fases de NovaEra Nexus (diagnóstico, diseño del sistema, implantación, cambio y adopción,
medición y consolidación) tienen cada una su pantalla: el diagnóstico y la hoja de ruta aquí, la
implantación en Portafolio, el cambio en Talento y la medición en Seguimiento.

---

## 2. Método

### 2.1 Fuentes

| Fuente | Cómo entra | Qué aporta |
|---|---|---|
| Entrevistas con cada dirección | Grabación (Plaud, Teams, Fathom) o notas, por el canal de recopilación del doc `08` §11 | Foto por área y puntos de dolor |
| Cuestionario de madurez | Formulario en la plataforma, una persona responsable por dimensión | Nivel 1 a 5 con evidencia |
| Datos del módulo de Finanzas | Ya están en la plataforma | Gasto IT de partida, OPEX, CAPEX, coste por usuario, ratio run/change |
| Inventario de sistemas, proveedores e IA | Importación o formulario | Base para ciber, compliance e IA |
| Documentos del cliente | Carpeta de Drive del cliente | Políticas, contratos, auditorías previas |

El agente de recopilación propone hallazgos a partir de transcripciones y documentos. Ninguno entra en el
informe sin que un consultor de NovaEra Nexus lo valide.

### 2.2 Estructura del diagnóstico

1. La foto: cómo trabaja cada área hoy (personas, procesos, herramientas, datos).
2. Los dolores: qué falla, con quién lo dijo y con qué evidencia.
3. DAFO de tecnología, ciberseguridad e IA.
4. Madurez: nueve dimensiones, nivel actual y nivel objetivo.
5. Líneas de trabajo y mapa de oportunidades: cada dolor apunta a una o varias iniciativas.
6. Valoración: votación de la dirección, cálculo económico y matriz de priorización.
7. Fichas de iniciativa.
8. Hoja de ruta en el tiempo y presupuesto por año.
9. Modelo de seguimiento: indicadores, cadencias y comité.

---

## 3. Modelo de madurez

### 3.1 Niveles

| Nivel | Nombre | Qué significa |
|---|---|---|
| 1 | Inicial | No hay práctica definida. Depende de quién esté ese día |
| 2 | Reactivo | Se hace cuando hay un problema. Algo documentado, poco medido |
| 3 | Definido | Proceso escrito, responsable asignado, se cumple casi siempre |
| 4 | Gestionado | Se mide con indicadores y se corrige con datos |
| 5 | Optimizado | Mejora continua, automatizado donde tiene sentido, se anticipa |

### 3.2 Dimensiones

| # | Dimensión | Qué se mira | Referencia |
|---|---|---|---|
| D1 | Estrategia y gobierno tecnológico | Plan director, presupuesto IT, comité, alineación con negocio | Doc `02` (viabilidad) |
| D2 | Procesos y operación | Digitalización de procesos, automatización, soporte | |
| D3 | Datos y analítica | Fuente única, calidad, cuadros de mando por rol | |
| D4 | Tecnología, infraestructura y cloud | Arquitectura, obsolescencia, continuidad, coste | Módulo Activos |
| D5 | Ciberseguridad | Seis funciones: Gobernar, Identificar, Proteger, Detectar, Responder, Recuperar | NIST CSF 2.0 |
| D6 | Cumplimiento normativo | RGPD y LOPDGDD, NIS2, ENS si trabaja para el sector público, DORA si es entidad financiera, ISO 27001 si está certificada o lo pide un cliente | |
| D7 | IA: adopción segura y Reglamento de IA | Inventario de sistemas de IA, clasificación de riesgo, alfabetización, uso seguro, gobierno | Reglamento (UE) 2024/1689, ISO/IEC 42001, OWASP Top 10 para LLM |
| D8 | Proveedores y ecosistema | Dependencia, contratos, riesgo de terceros, cadena de suministro | Módulo Proveedores |
| D9 | Personas, cultura y cambio | Competencias digitales, capacidad, adopción, gestión del cambio | Módulo Talento |

Cada dimensión tiene entre cuatro y seis preguntas. Cada pregunta tiene un descriptor por nivel y pide
evidencia (documento, captura, dato de la plataforma). Sin evidencia, la respuesta cuenta como máximo
nivel 2.

```
nivel_dimensión = media de sus preguntas, guardada en puntos básicos (1,0 → 10000; 5,0 → 50000)
brecha = nivel_objetivo − nivel_actual
```

El nivel objetivo lo fija la dirección a 12 o 24 meses. No todo tiene que llegar a 5: una empresa de 40
personas puede tener D3 en 3 y estar bien.

### 3.3 Ciberseguridad (D5)

Las seis funciones de NIST CSF 2.0 se puntúan por separado y D5 es su media. El informe muestra el
perfil actual y el perfil objetivo función por función, que es el formato con el que un CISO o un
auditor lo puede contrastar.

### 3.4 Cumplimiento (D6)

Primero aplicabilidad, después nivel. Una norma que no aplica no resta. Estado a octubre de 2026 que
el módulo debe reflejar y que el agente de vigilancia normativa mantiene al día:

- NIS2: España no la ha transpuesto. El anteproyecto de Ley de Coordinación y Gobernanza de la
  Ciberseguridad se aprobó en Consejo de Ministros el 14 de enero de 2025 y la Comisión llevó a España
  al Tribunal de Justicia el 8 de julio de 2026. Se evalúa como buena práctica y por obligación
  contractual cuando un cliente del cliente la exige.
- RGPD y LOPDGDD: aplica siempre que haya datos personales.
- ENS, DORA, ISO 27001: según aplicabilidad.

### 3.5 IA (D7)

Cuatro bloques:

1. Inventario: qué sistemas de IA usa la empresa, incluido el uso no autorizado (IA en la sombra).
2. Clasificación según el Reglamento de IA: prohibido, alto riesgo, riesgo limitado (transparencia),
   riesgo mínimo.
3. Obligaciones con fecha. La alfabetización en IA (artículo 4) se exige desde el 2 de febrero de 2025.
   Tras el Digital Omnibus, las obligaciones de alto riesgo del anexo III pasan al 2 de diciembre de
   2027 y las del anexo I al 2 de agosto de 2028.
4. Implantación segura: datos que salen de la empresa, control de accesos, revisión humana, registro de
   uso, riesgos de inyección de instrucciones y fuga de datos.

---

## 4. Líneas de trabajo y mapa de oportunidades

Una línea de trabajo agrupa iniciativas con un mismo fin. Las líneas las define el consultor para cada
cliente; la plataforma propone por defecto una por dimensión con brecha mayor que 1.

Cada iniciativa debe apuntar al menos a un dolor y a una dimensión. Una iniciativa que no resuelve
ningún dolor ni cierra ninguna brecha no entra en la votación.

---

## 5. Valoración 360

Es la misma escala para iniciativas del diagnóstico y para proyectos del Portafolio. Una iniciativa
aprobada pasa a proyecto con su nota y su historial. Sustituye a los cinco ejes del doc `08` §7.2, que
quedan incluidos aquí.

### 5.1 Criterios

Diez criterios en dos grupos. Los votados los puntúa la dirección. Los calculados salen de los datos con
tramos relativos al tamaño del cliente.

| Grupo | Criterio | Cómo se obtiene | Peso por defecto |
|---|---|---|---|
| Valor | V1 Alineación estratégica | Votado | 12 % |
| Valor | V2 Impacto en negocio (clientes, procesos, ventas) | Votado | 12 % |
| Valor | V3 Impacto en las personas (carga, capacidades, adopción) | Votado | 8 % |
| Valor | V4 Reducción de riesgo y cumplimiento (ciber, normativa, IA) | Votado | 12 % |
| Valor | V5 Retorno económico | Calculado (payback, §6) | 16 % |
| Viabilidad | E1 Inversión CAPEX | Calculado (% del presupuesto IT anual) | 10 % |
| Viabilidad | E2 OPEX recurrente nuevo | Calculado (% del OPEX IT anual) | 8 % |
| Viabilidad | E3 Recursos internos | Calculado (% de la capacidad anual del equipo) | 8 % |
| Viabilidad | E4 Tiempo hasta el primer valor | Calculado (meses) | 6 % |
| Viabilidad | E5 Madurez de la solución y riesgo de ejecución | Votado por IT, CTO, CIO y CISO | 8 % |

Valor suma 60 % y viabilidad 40 %. El retorno económico es el criterio que más pesa porque es lo que
más pregunta la dirección. Los pesos se pueden cambiar por cliente y deben sumar 10000 puntos básicos.

### 5.2 Tramos de los criterios calculados

5 es lo mejor en todos.

| Nota | V5 Payback | E1 CAPEX (% pres. IT) | E2 OPEX nuevo (% OPEX IT) | E3 Recursos (% capacidad) | E4 Tiempo |
|---|---|---|---|---|---|
| 5 | hasta 6 meses | menos del 2 % | menos del 1 % | menos del 2 % | menos de 3 meses |
| 4 | 7 a 12 meses | 2 a 5 % | 1 a 3 % | 2 a 5 % | 3 a 6 meses |
| 3 | 13 a 24 meses | 5 a 10 % | 3 a 6 % | 5 a 10 % | 6 a 12 meses |
| 2 | 25 a 36 meses | 10 a 20 % | 6 a 10 % | 10 a 20 % | 12 a 18 meses |
| 1 | más de 36 meses o no se recupera | más del 20 % | más del 10 % | más del 20 % | más de 18 meses |

### 5.3 Descriptores de los criterios votados

| Nota | V1 Estratégica | V2 Negocio | V3 Personas | V4 Riesgo y cumplimiento | E5 Madurez y ejecución |
|---|---|---|---|---|---|
| 5 | Objetivo explícito del plan director | Cambia un proceso que toca a clientes o ventas | Quita carga a muchos y mejora su trabajo | Cierra un riesgo alto o una obligación legal con fecha | Solución estándar, varios proveedores, equipo con experiencia |
| 4 | Apoya un objetivo explícito | Mejora clara de un proceso principal | Quita carga a un equipo entero | Reduce un riesgo alto | Solución estándar con un solo proveedor |
| 3 | Coherente con la estrategia | Mejora un proceso secundario | Efecto neutro con formación sencilla | Reduce un riesgo medio | Poca experiencia interna o versión reciente |
| 2 | Relación indirecta | Mejora local | Exige cambio de hábitos con resistencia | Reduce un riesgo bajo | Prototipo probado en otro sitio |
| 1 | Sin relación | Sin efecto medible | Añade carga | Sin efecto en riesgo | Por validar, sin casos reales |

### 5.4 Votación

Quién vota. Las personas de dirección invitadas, cada una con su función del organigrama (doc `08`
§12): dirección general, financiera, IT, CTO, CIO, CISO, comercial, producto, marketing y las que el
cliente tenga. Cada función tiene un peso de decisión configurado por el cliente (por defecto, iguales).

Qué vota cada función. V1 a V4 todas. E5 solo IT, CTO, CIO y CISO, porque es una pregunta técnica. El
cliente puede ajustar esta matriz. Se puede votar "no lo sé": cuenta como abstención y no como un 3.

Agregación, en tres pasos:

1. Dentro de una función con varias personas, media de sus votos. Así una función con tres personas no
   pesa el triple.
2. Entre funciones, media geométrica ponderada por el peso de decisión, renormalizado sobre las
   funciones que han votado ese criterio:

   ```
   nota_criterio = Π (nota_función ^ peso_función)        con Σ peso_función = 1
   ```

   Es el método de agregación de juicios individuales (AIJ) de Forman y Peniwati (1998). Frente a la
   media aritmética, una nota muy baja de una función pesa más. Si el CISO pone un 1 en riesgo, la
   nota del grupo baja de verdad, en vez de quedar diluida.
3. Quórum: si las funciones que han votado no suman el 60 % del peso de decisión, la iniciativa queda
   pendiente y no entra en la matriz.

Consenso. Para cada criterio se calcula la medida de consenso de Tastle y Wierman (2007) sobre la
distribución de votos ponderada:

```
Cns = 1 + Σ p_i · log2(1 − |X_i − μ| / d)

p_i  peso de los votos en el nivel i       μ  media ponderada
X_i  nivel (1 a 5)                          d  amplitud de la escala (5 − 1 = 4)
```

Vale 1 cuando todos votan lo mismo y 0 cuando la mitad vota 1 y la otra mitad 5.

| Consenso | Qué hace la plataforma |
|---|---|
| 0,70 o más | Nada |
| 0,50 a 0,69 | Marca la iniciativa para revisar en el comité |
| menos de 0,50 | No se puede aprobar sin debate registrado |

Ejemplo. V4 de una iniciativa: dirección general 4 (peso 30 %), financiera 2 (25 %), IT 5 (25 %), CISO 4
(20 %). La media aritmética sería 3,75. La geométrica ponderada es 3,56. El consenso es 0,61, así que la
iniciativa sale marcada para revisar: la financiera ve el riesgo de forma muy distinta a IT.

Voto secreto hacia el cliente. El comité ve las notas por función y el consenso, no quién votó qué
dentro de una función con más de una persona. El voto individual lo ven su autor y el consultor de
NovaEra Nexus. Así se reduce el efecto de votar lo mismo que el jefe.

Pesos de los criterios por ranking. Si el cliente prefiere ordenar los criterios en vez de repartir
porcentajes, la plataforma convierte el orden en pesos con el método de centroide (ROC) de Barron y
Barrett (1996):

```
peso_k = (1/n) · Σ_{i=k..n} 1/i
```

Con diez criterios, el primero pesa el 29,3 %, el segundo el 19,3 % y el décimo el 1 %.

### 5.5 Puntuación y matriz

```
valor       (0..100) = Σ_{V1..V5} peso × (nota − 1) / 4 × 100 / Σ pesos de valor
viabilidad  (0..100) = Σ_{E1..E5} peso × (nota − 1) / 4 × 100 / Σ pesos de viabilidad
total       (0..100) = Σ_{todos}  peso × (nota − 1) / 4 × 100
```

Matriz: viabilidad en el eje horizontal, valor en el vertical. Umbral por defecto 50 en los dos ejes,
configurable.

| Cuadrante | Valor | Viabilidad | Lectura |
|---|---|---|---|
| Hacer ya | 50 o más | 50 o más | Resultados rápidos |
| Planificar | 50 o más | menos de 50 | Apuestas que necesitan presupuesto y tiempo |
| Completar | menos de 50 | 50 o más | Se hacen si sobra capacidad |
| Replantear | menos de 50 | menos de 50 | Se descartan o se rediseñan |

Cada burbuja es una iniciativa. Su tamaño es el beneficio neto anual en euros, el color es la línea de
trabajo y el borde discontinuo indica consenso bajo.

### 5.6 Orden dentro de la hoja de ruta

La matriz dice qué se aprueba. El orden en el tiempo lo da el coste del retraso dividido por la duración,
con el mismo coste del retraso del doc `02`:

```
prioridad_secuencia = beneficio_neto_mensual / meses_de_implantación
```

Las dependencias mandan sobre este orden: una iniciativa no puede empezar antes que otra de la que
depende.

---

## 6. Impacto en euros

### 6.1 Qué se estima por iniciativa

Cada cifra se pide en tres puntos (mínimo, probable, máximo) y se usa la media PERT,
`(mín + 4·probable + máx) / 6`. El informe enseña el rango, no solo la media.

| Concepto | Unidad | Ejemplo |
|---|---|---|
| CAPEX | céntimos, una vez | Implantación, hardware, licencias perpetuas |
| Vida útil del CAPEX | meses | Para amortizar con la regla del módulo de Activos |
| OPEX nuevo | céntimos al mes | Suscripciones, cloud, soporte |
| Ahorro de OPEX existente | céntimos al mes | Licencias que se dan de baja, contratos que se cancelan |
| Horas liberadas | minutos al mes | Valoradas con la tarifa interna del doc `02` |
| Ingresos incrementales | céntimos al mes, en margen | |
| Riesgo evitado | céntimos al año | Reducción de la pérdida anual esperada |
| Meses de implantación | meses | El beneficio empieza al acabar |

Riesgo evitado:

```
pérdida_anual_esperada = impacto_de_un_incidente × probabilidad_anual
riesgo_evitado         = pérdida_antes − pérdida_después
```

### 6.2 Caja frente a capacidad

Las horas liberadas no son dinero en caja salvo que se reasignen. La financiera lo sabe y desconfía de un
payback que las mezcla. Por eso hay dos cálculos y el informe enseña los dos:

```
flujo_caja      = ahorro_OPEX + ingresos_incrementales − OPEX_nuevo
flujo_completo  = flujo_caja + horas_liberadas_valoradas + riesgo_evitado / 12

payback_caja     = meses_implantación + CAPEX / flujo_caja         (si flujo_caja > 0)
payback_completo = meses_implantación + CAPEX / flujo_completo     (si flujo_completo > 0)

ROI a 36 meses = (36 · beneficio_mensual − CAPEX − 36 · OPEX_nuevo) / (CAPEX + 36 · OPEX_nuevo)
```

Si el flujo es cero o negativo, la iniciativa "no se recupera" y V5 vale 1. Por defecto V5 usa el
payback completo; el cliente puede elegir el de caja.

Ejemplo: automatizar altas y bajas de usuarios. CAPEX 18.000 €, implantación 2 meses, OPEX nuevo 300
€/mes, licencias recuperadas de cuentas huérfanas 450 €/mes, 30 horas liberadas al mes a 42 €/h, riesgo
evitado 4.200 €/año.

- Flujo de caja: 450 − 300 = 150 €/mes. Payback de caja: 2 + 120 = 122 meses.
- Flujo completo: 150 + 1.260 + 350 = 1.760 €/mes. Payback completo: 2 + 10,2 = 12,2 meses (V5 = 3).

Las dos cifras juntas cuentan la verdad: se paga por capacidad y riesgo, no por ahorro en caja.

### 6.3 Presupuesto de la hoja de ruta

Por año y por línea de trabajo: CAPEX, OPEX nuevo, ahorro, beneficio y flujo acumulado. Al aprobar
una iniciativa, sus cifras pasan como partidas de presupuesto al módulo de Finanzas, y desde ese momento
el gasto real se compara con lo previsto.

---

## 7. Seguimiento continuo

### 7.1 Por iniciativa o proyecto

Cada iniciativa aprobada lleva entre uno y cinco indicadores con línea base, objetivo, frecuencia y
fuente. La fuente puede ser automática (un dato que ya está en la plataforma, como horas imputadas,
gasto de un proveedor o incidentes) o manual.

Beneficio realizado: cada mes se compara el beneficio previsto con el medido, en caja y completo.

| Situación | Qué hace la plataforma |
|---|---|
| Beneficio realizado por debajo del 80 % dos meses seguidos | Alerta al responsable y al consultor |
| Payback previsto se retrasa más de 3 meses | Alerta al comité |
| Indicador fuera de objetivo | Semáforo en el panel |
| Fecha normativa a menos de 90 días con brecha abierta | Alerta al CISO y al consultor |

### 7.2 Por cliente

- Mensual: panel de seguimiento (iniciativas, euros, indicadores) para el comité.
- Trimestral: reevaluación de madurez con el mismo cuestionario. El informe enseña la evolución de cada
  dimensión desde la línea base.
- Anual: revisión de la hoja de ruta, nueva votación de lo pendiente.

Esta parte es la que diferencia a NovaEra Nexus de una consultoría de un solo informe: el cliente ve
cada mes si lo que se decidió está dando lo que prometía.

---

## 8. El informe

### 8.1 Dentro de la plataforma

Ruta `/diagnostico/[id]/informe`. Es interactivo:

- Resumen ejecutivo en una pantalla: madurez actual y objetivo, cinco iniciativas principales, CAPEX y
  OPEX totales, beneficio anual, payback medio y riesgos que no pueden esperar.
- Radar de las nueve dimensiones, actual frente a objetivo, y rejilla de niveles con descriptores.
- Perfil NIST CSF 2.0 y tabla de obligaciones normativas con fechas.
- Inventario y clasificación de IA.
- Matriz de priorización con filtros por línea, cuadrante y consenso.
- Fichas de iniciativa: objetivo, descripción, plan de actividades, solución, CAPEX, OPEX, beneficio,
  payback de caja y completo, plazo, riesgos, indicadores, responsable y dependencias.
- Hoja de ruta por trimestres y cascada de euros por año.
- Simulador: quitar o añadir iniciativas y ver cómo cambian totales, payback y carga del equipo.
- Evolución: la misma vista en cualquier trimestre anterior.

Solo lo ven usuarios autenticados del cliente con permiso. No hay enlaces públicos.

### 8.2 Exportación

PDF y presentación con la marca de NovaEra Nexus y el logo del cliente (doc `08` §4.4). La exportación
es una foto fechada y lleva el número de versión del diagnóstico.

---

## 9. Modelo de datos

Todas las tablas llevan `tenantId` y política RLS. Importes en céntimos, porcentajes en puntos básicos,
tiempo en minutos o meses enteros.

```
Assessment            id, tenantId, version, status (DRAFT | REVIEW | PUBLISHED | ARCHIVED),
                      periodStart, periodEnd, scope (Json), publishedAt, publishedById
MaturityDimension     id, tenantId, code (D1..D9), name, order, frameworkRef        ← copia del catálogo
MaturityQuestion      id, tenantId, dimensionId, code, text, levelDescriptors (Json), order
MaturityAnswer        id, tenantId, assessmentId, questionId, level (1..5), evidenceRef, answeredById
MaturityTarget        id, tenantId, assessmentId, dimensionId, targetLevelBp, horizonMonths
Finding               id, tenantId, assessmentId, departmentId?, dimensionId?,
                      kind (STRENGTH | WEAKNESS | OPPORTUNITY | THREAT | PAIN),
                      text, sourceRef?, validatedById?, validatedAt?
WorkLine              id, tenantId, assessmentId, name, order
Initiative            id, tenantId, assessmentId, workLineId, code, title, objective, description,
                      activities (Json), solution, ownerPersonId?, status
                      (IDEA | READY | VOTING | APPROVED | IN_PROJECT | DISCARDED), projectId?
InitiativeLink        initiativeId, findingId? | dimensionId?                        ← dolor o brecha
InitiativeDependency  initiativeId, dependsOnId
InitiativeEstimate    id, tenantId, initiativeId, concept, minCents, likelyCents, maxCents,
                      minMinutes?, ..., months?                                     ← tres puntos
VotingRound           id, tenantId, assessmentId, status, opensAt, closesAt, quorumBp,
                      criteriaWeights (Json), functionWeights (Json), criterionMatrix (Json)
Vote                  id, tenantId, roundId, initiativeId, criterion, voterUserId, orgFunction,
                      level (1..5 | null = abstención), castAt
InitiativeScore       id, tenantId, roundId, initiativeId, perCriterion (Json), consensusBp (Json),
                      valueBp, feasibilityBp, totalBp, quadrant, paybackCashMonths?,
                      paybackFullMonths?, roi36Bp, computedAt
Kpi                   id, tenantId, initiativeId? | projectId?, name, unit, baseline, target,
                      direction (UP | DOWN), frequency, source (Json)
KpiReading            id, tenantId, kpiId, period, value, recordedById?
BenefitActual         id, tenantId, initiativeId? | projectId?, period, cashCents, fullCents
```

Los votos no se borran ni se editan: un voto nuevo del mismo autor sobre el mismo criterio sustituye al
anterior a efectos de cálculo y el anterior queda en historial. `InitiativeScore` es una foto: guarda
los pesos con los que se calculó.

El cálculo vive en un paquete puro, `packages/diagnosis-core`, con cobertura exigida al 95 %, igual que
`finance-core`: madurez, agregación de votos, consenso, ROC, notas por tramos, valor, viabilidad,
cuadrante, PERT, payback y ROI.

---

## 10. Permisos

| Acción | Consultor NovaEra Nexus (`OWNER`) | Dirección (`DIRECTION`) | Responsable de dimensión | Resto |
|---|---|---|---|---|
| Crear y publicar diagnóstico | Sí | No | No | No |
| Responder cuestionario | Sí | Sí | Su dimensión | No |
| Validar hallazgos | Sí | No | No | No |
| Crear y editar iniciativas | Sí | Proponer | Proponer | No |
| Votar | No | Sí | Si tiene función de dirección | No |
| Ver votos individuales | Sí | Los suyos | Los suyos | No |
| Aprobar hoja de ruta | Según política de aprobación del cliente (doc `08` §12.4) | | | |
| Ver informe | Sí | Sí | Sí | Si el cliente lo comparte |

El consultor no vota: propone y facilita. La decisión es del cliente.

---

## 11. Capa de IA en este módulo

| Agente | Qué propone | Disparador |
|---|---|---|
| Recopilación | Hallazgos y dolores a partir de transcripciones y documentos | Nueva transcripción o documento |
| Mapeo | Qué dimensión y qué iniciativa corresponde a cada dolor | Hallazgo validado |
| Fichas | Borrador de ficha con plan, solución y estimación en tres puntos | Iniciativa creada |
| Vigilancia normativa | Cambios de fechas y obligaciones (NIS2, Reglamento de IA) | Semanal |
| Seguimiento | Alertas de §7.1 y resumen mensual para el comité | Mensual y por evento |

Barandillas (doc `08` §13.5): los agentes nunca votan, nunca publican, nunca aprueban. Toda estimación
de un agente se marca como tal y no entra en la matriz hasta que una persona la confirma. Los agentes no
ven votos individuales ni datos salariales.

---

## 12. Fuentes

- Forman, E. y Peniwati, K. (1998). Aggregating individual judgments and priorities with the analytic
  hierarchy process. European Journal of Operational Research, 108(1), 165-169.
- Tastle, W. J. y Wierman, M. J. (2007). Consensus and dissention: A measure of ordinal dispersion.
  International Journal of Approximate Reasoning, 45(3), 531-545.
- Barron, F. H. y Barrett, B. E. (1996). Decision quality using ranked attribute weights. Management
  Science, 42(11), 1515-1523.
- NIST (2024). The NIST Cybersecurity Framework (CSF) 2.0. NIST CSWP 29.
- Reglamento (UE) 2024/1689 de Inteligencia Artificial y su modificación por el Digital Omnibus.
- Estado de la transposición de NIS2 en España: nis-solutions.eu/countries/spain, consultado en
  octubre de 2026.
