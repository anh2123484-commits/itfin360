import type { SpendConcept } from '@itfin360/finance-core';

/**
 * Catálogo del departamento ficticio: quién trabaja, a quién se le compra, qué
 * se le compra, qué equipos hay y qué proyectos están en marcha.
 *
 * Son datos, no lógica, y por eso están aparte del generador. Es lo que se toca
 * cuando el conjunto se queda corto, y mezclarlo con el código daba un fichero
 * de mil líneas en el que no se encontraba nada.
 *
 * Los proveedores son inventados: ninguna factura de este conjunto lleva el
 * nombre de una empresa que exista. Una factura ficticia a nombre de alguien
 * real es un documento falso, aunque esté en una base de datos de pruebas.
 */

/** Categorías de activo que usa el conjunto. No están todas las del esquema. */
export type CategoriaActivo =
  | 'SERVER'
  | 'STORAGE'
  | 'NETWORK'
  | 'WORKSTATION'
  | 'LAPTOP'
  | 'MOBILE'
  | 'PERIPHERAL';

/** Estados de proyecto que usa el conjunto. */
export type EstadoProyecto = 'PLANNED' | 'ACTIVE' | 'DELIVERED';

export const NOMBRES_PUESTO = [
  'Responsable de IT',
  'Técnico de sistemas',
  'Técnico de soporte',
  'Administrador de redes',
  'Desarrollador',
  'Analista de ciberseguridad',
] as const;

export const PERSONAS = [
  {
    nombre: 'Marta Ferrer Puig',
    puesto: 0,
    fteBp: 10_000,
    equipo: 'Dirección IT',
    meses: 44,
  },
  {
    nombre: 'Jordi Sala Vidal',
    puesto: 1,
    fteBp: 10_000,
    equipo: 'Sistemas',
    meses: 32,
  },
  {
    nombre: 'Núria Camps Roca',
    puesto: 1,
    fteBp: 10_000,
    equipo: 'Sistemas',
    meses: 19,
  },
  {
    nombre: 'Pau Ribas Font',
    puesto: 2,
    fteBp: 10_000,
    equipo: 'Soporte',
    meses: 27,
  },
  {
    nombre: 'Aina Soler Mas',
    puesto: 2,
    fteBp: 5_000,
    equipo: 'Soporte',
    meses: 14,
  },
  {
    nombre: 'Marc Oliva Serra',
    puesto: 3,
    fteBp: 10_000,
    equipo: 'Redes',
    meses: 38,
  },
  {
    nombre: 'Laia Bosch Prat',
    puesto: 4,
    fteBp: 10_000,
    equipo: 'Desarrollo',
    meses: 23,
  },
  {
    nombre: 'Oriol Puig Gual',
    puesto: 4,
    fteBp: 8_000,
    equipo: 'Desarrollo',
    meses: 11,
  },
  {
    nombre: 'Clara Vila Torres',
    puesto: 5,
    fteBp: 10_000,
    equipo: 'Seguridad',
    meses: 16,
  },
  {
    nombre: 'Ferran Mata Llop',
    puesto: 2,
    fteBp: 10_000,
    equipo: 'Soporte',
    meses: 30,
    bajaHace: 4,
  },
] as const;

export const PROVEEDORES = [
  {
    nombre: 'Nubaris Cloud',
    criticidad: 'CRITICAL' as const,
    pais: 'ES',
  },
  {
    nombre: 'Teledata Iberia',
    criticidad: 'HIGH' as const,
    pais: 'ES',
  },
  {
    nombre: 'Licencias Vega',
    criticidad: 'HIGH' as const,
    pais: 'ES',
  },
  {
    nombre: 'Hardware Nord',
    criticidad: 'MEDIUM' as const,
    pais: 'ES',
  },
  {
    nombre: 'Soporte Delta',
    criticidad: 'MEDIUM' as const,
    pais: 'ES',
  },
  {
    nombre: 'Auditoría Kessler',
    criticidad: 'LOW' as const,
    pais: 'ES',
  },
  {
    nombre: 'Formación Aula Nova',
    criticidad: 'LOW' as const,
    pais: 'ES',
  },
  {
    nombre: 'Consultoría Baix',
    criticidad: 'MEDIUM' as const,
    pais: 'ES',
  },
] as const;

