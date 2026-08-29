# ITFin360 — Modelo financiero y de cálculo

Documento normativo. Todo cálculo de la aplicación se implementa **exactamente** como aquí se define, en un paquete puro y testeado (`packages/finance-core`), sin dependencias de base de datos ni de framework. Cada fórmula tiene su test unitario con el caso numérico incluido en este documento.

**Reglas transversales**

- Toda cantidad monetaria se almacena en **céntimos (entero)** más código de divisa ISO-4217. Nunca `float`.
- Divisa base del tenant configurable; las conversiones usan el tipo de cambio del **día de devengo** y se persisten con la operación (no se recalcula el histórico).
- Todo cálculo se hace sobre **fecha de devengo** (`accrualDate`), no sobre fecha de pago ni de emisión.
- Todos los parámetros marcados *(config)* son editables por tenant, con valor por defecto y con historial de versiones (cambiar un parámetro no reescribe periodos ya cerrados).
- Un periodo cerrado (`PeriodClose`) congela sus resultados en una tabla de hechos; los recálculos posteriores generan un ajuste, no una sobreescritura.

---

## 1. Normalización del gasto

### 1.1 Coste mensual normalizado de un recurrente

```
mesesPeriodicidad = { MONTHLY:1, QUARTERLY:3, SEMIANNUAL:6, ANNUAL:12, BIENNIAL:24 }
costeMensual = importeContrato / mesesPeriodicidad[periodicidad]
costeAnualizado = costeMensual * 12
```

### 1.2 Devengo de una factura one-shot con periodo de servicio

Si la factura cubre `[inicio, fin]`, el importe se reparte proporcionalmente por días naturales en cada mes:

```
importeMes(m) = importeTotal * díasDeServicioEn(m) / díasTotalesDeServicio
```

Si no hay periodo de servicio, todo el importe devenga en el mes de `accrualDate`.

### 1.3 IVA

Los KPIs se calculan sobre **base imponible** (`netAmount`). El IVA soportado se guarda pero se excluye salvo que el tenant marque `vatRecoverable = false` *(config, default `true`)*, en cuyo caso el coste es el importe bruto.

---

## 2. Inmovilizado y amortización

### 2.1 Vidas útiles por defecto *(config)*

| Categoría | Vida útil | % anual |
|---|---|---|
| `SERVER` | 60 meses | 20 % |
| `STORAGE` | 60 meses | 20 % |
| `NETWORK` | 84 meses | 14,3 % |
| `WORKSTATION` / `LAPTOP` | 48 meses | 25 % |
| `MOBILE` | 36 meses | 33,3 % |
| `PERIPHERAL` | 36 meses | 33,3 % |
| `SOFTWARE_LICENSE_PERPETUAL` | 36 meses | 33,3 % |
| `INTANGIBLE_DEV` (desarrollo capitalizado) | 60 meses | 20 % |

### 2.2 Amortización lineal

```
baseAmortizable = valorAdquisición − valorResidual
cuotaMensual    = baseAmortizable / vidaÚtilMeses
amortAcumulada(t) = min(cuotaMensual * mesesTranscurridos, baseAmortizable)
valorNetoContable(t) = valorAdquisición − amortAcumulada(t)
```

El primer mes se prorratea por días si `prorrateoPrimerMes = true` *(config, default `true`)*.

**Métodos alternativos** (implementar tras el lineal): degresivo con coeficiente *(config, default 2,0 → doble saldo decreciente)* y por unidades de uso.

### 2.3 Deuda técnica de hardware

```
activosVencidos = activos con edadMeses > vidaÚtilMeses y estado = IN_USE
deudaTécnicaHW  = Σ costeReposiciónEstimado(activo)
```
`costeReposiciónEstimado` = precio de catálogo actual si existe; si no, `valorAdquisición * (1 + inflaciónHW)^años` con `inflaciónHW` *(config, default 3 %)*.

**Riesgo de renovación no presupuestada** = Σ costeReposición de activos que vencen en los próximos 12 meses y no tienen línea de presupuesto asociada.

---

## 3. Coste de personal

### 3.1 Coste empresa anual por empleado

