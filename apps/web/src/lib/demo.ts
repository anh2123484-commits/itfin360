import { conceptDefinition, type CostType, type SpendConcept } from '@itfin360/finance-core';

import {
  CATALOGO,
  type CategoriaActivo,
  type EstadoProyecto,
  MODELOS,
  NOMBRES_HITO,
  NOMBRES_PUESTO,
  PERSONAS,
  PESOS_HITO,
  PROVEEDORES,
  PROYECTOS,
} from '@/lib/demo-catalogo';

/**
 * Datos de demostración: un departamento de IT ficticio, completo y coherente.
 *
 * Existe porque la aplicación vacía no se puede juzgar. Con las tablas a cero,
 * `/gastos` enseña un cero, `/proyectos` no enseña nada y no hay forma de saber
 * si el reparto run/change o el CPI hacen lo que tienen que hacer. Meter a mano
 * seis meses de facturas para averiguarlo no es una opción.
 *
 * Tres reglas gobiernan este módulo.
 *
 * **Todo va marcado.** Cada fila lleva `DEMO` en un campo que se puede filtrar,
 * y por eso se puede borrar entera y sin dejar restos. Datos de prueba que no se
 * pueden distinguir de los de verdad son peores que no tener datos de prueba.
 *
 * **Es reproducible.** El azar sale de un generador con semilla, y la semilla
 * sale del identificador de la organización. La misma organización produce
 * siempre el mismo conjunto, así que los tests pueden comprobar cifras
 * concretas; organizaciones distintas producen identificadores distintos, que es
 * lo que impide que dos siembras choquen en la misma base.
 *
 * **Los proveedores son inventados.** Ninguna factura de este conjunto lleva el
 * nombre de una empresa real. Una factura ficticia a nombre de alguien que
 * existe es un documento falso, aunque esté en una base de datos de pruebas.
 */

/** Marca que llevan todas las filas sembradas. Por aquí se borran. */
export const MARCA = 'DEMO';

const PREFIJO_NOMBRE = `${MARCA} · `;
const PREFIJO_FACTURA = `${MARCA}-F`;
const PREFIJO_EMPLEADO = `${MARCA}-E`;
const PREFIJO_SERIE = `${MARCA}-SN-`;
const PREFIJO_PROYECTO = `${MARCA}-`;
const PREFIJO_IMPUTACION = 'demo:';

export const PREFIJOS = {
  nombre: PREFIJO_NOMBRE,
  factura: PREFIJO_FACTURA,
  empleado: PREFIJO_EMPLEADO,
  serie: PREFIJO_SERIE,
  proyecto: PREFIJO_PROYECTO,
  imputacion: PREFIJO_IMPUTACION,
} as const;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Hash de 32 bits de un texto. Sirve para que cada tenant tenga su propia serie. */
function semillaDe(texto: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/**
 * Generador con semilla (mulberry32).
 *
 * `Math.random()` daría un conjunto distinto en cada siembra, y entonces ningún
 * test podría afirmar nada sobre las cifras que salen.
 */
function generador(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Identificador con forma de UUID v4, sacado del generador. */
function identificador(azar: () => number): string {
  const hex = '0123456789abcdef'.split('');
  let salida = '';
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) salida += '4';
    else if (i === 16) salida += hex[8 + Math.floor(azar() * 4)]!;
    else salida += hex[Math.floor(azar() * 16)]!;
  }
  return [
    salida.slice(0, 8),
    salida.slice(8, 12),
    salida.slice(12, 16),
    salida.slice(16, 20),
    salida.slice(20),
  ].join('-');
}

function entre(azar: () => number, minimo: number, maximo: number): number {
  return minimo + Math.floor(azar() * (maximo - minimo + 1));
}

function uno<T>(azar: () => number, lista: readonly T[]): T {
  return lista[Math.floor(azar() * lista.length)] as T;
}

/** Primer día del mes, `n` meses antes de la fecha dada, en UTC. */
function mesesAntes(fecha: Date, n: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() - n, 1));
}

