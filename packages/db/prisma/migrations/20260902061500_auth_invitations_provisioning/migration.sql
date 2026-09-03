-- F0-06 · Auth.js, organizaciones y RBAC.
--
-- 1. Campos de autenticación en "user" y tabla "verification_token" (magic link de Auth.js).
--    Ambas son globales: existen antes de que haya sesión ni tenant, igual que "user".
-- 2. Tabla "invitation", de negocio, con su política tenant_isolation.
-- 3. provision_tenant(): alta de tenant para el rol de aplicación sin relajar el WITH CHECK
--    de tenant_isolation (issue #68). Ver justificación junto a la función.
-- 4. user_memberships(): lista las pertenencias de un usuario a través de todos los tenants
--    para resolver el tenant activo tras el login, cuando aún no hay contexto.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "email_verified" TIMESTAMP(3),
ADD COLUMN     "password_hash" TEXT;

-- CreateTable
-- rls-exempt: verification_token — token de magic link previo a la sesión; sin tenant, como "user".
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "can_view_compensation" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_email_idx" ON "invitation"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (generado con `pnpm rls:policy invitation`)
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invitation";
CREATE POLICY tenant_isolation ON "invitation"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- provision_tenant (issue #68)
--
-- El WITH CHECK de tenant_isolation en "tenant" exige que app.current_tenant sea el id de la
-- fila que se inserta, y el rol de aplicación no puede fijarlo antes de conocerlo. Alternativas:
--   a) relajar el WITH CHECK de "tenant" → cualquier consulta de aplicación podría crear
--      tenants y la política dejaría de ser simétrica con el resto de tablas. Descartada.
--   b) función SECURITY DEFINER acotada al alta → una única operación privilegiada, con
--      contrato cerrado (nombre, moneda, propietario), que fija el contexto al id recién
--      generado y crea atómicamente tenant + membership OWNER + entrada de audit_log.
-- Se elige (b). La función es lo único que el rol de aplicación puede ejecutar fuera de
-- contexto; no toca ninguna otra tabla, no acepta el id como parámetro y restaura el
-- contexto anterior al terminar. Su propietario debe ser el rol de migraciones.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_tenant(
  p_name          text,
  p_base_currency char(3),
  p_owner_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := gen_random_uuid();
  v_name      text := btrim(p_name);
  v_previous  text := current_setting('app.current_tenant', true);
BEGIN
  IF v_name IS NULL OR v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'provision_tenant: nombre de tenant inválido' USING ERRCODE = 'check_violation';
  END IF;
  IF p_base_currency IS NULL OR p_base_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'provision_tenant: moneda base inválida' USING ERRCODE = 'check_violation';
  END IF;
  IF p_owner_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = p_owner_user_id) THEN
    RAISE EXCEPTION 'provision_tenant: el usuario propietario no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM set_config('app.current_tenant', v_tenant_id::text, true);

  INSERT INTO "tenant" ("id", "name", "base_currency", "updated_at")
  VALUES (v_tenant_id, v_name, p_base_currency, now());

  INSERT INTO "membership" ("id", "tenant_id", "user_id", "role", "can_view_compensation", "updated_at")
  VALUES (gen_random_uuid(), v_tenant_id, p_owner_user_id, 'OWNER', true, now());

  INSERT INTO "audit_log" ("id", "tenant_id", "actor_id", "action", "entity", "entity_id", "after")
  VALUES (
    gen_random_uuid(), v_tenant_id, p_owner_user_id, 'tenant.created', 'tenant', v_tenant_id::text,
    jsonb_build_object('baseCurrency', p_base_currency, 'plan', 'TRIAL', 'ownerUserId', p_owner_user_id)
  );

  PERFORM set_config('app.current_tenant', coalesce(v_previous, ''), true);
  RETURN v_tenant_id;
END;
$$;

-- El GRANT EXECUTE al rol de aplicación (y sólo a él) lo hace `pnpm db:roles` por nombre de
-- función (APP_EXECUTABLE_FUNCTIONS en src/roles.ts), porque la migración no conoce el rol.
REVOKE ALL ON FUNCTION provision_tenant(text, char(3), uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- user_memberships
--
-- Tras el login el usuario aún no tiene tenant activo, así que la aplicación no puede
-- consultar "membership" (RLS devuelve 0 filas sin contexto). Esta función devuelve
-- únicamente las pertenencias del usuario indicado (id de tenant, nombre, rol y permiso
-- salarial), sin exponer ningún otro dato del tenant ni de otros usuarios.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_memberships(p_user_id uuid)
RETURNS TABLE (
  tenant_id             uuid,
  tenant_name           text,
  role                  "role",
  can_view_compensation boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m."tenant_id", t."name", m."role", m."can_view_compensation"
  FROM "membership" m
  JOIN "tenant" t ON t."id" = m."tenant_id"
  WHERE m."user_id" = p_user_id
  ORDER BY t."name", t."id";
$$;

REVOKE ALL ON FUNCTION user_memberships(uuid) FROM PUBLIC;