```
costeSS        = salarioBrutoAnual * tasaSSEmpresa
costePuesto    = amortMensualActivosAsignados*12 + licenciasAsignadasAnual + costeEspacioAnual + telefoníaAnual
costeEmpresa   = salarioBrutoAnual + costeSS + variableAnual + beneficiosAnual
               + formaciónAnual + costePuesto + otrosCostesAnual
```

`tasaSSEmpresa` *(config, default 0,32 para España)*. Se desglosa en parámetros editables: contingencias comunes 23,60 %, desempleo 5,50 %, FOGASA 0,20 %, formación profesional 0,60 %, MEI 0,67 %, AT/EP variable por CNAE *(default 1,50 %)*. El default global es un redondeo conservador; el tenant puede activar el desglose exacto. **El tipo aplicable y las bases máximas de cotización cambian cada año: son datos de configuración anual del tenant, nunca constantes en código.**

Si el empleado no está al 100 %: todos los importes se multiplican por su `fteRatio`.

### 3.2 Horas productivas y tarifa horaria interna

```
horasConvenio     = jornadaAnualConvenio                      (config, default 1.780 h)
horasDisponibles  = horasConvenio − vacaciones − festivos − absentismoPrevisto − formación
horasProductivas  = horasDisponibles * factorProductividad     (config, default 0,85)
tarifaHorariaInterna = costeEmpresaAnual / horasProductivas
```

Se calcula también una **tarifa por rol** (media ponderada por FTE de los empleados del rol) para poder estimar proyectos sin exponer salarios individuales.

**Ejemplo de referencia (test unitario obligatorio):**
bruto 42.000 € · SS 32 % · variable 2.000 € · beneficios 1.200 € · formación 800 € · coste puesto 1.500 €
→ costeSS = 13.440 € → **costeEmpresa = 60.940 €**
horasConvenio 1.780 − vacaciones 184 − festivos 96 − absentismo 40 − formación 24 = 1.436 h disponibles
→ horasProductivas = 1.436 × 0,85 = 1.220,6 h → **tarifa interna = 49,93 €/h**

### 3.3 Utilización, run/change y rendimiento

```
utilización     = horasImputadas / horasDisponibles
%change         = horasEnProyectos / horasImputadas
%run            = horasEnServicios / horasImputadas
costeRun        = Σ horasRun * tarifa
costeChange     = Σ horasChange * tarifa
horasNoImputadas= horasDisponibles − horasImputadas
costeNoImputado = horasNoImputadas * tarifa        → "coste invisible"
```

**Ratio de recuperación** (¿el puesto devuelve lo que cuesta?):
```
valorImputado    = Σ (horas imputadas * tarifaDeReferencia)
   donde tarifaDeReferencia = tarifa de mercado del rol (config) para trabajo interno,
   o precio de venta si el departamento factura a negocio.
ratioRecuperación = valorImputado / costeEmpresa
```
Bandas *(config)*: `< 0,8` deficitario · `0,8–1,1` en equilibrio · `> 1,1` genera margen.

> El ratio de recuperación mide recuperación económica del puesto, no el desempeño de la persona. La UI lo etiqueta así y no permite ordenar empleados por este indicador en vistas compartidas; sólo agregados por rol y equipo. Es una decisión de producto, no un detalle cosmético.

---

## 4. TCO por servicio y unit economics

### 4.1 TCO

```
TCO(servicio, periodo) =
    OPEXdirecto            (facturas y recurrentes imputados al servicio)
  + amortizaciónCAPEX      (Σ cuotas mensuales de activos asignados al servicio)
  + costePersonal          (Σ horas run imputadas al servicio * tarifa)
  + overheadAsignado       (costes no imputables repartidos por regla de allocation)
```

### 4.2 Reparto de overhead y chargeback

Driver configurable por regla:

```
peso(BU) = valorDriver(BU) / Σ valorDriver(todas las BU)
costeAsignado(BU) = costeAReparto * peso(BU)
```
Drivers soportados: `HEADCOUNT`, `ACTIVE_USERS`, `DEVICES`, `TICKETS`, `STORAGE_GB`, `COMPUTE_UNITS`, `REVENUE`, `FIXED_PERCENT`.