function dia(fecha: Date, n: number): Date {
  return new Date(fecha.getTime() + n * DIA_MS);
}

function lunesDe(fecha: Date): Date {
  const d = fecha.getUTCDay();
  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate() - (d === 0 ? 6 : d - 1),
    ),
  );
}

const IVA_BP = 2_100;

export interface FilaPuesto {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly family: string | null;
}

export interface FilaEmpleado {
  readonly id: string;
  readonly tenantId: string;
  readonly positionId: string;
  readonly fullName: string;
  readonly employeeCode: string;
  readonly employmentType: 'PERMANENT' | 'TEMPORARY';
  readonly fteBp: number;
  readonly hireDate: Date;
  readonly terminationDate: Date | null;
  readonly team: string;
  readonly costCenter: string;
}

export interface FilaProveedor {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly country: string;
}

export interface FilaFactura {
  readonly id: string;
  readonly tenantId: string;
  readonly vendorId: string;
  readonly invoiceNumber: string;
  readonly issueDate: Date;
  readonly accrualDate: Date;
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
  readonly currency: string;
  readonly status: 'POSTED' | 'APPROVED' | 'PENDING_REVIEW' | 'DRAFT';
  readonly source: 'CSV_IMPORT';
}

export interface FilaLinea {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly lineNumber: number;
  readonly description: string;
  readonly unitPriceCents: number;
  readonly netCents: number;
  readonly costType: CostType;
  readonly concept: SpendConcept;
}

export interface FilaContrato {
  readonly id: string;
  readonly tenantId: string;
  readonly vendorId: string;
  readonly name: string;
  readonly concept: SpendConcept;
  readonly amountCents: number;
  readonly currency: string;
  readonly periodicity: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  readonly startDate: Date;
  readonly renewalDate: Date;
  readonly noticeDays: number;
  readonly autoRenew: boolean;
  readonly licensedSeats: number | null;
  readonly activeSeats: number | null;
  readonly seatsMeasuredAt: Date | null;
  readonly previousAmountCents: number | null;
  readonly status: 'ACTIVE' | 'CANCELLED';
}

export interface FilaActivo {
  readonly id: string;
  readonly tenantId: string;
  readonly vendorId: string;
  readonly name: string;
  readonly category: CategoriaActivo;
  readonly serialNumber: string;
  readonly acquisitionCents: number;
  readonly usefulLifeMonths: number;
  readonly inServiceDate: Date;
  readonly currency: string;
  readonly status: 'IN_USE' | 'IN_STOCK';
  readonly catalogPriceCents: number;
  readonly hasBudgetLine: boolean;
}

export interface FilaProyecto {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly status: EstadoProyecto;
  readonly managerId: string;
  readonly service: string;
  readonly sponsor: string;
}

export interface FilaBaseline {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly version: number;
  readonly bacCents: number;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly reason: string;
  readonly approvedBy: string;
  readonly isCurrent: boolean;
}

export interface FilaHito {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly name: string;
  readonly weightBp: number;
  readonly status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  readonly progressBp: number | null;
  readonly plannedDate: Date;
  readonly actualDate: Date | null;
  readonly position: number;
}

export interface FilaImputacion {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly projectId: string | null;
  readonly entryDate: Date;
  readonly minutes: number;
  readonly startMinute: number;
  readonly activity: 'RUN' | 'CHANGE' | 'INTERNAL' | 'ABSENCE';
  readonly service: string;
  readonly isRework: boolean;
  readonly isOvertime: boolean;
  readonly isBillable: boolean;
  readonly source: 'CSV_IMPORT';
  readonly externalKey: string;
}

export interface DatosDemo {
  readonly puestos: readonly FilaPuesto[];
  readonly empleados: readonly FilaEmpleado[];
  readonly proveedores: readonly FilaProveedor[];
  readonly facturas: readonly FilaFactura[];
  readonly lineas: readonly FilaLinea[];
  readonly contratos: readonly FilaContrato[];
  readonly activos: readonly FilaActivo[];
  readonly proyectos: readonly FilaProyecto[];
  readonly baselines: readonly FilaBaseline[];
  readonly hitos: readonly FilaHito[];
  readonly imputaciones: readonly FilaImputacion[];
}

