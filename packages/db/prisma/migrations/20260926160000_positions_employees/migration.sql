-- ---------------------------------------------------------------------------
-- Puestos y empleados (F4-01)
--
-- Migración aditiva (regla dura 10): sólo crea tablas, índices, claves ajenas y
-- comprobaciones. No toca nada de lo que ya existe.
--
-- ## Lo que hay aquí y lo que no
--
-- Aquí está quién trabaja, en qué puesto, con qué jornada y entre qué fechas.
-- **No** está lo que cobra. La retribución va en su propia tabla, cifrada y
-- auditada por lectura (F4-02), y separarlas no es una comodidad de diseño: es
-- lo que permite que el resto del producto lea la plantilla sin que nadie tenga
-- que pasar por el permiso salarial. Si el sueldo viviera en esta tabla, toda
-- consulta de utilización o de reparto de costes tendría que tratarse como una
-- consulta de datos retributivos.
--
-- ## La jornada en puntos básicos, no en decimal
--
-- `fte_bp` va de 1 a 10000, donde 10000 es jornada completa. Una jornada del
-- 37,5 % es 3750. La alternativa era un `DECIMAL` o, peor, un `float`, y la
-- regla dura del proyecto sobre importes vale igual aquí: un número que se
-- multiplica por dinero no puede arrastrar error de coma flotante. Con enteros,
-- 3750/10000 es exacto y la conversión a la proporción que espera
-- `employerCost` se hace en un solo sitio.
--
-- ## Las fechas de alta y baja mandan sobre el año
--
-- `termination_date` es lo que hace que un empleado que se va en junio no
-- cuente como un año entero en los cálculos anuales. La comprobación de que la
-- baja no es anterior al alta está en la base: una baja antes del alta daría
-- una proporción negativa, y un coste de personal negativo no se detecta
-- mirando un cuadro de mando, se detecta cuando ya no cuadra nada.
--
-- Las dos tablas llevan `tenant_id`, RLS forzada y la política `tenant_isolation`
-- generada por `pnpm db:rls:policy`.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('PERMANENT', 'TEMPORARY', 'INTERN', 'CONTRACTOR');

-- CreateTable
CREATE TABLE "position" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT,
    "level" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "position_id" UUID,
    "full_name" TEXT NOT NULL,
    "employee_code" TEXT,
    "email" TEXT,
    "employment_type" "employment_type" NOT NULL DEFAULT 'PERMANENT',
    "fte_bp" INTEGER NOT NULL DEFAULT 10000,
    "hire_date" TIMESTAMP(3) NOT NULL,
    "termination_date" TIMESTAMP(3),
    "team" TEXT,
    "cost_center" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "position_tenant_id_name_key" ON "position"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "position_tenant_id_idx" ON "position"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_employee_code_key" ON "employee"("tenant_id", "employee_code");

-- CreateIndex
CREATE INDEX "employee_tenant_id_hire_date_idx" ON "employee"("tenant_id", "hire_date");

-- CreateIndex
CREATE INDEX "employee_tenant_id_team_idx" ON "employee"("tenant_id", "team");

-- CreateIndex
CREATE INDEX "employee_position_id_idx" ON "employee"("position_id");

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Datos imposibles, rechazados por la base.
-- ---------------------------------------------------------------------------

ALTER TABLE "employee" ADD CONSTRAINT "employee_fte_bp_check" CHECK ("fte_bp" > 0 AND "fte_bp" <= 10000);
ALTER TABLE "employee" ADD CONSTRAINT "employee_dates_check" CHECK ("termination_date" IS NULL OR "termination_date" >= "hire_date");

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Salida literal de `pnpm db:rls:policy <tabla>`.
-- ---------------------------------------------------------------------------

ALTER TABLE "position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "position" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "position";
CREATE POLICY tenant_isolation ON "position"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "employee";
CREATE POLICY tenant_isolation ON "employee"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