Las reglas se encadenan (reparto en cascada) y el motor debe **detectar ciclos** y fallar de forma explícita.

### 4.3 Unit economics

```
costePorUsuario     = TCOtotal / usuariosActivos
costePorDispositivo = TCOtotal / dispositivosGestionados
costePorTicket      = (costeRun + OPEXsoporte) / ticketsResueltos
ITspendRatio        = TCOtotal / facturaciónEmpresa
```

---

## 5. Proyectos: EVM y coste del retraso

### 5.1 Earned Value Management

```
BAC  = presupuesto baseline vigente
PV   = BAC * %avancePlanificado(fecha)
EV   = BAC * %avanceReal(fecha)
AC   = coste real acumulado (horas*tarifa + facturas + activos imputados)

CV   = EV − AC          SV   = EV − PV
CPI  = EV / AC          SPI  = EV / PV
EAC  = AC + (BAC − EV) / CPI        [método por rendimiento; default]
EACalt = AC + (BAC − EV)            [si la desviación se considera puntual]
ETC  = EAC − AC
VAC  = BAC − EAC
TCPI = (BAC − EV) / (BAC − AC)
```
`CPI` y `SPI` no se calculan si `AC = 0` o `PV = 0` → se devuelve `null`, nunca `0` ni infinito. `%avanceReal` procede de hitos ponderados o de la regla 0/50/100 *(config)*, nunca de "horas consumidas / horas previstas" (eso mide consumo, no avance).

### 5.2 Coste del retraso (Cost of Delay)

Es el núcleo diferencial del producto. Por cada día de retraso sobre la fecha baseline:

```
CoDdía =   costeEquipoRetenido
         + costeOportunidad
         + penalizaciónContractual
         + costePuenteOperativo
         + costeRetrabajo/díasRetraso

costeEquipoRetenido   = Σ (fteAsignado * tarifaHorariaInterna * horasJornada)
costeOportunidad      = beneficioOAhorroAnualEsperado / 365
penalizaciónContractual = importe por día según cláusula SLA/contrato (0 si no aplica)
costePuenteOperativo  = coste mensual del sistema legacy que el proyecto sustituye / 30
costeRetrabajo        = Σ horasRetrabajo * tarifa

CoDtotal = Σ_días CoDdía        (se acumula día a día, con la composición del equipo real de cada día)
```

**Ejemplo de referencia (test unitario obligatorio):**
proyecto con 3 FTE a 50 €/h y jornada de 8 h → 1.200 €/día de equipo retenido;
ahorro anual esperado 120.000 € → 328,77 €/día de oportunidad;
penalización 0; legacy 4.000 €/mes → 133,33 €/día.
→ **CoDdía = 1.662,10 €**; 30 días de retraso → **CoDtotal = 49.863 €**, frente a un BAC de, por ejemplo, 150.000 € = **33 % de sobrecoste invisible** que no aparece en ninguna factura.

### 5.3 Desviación y fiabilidad de entrega

```
desviaciónPresupuestaria = (costeReal − BACinicial) / BACinicial
desviaciónPlazo(días)    = fechaFinReal − fechaFinBaselineInicial
OTD (on-time delivery)   = proyectosEntregadosEnFecha / proyectosEntregados
OBD (on-budget delivery) = proyectosConDesviación ≤ umbral / proyectosEntregados   (umbral config, default 10 %)
índiceReBaseline         = nº de re-baselines / nº de proyectos
```
La desviación se mide **siempre contra la baseline inicial**, no contra la última re-baseline. La comparación contra la vigente se muestra aparte; si sólo se enseña esa, re-baselinear borra el problema.

Causas de retraso tipificadas *(enum, config ampliable)*: `SCOPE_CHANGE`, `RESOURCE_UNAVAILABLE`, `VENDOR_DELAY`, `DEPENDENCY_BLOCKED`, `QUALITY_REWORK`, `APPROVAL_DELAY`, `ESTIMATION_ERROR`, `EXTERNAL`. El cuadro de mando agrupa el CoD acumulado por causa: eso es lo que dice dónde actuar.

