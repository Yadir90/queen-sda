// Declaraciones de tipos para el núcleo compartido backupCore.mjs
import type { BackupSummary, DayData, Expense, MonthlyArchive, PayrollRecord, Receivable, ReceivablePhoto, SmsLog, SmsOutboxItem, TransferMovement, Worker, WorkerPayment } from '../types'

export declare function summarizeDays(days: Array<Record<string, unknown>>): BackupSummary
export declare function normalizeDay(d: Record<string, unknown>): DayData
export declare function normalizeReceivable(r: Record<string, unknown>): Receivable
export declare function normalizeExpense(e: Record<string, unknown>): Expense
export declare function normalizeWorkerRecord(w: Record<string, unknown>): Omit<Worker, 'roleKind'>
export declare function normalizePayroll(rec: Record<string, unknown>): PayrollRecord
export declare function isPending(rec: Receivable, effectiveSaldo: number): boolean
export declare function normalizeTransferMovements(data: unknown): TransferMovement[]
export declare function parseBackup(raw: unknown): {
  meta: { backupOf: string; exportedAt: string }
  days: DayData[]
  receivables: Receivable[]
  expenses: Expense[]
  transferMovements: TransferMovement[]
  workers: Array<Omit<Worker, 'roleKind'>>
  payrollHistory: PayrollRecord[]
  anchorDate: string | null
  learnedKinds: Record<string, string>
  cuentasOverrides: Record<string, string>
  entrySourceKeys: string[]
  expensesCount: number
  payrollCount: number
  workersCount: number
  receivablePhotos: ReceivablePhoto[]
  smsLogs: SmsLog[]
  smsOutbox: SmsOutboxItem[]
  monthlyArchives: MonthlyArchive[]
  workerPayments: WorkerPayment[]
  summary: BackupSummary
}
