-- ---------------------------------------------------------------------------
-- Proyectos, baselines e hitos (F5-01)
--
-- Migración aditiva (regla dura 10): crea tipos, tablas, índices, claves ajenas
-- y comprobaciones, y añade a `time_entry` una columna **opcional**. No cambia
-- ni borra nada de lo que ya existe, así que el código anterior sigue
-- funcionando contra este esquema.
--
-- ## La baseline no se edita: se versiona
--
-- `project_baseline` es una tabla de historia, no de estado. Re-planificar un
-- proyecto no cambia la fila: escribe una fila nueva con `version + 1`, con su
-- motivo y quién lo aprobó, y apaga el `is_current` de la anterior.
--
-- Esto no es un lujo de trazabilidad. La desviación de un proyecto sólo
-- significa algo contra un presupuesto que no se ha movido: si la baseline se
-- pudiera sobrescribir, cualquier proyecto se podría dejar a cero de desviación
-- reescribiendo el número contra el que se mide, y el cuadro de mando diría que
-- todo va bien justo cuando ya no va bien. Conservar las versiones es lo que
-- permite responder a la única pregunta que importa en el comité: «¿esto se
-- desvió, o se cambió el objetivo?».
--
-- Un índice único parcial garantiza que hay **como mucho una** baseline vigente
-- por proyecto. La base lo impone; no depende de que la aplicación se acuerde.
--
-- ## Los pesos de los hitos, en puntos básicos
--
-- `weight_bp` va de 1 a 10000, donde 10000 es el proyecto entero. La suma de los
-- hitos de un proyecto tiene que dar exactamente 10000. Eso es una condición
-- entre filas, y una comprobación `CHECK` no puede verla: se valida en la
-- transacción que guarda el conjunto de hitos, que relee la suma y aborta si no
-- cuadra. Está documentado aquí porque quien lea sólo el esquema debe saber que
-- esa regla existe y dónde vive.
--
-- En puntos básicos y no en decimal por la misma razón que la jornada: un peso
-- que multiplica dinero no puede arrastrar error de coma flotante. Tres hitos
-- de un tercio son 3334 + 3333 + 3333, que suma 10000 exacto; con `0.3333`
-- repetido, no suma uno y el avance sale mal en el tercer decimal para siempre.
--
-- ## El avance no se deduce del gasto
--
-- `progress_bp` es avance declarado, y `status` es el estado del hito. Ninguno
-- de los dos se calcula a partir de horas consumidas ni de coste imputado:
-- medir avance por consumo es exactamente el error que hace que un proyecto
-- parezca ir bien hasta el día antes de la entrega. El motor (`evm.ts`) ya
-- trabaja así; la base guarda lo que hace falta para alimentarlo y nada más.
--
-- Las tres tablas llevan `tenant_id`, RLS forzada y la política `tenant_isolation`
-- generada por `pnpm db:rls:policy`.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "progress_method" AS ENUM ('WEIGHTED_MILESTONES', 'ZERO_FIFTY_HUNDRED');

-- CreateEnum
CREATE TYPE "milestone_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "project_status" NOT NULL DEFAULT 'PLANNED',
    "progress_method" "progress_method" NOT NULL DEFAULT 'WEIGHTED_MILESTONES',
    "service" TEXT,
    "cost_center" TEXT,
    "sponsor" TEXT,
    "manager_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_baseline" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "bac_cents" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weight_bp" INTEGER NOT NULL,
    "status" "milestone_status" NOT NULL DEFAULT 'NOT_STARTED',
    "progress_bp" INTEGER,
    "planned_date" DATE,
    "actual_date" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_tenant_id_code_key" ON "project"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "project_tenant_id_status_idx" ON "project"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "project_manager_id_idx" ON "project"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_baseline_project_id_version_key" ON "project_baseline"("project_id", "version");

-- CreateIndex
CREATE INDEX "project_baseline_tenant_id_idx" ON "project_baseline"("tenant_id");

-- CreateIndex
CREATE INDEX "milestone_project_id_position_idx" ON "milestone"("project_id", "position");

-- CreateIndex
CREATE INDEX "milestone_tenant_id_status_idx" ON "milestone"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Las horas se imputan a un proyecto.
--
-- Columna opcional y nula para todo lo ya escrito: una imputación de
-- explotación no pertenece a ningún proyecto y no tiene por qué inventarse uno.
-- Sin esta columna el coste real de un proyecto (F5-02) no tiene de dónde
-- salir, y el EVM se quedaría para siempre con el presupuesto y sin el gasto.
--
-- `ON DELETE SET NULL`: borrar un proyecto no puede borrar las horas que la
-- gente trabajó. El proyecto desaparece, el tiempo trabajado se queda.
-- ---------------------------------------------------------------------------

ALTER TABLE "time_entry" ADD COLUMN "project_id" UUID;

ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "time_entry_project_id_idx" ON "time_entry"("project_id");

-- ---------------------------------------------------------------------------
-- Como mucho una baseline vigente por proyecto. Lo impone la base: el día que
-- un camino de código se olvide de apagar la anterior, el `INSERT` falla en vez
-- de dejar el proyecto con dos presupuestos a la vez y dos desviaciones
-- distintas según quién consulte.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "project_baseline_current_key" ON "project_baseline"("project_id") WHERE "is_current";

-- ---------------------------------------------------------------------------
-- Datos imposibles, rechazados por la base.
-- ---------------------------------------------------------------------------

ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_version_check" CHECK ("version" >= 1);
ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_bac_cents_check" CHECK ("bac_cents" >= 0);
ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_dates_check" CHECK ("end_date" >= "start_date");

ALTER TABLE "milestone" ADD CONSTRAINT "milestone_weight_bp_check" CHECK ("weight_bp" > 0 AND "weight_bp" <= 10000);
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_progress_bp_check" CHECK ("progress_bp" IS NULL OR ("progress_bp" >= 0 AND "progress_bp" <= 10000));
-- Un hito terminado tiene fecha real; uno que no lo está, no la tiene todavía.
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_actual_date_check" CHECK ("status" = 'COMPLETED' OR "actual_date" IS NULL);

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Salida literal de `pnpm db:rls:policy <tabla>`.
-- ---------------------------------------------------------------------------

ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "project";
CREATE POLICY tenant_isolation ON "project"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "project_baseline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_baseline" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "project_baseline";
CREATE POLICY tenant_isolation ON "project_baseline"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milestone" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "milestone";
CREATE POLICY tenant_isolation ON "milestone"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
