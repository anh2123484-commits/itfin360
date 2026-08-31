-- ---------------------------------------------------------------------------
-- Contexto de tenant robusto ante `app.current_tenant` vacía (F0-05)
--
-- Las políticas de la migración inicial comparan contra
-- `current_setting('app.current_tenant', true)::uuid`. Si la variable de
-- sesión está fijada a cadena vacía —lo que ocurre en cuanto alguien hace
-- `set local app.current_tenant = ''`, o al reutilizar una conexión de un
-- pool que la limpió así— la conversión a `uuid` lanza
-- `invalid input syntax for type uuid: ""` en lugar de devolver cero filas.
-- Un error de sintaxis es un fallo ruidoso pero también un fallo distinto del
-- que queremos: fuera de contexto de tenant la respuesta correcta es "ninguna
-- fila", no una excepción que la aplicación pueda confundir con un problema
-- de infraestructura y reintentar.
--
-- `NULLIF(..., '')::uuid` devuelve NULL con la variable sin fijar y con la
-- variable vacía. `columna = NULL` es NULL, que RLS trata como falso: cero
-- filas en `USING` y rechazo en `WITH CHECK`.
--
-- Migración aditiva (regla dura 10): no toca datos ni columnas. Reemplaza las
-- políticas por su versión corregida; `DROP POLICY IF EXISTS` + `CREATE
-- POLICY` en la misma transacción de la migración, así que en ningún instante
-- hay una tabla con RLS activada y sin política.
--
-- El `WITH CHECK` de `tenant` se mantiene tal cual, incluida su consecuencia:
-- el rol de aplicación no puede crear un tenant, porque tendría que fijar
-- `app.current_tenant` al id de una fila que aún no existe. Hoy sólo lo hace
-- el rol de migraciones (con `BYPASSRLS`). Resolver el alta es F0-06 y se
-- discute en la issue #68; relajar aquí el `WITH CHECK` abriría un agujero de
-- escritura entre tenants.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_isolation ON "tenant";
CREATE POLICY tenant_isolation ON "tenant"
  USING ("id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "tenant_param_version";
CREATE POLICY tenant_isolation ON "tenant_param_version"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "membership";
CREATE POLICY tenant_isolation ON "membership"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON "audit_log";
CREATE POLICY tenant_isolation ON "audit_log"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
