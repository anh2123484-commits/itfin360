-- ---------------------------------------------------------------------------
-- Contratos recurrentes e inmovilizado (F3-01)
--
-- Migración aditiva (regla dura 10): sólo crea tipos, tablas, índices, claves
-- ajenas y restricciones de comprobación. No toca ni una fila de lo que existe.
--
-- Hasta aquí, el esquema de negocio tenía tres tablas: proveedor, factura y
-- línea. El motor de cálculo lleva escrito desde el principio cómo amortizar un
-- activo, cómo normalizar un contrato a coste mensual, cómo medir el desperdicio
-- de licencias y cuánto cuesta reponer el parque vencido, pero no tenía dónde
-- leer nada de eso. Estas dos tablas son lo que le da de comer.
--
-- ## Por qué los campos son exactamente estos
--
-- No están elegidos por parecer completos, sino copiados de lo que pide
-- `@itfin360/finance-core`:
--
-- - `contract.amount_cents` + `periodicity` son `RecurringContract`, que es lo
--   que `normalizeRecurring` necesita para dar coste mensual y anualizado.
-- - `licensed_seats` y `active_seats` son `SeatContract`, de donde sale el
--   desperdicio de licencias.
-- - `previous_amount_cents` y `previous_periodicity` son el otro extremo de
--   `priceChange`. Van en la propia fila y no en una tabla de histórico porque
--   lo que hace falta para avisar de una subida es el periodo anterior, uno
--   solo. El histórico completo es otra tarea y no bloquea esta.
-- - `asset.acquisition_cents`, `residual_cents`, `useful_life_months` e
--   `in_service_date` son `DepreciationInput` literal.
-- - `catalog_price_cents` y `has_budget_line` son `AssetForDebt`, para la deuda
--   técnica y el riesgo de renovación sin presupuestar.
--
-- ## Lo que decide la base y no la aplicación
--
-- Las comprobaciones de importes y de vida útil son `CHECK`. Un activo con vida
-- útil cero hace que la amortización divida por cero, y un residual mayor que el
-- valor de compra da cuotas negativas: eso no es un caso de negocio, es un dato
-- imposible, y lo imposible se rechaza donde no se puede olvidar comprobarlo.
--
-- `asset.invoice_id` enlaza el activo con la factura que lo trajo, que es lo que
-- permite bajar de un número del cuadro de mando hasta el documento de origen.
-- Es opcional porque hay parque anterior a la aplicación que se carga a mano.
--
-- Las dos tablas llevan `tenant_id`, RLS forzada y la política `tenant_isolation`
-- generada por `pnpm db:rls:policy`, idéntica a la del resto.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "periodicity" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'BIENNIAL');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('ACTIVE', 'NOTICE_GIVEN', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "asset_category" AS ENUM ('SERVER', 'STORAGE', 'NETWORK', 'WORKSTATION', 'LAPTOP', 'MOBILE', 'PERIPHERAL', 'SOFTWARE_LICENSE_PERPETUAL', 'INTANGIBLE_DEV');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('IN_USE', 'IN_STOCK', 'IN_REPAIR', 'RETIRED', 'DISPOSED');

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "concept" "spend_concept" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "periodicity" "periodicity" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "renewal_date" TIMESTAMP(3),
    "notice_days" INTEGER,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "licensed_seats" INTEGER,
    "active_seats" INTEGER,
    "seats_measured_at" TIMESTAMP(3),
    "previous_amount_cents" INTEGER,
    "previous_periodicity" "periodicity",
    "status" "contract_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID,
    "invoice_id" UUID,
    "name" TEXT NOT NULL,
    "category" "asset_category" NOT NULL,
    "serial_number" TEXT,
    "acquisition_cents" INTEGER NOT NULL,
    "residual_cents" INTEGER NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "in_service_date" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "asset_status" NOT NULL DEFAULT 'IN_USE',
    "catalog_price_cents" INTEGER,
    "has_budget_line" BOOLEAN NOT NULL DEFAULT false,
    "assigned_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_tenant_id_status_idx" ON "contract"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "contract_tenant_id_renewal_date_idx" ON "contract"("tenant_id", "renewal_date");

-- CreateIndex
CREATE INDEX "contract_vendor_id_idx" ON "contract"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_tenant_id_vendor_id_name_key" ON "contract"("tenant_id", "vendor_id", "name");

-- CreateIndex
CREATE INDEX "asset_tenant_id_category_idx" ON "asset"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "asset_tenant_id_status_idx" ON "asset"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "asset_invoice_id_idx" ON "asset"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_tenant_id_serial_number_key" ON "asset"("tenant_id", "serial_number");

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Datos imposibles, rechazados por la base.
-- ---------------------------------------------------------------------------

ALTER TABLE "contract" ADD CONSTRAINT "contract_amount_cents_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "contract" ADD CONSTRAINT "contract_previous_amount_cents_check" CHECK ("previous_amount_cents" IS NULL OR "previous_amount_cents" >= 0);
ALTER TABLE "contract" ADD CONSTRAINT "contract_seats_check" CHECK (("licensed_seats" IS NULL OR "licensed_seats" >= 0) AND ("active_seats" IS NULL OR "active_seats" >= 0));
ALTER TABLE "contract" ADD CONSTRAINT "contract_notice_days_check" CHECK ("notice_days" IS NULL OR "notice_days" >= 0);
ALTER TABLE "contract" ADD CONSTRAINT "contract_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "asset" ADD CONSTRAINT "asset_acquisition_cents_check" CHECK ("acquisition_cents" >= 0);
ALTER TABLE "asset" ADD CONSTRAINT "asset_residual_cents_check" CHECK ("residual_cents" >= 0 AND "residual_cents" <= "acquisition_cents");
ALTER TABLE "asset" ADD CONSTRAINT "asset_useful_life_months_check" CHECK ("useful_life_months" >= 1);
ALTER TABLE "asset" ADD CONSTRAINT "asset_catalog_price_cents_check" CHECK ("catalog_price_cents" IS NULL OR "catalog_price_cents" >= 0);

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Salida literal de `pnpm db:rls:policy <tabla>`.
-- ---------------------------------------------------------------------------

ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contract";
CREATE POLICY tenant_isolation ON "contract"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset";
CREATE POLICY tenant_isolation ON "asset"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