---

## 6. Presupuesto y forecast

```
presupuestoPeriodo   = Σ líneas de presupuesto del periodo
realPeriodo          = Σ coste devengado del periodo
varianza             = real − presupuesto
% ejecución          = real / presupuesto

forecastAñoCompleto  = realAcumulado
                     + Σ recurrentesRestantesDelAño
                     + Σ ETC de proyectos activos
                     + Σ amortizacionesRestantes
                     + Σ comprometidoNoDevengado (pedidos y contratos firmados)
```

**Escenarios**: un escenario es un conjunto de *overrides* (cancelar servicio X, cambiar precio de Y, retrasar renovación Z, +1 FTE) aplicados sobre el forecast base. Nunca escriben en los datos reales.

---

## 7. IT Viability Score

Score compuesto 0–100. Cada indicador se normaliza a 0–100 mediante bandas configurables (interpolación lineal entre banda mala y banda buena, recorte fuera de rango).

| # | Indicador | Peso | Banda buena (100) | Banda mala (0) |
|---|---|---|---|---|
| 1 | IT spend / facturación vs referencia del sector | 15 | dentro de la banda del sector | > 2× banda |
| 2 | Ratio run/change | 15 | change ≥ 30 % | change ≤ 10 % |
| 3 | CPI medio ponderado por BAC | 15 | ≥ 1,00 | ≤ 0,75 |
| 4 | Desviación presupuestaria anual | 15 | ≤ 5 % | ≥ 25 % |
| 5 | Coste por usuario vs referencia | 10 | ≤ referencia | ≥ 2× referencia |
| 6 | Utilización del equipo | 10 | 70–85 % | < 50 % o > 95 % |
| 7 | % de gasto bajo contrato gobernado | 10 | ≥ 90 % | ≤ 50 % |
| 8 | Cobertura de renovación de activos | 10 | deuda técnica ≤ 5 % del TCO | ≥ 25 % |

```
score = Σ (indicadorNormalizado_i * peso_i) / Σ pesos
```

Lectura *(config)*: `≥ 75` viable y bajo control · `55–74` viable con tensiones · `40–54` en riesgo · `< 40` no viable sin intervención.

**Requisitos no negociables del score:**
- Cada indicador expone `valor`, `valorNormalizado`, `peso`, `contribución`, `banda`, y la lista de registros de origen. Sin *drill-down* completo, el score no se muestra.
- Un indicador sin datos suficientes se marca `INSUFFICIENT_DATA`, se **excluye del cómputo** y sus pesos se redistribuyen proporcionalmente; el score indica sobre qué cobertura se ha calculado (`% de peso disponible`). Nunca se rellena con un valor por defecto.
- Las bandas de referencia sectoriales las carga el tenant (o se dejan vacías). **No se inventan benchmarks en el código.** Si no hay referencia cargada, los indicadores 1 y 5 quedan `INSUFFICIENT_DATA`.

---

## 8. Motor de cálculo — contrato técnico

`packages/finance-core` exporta funciones puras:

```ts
depreciationSchedule(asset, opts): MonthlyDepreciation[]
normalizeRecurring(contract): { monthlyCents: number; annualCents: number }
accrualSpread(invoice): { period: string; cents: number }[]
employerCost(employee, comp, params): EmployerCostBreakdown
internalHourlyRate(employerCost, hoursParams): { productiveHours: number; rateCents: number }
utilization(timeEntries, hoursParams): UtilizationResult
serviceTco(inputs): TcoBreakdown
allocate(amountCents, rule, drivers): Map<BusinessUnitId, number>   // detecta ciclos
evm(project, asOf): EvmResult                                        // null-safe
costOfDelay(project, delayDays, asOf): CoDBreakdown
forecast(inputs): ForecastResult
viabilityScore(indicators, weights, bands): ScoreResult
```

Reglas: sin I/O, sin `Date.now()` (la fecha se pasa siempre como argumento), aritmética entera en céntimos con redondeo *half-up* explícito en el último paso, y **cobertura de tests ≥ 95 % en este paquete** (es un gate de CI, no una recomendación).
