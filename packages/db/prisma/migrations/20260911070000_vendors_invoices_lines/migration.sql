-- ---------------------------------------------------------------------------
-- Proveedores, facturas y líneas de factura (F2-01)
--
-- Migración aditiva (regla dura 10): sólo crea tipos, tablas, índices y claves
-- ajenas; no toca ni una fila ni una columna de lo que ya existe.
--
-- Dos decisiones que viven aquí y no en la aplicación:
--
-- 1. `invoice_tenant_id_vendor_id_invoice_number_key`. Un proveedor no emite
--    dos veces el mismo número, así que el duplicado exacto lo rechaza la base
--    de datos y no depende de que nadie se acuerde de comprobarlo. El
--    duplicado difuso (mismo importe, fechas cercanas) no se bloquea: lo marca
--    `finance-core` y lo confirma una persona, y al confirmarlo la factura
--    queda en estado DUPLICATE enlazada a la original por `duplicate_of_id`.
--
-- 2. `invoice_line.concept` es el tipo `spend_concept`, no texto libre. Con
--    texto libre "SaaS", "Saas" y "Software" acaban siendo tres líneas
--    presupuestarias distintas y el % de gasto gobernado del Viability Score
--    deja de poder calcularse. El enum replica `SPEND_CONCEPTS` de
--    `@itfin360/finance-core` y hay un test que fija la correspondencia.
--
-- Las tres tablas llevan `tenant_id`, RLS forzada y la política `tenant_isolation`
-- generada por `pnpm db:rls:policy`, idéntica a la de las tablas de tenancy.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "invoice_source" AS ENUM ('MANUAL', 'CSV_IMPORT', 'OCR', 'ERP_SYNC', 'CLOUD_CONNECTOR', 'API');

-- CreateEnum
CREATE TYPE "cost_type" AS ENUM ('OPEX_RECURRING', 'OPEX_ONE_OFF', 'CAPEX', 'PERSONNEL_EXTERNAL', 'PROJECT_COST', 'PENALTY');

-- CreateEnum
CREATE TYPE "spend_concept" AS ENUM ('SAAS_SUBSCRIPTION', 'SOFTWARE_LICENSE', 'CLOUD_INFRASTRUCTURE', 'HOSTING', 'TELECOM', 'MAINTENANCE', 'THIRD_PARTY_SUPPORT', 'INSURANCE', 'CONSULTING', 'TRAINING', 'SECURITY_SERVICES', 'SECURITY_AUDIT', 'CONSUMABLES', 'HARDWARE_SERVER', 'HARDWARE_STORAGE', 'HARDWARE_NETWORK', 'HARDWARE_ENDUSER', 'HARDWARE_MOBILE', 'PERPETUAL_LICENSE', 'CAPITALISED_DEV', 'CONTRACTOR', 'PROJECT_SERVICES', 'SLA_PENALTY', 'OTHER');

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "country" CHAR(2),
    "criticality" "criticality" NOT NULL DEFAULT 'MEDIUM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "accrual_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "service_start" TIMESTAMP(3),
    "service_end" TIMESTAMP(3),
    "net_cents" INTEGER NOT NULL,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "gross_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(18,8),
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "source" "invoice_source" NOT NULL DEFAULT 'MANUAL',
    "file_key" TEXT,
    "extraction" JSONB,
    "extraction_confidence" DOUBLE PRECISION,
    "duplicate_of_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "cost_type" "cost_type" NOT NULL,
    "concept" "spend_concept" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_tenant_id_idx" ON "vendor"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_tenant_id_name_key" ON "vendor"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_tenant_id_tax_id_key" ON "vendor"("tenant_id", "tax_id");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_accrual_date_idx" ON "invoice"("tenant_id", "accrual_date");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_status_idx" ON "invoice"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenant_id_vendor_id_invoice_number_key" ON "invoice"("tenant_id", "vendor_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_line_tenant_id_concept_idx" ON "invoice_line"("tenant_id", "concept");

-- CreateIndex
CREATE INDEX "invoice_line_invoice_id_idx" ON "invoice_line"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_invoice_id_line_number_key" ON "invoice_line"("invoice_id", "line_number");

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Salida literal de `pnpm db:rls:policy <tabla>`.
-- ---------------------------------------------------------------------------

ALTER TABLE "vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vendor";
CREATE POLICY tenant_isolation ON "vendor"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoice";
CREATE POLICY tenant_isolation ON "invoice"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoice_line";
CREATE POLICY tenant_isolation ON "invoice_line"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
