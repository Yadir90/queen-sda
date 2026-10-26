// Declaraciones de tipos para el núcleo de sincronización syncCore.mjs
import type {
  DayData, Expense, LocalPayment, PayrollEmployee, PayrollRecord, PersonAlias, Receivable, Worker,
} from '../types'

export interface CuentasEntry {
  date: string
  entryKey: string
  rawName: string
  amount: number
  concept: string
  classification: string
  defaultClassification: string
  overridden: boolean
  learned: boolean
  needsDecision: boolean
  sourceKey: string
  paidOk: boolean
  gastoObs: boolean
  persona: boolean
}

export interface SyncState {
  days: DayData[]
  receivables: Receivable[]
  localPayments: LocalPayment[]
  expenses: Expense[]
  workers: Array<Omit<Worker, 'roleKind'> & { roleKind?: string }>
  aliases: Record<string, PersonAlias>
  learnedKinds: Record<string, string>
  cuentasOverrides: Record<string, string>
  suppressedEntries: string[]
  payrollHistory: PayrollRecord[]
  accountSyncDates?: string[]
}

export interface SyncResult {
  receivables: Receivable[]
  localPayments: LocalPayment[]
  expenses: Expense[]
  cuentasEntries: CuentasEntry[]
  aliases: Record<string, PersonAlias>
  newAliases: Record<string, PersonAlias>
  createdReceivableIds: string[]
  updatedReceivableIds: string[]
  deletedReceivableIds: string[]
  createdExpenseIds: string[]
  updatedExpenseIds: string[]
  deletedExpenseIds: string[]
}

export declare function syncDerivedData(state: SyncState): SyncResult
export declare function applyImportedPaidAccounts(
  receivables: Receivable[],
  day: DayData,
): { receivables: Receivable[]; paid: number; skipped: number; unmatched: number }
export declare function buildWorkersRegistry(
  importedWorkers: Array<Omit<Worker, 'roleKind'> & { roleKind?: string }>,
  days: DayData[],
  payrollHistory: PayrollRecord[],
  anchor?: string,
): Worker[]
export declare function buildMarksByWorker(days: DayData[]): Record<string, Record<string, number>>
export declare function buildCuentasEntries(
  days: DayData[],
  opts?: {
    learnedKinds?: Record<string, string>
    overrides?: Record<string, string>
    knownPersons?: Set<string>
    suppressed?: string[]
  },
): CuentasEntry[]
export declare function deriveSuppressedEntries(
  days: DayData[],
  entrySourceKeys: string[],
  opts?: {
    learnedKinds?: Record<string, string>
    overrides?: Record<string, string>
    knownPersons?: Set<string>
  },
): string[]

export declare function addDaysISO(iso: string, n: number): string
export declare function diffDays(a: string, b: string): number
export declare function clientKeyOf(name: string): string
export declare function firstNameKeyOf(name: string): string
export declare function canonicalPersonKey(storedKey: string | null | undefined, fallbackName?: string): string
export declare function isDirectionPerson(nameOrKey: string): boolean
export declare function cycleIndexFor(anchor: string, date: string): number
export declare function cycleWindow(anchor: string, idx: number): { start: string; end: string; payDate: string }
export declare function cycleForDate(anchor: string, date: string): { start: string; end: string; payDate: string }

export interface DerivedPayrollEmployee extends PayrollEmployee {
  key: string
  direccion: boolean
  noPagado: boolean
}
export interface DerivedPayroll {
  cycleStart: string
  cycleEnd: string
  payDate: string
  photoDate: string | null
  fromAdjustment: boolean
  employees: DerivedPayrollEmployee[]
  total: number
  excludedTotal: number
  payrollCount: number
}
export declare function deriveCyclePayroll(
  days: DayData[],
  cycleStart: string,
  opts?: { adjustment?: PayrollEmployee[] | null; unpaidKeys?: string[] },
): DerivedPayroll
export declare function recordedPayroll(payrollHistory: PayrollRecord[], cycleStart: string): PayrollRecord | null
