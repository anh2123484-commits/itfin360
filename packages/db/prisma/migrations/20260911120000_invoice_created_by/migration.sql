-- ---------------------------------------------------------------------------
-- Quién registró la factura (F2-02)
--
-- Hace falta para la segregación de funciones: sin saber quién la dio de alta
-- no se puede impedir que esa misma persona la apruebe. El control viene
-- desactivado por defecto —en un departamento de dos personas bloquearía el
-- flujo el primer día— pero la columna tiene que existir para poder
-- encenderlo, y para responder a «quién metió esta factura» en una auditoría.
--
-- Nullable a propósito: las facturas que entren por conector o por importación
-- no tienen una persona detrás, y `ON DELETE SET NULL` conserva la factura
-- cuando se borra el usuario. Una factura no desaparece porque alguien deje la
-- empresa.
--
-- Migración aditiva (regla dura 10): añade columna, índice y clave ajena; no
-- toca ni una fila. `invoice` ya tiene RLS forzada y su política desde la
-- migración de F2-01, y añadir una columna no la altera.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "created_by_id" UUID;

-- CreateIndex
CREATE INDEX "invoice_tenant_id_created_by_id_idx" ON "invoice"("tenant_id", "created_by_id");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
