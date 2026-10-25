// Declaraciones de tipos para el núcleo compartido backupCore.mjs
import type { BackupSummary, DayData, Receivable } from '../types'

export declare function summarizeDays(days: Array<Record<string, unknown>>): BackupSummary
export declare function normalizeDay(d: Record<string, unknown>): DayData
export declare function normalizeReceivable(r: Record<string, unknown>): Receivable
export declare function isPending(rec: Receivable, effectiveSaldo: number): boolean
export declare function parseBackup(raw: unknown): {
  meta: { backupOf: string; exportedAt: string }
  days: DayData[]
  receivables: Receivable[]
  expensesCount: number
  payrollCount: number
  workersCount: number
  summary: BackupSummary
}
