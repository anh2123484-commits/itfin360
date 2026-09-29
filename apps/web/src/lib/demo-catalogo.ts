import type { SpendConcept } from '@itfin360/finance-core';

/**
 * Quién trabaja en el departamento ficticio y a quién se le compra.
 *
 * Los proveedores son inventados: ninguna factura de este conjunto lleva el
 * nombre de una empresa que exista. Una factura ficticia a nombre de alguien
 * real es un documento falso, aunque esté en una base de datos de pruebas.
 */

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
