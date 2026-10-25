// Queen SDA — utilidades de formato y cálculo compartidas por las pantallas.

import type { LocalPayment, Receivable } from '../types'

const fmtNum = new Intl.NumberFormat('es-CU', { maximumFractionDigits: 0 })

export function fmtCUP(value: number): string {
  return `${fmtNum.format(Math.round(value))} CUP`
}

export function fmtInt(value: number): string {
  return fmtNum.format(Math.round(value))
}

/** Fecha ISO (yyyy-mm-dd) de hoy en hora local. */
export function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${months[m - 1]} de ${y}`
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

/** Fecha de vencimiento (ISO) o null si la categoría no tiene plazo. */
export function dueDate(rec: Receivable): string | null {
  const plazo = plazoDias(rec.category)
  if (plazo === null || !rec.date) return null
  const d = new Date(`${rec.date}T12:00:00`)
  d.setDate(d.getDate() + plazo)
  return d.toISOString().slice(0, 10)
}

/** Morosa = pendiente y pasada de su plazo (a la fecha de referencia). */
export function isMorosa(rec: Receivable, saldo: number, refDate: string): boolean {
  if (rec.status === 'pagada' || rec.closeKind || saldo <= 0) return false
  const due = dueDate(rec)
  return due !== null && refDate > due
}

/** 0..1 — qué tan cerca está del vencimiento (para el degradado verde→rojo). */
export function agingRatio(rec: Receivable, refDate: string): number {
  const plazo = plazoDias(rec.category)
  if (plazo === null || !rec.date) return 0
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
