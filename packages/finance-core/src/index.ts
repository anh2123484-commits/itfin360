/**
 * Motor de cálculo puro de ITFin360 (`docs/02-modelo-financiero.md`).
 *
 * Este paquete no hace I/O: sin Prisma, sin `fetch` y sin `Date.now()`;
 * la fecha de cálculo siempre entra como parámetro.
 */

export {
  addCents,
  allocateByLargestRemainder,
  cents,
  convert,
  currencyCode,
  money,
  multiplyCents,
  roundHalfUp,
  subtractCents,
  ZERO_CENTS,
  type Cents,
  type CurrencyCode,
  type ExchangeRate,
  type Money,
} from './money.js';

export {
  MONTHS_IN_PERIOD,
  normalizeRecurring,
  portfolioMonthlyCents,
  spreadRecurring,
  type NormalizedRecurring,
  type Periodicity,
  type RecurringContract,
} from './recurring.js';

export {
  accruedInPeriod,
  accrualSpread,
  type AccrualEntry,
  type AccrualInput,
  type ServicePeriod,
} from './accrual.js';

export {
  DEFAULT_HARDWARE_INFLATION_RATE,
  DEFAULT_USEFUL_LIFE_MONTHS,
  depreciationSchedule,
  monthlyDepreciationCents,
  netBookValueAt,
  replacementCost,
  technicalDebt,
  type AssetCategory,
  type AssetForDebt,
  type AssetStatus,
  type DepreciationEntry,
  type DepreciationInput,
  type TechnicalDebtConfig,
  type TechnicalDebtResult,
} from './depreciation.js';

export {
  DEFAULT_COLLECTIVE_AGREEMENT_HOURS,
  DEFAULT_EMPLOYER_SS_RATE,
  DEFAULT_PRODUCTIVITY_FACTOR,
  DEFAULT_SS_BREAKDOWN,
  MIN_EMPLOYEES_FOR_AGGREGATE,
  employerCost,
  internalHourlyRate,
  productiveHours,
  roleHourlyRate,
  socialSecurityRate,
  workplaceCost,
  type EmployerCost,
  type EmployerCostInput,
  type ProductiveHours,
  type ProductiveHoursInput,
  type RoleHourlyRate,
  type RoleMember,
  type SocialSecurityBreakdown,
  type WorkplaceCostInput,
} from './personnel.js';

/** Identificador del paquete, útil para trazas y diagnósticos. */
export const FINANCE_CORE_PACKAGE = '@itfin360/finance-core' as const;