export interface Partida {
  readonly concepto: SpendConcept;
  readonly texto: string;
  readonly min: number;
  readonly max: number;
}

/** Qué compra cada proveedor. Un proveedor de red no factura formación. */
export const CATALOGO: Readonly<Record<string, readonly Partida[]>> = {
  'Nubaris Cloud': [
    {
      concepto: 'CLOUD_INFRASTRUCTURE',
      texto: 'Infraestructura cloud',
      min: 180_000,
      max: 420_000,
    },
    {
      concepto: 'HOSTING',
      texto: 'Alojamiento web',
      min: 20_000,
      max: 60_000,
    },
  ],
  'Teledata Iberia': [
    {
      concepto: 'TELECOM',
      texto: 'Fibra y líneas móviles',
      min: 90_000,
      max: 140_000,
    },
    {
      concepto: 'HARDWARE_NETWORK',
      texto: 'Electrónica de red',
      min: 120_000,
      max: 380_000,
    },
  ],
  'Licencias Vega': [
    {
      concepto: 'SAAS_SUBSCRIPTION',
      texto: 'Suscripciones de ofimática',
      min: 210_000,
      max: 260_000,
    },
    {
      concepto: 'SOFTWARE_LICENSE',
      texto: 'Licencias de backup',
      min: 40_000,
      max: 90_000,
    },
    {
      concepto: 'PERPETUAL_LICENSE',
      texto: 'Licencia perpetua de diseño',
      min: 150_000,
      max: 240_000,
    },
  ],
  'Hardware Nord': [
    {
      concepto: 'HARDWARE_ENDUSER',
      texto: 'Portátiles',
      min: 90_000,
      max: 340_000,
    },
    {
      concepto: 'HARDWARE_SERVER',
      texto: 'Servidor de virtualización',
      min: 480_000,
      max: 900_000,
    },
    {
      concepto: 'CONSUMABLES',
      texto: 'Consumibles y cableado',
      min: 8_000,
      max: 30_000,
    },
    {
      concepto: 'RESALE_GOODS',
      texto: 'Material para reventa a cliente',
      min: 120_000,
      max: 300_000,
    },
  ],
  'Soporte Delta': [
    {
      concepto: 'THIRD_PARTY_SUPPORT',
      texto: 'Soporte de segundo nivel',
      min: 110_000,
      max: 180_000,
    },
    {
      concepto: 'MAINTENANCE',
      texto: 'Mantenimiento de servidores',
      min: 60_000,
      max: 120_000,
    },
    {
      concepto: 'SLA_PENALTY',
      texto: 'Penalización por incumplimiento de SLA',
      min: 15_000,
      max: 40_000,
    },
  ],
  'Auditoría Kessler': [
    {
      concepto: 'SECURITY_AUDIT',
      texto: 'Auditoría de seguridad',
      min: 250_000,
      max: 450_000,
    },
    {
      concepto: 'SECURITY_SERVICES',
      texto: 'Vigilancia gestionada',
      min: 70_000,
      max: 130_000,
    },
  ],
  'Formación Aula Nova': [
    {
      concepto: 'TRAINING',
      texto: 'Formación del equipo',
      min: 40_000,
      max: 120_000,
    },
  ],
  'Consultoría Baix': [
    {
      concepto: 'CONSULTING',
      texto: 'Consultoría de arquitectura',
      min: 180_000,
      max: 420_000,
    },
    {
      concepto: 'CONTRACTOR',
      texto: 'Refuerzo externo por horas',
      min: 200_000,
      max: 560_000,
    },
    {
      concepto: 'PROJECT_SERVICES',
      texto: 'Servicios de implantación',
      min: 300_000,
      max: 700_000,
    },
  ],
};