/** Meses de facturación que se generan hacia atrás. */
export const MESES_DE_HISTORIA = 6;
/** Semanas de partes de trabajo que se generan hacia atrás. */
export const SEMANAS_DE_HORAS = 3;

const DIVISA = 'EUR';

/**
 * El departamento entero, listo para escribir.
 *
 * No toca la base: devuelve filas. Así se puede comprobar en un test que los
 * importes cuadran y que los pesos de los hitos suman uno, sin levantar Postgres.
 */
export function generarDemo(tenantId: string, hoy: Date): DatosDemo {
  const azar = generador(semillaDe(tenantId));

  const puestos: FilaPuesto[] = NOMBRES_PUESTO.map((nombre) => ({
    id: identificador(azar),
    tenantId,
    name: `${PREFIJO_NOMBRE}${nombre}`,
    family: nombre === 'Responsable de IT' ? 'Dirección' : 'Técnica',
  }));

  const empleados: FilaEmpleado[] = PERSONAS.map((persona, indice) => ({
    id: identificador(azar),
    tenantId,
    positionId: puestos[persona.puesto]!.id,
    fullName: persona.nombre,
    employeeCode: `${PREFIJO_EMPLEADO}${String(indice + 1).padStart(2, '0')}`,
    employmentType: persona.fteBp < 10_000 ? 'TEMPORARY' : 'PERMANENT',
    fteBp: persona.fteBp,
    hireDate: mesesAntes(hoy, persona.meses),
    terminationDate: 'bajaHace' in persona ? mesesAntes(hoy, persona.bajaHace) : null,
    team: persona.equipo,
    costCenter: 'CC-IT',
  }));

  const proveedores: FilaProveedor[] = PROVEEDORES.map((proveedor) => ({
    id: identificador(azar),
    tenantId,
    name: `${PREFIJO_NOMBRE}${proveedor.nombre}`,
    criticality: proveedor.criticidad,
    country: proveedor.pais,
  }));

  const facturas: FilaFactura[] = [];
  const lineas: FilaLinea[] = [];
  let numeroFactura = 0;

  for (let atras = MESES_DE_HISTORIA - 1; atras >= 0; atras -= 1) {
    const inicioMes = mesesAntes(hoy, atras);
    for (const [indiceProveedor, proveedor] of PROVEEDORES.entries()) {
      // No todos los proveedores facturan todos los meses: un departamento real
      // no tiene una factura de auditoría cada treinta días.
      const partidas = CATALOGO[proveedor.nombre]!;
      const trimestral = proveedor.nombre === 'Auditoría Kessler';
      const cuantas = trimestral ? (atras % 3 === 0 ? 1 : 0) : entre(azar, 1, 2);

      for (let n = 0; n < cuantas; n += 1) {
        numeroFactura += 1;
        const facturaId = identificador(azar);
        const devengo = dia(inicioMes, entre(azar, 0, 25));
        const cuantasLineas = entre(azar, 1, 3);

        let neto = 0;
        for (let l = 0; l < cuantasLineas; l += 1) {
          const partida = uno(azar, partidas);
          const importe = entre(azar, partida.min, partida.max);
          neto += importe;
          lineas.push({
            id: identificador(azar),
            tenantId,
            invoiceId: facturaId,
            lineNumber: l + 1,
            description: partida.texto,
            unitPriceCents: importe,
            netCents: importe,
            costType: conceptDefinition(partida.concepto).costType,
            concept: partida.concepto,
          });
        }

        const iva = Math.round((neto * IVA_BP) / 10_000);
        // El mes en curso todavía se está cerrando: algunas facturas están sin
        // aprobar, y eso es lo que hace que `/gastos` se comporte como en la
        // vida real, donde el último mes siempre se mueve.
        const estado = atras === 0 && indiceProveedor % 3 === 0 ? 'PENDING_REVIEW' : 'POSTED';

        facturas.push({
          id: facturaId,
          tenantId,
          vendorId: proveedores[indiceProveedor]!.id,
          invoiceNumber: `${PREFIJO_FACTURA}${String(numeroFactura).padStart(4, '0')}`,
          issueDate: devengo,
          accrualDate: devengo,
          netCents: neto,
          vatCents: iva,
          grossCents: neto + iva,
          currency: DIVISA,
          status: estado,
          source: 'CSV_IMPORT',
        });
      }
    }
  }

  const contratos: FilaContrato[] = [
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[2]!.id,
      name: `${PREFIJO_NOMBRE}Suscripción de ofimática`,
      concept: 'SAAS_SUBSCRIPTION',
      amountCents: 234_000,
      currency: DIVISA,
      periodicity: 'MONTHLY',
      startDate: mesesAntes(hoy, 22),
      renewalDate: dia(hoy, 95),
      noticeDays: 60,
      autoRenew: true,
      // Cuarenta y cinco licencias para veintiocho personas: el desperdicio que
      // la pantalla de contratos saca ordenado por dinero en juego.
      licensedSeats: 45,
      activeSeats: 28,
      seatsMeasuredAt: dia(hoy, -7),
      previousAmountCents: 198_000,
      status: 'ACTIVE',
    },
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[0]!.id,
      name: `${PREFIJO_NOMBRE}Reserva de capacidad cloud`,
      concept: 'CLOUD_INFRASTRUCTURE',
      amountCents: 1_140_000,
      currency: DIVISA,
      periodicity: 'QUARTERLY',
      startDate: mesesAntes(hoy, 15),
      renewalDate: dia(hoy, 38),
      noticeDays: 30,
      autoRenew: true,
      licensedSeats: null,
      activeSeats: null,
      seatsMeasuredAt: null,
      previousAmountCents: null,
      status: 'ACTIVE',
    },
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[1]!.id,
      name: `${PREFIJO_NOMBRE}Fibra y móviles`,
      concept: 'TELECOM',
      amountCents: 118_000,
      currency: DIVISA,
      periodicity: 'MONTHLY',
      startDate: mesesAntes(hoy, 30),
      renewalDate: dia(hoy, 210),
      noticeDays: 60,
      autoRenew: true,
      licensedSeats: null,
      activeSeats: null,
      seatsMeasuredAt: null,
      previousAmountCents: null,
      status: 'ACTIVE',
    },
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[4]!.id,
      name: `${PREFIJO_NOMBRE}Soporte de segundo nivel`,
      concept: 'THIRD_PARTY_SUPPORT',
      amountCents: 1_680_000,
      currency: DIVISA,
      periodicity: 'ANNUAL',
      startDate: mesesAntes(hoy, 10),
      // Dentro del preaviso: si nadie hace nada, se renueva sola.
      renewalDate: dia(hoy, 41),
      noticeDays: 90,
      autoRenew: true,
      licensedSeats: null,
      activeSeats: null,
      seatsMeasuredAt: null,
      previousAmountCents: 1_320_000,
      status: 'ACTIVE',
    },
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[5]!.id,
      name: `${PREFIJO_NOMBRE}Vigilancia gestionada`,
      concept: 'SECURITY_SERVICES',
      amountCents: 96_000,
      currency: DIVISA,
      periodicity: 'MONTHLY',
      startDate: mesesAntes(hoy, 8),
      renewalDate: dia(hoy, 150),
      noticeDays: 30,
      autoRenew: false,
      licensedSeats: 60,
      activeSeats: 58,
      seatsMeasuredAt: dia(hoy, -14),
      previousAmountCents: null,
      status: 'ACTIVE',
    },
    {
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[2]!.id,
      name: `${PREFIJO_NOMBRE}Licencias de backup`,
      concept: 'SOFTWARE_LICENSE',
      amountCents: 62_000,
      currency: DIVISA,
      periodicity: 'MONTHLY',
      startDate: mesesAntes(hoy, 26),
      renewalDate: dia(hoy, -20),
      noticeDays: 30,
      autoRenew: false,
      licensedSeats: 20,
      activeSeats: 12,
      seatsMeasuredAt: dia(hoy, -30),
      previousAmountCents: null,
      // Cancelado: sirve para comprobar que un contrato cancelado no genera
      // avisos por mucho desperdicio que tenga.
      status: 'CANCELLED',
    },
  ];

  const activos: FilaActivo[] = [];
  for (let i = 0; i < 24; i += 1) {
    const modelo = uno(azar, MODELOS);
    // Algunos se compraron hace más que su vida útil: son la deuda técnica que
    // el panel de inmovilizado tiene que saber enseñar.
    const antiguedad = entre(azar, 4, modelo.vida + 26);
    activos.push({
      id: identificador(azar),
      tenantId,
      vendorId: proveedores[modelo.proveedor]!.id,
      name: `${PREFIJO_NOMBRE}${modelo.nombre}`,
      category: modelo.categoria,
      serialNumber: `${PREFIJO_SERIE}${String(i + 1).padStart(4, '0')}`,
      acquisitionCents: modelo.precio,
      usefulLifeMonths: modelo.vida,
      inServiceDate: mesesAntes(hoy, antiguedad),
      currency: DIVISA,
      status: antiguedad > modelo.vida + 18 ? 'IN_STOCK' : 'IN_USE',
      catalogPriceCents: Math.round(modelo.precio * 1.08),
      hasBudgetLine: i % 4 === 0,
    });
  }

  const proyectos: FilaProyecto[] = [];
  const baselines: FilaBaseline[] = [];
  const hitos: FilaHito[] = [];

  for (const plantilla of PROYECTOS) {
    const proyectoId = identificador(azar);
    const inicio = mesesAntes(hoy, plantilla.empiezaHace);
    const fin = mesesAntes(hoy, plantilla.empiezaHace - plantilla.dura);

    proyectos.push({
      id: proyectoId,
      tenantId,
      code: `${PREFIJO_PROYECTO}${plantilla.codigo}`,
      name: plantilla.nombre,
      status: plantilla.estado,
      managerId: empleados[plantilla.jefe]!.id,
      service: plantilla.servicio,
      sponsor: 'Dirección general',
    });

    if (plantilla.rebaseline) {
      // La versión anterior se conserva: es lo que permite distinguir «esto se
      // desvió» de «se cambió el objetivo».
      baselines.push({
        id: identificador(azar),
        tenantId,
        projectId: proyectoId,
        version: 1,
        bacCents: Math.round(plantilla.bac * 0.8),
        startDate: inicio,
        endDate: mesesAntes(hoy, plantilla.empiezaHace - plantilla.dura + 3),
        reason: 'Presupuesto inicial aprobado en comité',
        approvedBy: 'Comité de inversiones',
        isCurrent: false,
      });
    }

    baselines.push({
      id: identificador(azar),
      tenantId,
      projectId: proyectoId,
      version: plantilla.rebaseline ? 2 : 1,
      bacCents: plantilla.bac,
      startDate: inicio,
      endDate: fin,
      reason: plantilla.rebaseline
        ? 'Ampliación de alcance a las dos sedes nuevas'
        : 'Presupuesto inicial aprobado en comité',
      approvedBy: 'Comité de inversiones',
      isCurrent: true,
    });

    for (const [indice, nombre] of NOMBRES_HITO.entries()) {
      const terminado = indice < plantilla.hechos;
      const enCurso = indice === plantilla.hechos && plantilla.estado === 'ACTIVE';
      const tramo = Math.round(((indice + 1) * plantilla.dura) / NOMBRES_HITO.length);
      const previsto = mesesAntes(hoy, plantilla.empiezaHace - tramo);
      hitos.push({
        id: identificador(azar),
        tenantId,
        projectId: proyectoId,
        name: nombre,
        weightBp: PESOS_HITO[indice]!,
        status: terminado ? 'COMPLETED' : enCurso ? 'IN_PROGRESS' : 'NOT_STARTED',
        progressBp: enCurso ? entre(azar, 2_000, 7_000) : null,
        plannedDate: previsto,
        actualDate: terminado ? dia(previsto, entre(azar, -8, 20)) : null,
        position: indice,
      });
    }
  }

  const proyectosActivos = proyectos.filter((p) => p.status === 'ACTIVE');

  const imputaciones: FilaImputacion[] = [];
  let numeroImputacion = 0;
  const lunesActual = lunesDe(hoy);

  for (let semana = SEMANAS_DE_HORAS; semana >= 1; semana -= 1) {
    const lunes = dia(lunesActual, -7 * semana);
    for (let d = 0; d < 5; d += 1) {
      const fecha = dia(lunes, d);
      for (const [indice, persona] of empleados.entries()) {
        if (persona.terminationDate !== null && persona.terminationDate < fecha) continue;

        // Una persona de cada quince días está de vacaciones ese día.
        if (azar() < 0.06) {
          numeroImputacion += 1;
          imputaciones.push({
            id: identificador(azar),
            tenantId,
            employeeId: persona.id,
            projectId: null,
            entryDate: fecha,
            minutes: 480,
            startMinute: 540,
            activity: 'ABSENCE',
            service: 'Vacaciones',
            isRework: false,
            isOvertime: false,
            isBillable: false,
            source: 'CSV_IMPORT',
            externalKey: `${PREFIJO_IMPUTACION}${String(numeroImputacion).padStart(5, '0')}`,
          });
          continue;
        }

        // Dos tramos que no se pisan: mañana y tarde. La jornada de quien está a
        // media jornada se reparte igual, sólo que más corta.
        const jornada = Math.round((480 * persona.fteBp) / 10_000);
        const manana = Math.round(jornada * 0.55);
        const tarde = jornada - manana;
        const tramos = [
          {
            inicio: 540,
            minutos: manana,
          },
          {
            inicio: 540 + manana + 60,
            minutos: tarde,
          },
        ];

        for (const tramo of tramos) {
          if (tramo.minutos <= 0) continue;
          const esProyecto = proyectosActivos.length > 0 && azar() < 0.45;
          const proyecto = esProyecto ? uno(azar, proyectosActivos) : null;
          numeroImputacion += 1;
          imputaciones.push({
            id: identificador(azar),
            tenantId,
            employeeId: persona.id,
            projectId: proyecto?.id ?? null,
            entryDate: fecha,
            minutes: tramo.minutos,
            startMinute: tramo.inicio,
            activity: esProyecto ? 'CHANGE' : indice % 7 === 0 ? 'INTERNAL' : 'RUN',
            service: esProyecto ? (proyecto?.service ?? 'Proyecto') : 'Explotación',
            isRework: !esProyecto && azar() < 0.12,
            isOvertime: false,
            isBillable: esProyecto && azar() < 0.5,
            source: 'CSV_IMPORT',
            externalKey: `${PREFIJO_IMPUTACION}${String(numeroImputacion).padStart(5, '0')}`,
          });
        }
      }
    }
  }

  return {
    puestos,
    empleados,
    proveedores,
    facturas,
    lineas,
    contratos,
    activos,
    proyectos,
    baselines,
    hitos,
    imputaciones,
  };
}

/** Cuántas filas escribe el conjunto, por si hace falta avisar antes. */
export function tamanoDemo(datos: DatosDemo): number {
  return (
    datos.puestos.length +
    datos.empleados.length +
    datos.proveedores.length +
    datos.facturas.length +
    datos.lineas.length +
    datos.contratos.length +
    datos.activos.length +
    datos.proyectos.length +
    datos.baselines.length +
    datos.hitos.length +
    datos.imputaciones.length
  );
}
