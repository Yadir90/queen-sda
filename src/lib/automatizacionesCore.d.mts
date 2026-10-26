import type { StoredData } from '../types'
import type { Bulletin } from './documentosCore.d.mts'

export const BACKUP_RETENTION_DAYS: number
export const BACKUP_MAX_AGE_HOURS: number
export const IPV_MISSING_ALARM_TIME: string
export const PRUNE_KEEP: { immuneRuns: number; behaviorRuns: number; automationRuns: number; unusedLearningDays: number }
export const AUTOMATION_CLOUD_PENDING: string

export interface AutomationTaskDef {
  key: string
  name: string
  schedule: string
  cloud: string
}
export const AUTOMATION_TASKS: AutomationTaskDef[]

export interface AutomationRun {
  id: string
  task: string
  at: string
  status: string
  detail: string
}

export interface QueenLearningConflict {
  id: string
  text: string
  ruleId: string
  status: string
  detectedAt: string
  note: string
}
export interface QueenLearningState {
  integratedConcepts: string[]
  integratedAliases: string[]
  integratedDecisions: number
  integratedLessons: string[]
  conflicts: QueenLearningConflict[]
  lastRunAt: string | null
  runs: number
}

export interface IntegrityIssue { kind: string; detail: string }
export function listCloneIntegrityIssues(data: StoredData): IntegrityIssue[]

export interface BackupTotals {
  days: number
  from: string | null
  to: string | null
  ventas: number
  gananciaBruta: number
  gananciaNeta: number
  cuadreTotal: number
  receivables: number
}
export interface BackupVerification { ok: boolean; totals: BackupTotals; issues: string[] }
export function verifyBackupRoundTrip(backup: unknown): BackupVerification
export function buildNightlyBackup(data: StoredData, now?: Date | string): {
  backup: unknown
  filename: string
  control: BackupTotals & { allSquared: boolean }
  verification: BackupVerification
  verified: boolean
}
export function pruneBackupCopies(
  copies: Array<{ id?: string; generatedAt?: string; exportedAt?: string }>,
  now?: Date | string,
  retentionDays?: number,
): { keep: unknown[]; remove: unknown[]; copyCount: number; retentionDays: number }

export interface MaintenanceCheck { key: string; area: string; label: string; status: 'healthy' | 'warning'; detail: string }
export interface MaintenanceResult {
  at: string
  score: number
  status: 'healthy' | 'warning'
  checks: MaintenanceCheck[]
  sentinels: Array<{ key: string; area: string; status: string; detail: string; heartbeatAt: string }>
  errorBank: { cells: number; open: number }
  prunePlan: Array<{ kind: string; label: string; keep: number | null; wouldRemove: number }>
  codeOnlyNotes: string[]
  summary: string
}
export function runMaintenanceDiagnosis(data: StoredData, opts?: {
  now?: Date | string
  backupStatus?: { lastAt: string; copyCount?: number; lastVerificationOk?: boolean } | null
  backupExport?: unknown
  histories?: { immuneRuns?: number; behaviorRuns?: number; automationRuns?: number }
}): MaintenanceResult
export function pruneAutomationRuns(runs: AutomationRun[], keep?: number): AutomationRun[]

export function emptyQueenLearning(): QueenLearningState
export interface LearningLesson { id: string; text?: string; contradictsRuleId?: string }
export function runNightlyLearning(data: StoredData, prior: QueenLearningState | null, opts?: {
  now?: Date | string
  lessons?: LearningLesson[]
}): {
  state: QueenLearningState
  detail: {
    newConcepts: string[]
    newAliases: string[]
    newDecisions: number
    newLessons: string[]
    newConflicts: QueenLearningConflict[]
  }
  summary: string
}

import type { BulletinTransport } from './documentosCore.d.mts'
export function dispatchPendingBulletins(bulletins: Bulletin[], opts?: {
  transport?: BulletinTransport | ((b: Bulletin) => Promise<void>) | null
  now?: Date | string
}): Promise<{
  bulletins: Bulletin[]
  sentIds: string[]
  skipped: Array<{ id: string; reason: string }>
  transported: boolean
  reason: string
  recipients?: string[]
}>

export interface MissingIpvStatus { date: string; state: 'importado' | 'en-espera' | 'ausente'; alarm: boolean; detail: string }
export function missingIpvStatus(data: StoredData, opts?: { now?: Date | string; date?: string; time?: string }): MissingIpvStatus

export function createAutomationRun(task: string, status: string, detail: string, now?: Date | string): AutomationRun

export interface AutomationsStatus {
  tasks: Array<AutomationTaskDef & { cloudStatus: string; lastRunAt: string | null; lastStatus: string | null; lastDetail: string }>
  cloudStatus: string
  backup: { lastRunAt: string | null; detail: string }
  maintenance: { lastRunAt: string | null; detail: string }
  learning: { lastRunAt: string | null; integratedConcepts: number; integratedAliases: number; pendingConflicts: number }
  bulletins: { pending: number; lastDispatchAt: string | null; recipients: string[] }
  ipvToday: MissingIpvStatus
}
export function buildAutomationsStatus(
  data: StoredData,
  runs: AutomationRun[],
  learning: QueenLearningState | null,
  opts?: { now?: Date | string; date?: string; time?: string },
): AutomationsStatus