export interface ModeloActivo {
  readonly nombre: string;
  readonly categoria: CategoriaActivo;
  readonly proveedor: number;
  readonly precio: number;
  readonly vida: number;
}

export interface PlantillaProyecto {
  readonly codigo: string;
  readonly nombre: string;
  readonly servicio: string;
  readonly estado: EstadoProyecto;
  readonly jefe: number;
  readonly bac: number;
  readonly empiezaHace: number;
  readonly dura: number;
  readonly hechos: number;
  readonly rebaseline: boolean;
}

export const MODELOS: readonly ModeloActivo[] = [
  {
    nombre: 'Portátil de técnico',
    categoria: 'LAPTOP',
    proveedor: 3,
    precio: 128_000,
    vida: 48,
  },
  {
    nombre: 'Portátil de desarrollo',
    categoria: 'LAPTOP',
    proveedor: 3,
    precio: 189_000,
    vida: 48,
  },
  {
    nombre: 'Sobremesa de oficina',
    categoria: 'WORKSTATION',
    proveedor: 3,
    precio: 94_000,
    vida: 60,
  },
  {
    nombre: 'Servidor de virtualización',
    categoria: 'SERVER',
    proveedor: 3,
    precio: 780_000,
    vida: 60,
  },
  {
    nombre: 'Cabina de almacenamiento',
    categoria: 'STORAGE',
    proveedor: 3,
    precio: 620_000,
    vida: 72,
  },
  {
    nombre: 'Conmutador de acceso',
    categoria: 'NETWORK',
    proveedor: 1,
    precio: 145_000,
    vida: 84,
  },
  {
    nombre: 'Punto de acceso wifi',
    categoria: 'NETWORK',
    proveedor: 1,
    precio: 38_000,
    vida: 60,
  },
  {
    nombre: 'Teléfono de empresa',
    categoria: 'MOBILE',
    proveedor: 1,
    precio: 52_000,
    vida: 36,
  },
  {
    nombre: 'Monitor de 27 pulgadas',
    categoria: 'PERIPHERAL',
    proveedor: 3,
    precio: 31_000,
    vida: 60,
  },
];

export const PROYECTOS: readonly PlantillaProyecto[] = [
  {
    codigo: 'ERP26',
    nombre: 'Migración del ERP a la nube',
    servicio: 'Aplicaciones',
    estado: 'ACTIVE',
    jefe: 6,
    bac: 12_500_000,
    empiezaHace: 7,
    dura: 12,
    hechos: 2,
    rebaseline: true,
  },
  {
    codigo: 'RED26',
    nombre: 'Renovación de la red de sedes',
    servicio: 'Infraestructura',
    estado: 'ACTIVE',
    jefe: 5,
    bac: 6_800_000,
    empiezaHace: 4,
    dura: 8,
    hechos: 2,
    rebaseline: false,
  },
  {
    codigo: 'SEG26',
    nombre: 'Implantación de ISO 27001',
    servicio: 'Seguridad',
    estado: 'ACTIVE',
    jefe: 8,
    bac: 4_200_000,
    empiezaHace: 5,
    dura: 14,
    hechos: 1,
    rebaseline: false,
  },
  {
    codigo: 'PUE26',
    nombre: 'Renovación del puesto de trabajo',
    servicio: 'Puesto de trabajo',
    estado: 'DELIVERED',
    jefe: 3,
    bac: 3_100_000,
    empiezaHace: 11,
    dura: 6,
    hechos: 4,
    rebaseline: false,
  },
  {
    codigo: 'BI26',
    nombre: 'Cuadro de mando de negocio',
    servicio: 'Datos',
    estado: 'PLANNED',
    jefe: 6,
    bac: 2_400_000,
    empiezaHace: -1,
    dura: 9,
    hechos: 0,
    rebaseline: false,
  },
];

export const NOMBRES_HITO = ['Análisis', 'Diseño', 'Construcción', 'Pruebas'] as const;
export const PESOS_HITO = [2_000, 2_000, 4_000, 2_000] as const;
