-- ---------------------------------------------------------------------------
-- Imputación de horas (F4-04)
--
-- Migración aditiva (regla dura 10).
--
-- Una imputación es media hora de la vida de alguien convertida en un número.
-- De aquí salen la utilización, el ratio run/change, el coste de lo que no se
-- imputa y, más adelante, el coste real de cada proyecto. Si esta tabla miente,
-- mienten todos los cuadros de mando que vengan después, y nadie sabrá por qué.
--
-- ## Minutos, no horas decimales
--
-- `minutes` es un entero. Media hora es 30, no 0,5. Con horas decimales, tres
-- cuartos de hora son 0,75 pero veinte minutos son 0,333…, y al sumar un mes de
-- partes de trabajo el total se desvía lo bastante como para que alguien tenga
-- que explicar por qué el informe dice 161,99 horas.
--
-- ## `start_minute` es opcional, y por eso el solape también
--
-- Minutos desde medianoche. Hay departamentos que apuntan «tres horas al
-- proyecto X» sin decir cuáles, y obligar a poner la hora de inicio haría que
-- nadie rellenara el parte. Cuando dos imputaciones del mismo día sí la llevan,
-- el solape se comprueba; cuando no, no se puede y no se finge que sí.
--
-- ## Por qué `is_overtime` y no un tope duro
--
-- El criterio de aceptación pide que no se puedan imputar más horas de las
-- disponibles en un día sin marcarlo como extra. La palabra que importa es
-- «sin». Las horas extra existen, y un sistema que las rechaza consigue que se
-- apunten repartidas en otros días, que es la única forma de perderlas de vista.
-- Se dejan pasar, marcadas, para que se puedan contar.
--
-- ## `external_key` y la importación idempotente
--
-- El otro criterio de aceptación. Cuando la imputación venga de un CSV o de
-- Jira, cada línea trae su identificador de origen; el índice único sobre
-- (tenant, external_key) hace que reimportar el mismo fichero no duplique nada,
-- sin que el código tenga que acordarse de comprobarlo.
--
-- La tabla lleva `tenant_id`, RLS forzada y la política `tenant_isolation`.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "time_activity" AS ENUM ('RUN', 'CHANGE', 'INTERNAL', 'ABSENCE');

-- CreateEnum
CREATE TYPE "time_source" AS ENUM ('MANUAL', 'CSV_IMPORT', 'CONNECTOR');

-- CreateTable
CREATE TABLE "time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "start_minute" INTEGER,
    "activity" "time_activity" NOT NULL,
    "service" TEXT,
    "description" TEXT,
    "is_rework" BOOLEAN NOT NULL DEFAULT false,
    "is_overtime" BOOLEAN NOT NULL DEFAULT false,
    "is_billable" BOOLEAN NOT NULL DEFAULT false,
    "source" "time_source" NOT NULL DEFAULT 'MANUAL',
    "external_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_entry_date_idx" ON "time_entry"("tenant_id", "entry_date");

-- CreateIndex
CREATE INDEX "time_entry_employee_id_entry_date_idx" ON "time_entry"("employee_id", "entry_date");

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_activity_idx" ON "time_entry"("tenant_id", "activity");

-- CreateIndex
CREATE UNIQUE INDEX "time_entry_tenant_id_external_key_key" ON "time_entry"("tenant_id", "external_key");

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Datos imposibles, rechazados por la base.
-- ---------------------------------------------------------------------------

ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_minutes_check" CHECK ("minutes" > 0 AND "minutes" <= 1440);
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_start_minute_check" CHECK ("start_minute" IS NULL OR ("start_minute" >= 0 AND "start_minute" < 1440));
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_fits_in_day_check" CHECK ("start_minute" IS NULL OR "start_minute" + "minutes" <= 1440);

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Salida literal de `pnpm db:rls:policy time_entry`.
-- ---------------------------------------------------------------------------

ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_entry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "time_entry";
CREATE POLICY tenant_isolation ON "time_entry"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
