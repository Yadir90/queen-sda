import type { MonthEconomy } from './economiaCore.mjs'
import type { StoredData } from '../types'

export type DocumentsData = StoredData

export interface DocStyle {
  deep: string; emerald: string; accent: string; turquoise: string; gold: string
  ink: string; dim: string; bg: string; border: string
  auroraBlue: string; auroraViolet: string; menuDeep: string
  headerTitle: string; kpiValue: string; checkCircleBg: string; checkMark: string
  systemName: string; business: string
}
export const DOC_STYLE: DocStyle
export const DOC_AURORA: { css: string; cssDark: string }

export function fmtDoc(v: number): string
export function fmtDocCUP(v: number): string
export function monthLabelEs(monthKey: string): string
export function fmtFechaDoc(iso: string): string

export interface DocSigner { label: string; name: string; role: string }
export interface SignatureBlock {
  title: string
  signers: DocSigner[]
  stamp: { title: string; subtitle: string; imageAvailable: boolean; missingText: string }
  signatureImageAvailable: boolean
  pendingText: string
}
export const DOC_SIGNERS: { admin: DocSigner; economico: DocSigner; director: DocSigner }
export const DOC_STAMP_TITLE: string
export const DOC_STAMP_SUBTITLE: string
export const SIGNATURE_PENDING_TEXT: string
export const STAMP_MISSING_TEXT: string
export function signatureBlockFor(kind: 'nomina' | 'informe' | 'generico' | 'menu'): SignatureBlock | null

export interface InformeData {
  kind: 'informe'
  title: string
  monthKey: string
  monthLabel: string
  generatedAt: string
  eco: MonthEconomy
  signatures: SignatureBlock | null
}
export function buildInformeData(data: DocumentsData, monthKey: string, today: string): InformeData

export interface NominaEmployeeDoc {
  name: string
  position: string
  daysWorked: number
  dailySalary: number | null
  total: number
  cashAmount: number
  transferAmount: number
}
export interface NominaDocumento {
  kind: 'nomina'
  title: string
  cycleStart: string
  cycleEnd: string
  payDate: string
  recorded: boolean
  employees: NominaEmployeeDoc[]
  total: number
  totalDias: number
  totalEfectivo: number
  totalTransferencia: number
  mixed: boolean
  signatures: SignatureBlock | null
}
export function buildNominaDocumento(data: DocumentsData, cycleStart?: string): NominaDocumento | null
export interface PayrollCycleOption { cycleStart: string; cycleEnd: string; payDate: string; total: number; recorded: boolean }
export function payrollCyclesAvailable(data: DocumentsData): PayrollCycleOption[]

export interface MenuItemDoc { name: string; price: number; description: string }
export interface MenuData {
  kind: 'menu'
  title: string
  dateLabel: string
  sections: Array<{ section: string; families: Array<{ family: string; items: MenuItemDoc[] }> }>
  itemCount: number
  excluded: Array<{ name: string; rule: string }>
  signatures: null
}
export const MENU_SECTION_ORDER: string[]
export function buildMenuData(data: DocumentsData, today: string): MenuData

export interface BackupExport { backupOf: string; exportedAt: string; data: Record<string, unknown> }
export function buildBackupExport(data: DocumentsData, exportedAt: string): BackupExport

export const BULLETIN_RECIPIENTS: string[]
export function bulletinSubject(dateISO: string): string

export interface BulletinStructured {
  date: string
  monthKey: string
  venta: number; bruta: number; neta: number; cuadre: number
  gastosDia: number; gastosDiaCount: number; resultadoDia: number
  inversionDia: number; mermaDia: number; extrasDia: number
  fondos: {
    efectivo: number; transferencias: number; totalCuentasPorCobrar: number; divisasCUP: number
    zelle: number; totalFondos: number; ventas: number
    billetes?: Array<{ cantidad: number; denominacion: number; subtotal: number }>
  } | null
  deptTotals: Record<string, number>
  topProducts: Array<{ name: string; dept: string; cantidad: number; importe: number }>
  dineroEnLaCalle: number
  calleDetalle: Array<{ name: string; saldo: number }>
  mes: {
    ventas: number; bruta: number; neta: number; gastos: number; extras: number; resultado: number
    billar: number; barra: number; cocina: number; inversion: number; merma: number
    totalCobrado: number; efectivoCaja: number; zelle: number; diasConIpv: number
    fondoVentas: number; fondoVentasProgreso: number; fondoUtilidades: number; fondoUtilidadesProgreso: number
  }
}

export type BulletinStatus = 'pendiente' | 'enviado' | 'error'
export interface Bulletin {
  id: string
  date: string
  status: BulletinStatus
  attempts: number
  lastError: string | null
  recipients: string[]
  subject: string
  html: string
  text: string
  structured: BulletinStructured
  createdAt: string | null
  sentAt: string | null
}

export function buildDailyBulletin(data: DocumentsData, targetDate: string, opts?: { trigger?: string; now?: string | null }): Bulletin | null
export function bulletinHtml(s: BulletinStructured, subject: string): string
export function bulletinText(s: BulletinStructured): string
export function ensureBulletinsForDays(data: DocumentsData, existing: Bulletin[], opts?: { now?: string | null }): Bulletin[]
export function regenerateBulletin(data: DocumentsData, bulletin: Bulletin): Bulletin
export function bulletinQueueSummary(bulletins: Bulletin[]): { total: number; pendientes: number; enviados: number; conError: number }
export interface BulletinTransport { send: (b: Bulletin) => Promise<void> }
export function attemptBulletinSend(queue: Bulletin[], bulletinId: string, transport: BulletinTransport | null, now?: string | null): Promise<{ queue: Bulletin[]; sent: boolean; reason: string }>

export function informeHtml(rep: InformeData): string
export function nominaHtml(doc: NominaDocumento): string
export function menuHtml(menu: MenuData): string
export function buildPptxBlob(rep: InformeData): Blob
