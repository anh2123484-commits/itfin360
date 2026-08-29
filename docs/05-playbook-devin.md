# Playbook de operación con Devin

Cómo se le da trabajo a Devin sobre este repositorio, y cómo se controla lo que devuelve.

## 1. Preparación (una sola vez)

1. **Conectar el repo** en Devin (Settings → Integrations → GitHub) y darle permiso de escritura y de abrir PR.
2. **Cargar el conocimiento del repo** (Devin → Knowledge). Pegar como *knowledge* estos cuatro bloques, que son los que evitan el 80 % de los desvíos:
   - `AGENTS.md` completo.
   - Las reglas duras de la sección 1 de `AGENTS.md`, otra vez, como knowledge independiente titulado "Reglas que causan rechazo de PR".
   - El contrato del motor de cálculo (sección 8 de `docs/02-modelo-financiero.md`).
   - Los comandos de la sección 3 de `AGENTS.md`.
3. **Protección de `main`**: PR obligatoria, CI en verde obligatoria, al menos una aprobación humana, sin *force push*. Devin nunca escribe en `main` directamente.
4. **Secrets del entorno de Devin**: `DATABASE_URL`, `REDIS_URL`, `S3_*` de un entorno desechable. **Nunca** credenciales de producción ni de un cliente real.

## 2. Regla de oro

**Una issue = una sesión de Devin = una PR.** Las sesiones largas y multi-tarea son donde Devin se desvía. Si una tarea del backlog resulta ser más grande de lo previsto, se corta en dos issues antes de arrancarla, no a mitad.

## 3. Plantilla de prompt (pegar en Devin)

```
Repo: <owner>/<repo>. Rama base: main.

Antes de empezar lee, en este orden:
  AGENTS.md
  docs/01-prd-y-alcance.md
  docs/02-modelo-financiero.md
  docs/03-arquitectura-y-datos.md
  docs/04-backlog.md

Tarea: resuelve la issue #<N> — <título> (identificador de backlog <F?-??>).

Alcance: exactamente lo que dice la issue. Nada más. Si ves algo que arreglar
fuera de alcance, abre una issue nueva y no lo toques en esta PR.

Antes de abrir la PR ejecuta y deja en verde:
  pnpm lint && pnpm typecheck && pnpm test && pnpm build

Entrega una PR contra main que:
  - se llame "<tipo>(<ámbito>): <descripción>" (Conventional Commits)
  - incluya "Closes #<N>"
  - rellene la plantilla de PR, incluida la sección "Decisiones tomadas"
  - añada los tests que exigen los criterios de aceptación de la issue

Si una decisión estructural no está resuelta en docs/ (modelo de datos,
seguridad, o una fórmula financiera): NO la inventes. Abre la PR en draft,
implementa la opción más conservadora y explica la duda en un comentario.
```

## 4. Cómo se revisa lo que devuelve

Checklist de revisión, en este orden (el primero que falle corta la revisión):

1. ¿CI en verde, cobertura de `finance-core` por encima del gate?
2. ¿Se cumplen **todos** los criterios de aceptación de la issue? (léelos, no los des por hechos)
3. ¿Algún importe en `float`? ¿Algún campo de dinero sin sufijo `Cents`?
4. ¿Tabla nueva sin `tenantId` o sin política RLS?
5. ¿Consulta Prisma fuera de `withTenant`?
6. ¿Toca retribución sin cifrado, sin permiso o sin auditoría?
7. ¿La sección "Decisiones tomadas" esconde alguna invención? Es la parte que más hay que leer.
8. ¿El diff hace algo que la issue no pedía?

## 5. Orden de lanzamiento recomendado

**Semana 1 — dos hilos en paralelo**
- Hilo A (infraestructura): F0-01 → F0-02 → F0-03 → F0-04 → F0-05 (secuencial; F0-05 es el más delicado, revísalo tú a mano).
- Hilo B (dominio): F1-01 → F1-02 → F1-03 → F1-04 (sólo depende de F0-01; no toca base de datos, así que no colisiona).

**Semana 2** — A: F0-06 → F0-07 → F0-08 · B: F1-05 → F1-08 → F1-09 → F1-10

A partir de la Fase 2 conviene un solo hilo hasta F6-01, porque casi todo comparte migraciones y dos PR que tocan el esquema a la vez se pelean.

## 6. Qué NO delegar a Devin sin revisión línea a línea

- **F0-05 (RLS)** — un fallo aquí es una fuga de datos entre clientes.
- **F4-02 (retribución cifrada)** — datos personales de categoría delicada.
- **F1-10 y F6-06 (Viability Score)** — es el juicio del producto; un score mal calibrado destruye la confianza más rápido que un bug.
- **Cualquier migración con `DROP`.**

## 7. Si prefieres automatizarlo con la API de Devin

Devin expone una API (`https://api.devin.ai/v1`) con la que se pueden crear sesiones desde un script o desde una GitHub Action: `POST /sessions` con el prompt, y consulta de estado por `GET /sessions/{id}`. El patrón útil es una Action que, al etiquetar una issue con `devin`, cree la sesión con la plantilla de la sección 3 rellenada con el número y el título de la issue. Antes de montarla, confirma en la documentación oficial de Devin los nombres exactos de endpoint y campos, que cambian con las versiones.
