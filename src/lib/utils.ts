// Queen SDA — utilidades de formato y cálculo compartidas por las pantallas.

import type { LocalPayment, Receivable } from '../types'

/* Formato numérico centralizado es-ES, como el periods.ts del original
   (antes las pantallas usaban es-CU y los núcleos es-ES: D-35). */
const fmtNum = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

/* ===== Zona horaria gobernante: America/Havana (D-04) =====
   Puerto literal de los helpers del original (havanaNow de su App.tsx y
   havanaNowParts de su servidor): «hoy» y la hora de los cálculos salen
   SIEMPRE de La Habana, nunca del reloj local del dispositivo. */
export const HAVANA_TZ = 'America/Havana'

export function havanaNow(): { date: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: HAVANA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) || 0 }
  } catch {
    const now = new Date()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return { date: `${now.getFullYear()}-${m}-${day}`, hour: now.getHours() }
  }
}

export function havanaNowParts(now: Date): { iso: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: HAVANA_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour ?? 0), minute: Number(parts.minute ?? 0) }
}

/** fmtSmsTimestamp del original: fecha y hora legibles en hora de La Habana. */
export function fmtSmsTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString('es-CU', {
    timeZone: HAVANA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtCUP(value: number): string {
  return `${fmtNum.format(Math.round(value))} CUP`
}

export function fmtInt(value: number): string {
  return fmtNum.format(Math.round(value))
}

/** Fecha ISO (yyyy-mm-dd) de hoy en America/Havana (helper gobernante
 *  del original): todas las pantallas heredan La Habana por esta vía. */
export function todayISO(): string {
  return havanaNow().date
}

/** Nombres de mes compartidos (D-39): una sola fuente para rejillas,
 *  selectores y rótulos, como el original — no una copia por pantalla. */
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const MONTH_NAMES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${months[m - 1]} de ${y}`
}

const MONTHS_ES_LIST = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** fmtDateListEs del original (App.tsx:1335): lista de fechas con fecha
 *  exacta — «2, 3, 4 y 5 de octubre» si comparten mes y año; si no,
 *  fechas cortas separadas por comas. */
export function fmtDateListEs(dates: string[]): string {
  if (!dates.length) return ''
  const sorted = [...dates].sort()
  const sameMonth = sorted.every((d) => d.slice(0, 7) === sorted[0]!.slice(0, 7))
  if (sameMonth) {
    const nums = sorted.map((d) => String(parseInt(d.slice(8, 10), 10)))
    const list = nums.length > 1 ? `${nums.slice(0, -1).join(', ')} y ${nums[nums.length - 1]}` : nums[0]!
    return `${list} de ${MONTHS_ES_LIST[parseInt(sorted[0]!.slice(5, 7), 10) - 1] ?? ''}`
  }
  return sorted.map((d) => fmtDateShort(d)).join(', ')
}

export function fmtDateShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d} ${months[(m || 1) - 1]}`
}

/** Saldo efectivo de una cuenta: saldo del respaldo menos abonos locales de Cobrar. */
export function effectiveSaldo(rec: Receivable, localPayments: LocalPayment[]): number {
  const local = localPayments.filter((p) => p.receivableId === rec.id).reduce((s, p) => s + p.amount, 0)
  return Math.max(0, rec.saldoBase - local)
}

export function effectivePayments(rec: Receivable, localPayments: LocalPayment[]) {
  const local = localPayments
    .filter((p) => p.receivableId === rec.id)
    .map((p) => ({ id: p.id, amount: p.amount, paidDate: p.date, paymentMethod: p.method, local: true }))
  return [...rec.payments, ...local].sort((a, b) => a.paidDate.localeCompare(b.paidDate))
}

/** Plazo en días según la categoría: clientes 7, trabajadores 15, administrativos sin plazo definido. */
export function plazoDias(category: Receivable['category']): number | null {
  if (category === 'cliente') return 7
  if (category === 'trabajador') return 15
  return null
}

/** Suma días HÁBILES (sin sábado ni domingo), como el original. */
export function addBusinessDaysISO(desdeISO: string, amount: number): string {
  const date = new Date(`${desdeISO}T12:00:00`)
  let added = 0
  while (added < Math.max(0, amount)) {
    date.setDate(date.getDate() + 1)
    const weekday = date.getDay()
    if (weekday !== 0 && weekday !== 6) added++
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Días hábiles transcurridos entre dos fechas (el del original). */
export function businessDaysElapsed(desdeISO: string, hoyISO: string): number {
  if (hoyISO <= desdeISO) return 0
  const cursor = new Date(`${desdeISO}T12:00:00`)
  const end = new Date(`${hoyISO}T12:00:00`)
  let count = 0
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    const weekday = cursor.getDay()
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

/** Fecha de vencimiento (ISO) o null si la categoría no tiene plazo.
 *  Trabajadores: 15 días HÁBILES desde la creación (regla del
 *  original — addBusinessDays); clientes: 7 días naturales. */
export function dueDate(rec: Receivable): string | null {
  const plazo = plazoDias(rec.category)
  if (plazo === null || !rec.date) return null
  if (rec.category === 'trabajador') return addBusinessDaysISO(rec.date, plazo)
  const d = new Date(`${rec.date}T12:00:00`)
  d.setDate(d.getDate() + plazo)
  /* Sin toISOString(): es UTC y podía desplazar el día según la zona
     del dispositivo; se compone con las partes locales del mediodía. */
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Morosa = pendiente y pasada de su plazo (a la fecha de referencia),
 *  o marcada a mano (toggleMorosa del original: en el Archivo de
 *  morosas aunque el plazo no haya vencido). */
export function isMorosa(rec: Receivable, saldo: number, refDate: string): boolean {
  if (rec.status === 'pagada' || rec.closeKind || saldo <= 0) return false
  if (rec.isMorosa) return true
  const due = dueDate(rec)
  return due !== null && refDate > due
}

/** 0..1 — qué tan cerca está del vencimiento (el progreso de
 *  vigenciaCuenta del original: días hábiles para trabajadores,
 *  naturales para clientes). */
export function agingRatio(rec: Receivable, refDate: string): number {
  const plazo = plazoDias(rec.category)
  if (plazo === null || !rec.date) return 0
  if (rec.category === 'trabajador') {
    return Math.min(1, Math.max(0, businessDaysElapsed(rec.date, refDate) / plazo))
  }
  const start = new Date(`${rec.date}T12:00:00`).getTime()
  const ref = new Date(`${refDate}T12:00:00`).getTime()
  const elapsed = (ref - start) / 86400000
  return Math.min(1, Math.max(0, elapsed / plazo))
}

export const CATEGORY_LABEL: Record<Receivable['category'], string> = {
  cliente: 'Clientes',
  trabajador: 'Trabajadores',
  administrativo: 'Administrativos',
}
export const CATEGORY_SINGULAR: Record<Receivable['category'], string> = {
  cliente: 'Cliente',
  trabajador: 'Trabajador',
  administrativo: 'Administrativo',
}
