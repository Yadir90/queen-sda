import type { StoredData } from '../types'

export type QueenData = StoredData

export function fmtQueen(v: number): string
export function fmtQueenCUP(v: number): string
export function normalizeQueenText(s: unknown): string
export function fmtFechaQueen(iso: string | null | undefined): string

export interface QueenStage {
  id: 'celula' | 'infante' | 'juvenil' | 'adulto' | 'maduro'
  name: string
  minScore: number
  color: string
  light: string
  description: string
}
export const QUEEN_STAGES: QueenStage[]

export interface QueenEvolutionMetric {
  key: string
  label: string
  value: number | null
  target: number
  weight: number
  measured: boolean
  detail: string
}
export interface QueenEvolutionSnapshot {
  stageId: QueenStage['id']
  stageName: string
  score: number
  measuredAt: string | null
  metrics: Record<string, number | null>
}
export interface QueenEvolution {
  stage: QueenStage
  nextStage: QueenStage | null
  score: number | null
  progressToNext: number
  metrics: QueenEvolutionMetric[]
  measuredWeight: number
  note: string
  snapshot: QueenEvolutionSnapshot | null
}
export function buildQueenEvolution(data: QueenData, refDate: string): QueenEvolution

export interface QueenDirective { id: string; category: string; title: string; rule: string }
export const QUEEN_OWNER_DIRECTIVES: QueenDirective[]

export interface QueenPermissionRule {
  actor: 'queen' | 'usuario' | 'sistema'
  domain: 'money' | 'accounts' | 'ipv' | 'dna' | 'permissions' | 'operations'
  capability: 'read' | 'write' | 'execute'
  allowed: boolean
  reason: string
}
export const QUEEN_PERMISSION_RULES: QueenPermissionRule[]
export const DOMAIN_LABELS: Record<string, string>

export interface QueenAutonomyRule { actionKey: string; area: string; level: 'autonomous' | 'notify' | 'authorize'; reason: string }
export const QUEEN_AUTONOMY_RULES: QueenAutonomyRule[]

export interface QueenOperationMode {
  key: string
  title: string
  description: string
  canDo: string[]
  cannotDo: string[]
  liveSignal: string
}
export function buildQueenOperationModes(data: QueenData): QueenOperationMode[]

export interface QueenPendingCard {
  clientKey: string
  client: string
  category: string
  persona: string | null
  total: number
  count: number
  morosas: number
  morosasTotal: number
}
export function pendingByCard(data: QueenData, refDate: string): QueenPendingCard[]
export interface QueenPendingTotals {
  cards: QueenPendingCard[]
  total: number
  count: number
  clientes: number
  trabajadores: number
  administrativos: number
  dineroEnLaCalle: number
  morosasCount: number
  morosasTotal: number
}
export function pendingTotals(data: QueenData, refDate: string): QueenPendingTotals
export function esPendienteQueen(rec: { status: string; closeKind: string | null }, saldo: number): boolean
export function esMorosaQueen(rec: { status: string; closeKind: string | null; date: string; category: string }, saldo: number, refDate: string): boolean

export interface QueenMemory {
  directives: QueenDirective[]
  learnedKinds: Array<{ key: string; kind: string }>
  aliases: Array<{ variant: string; canonicalKey: string; canonicalDisplay: string }>
  decisionsCount: number
  decisionsSample: Array<{ key: string; kind: string }>
  notTraveling: string[]
}
export function buildQueenMemory(data: QueenData): QueenMemory

export interface QueenErrorCell {
  cellKey: string
  module: string
  topic: string
  symptoms: string
  cause: string
  antibody: string
  status: string
  detections: number
}
export function buildQueenErrorBank(data: QueenData): { cells: QueenErrorCell[]; knownThreats: number }

export function missingImportDates(data: QueenData, refDate: string): { gaps: string[]; lastDay: string | null; daysCount: number }

export interface QueenObservation { kind: string; level: 'info' | 'alert' | 'suggestion'; text: string }
export function buildQueenObservations(data: QueenData, refDate: string): QueenObservation[]

export interface QueenLanguageStatus {
  deterministicReady: boolean
  configured: boolean
  channelDeployed: boolean
  providers: string[]
  note: string
}
export function queenLanguageStatus(supabaseConfigured: boolean): QueenLanguageStatus

export const QUEEN_QUICK_QUESTIONS: string[]

export interface QueenFigure { label: string; value: number | string }
export interface QueenAnswer {
  intent: string
  text: string
  figures: QueenFigure[]
  verifiedAgainst: string[]
  unverified: string[]
}
export function answerQueen(data: QueenData, question: string, opts?: { refDate?: string }): QueenAnswer

/* Consola (puerto de QueenTab del original): salud, patrones,
   anticipaciones, sugerencias, bandeja SMS y transparencia. */
export type QueenHealthState = 'healthy' | 'warning' | 'error' | 'working' | 'expectant'
export const QUEEN_HEALTH_COPY: Record<QueenHealthState, { label: string; detail: string }>
export function buildQueenHealth(data: QueenData, refDate: string): { state: QueenHealthState; label: string; detail: string }
export function queenQuestionPattern(question: string): string

export interface QueenAnticipation {
  id: string
  level: 'prioridad' | 'atencion' | 'rutina'
  title: string
  detail: string
  actionLabel: string
  tab?: string
  question?: string
  panel?: string
}
export function buildQueenAnticipations(data: QueenData, refDate: string, opts?: { freq?: Record<string, number>; openCorrections?: number; now?: { date: string; hour: number } }): QueenAnticipation[]
export function buildQueenSuggestions(data: QueenData, refDate: string): QueenObservation[]

export interface QueenSmsDue {
  clientKey: string
  client: string
  category: string
  persona: string | null
  morosas: number
  morosasTotal: number
  total: number
  transport: 'sin-transporte'
  transportLabel: string
}
export function buildQueenSmsDue(data: QueenData, refDate: string): QueenSmsDue[]

export interface QueenAnswerMeta {
  confidence: 'alta' | 'media' | 'baja'
  confidenceReason: string
  reasoningSteps: string[]
  dataUsed: string[]
  connectedInsight?: string
  proactiveSuggestion?: string
  followUp?: string
}
export function deriveQueenAnswerMeta(ans: QueenAnswer): QueenAnswerMeta

export interface QueenLearnedCorrection {
  id: string
  turnKey: string
  question: string
  pattern?: string
  correction: string
  createdAt: string
  status: string
}
export function applyQueenLearnedCorrections(ans: QueenAnswer, question: string, corrections: QueenLearnedCorrection[]): QueenAnswer
