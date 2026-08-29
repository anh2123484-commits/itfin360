# ITFin360 — PRD y alcance

**Producto:** plataforma SaaS multi-tenant de gestión financiera 360º de un departamento IT.
**Pregunta que responde:** *¿este departamento IT es financieramente viable, y dónde se está perdiendo el dinero?*

---

## 1. Problema

Un departamento IT gasta por cuatro vías que nadie consolida en el mismo sitio:

1. **OPEX recurrente** — SaaS, licencias, cloud, mantenimientos, telco, soporte de terceros.
2. **CAPEX / inmovilizado** — servidores, portátiles, dispositivos, red; con amortización que casi nunca se imputa al servicio que la consume.
3. **Personal** — el mayor coste del departamento y el peor medido: no se sabe qué parte va a *run* (mantener) y qué parte a *change* (proyectos).
4. **Sobrecoste de proyecto** — desviaciones y, sobre todo, el coste de los retrasos: equipo retenido, sistema legacy que sigue vivo, penalizaciones, beneficio no realizado.

Consecuencia: el CFO ve una línea de gasto opaca, el IT Manager no puede defender su presupuesto y nadie sabe el coste real por usuario, por servicio o por unidad de negocio.

## 2. Propuesta de valor

Una única base de coste (facturas + activos + nóminas + imputaciones) sobre la que se calculan:

- **TCO por servicio IT** y coste por usuario / dispositivo / ticket.
- **Rendimiento por puesto**: coste empresa, tarifa horaria interna, utilización, ratio run/change y ratio de recuperación.
- **Salud de proyectos** con EVM (CPI/SPI/EAC) y **coste del retraso** cuantificado en euros/día.
- **IT Viability Score** (0–100) con las bandas y el desglose que lo justifica.
- **Chargeback/showback** por unidad de negocio.

## 3. Usuarios y permisos

| Rol | Qué ve | Qué NO ve |
|---|---|---|
| `OWNER` | Todo, incluida configuración de tenant y facturación del SaaS | — |
| `FINANCE` (CFO/controller) | Todo el dato económico, incluidos salarios individuales | Configuración técnica |
| `IT_MANAGER` | Todo el coste; salarios **por banda**, no importe individual | Importes salariales individuales (salvo permiso explícito) |
| `PROJECT_MANAGER` | Sus proyectos, presupuesto, desviación, coste de retraso | Salarios; coste de otros proyectos |
| `CONTRIBUTOR` | Imputación de horas propias, alta de facturas | Cualquier agregado económico |
| `VIEWER` | Dashboards agregados en modo showback | Detalle de factura y salarios |

La visibilidad salarial es un permiso **separado del rol** (`canViewCompensation`), auditado en cada acceso.

## 4. Módulos (alcance funcional)

### M1 · Ingesta de costes
- Alta manual de facturas y líneas de factura.
- Importación CSV/Excel con mapeo de columnas guardable por plantilla.
- **OCR/IA sobre PDF**: extracción de proveedor, CIF, nº factura, fechas, base, IVA, total, divisa y líneas; siempre pasa por una **cola de validación humana** antes de contabilizar.
- Conectores ERP/contabilidad (Holded, Sage, A3, Odoo) — patrón de adaptador, uno implementado de referencia.
- Conectores cloud/SaaS de coste real (Azure Cost Management, AWS Cost Explorer, Microsoft 365 / licencias) — importan coste diario y nº de licencias activas.
- Deduplicación por `(vendor, invoiceNumber, fiscalYear)` y detección de duplicados por importe+fecha.

### M2 · Gasto recurrente y contratos
- Suscripciones y contratos con periodicidad, fecha de renovación, preaviso y cláusula de auto-renovación.
- Normalización a coste mensual y anualizado.
- **Detección de desperdicio**: licencias contratadas vs activas.
- Alertas de renovación y de subida de precio respecto al periodo anterior.

### M3 · Inmovilizado (CAPEX)
- Registro de activos con categoría, fecha de alta, valor, valor residual y vida útil.
- Amortización lineal mensual automática (métodos alternativos: degresiva y por unidades, configurables).
- Valor neto contable, edad del parque y **deuda técnica de hardware** (coste de reposición de lo que ya superó su vida útil).
- Asignación de activos a servicio, centro de coste y empleado.

### M4 · Personal y productividad
- Puestos, empleados, dedicación (FTE) y **retribución** (tabla aparte, cifrada).
- Coste empresa calculado (bruto + SS empresa + beneficios + formación + coste del puesto).
- Tarifa horaria interna a partir de horas productivas reales.
- Imputación de horas a servicios (*run*) y proyectos (*change*), manual o importada de Jira/Clockify.
- Utilización, ratio run/change, coste por rol y ratio de recuperación.

### M5 · Proyectos y sobrecoste por desviación
- Baseline de presupuesto, alcance y fechas; versionado de baselines (una re-baseline no borra la anterior).
- Coste real por imputación de horas + facturas asociadas + activos asociados.
- EVM: PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC, TCPI.
- **Registro de eventos de retraso** con causa tipificada y cálculo de coste de retraso en euros.
- Change requests con impacto económico y aprobación.

### M6 · Presupuesto, escenarios y chargeback
- Presupuesto anual por centro de coste / servicio / categoría, con reparto mensual.
- Real vs presupuesto vs forecast (forecast = real acumulado + previsión de recurrentes + ETC de proyectos).
- Escenarios "qué pasa si" (recortar un servicio, internalizar un proveedor, retrasar una renovación).
- Reglas de reparto (drivers: usuarios, dispositivos, tickets, consumo, ingresos de la BU) → coste por unidad de negocio.

### M7 · Viabilidad y cuadro de mando
- **IT Viability Score** con desglose por indicador y comparación contra bandas configurables por sector/tamaño.
- Dashboards: dirección (1 pantalla), IT Manager, controller, y vista por proyecto.
- Exportación a Excel/PDF y envío programado por email.

## 5. Fuera de alcance (v1)

Contabilidad legal/asientos, facturación a clientes finales, gestión de compras (aprobación de pedidos), ITSM/ticketing propio, nóminas.

## 6. Criterios de éxito de la v1

- Cargar 12 meses de facturas reales de un departamento IT de 10–50 personas en < 1 día de trabajo.
- Reproducir el TCO anual con una desviación < 2 % respecto a la contabilidad.
- Cierre mensual (validar facturas + amortizaciones + imputaciones) en < 2 horas.
- El Viability Score y su desglose son explicables línea a línea hasta la factura de origen (*drill-down* completo).
