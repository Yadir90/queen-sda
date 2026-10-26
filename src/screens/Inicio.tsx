import { useMemo, useState } from 'react'
import type { Section, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { ColumnChart, RowChart, ChartCard, DayPulse, MonthHeatMap, ProgressRing, CashBars, LuminousBars, FutureCard, DeptCompareChart, BucketCompareChart, buildRiver, buildCategoryBars, type ChartDatum, type HeatDay } from '../components/charts'
import { DayTimeline, NightCloseConsole, type CloseStep, type TimelineEvent } from '../components/homeMirror'
import '../components/homeMirror.css'
import { dueDate, effectiveSaldo, fmtCUP, fmtDate, fmtDateListEs, fmtDateShort, fmtInt, isMorosa, todayISO } from '../lib/utils'
import { downloadBlob, printHtml } from '../lib/download'
import { logActivity } from '../lib/activityLog'

/* Inicio (panorama) — orden de bloques del sistema original:
   selector de período · línea de cobertura · (mes) este mes vs el
   anterior · acciones rápidas · resumen de hoy · «El negocio en
   gráficos» (DayPulse, tres anillos, mapa térmico) · «DE UN VISTAZO»
   «El día y su cierre» (DayTimeline + NightCloseConsole) · alerta en
   rojo (fx-vital-alert) · tarjetas de gráficos del período · CashBars
   y LuminousBars · «De dónde salen los totales de cuentas» ·
   comparador de períodos · medidores de fondos · botón «+».
   SIN «De un vistazo» en Inicio: en el original vive solo en Sistema.
   Todo sale de los datos reales importados: un día ausente no cuenta
   como venta 0 y ninguna cifra se inventa. */

type PeriodType = 'dia' | 'semana' | 'quincena' | 'mes' | 'trimestre'
const PERIOD_TYPES: Array<{ id: PeriodType; label: string }> = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'quincena', label: 'Quincena' },
  { id: 'mes', label: 'Mes' },
  { id: 'trimestre', label: 'Trimestre' },
]
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function parseISO(iso: string): Date { return new Date(`${iso}T12:00:00`) }
function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function addDays(iso: string, n: number): string { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
function monthKey(iso: string): string { return iso.slice(0, 7) }
function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate() }

function rangeFor(type: PeriodType, anchor: string): { from: string; to: string; label: string } {
  const d = parseISO(anchor)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  if (type === 'dia') return { from: anchor, to: anchor, label: fmtDate(anchor) }
  if (type === 'semana') {
    const dow = (d.getDay() + 6) % 7 // lunes = 0
    const from = addDays(anchor, -dow)
    const to = addDays(from, 6)
    return { from, to, label: `Semana del ${fmtDateShort(from)} al ${fmtDateShort(to)}` }
  }
  if (type === 'quincena') {
    if (d.getDate() <= 15) return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m - 1, 15)), label: `Quincena 1–15 de ${MONTHS[m - 1]}` }
    return { from: toISO(new Date(y, m - 1, 16)), to: toISO(new Date(y, m - 1, daysInMonth(y, m))), label: `Quincena 16–${daysInMonth(y, m)} de ${MONTHS[m - 1]}` }
  }
  if (type === 'mes') return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m - 1, daysInMonth(y, m))), label: `${MONTHS[m - 1]} de ${y}` }
  const q = Math.floor((m - 1) / 3)
  const fromM = q * 3 + 1
  const toM = fromM + 2
  const ord = ['1.er', '2.º', '3.er', '4.º'][q]
  return { from: toISO(new Date(y, fromM - 1, 1)), to: toISO(new Date(y, toM - 1, daysInMonth(y, toM))), label: `${ord} trimestre de ${y}` }
}

/** La Quincena abre la última CERRADA, no la en curso (como el original). */
function lastClosedQuincenaAnchor(today: string): string {
  const d = parseISO(today)
  if (d.getDate() > 15) return toISO(new Date(d.getFullYear(), d.getMonth(), 15))
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return toISO(new Date(prev.getFullYear(), prev.getMonth(), daysInMonth(prev.getFullYear(), prev.getMonth() + 1)))
}

/** Inicio del período siguiente/anterior a un tramo (para el comparador):
 *  +1 = el día después del fin del tramo; −1 = el tramo que contiene el
 *  día anterior a su inicio. Vale para los cinco tipos del clon. */
function shiftPeriodStart(type: PeriodType, fromISO: string, dir: number): string {
  if (dir > 0) return addDays(rangeFor(type, fromISO).to, 1)
  return rangeFor(type, addDays(fromISO, -1)).from
}

/** delta / fmtDelta de periods.ts del original, literales. */
function delta(cur: number, prev: number): { abs: number; pct: number | null } {
  const abs = cur - prev
  return { abs, pct: prev !== 0 ? (abs / Math.abs(prev)) * 100 : null }
}
function fmtDelta(cur: number, prev: number): { texto: string; mejora: boolean | null } {
  const d = delta(cur, prev)
  if (prev === 0 && cur === 0) return { texto: 'sin cambio', mejora: null }
  if (d.pct == null) return { texto: `${d.abs >= 0 ? '+' : ''}${fmtCUP(d.abs)} (sin base)`, mejora: d.abs > 0 ? true : d.abs < 0 ? false : null }
  return {
    texto: `${d.abs >= 0 ? '+' : ''}${fmtCUP(d.abs)} (${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%)`,
    mejora: d.abs > 0 ? true : d.abs < 0 ? false : null,
  }
}

export default function Inicio({ data, isAdmin, onImportClick, onNavigate }: { data: StoredData; isAdmin: boolean; onImportClick: () => void; onNavigate: (s: Section) => void }) {
  const today = todayISO()
  const lastDay = data.days.length ? data.days[data.days.length - 1] : null
  const [ptype, setPtype] = useState<PeriodType>('mes')
  const [anchor, setAnchor] = useState<string>(() => lastDay?.date ?? today)
  const [exportMsg, setExportMsg] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [compareOn, setCompareOn] = useState(false)
  const [compareFrom, setCompareFrom] = useState<string>(() => shiftPeriodStart('mes', rangeFor('mes', lastDay?.date ?? today).from, -1))

  const pending = useMemo(() => data.receivables
    .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
    .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0), [data])
  const dineroCalle = pending.filter((x) => x.rec.category === 'cliente').reduce((s, x) => s + x.saldo, 0)
  const vencidas = pending.filter((x) => isMorosa(x.rec, x.saldo, today))
  const vencidasTotal = vencidas.reduce((s, x) => s + x.saldo, 0)

  if (!lastDay) {
    return (
      <div>
        <TabHeader icon="dashboard" title="Inicio" desc="Tablero y resumen del período" badge={TAB_BADGES.panorama} />
        <Card>
          <p className="eyebrow">Inicio</p>
          <EmptyState icon="archive" title="Sin datos todavía" text="Este sistema externo aún no tiene días importados. Los datos reales entran importando el respaldo diario del SDA; aquí nunca verás cifras de ejemplo.">
            {isAdmin ? (
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={onImportClick}>Importar respaldo del SDA</button>
              </div>
            ) : (
              <p className="small muted" style={{ marginTop: 12 }}>Pídele al administrador que importe el respaldo para ver los datos.</p>
            )}
          </EmptyState>
        </Card>
      </div>
    )
  }

  const range = rangeFor(ptype, anchor)
  const inRange = (iso: string) => iso >= range.from && iso <= range.to
  const periodDays = data.days.filter((d) => inRange(d.date))
  const sum = (fn: (d: (typeof data.days)[number]) => number, days = periodDays) => days.reduce((s, d) => s + fn(d), 0)
  const ventas = sum((d) => d.ventasDia)
  const bruta = sum((d) => d.gananciaBruta)
  const neta = sum((d) => d.gananciaNeta)
  const gastosIpv = sum((d) => d.gastosIpv)

  // Cobertura: días del período transcurridos (hasta hoy) y huecos con fecha.
  const covTo = range.to < today ? range.to : today
  const covDates: string[] = []
  for (let cur = range.from; cur <= covTo; cur = addDays(cur, 1)) covDates.push(cur)
  const haveSet = new Set(data.days.map((d) => d.date))
  const missing = covDates.filter((iso) => !haveSet.has(iso))
  const periodExpensesCount = data.expenses.filter((e) => inRange(e.date)).length

  // Tramos para los gráficos de columnas.
  const buckets: ChartDatum[] = ptype === 'trimestre'
    ? (() => {
        const byMonth = new Map<string, { ventas: number; bruta: number; neta: number; gastos: number }>()
        for (const d of periodDays) {
          const k = monthKey(d.date)
          const b = byMonth.get(k) ?? { ventas: 0, bruta: 0, neta: 0, gastos: 0 }
          b.ventas += d.ventasDia; b.bruta += d.gananciaBruta; b.neta += d.gananciaNeta; b.gastos += d.gastosIpv
          byMonth.set(k, b)
        }
        return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, b]) => ({
          label: MONTHS_SHORT[Number(k.slice(5)) - 1], detail: `${MONTHS[Number(k.slice(5)) - 1]} de ${k.slice(0, 4)}`,
          ventas: b.ventas, bruta: b.bruta, neta: b.neta, total: b.gastos,
        }))
      })()
    : periodDays.map((d) => ({
        label: ptype === 'dia' || ptype === 'semana' ? fmtDateShort(d.date) : String(Number(d.date.slice(8))),
        detail: fmtDate(d.date), ventas: d.ventasDia, bruta: d.gananciaBruta, neta: d.gananciaNeta, total: d.gastosIpv,
      }))

  // Departamentos del período.
  const deptMap = new Map<string, number>()
  for (const d of periodDays) for (const dep of d.departments) deptMap.set(dep.name, (deptMap.get(dep.name) ?? 0) + dep.ventas)
  const depts = [...deptMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))

  // Este mes vs el anterior (solo período Mes, con el mes del ancla).
  const anchorMonth = monthKey(anchor)
  const [ay, am] = anchorMonth.split('-').map(Number)
  const prevDate = new Date(ay, am - 2, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
  const monthDays = data.days.filter((d) => monthKey(d.date) === anchorMonth)
  const prevMonthDays = data.days.filter((d) => monthKey(d.date) === prevMonth)
  const mVentas = sum((d) => d.ventasDia, monthDays)
  const mBruta = sum((d) => d.gananciaBruta, monthDays)
  const mNeta = sum((d) => d.gananciaNeta, monthDays)
  const mResultado = mNeta - sum((d) => d.gastosIpv, monthDays)
  const pVentas = sum((d) => d.ventasDia, prevMonthDays)
  const pBruta = sum((d) => d.gananciaBruta, prevMonthDays)
  const pNeta = sum((d) => d.gananciaNeta, prevMonthDays)
  const pResultado = pNeta - sum((d) => d.gastosIpv, prevMonthDays)
  const deltaPill = (cur: number, prev: number) => {
    if (prev === 0) return null
    const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100)
    const up = cur >= prev
    return (
      <span className="delta-pill" style={{ background: up ? 'var(--turquoise-soft)' : 'var(--danger-soft)', color: up ? 'var(--deep-2)' : 'var(--danger)' }}>
        {up ? '+' : ''}{pct} %
      </span>
    )
  }

  // Mes en curso (hoy) para anillos, mapa térmico y salud.
  const curMonth = monthKey(today)
  const curMonthDays = data.days.filter((d) => monthKey(d.date) === curMonth)
  const elapsedMonthDays = Number(today.slice(8))
  const monthHeat: HeatDay[] = []
  {
    const [cy, cm] = curMonth.split('-').map(Number)
    const total = daysInMonth(cy, cm)
    const byDate = new Map(curMonthDays.map((d) => [d.date, d]))
    for (let i = 1; i <= total; i++) {
      const iso = `${curMonth}-${String(i).padStart(2, '0')}`
      const d = byDate.get(iso)
      monthHeat.push({ date: iso, ventas: d ? d.ventasDia : null, neta: d ? d.gananciaNeta : null })
    }
  }
  const covPct = elapsedMonthDays > 0 ? (curMonthDays.length / elapsedMonthDays) * 100 : 0
  const alDiaPct = pending.length > 0 ? ((pending.length - vencidas.length) / pending.length) * 100 : 100
  // NOTA «De un vistazo» (decisión documentada): en el original ese
  // panel vive SOLO en Sistema, con la salud del organismo (sistema),
  // no en Inicio. La versión anterior de Inicio promediaba tres
  // comprobaciones propias (IPV/cuadre/cuentas) y lo presentaba como
  // «salud»: eso NO es el original y se retiró. Inicio no muestra
  // ningún «De un vistazo»; la salud queda en Sistema.

  const monthVentas = sum((d) => d.ventasDia, curMonthDays)
  const monthNetaAll = sum((d) => d.gananciaNeta, curMonthDays)
  const marginPct = monthVentas > 0 ? (monthNetaAll / monthVentas) * 100 : 0
  const curMonthExpenses = data.expenses.filter((e) => monthKey(e.date) === curMonth)
  const curMonthGastos = curMonthExpenses.reduce((t, e) => t + e.total, 0)
  const curMonthExtrasList = curMonthDays.flatMap((d) => d.extras)
  // Los registrados a mano en Extras suman en la misma línea, como en
  // Economía (monthEconomy): si no, Inicio y Economía se contradicen.
  const curMonthRegistered = (data.extraIncomes ?? []).filter((x) => monthKey(x.date) === curMonth)
  const curMonthExtras = curMonthDays.reduce((t, d) => t + d.extras.reduce((u, x) => u + x.importe, 0), 0)
    + curMonthRegistered.reduce((t, x) => t + x.amount, 0)
  const monthResultado = monthNetaAll - curMonthGastos + curMonthExtras
  const mesEnRojo = monthResultado < 0 && (curMonthDays.length > 0 || curMonthExpenses.length > 0 || curMonthExtrasList.length > 0 || curMonthRegistered.length > 0)

  // Medidores de fondos (mes del ancla y su trimestre).
  const meterMonthDays = monthDays
  const meterMonthTotalDays = daysInMonth(ay, am)
  const meterMonthElapsed = anchorMonth === curMonth ? elapsedMonthDays : meterMonthTotalDays
  const qStartMonth = Math.floor((am - 1) / 3) * 3 + 1
  const quarterMonths = [0, 1, 2].map((i) => `${ay}-${String(qStartMonth + i).padStart(2, '0')}`)
  const quarterDays = data.days.filter((d) => quarterMonths.includes(monthKey(d.date)))
  const quarterNeta = sum((d) => d.gananciaNeta, quarterDays)
  const quarterTotalDays = quarterMonths.reduce((s, k) => { const [qy, qm] = k.split('-').map(Number); return s + daysInMonth(qy, qm) }, 0)
  const quarterElapsedDays = quarterMonths.includes(curMonth)
    ? quarterMonths.slice(0, quarterMonths.indexOf(curMonth)).reduce((s, k) => { const [qy, qm] = k.split('-').map(Number); return s + daysInMonth(qy, qm) }, 0) + elapsedMonthDays
    : quarterTotalDays

  const prevDay = data.days.length > 1 ? data.days[data.days.length - 2] : null
  // smartSummaries del original, literales: (1) la venta del último día
  // frente al anterior y (2) las cuentas por vencer en los próximos
  // 3 días (pendientes, no morosas, con vencimiento a 0–3 días vista).
  const smartSummaries: string[] = [
    lastDay && prevDay
      ? lastDay.ventasDia === prevDay.ventasDia
        ? `La venta del ${fmtDateShort(lastDay.date)} quedó igual que el día anterior: ${fmtCUP(lastDay.ventasDia)}.`
        : `El ${fmtDateShort(lastDay.date)} vendiste ${fmtCUP(Math.abs(lastDay.ventasDia - prevDay.ventasDia))} ${lastDay.ventasDia > prevDay.ventasDia ? 'más' : 'menos'} que el día anterior.`
      : 'Importa dos días para comparar las ventas recientes.',
    (() => {
      const dueSoon = pending.filter(({ rec }) => {
        const due = dueDate(rec)
        if (!due) return false
        const days = Math.round((parseISO(due).getTime() - parseISO(today).getTime()) / 86400000)
        return days >= 0 && days <= 3
      }).length
      return dueSoon > 0 ? `${fmtInt(dueSoon)} cuenta${dueSoon === 1 ? '' : 's'} por vencer en los próximos 3 días.` : 'No hay cuentas por vencer en los próximos 3 días.'
    })(),
  ]

  // ---- El día y su cierre (bloque literal del original) ----
  // Timed: en el original salen del outbox de correos; en el clon la
  // única hora real registrada de un envío es Bulletin.sentAt, así que
  // los boletines ENVIADOS de hoy ocupan ese carril, con su asunto y
  // sus destinatarios reales. Sin boletín enviado hoy, no hay eventos
  // con hora: no se inventa ninguna.
  const diaHoyTl = data.days.find((d) => d.date === today) ?? null
  const timedTl: TimelineEvent[] = []
  for (const b of data.bulletins) {
    if (b.status !== 'enviado' || !b.sentAt) continue
    const sent = new Date(b.sentAt)
    if (Number.isNaN(sent.getTime())) continue
    const fechaHavana = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(sent)
    if (fechaHavana !== today) continue
    const hm = new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', hour: '2-digit', minute: '2-digit', hour12: false }).format(sent)
    const [hh = 0, mm = 0] = hm.split(':').map(Number)
    timedTl.push({ id: `mail-${b.id}`, label: `Correo enviado: ${b.subject || 'informe'}`, detail: `Salió hacia ${b.recipients.join(', ') || 'su destinatario'} y el servicio lo confirmó.`, minutes: hh * 60 + mm, tone: 'ok' })
  }
  const untimedTl: TimelineEvent[] = []
  if (diaHoyTl) {
    untimedTl.push({ id: 'ipv-hoy', label: `IPV de hoy: venta ${fmtCUP(diaHoyTl.ventasDia)}`, detail: `Ganancia neta ${fmtCUP(diaHoyTl.gananciaNeta)} · cuadre ${Math.abs(diaHoyTl.cuadre) < 0.005 ? 'en cero' : `con diferencia de ${fmtCUP(diaHoyTl.cuadre)}`}.`, minutes: null, tone: Math.abs(diaHoyTl.cuadre) < 0.005 ? 'ok' : 'bad' })
    const topDep = [...diaHoyTl.departments].sort((a, b) => b.ventas - a.ventas)[0]
    if (topDep) untimedTl.push({ id: 'pico-hoy', label: `Pico del día: ${topDep.name}`, detail: `Es el departamento que más vendió hoy: ${fmtCUP(topDep.ventas)} de los ${fmtCUP(diaHoyTl.ventasDia)} del día.`, minutes: null, tone: 'info' })
  }
  const gastosHoyTl = data.expenses.filter((e) => e.date === today)
  if (gastosHoyTl.length) untimedTl.push({ id: 'gastos-hoy', label: `Gastos de hoy: ${gastosHoyTl.length} (${fmtCUP(gastosHoyTl.reduce((t, e) => t + e.total, 0))})`, detail: 'Son los gastos con fecha de hoy en la pestaña Gastos.', minutes: null, tone: 'info' })
  const cuentasHoyTl = pending.filter((x) => x.rec.date === today)
  if (cuentasHoyTl.length) untimedTl.push({ id: 'cuentas-hoy', label: `Cuentas nuevas hoy: ${cuentasHoyTl.length}`, detail: `Nacieron hoy y quedan por cobrar ${fmtCUP(cuentasHoyTl.reduce((t, x) => t + x.saldo, 0))}.`, minutes: null, tone: 'warn' })
  const boletinHoyTl = data.bulletins.some((b) => b.date === today && b.status === 'enviado')
  const stepsTl: CloseStep[] = [
    { key: 'ipv', label: 'IPV del día subido', done: !!diaHoyTl, detail: diaHoyTl ? `Ya está el IPV de hoy, con venta de ${fmtCUP(diaHoyTl.ventasDia)}.` : 'Todavía no se subió el IPV de hoy: sin él, el día no cuenta en ningún total.', actionLabel: 'Subir el IPV' },
    { key: 'cuadre', label: 'Cuadre del día en cero', done: !!diaHoyTl && Math.abs(diaHoyTl.cuadre) < 0.005, detail: diaHoyTl ? (Math.abs(diaHoyTl.cuadre) < 0.005 ? 'La caja y las ventas coinciden: diferencia de 0 CUP.' : `El cuadre tiene una diferencia de ${fmtCUP(diaHoyTl.cuadre)}: hay que revisarla antes de cerrar.`) : 'Sin IPV no hay cuadre que confirmar.', actionLabel: 'Ver en Días' },
    { key: 'gastos', label: 'Gastos del día registrados', done: gastosHoyTl.length > 0, detail: gastosHoyTl.length ? `${gastosHoyTl.length} gasto${gastosHoyTl.length === 1 ? '' : 's'} de hoy por ${fmtCUP(gastosHoyTl.reduce((t, e) => t + e.total, 0))}.` : 'Hoy no hay gastos registrados: si no hubo ninguno, déjalo así; si falta alguno, regístralo ahora.', actionLabel: 'Ir a Gastos' },
    { key: 'boletin', label: 'Boletín del día enviado', done: boletinHoyTl, detail: boletinHoyTl ? 'El boletín de hoy ya salió por correo a sus destinatarios.' : 'El boletín de hoy aún no consta enviado: se despacha desde Sistema o solo, a su hora.', actionLabel: 'Ir a Sistema' },
  ]

  // ---- Comparador de períodos (bloque literal del original) ----
  const cmpRange = rangeFor(ptype, compareFrom)
  const aggPeriod = (from: string, to: string) => {
    const days = data.days.filter((d) => d.date >= from && d.date <= to)
    const gastos = data.expenses.filter((e) => e.date >= from && e.date <= to).reduce((t, e) => t + e.total, 0)
    const extras = days.reduce((t, d) => t + d.extras.reduce((u, x) => u + x.importe, 0), 0)
    const v = days.reduce((t, d) => t + d.ventasDia, 0)
    const n = days.reduce((t, d) => t + d.gananciaNeta, 0)
    return {
      days, count: days.length, ventas: v,
      bruta: days.reduce((t, d) => t + d.gananciaBruta, 0), neta: n,
      gastos, extras, resultado: n - gastos + extras,
      promedio: days.length ? v / days.length : 0,
    }
  }
  const actualAgg = aggPeriod(range.from, range.to)
  const compareAgg = aggPeriod(cmpRange.from, cmpRange.to)
  const deptComparison = (() => {
    const names = [...new Set([...actualAgg.days, ...compareAgg.days].flatMap((d) => d.departments.map((dep) => dep.name)))]
    const deptSum = (days: typeof actualAgg.days, name: string) => days.reduce((t, d) => t + (d.departments.find((dep) => dep.name === name)?.ventas ?? 0), 0)
    return names.map((name) => ({ name, actual: deptSum(actualAgg.days, name), comparado: deptSum(compareAgg.days, name) }))
      .sort((a, b) => b.actual - a.actual)
  })()
  const comparisonMerged = (() => {
    if (ptype === 'trimestre') {
      const totalDays = Math.round((parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86400000) + 1
      const weeks = Math.ceil(totalDays / 7)
      const sumWeek = (days: typeof actualAgg.days, fromISO: string, i: number) => days.filter((d) => {
        const off = Math.round((parseISO(d.date).getTime() - parseISO(fromISO).getTime()) / 86400000)
        return off >= i * 7 && off < i * 7 + 7
      }).reduce((t, d) => t + d.ventasDia, 0)
      return Array.from({ length: weeks }, (_, i) => {
        const wStart = addDays(range.from, i * 7)
        return { label: `Sem ${i + 1} (${wStart.slice(8)}/${wStart.slice(5, 7)})`, actual: sumWeek(actualAgg.days, range.from, i), comparado: sumWeek(compareAgg.days, cmpRange.from, i) }
      })
    }
    const totalDays = Math.round((parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86400000) + 1
    return Array.from({ length: totalDays }, (_, i) => {
      const aDate = addDays(range.from, i)
      const cDate = addDays(cmpRange.from, i)
      return {
        label: aDate.slice(8),
        actual: actualAgg.days.find((d) => d.date === aDate)?.ventasDia ?? 0,
        comparado: compareAgg.days.find((d) => d.date === cDate)?.ventasDia ?? 0,
      }
    })
  })()
  const bucketLabel = ptype === 'quincena' || ptype === 'mes' ? 'por día' : ptype === 'trimestre' ? 'por semana' : 'por mes'

  const shift = (dir: number) => {
    if (ptype === 'dia') setAnchor(addDays(anchor, dir))
    else if (ptype === 'semana') setAnchor(addDays(anchor, dir * 7))
    else if (ptype === 'mes') { const d = parseISO(anchor); setAnchor(toISO(new Date(d.getFullYear(), d.getMonth() + dir, 1))) }
    else if (ptype === 'trimestre') { const d = parseISO(anchor); setAnchor(toISO(new Date(d.getFullYear(), d.getMonth() + dir * 3, 1))) }
    else setAnchor(dir > 0 ? addDays(range.to, 1) : addDays(range.from, -1))
  }
  const goCurrent = () => {
    if (ptype === 'quincena') setAnchor(lastClosedQuincenaAnchor(today))
    else setAnchor(today)
  }
  const pickType = (t: PeriodType) => {
    setPtype(t)
    const nextAnchor = t === 'quincena' ? lastClosedQuincenaAnchor(today) : anchor
    if (t === 'quincena') setAnchor(nextAnchor)
    setCompareFrom(shiftPeriodStart(t, rangeFor(t, nextAnchor).from, -1))
  }

  return (
    <div>
      <TabHeader icon="dashboard" title="Inicio" desc="Tablero y resumen del período" badge={TAB_BADGES.panorama} />

      {/* 1 · Selector de período */}
      <div className="period-nav">
        <div className="period-tabs" role="tablist" aria-label="Tipo de período">
          {PERIOD_TYPES.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={ptype === t.id} className={`period-tab ${ptype === t.id ? 'active' : ''}`} onClick={() => pickType(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="period-row">
          <button type="button" className="period-arrow" onClick={() => shift(-1)} aria-label="Período anterior"><Icon name="chevronL" size={19} /></button>
          <span className="period-label">
            {range.label}
            {range.from <= today && today <= range.to ? <span className="period-incourse">hasta la fecha</span> : null}
            <span className="period-dates">{range.from} — {range.to}</span>
            {!(range.from <= today && today <= range.to) ? (
              <button type="button" className="period-current-link" onClick={goCurrent}>Ir al actual</button>
            ) : null}
          </span>
          <button type="button" className="period-arrow" onClick={() => shift(1)} aria-label="Período siguiente"><Icon name="chevronR" size={19} /></button>
        </div>
        <p className="period-note">Todo se recalcula con los días importados del período. Los pagos de RH siguen sus ciclos de 15 días exactos («RH»), distintos de la quincena natural.</p>
      </div>

      {/* 2 · Línea de cobertura y documentos del período (textos y
          botones del original, D-66) */}
      <p className="coverage-line" role="status">
        <strong>Cobertura:</strong> {range.label}: {fmtInt(periodDays.length)} día{periodDays.length === 1 ? '' : 's'} importado{periodDays.length === 1 ? '' : 's'}
        {missing.length > 0
          ? <> — faltan {fmtDateListEs(missing.slice(0, 8))}{missing.length > 8 ? ` y ${missing.length - 8} más` : ''}</>
          : periodDays.length > 0 ? ' — sin huecos en ese tramo' : ''}.
        Un día ausente no cuenta como venta 0: los promedios son por día importado.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          type="button" className="btn primary" disabled={exportBusy || (periodDays.length === 0 && periodExpensesCount === 0)}
          onClick={() => {
            setExportBusy(true)
            void (async () => {
              try {
                const docs = await import('../lib/documentosCore.mjs')
                const rep = docs.buildPeriodInformeData(data, range.from, range.to, range.label, today)
                logActivity('exportacion', `Exportó el PDF del período (${range.label})`, { section: 'inicio' })
                setExportMsg(printHtml(docs.informeHtml(rep))
                  ? `PDF del período listo (${range.label}): se abrió la vista de impresión.`
                  : 'El navegador bloqueó la ventana del PDF. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
              } finally { setExportBusy(false) }
            })()
          }}
        >
          <Icon name="doc" size={16} /> PDF del período
        </button>
        <button
          type="button" className="btn" disabled={exportBusy || (periodDays.length === 0 && periodExpensesCount === 0)}
          onClick={() => {
            setExportBusy(true)
            void (async () => {
              try {
                const docs = await import('../lib/documentosCore.mjs')
                const rep = docs.buildPeriodInformeData(data, range.from, range.to, range.label, today)
                downloadBlob(docs.buildPptxBlob(rep), `presentacion-periodo-${range.from}.pptx`)
                logActivity('exportacion', `Exportó la presentación PowerPoint del período (${range.label})`, { section: 'inicio' })
                setExportMsg(`Presentación PowerPoint descargada con las cifras de ${range.label}.`)
              } finally { setExportBusy(false) }
            })()
          }}
        >
          <Icon name="chart" size={16} /> Presentación PowerPoint
        </button>
      </div>
      {exportMsg ? <p className="small" role="status" style={{ marginTop: -6, marginBottom: 14 }}>{exportMsg}</p> : null}

      {/* 3 · Este mes vs el anterior (solo Mes) */}
      {ptype === 'mes' && prevMonthDays.length > 0 ? (
        <Card>
          <h3>Este mes vs el anterior</h3>
          <p className="sub">{MONTHS[am - 1]} contra {MONTHS[prevDate.getMonth()]} — solo con los días importados de cada mes.</p>
          <div className="grid-2">
            <div className="stat"><div className="label">Ventas</div><div className="value">{fmtCUP(mVentas)}{deltaPill(mVentas, pVentas)}</div></div>
            <div className="stat"><div className="label">Ganancia bruta</div><div className="value">{fmtCUP(mBruta)}{deltaPill(mBruta, pBruta)}</div></div>
            <div className="stat"><div className="label">Ganancia neta</div><div className="value">{fmtCUP(mNeta)}{deltaPill(mNeta, pNeta)}</div></div>
            <div className="stat"><div className="label">Resultado (neta − gastos del IPV)</div><div className="value">{fmtCUP(mResultado)}{deltaPill(mResultado, pResultado)}</div></div>
          </div>
        </Card>
      ) : null}

      {/* 4 · Acciones rápidas */}
      <div className="quick-grid">
        <button type="button" className="quick-action" onClick={onImportClick}>
          <span className="qa-ico"><Icon name="upload" size={20} /></span>
          <span><span className="qa-label">Importar IPV</span><br /><span className="qa-sub">Respaldo diario del SDA</span></span>
        </button>
        <button type="button" className="quick-action" onClick={() => onNavigate('cuentas')}>
          <span className="qa-ico"><Icon name="wallet" size={20} /></span>
          <span><span className="qa-label">Ver cuentas</span><br /><span className="qa-sub">{fmtInt(pending.length)} pendientes · {fmtCUP(dineroCalle)} en la calle</span></span>
        </button>
        <button type="button" className="quick-action" onClick={() => onNavigate('dias')}>
          <span className="qa-ico"><Icon name="calendar" size={20} /></span>
          <span><span className="qa-label">Ver días</span><br /><span className="qa-sub">{fmtInt(data.days.length)} días importados</span></span>
        </button>
      </div>

      {/* 5 · Resumen de hoy (smart-summary del original, con su
          animación vital «respira»: fx-vital-serene de homeMirror.css) */}
      <div className="smart-summary fx-vital-serene" aria-label="Resumen inteligente de hoy">
        <div><Icon name="sparkle" size={18} /><strong>Resumen de hoy</strong></div>
        <ul>{smartSummaries.map((summary) => <li key={summary}>{summary}</li>)}</ul>
      </div>

      {/* 6 · El negocio en gráficos */}
      <Card>
        <h3>El negocio en gráficos</h3>
        <p className="sub">Pulso diario — cada día con IPV es un latido: el último día frente al anterior.</p>
        <DayPulse days={data.days.map((d) => ({ date: d.date, ventas: d.ventasDia }))} />
      </Card>
      <Card>
        <div className="rings-row">
          <ProgressRing
            label="Mes con IPV" pct={covPct} valueText={`${curMonthDays.length}/${elapsedMonthDays} días`}
            detail={`En ${MONTHS[Number(curMonth.slice(5)) - 1]} van ${elapsedMonthDays} días y hay IPV de ${curMonthDays.length}. Lo que falta no cuenta como venta 0: simplemente aún no se ha subido.`}
          />
          <ProgressRing
            label="Margen neto del mes" pct={Math.max(0, marginPct)} valueText={`${Math.round(marginPct)} %`}
            detail={`Del mes en curso: ventas ${fmtCUP(monthVentas)} y ganancia neta ${fmtCUP(monthNetaAll)}. El margen es la parte de la venta que queda como ganancia neta.`}
            color="var(--chart-deep)"
          />
          <ProgressRing
            label="Cuentas al día" pct={alDiaPct} valueText={pending.length ? `${pending.length - vencidas.length}/${pending.length}` : 'Sin pendientes'}
            detail={pending.length ? `De ${fmtInt(pending.length)} cuentas pendientes, ${fmtInt(vencidas.length)} están fuera de plazo por ${fmtCUP(vencidasTotal)}. Las demás siguen dentro de su plazo (clientes 7 días, trabajadores 15).` : 'No hay cuentas pendientes de cobro: todo está al día.'}
            color="var(--chart-turquoise)"
          />
        </div>
      </Card>
      <Card>
        <MonthHeatMap days={monthHeat} monthKey={curMonth} todayISO={today} compact />
      </Card>

      {/* 7 · «El día y su cierre» (DayTimeline + NightCloseConsole del
          original, tras «El negocio en gráficos» como en el original).
          SIN «De un vistazo» aquí: ese panel es de Sistema. */}
      <section aria-label="El día y su cierre" style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
        <DayTimeline events={[...timedTl, ...untimedTl]} dayLabel="hoy" />
        <NightCloseConsole steps={stepsTl} dayLabel="hoy" onAction={(key) => (key === 'ipv' ? onImportClick() : key === 'cuadre' ? onNavigate('dias') : key === 'gastos' ? onNavigate('economia') : onNavigate('sistema'))} />
      </section>

      {/* 8 · El mes va en rojo (fx-vital-alert del original) */}
      {mesEnRojo ? (
        <Card className="alert-red fx-vital-alert">
          <div role="alert" aria-label="El mes va en rojo">
            <h3 style={{ color: 'var(--danger)' }}>Este mes va en rojo: {fmtCUP(monthResultado)}</h3>
            <p className="sub">
              Acumulado de {MONTHS[Number(curMonth.slice(5)) - 1]} de {curMonth.slice(0, 4)} hasta hoy: ganancia neta {fmtCUP(monthNetaAll)} − gastos {fmtCUP(curMonthGastos)} + otros ingresos {fmtCUP(curMonthExtras)}.
              El aviso aparece en cuanto el acumulado se pone negativo — sin esperar al cierre del mes ni de la quincena — y se mantiene mientras el mes siga en rojo. Queen también lo deja en su bandeja.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => onNavigate('economia')}>Ver los gastos</button>
              <button type="button" className="btn" onClick={() => onNavigate('queen')}>Ver el aviso en Queen</button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* 9 · Tarjetas de gráficos del período */}
      <ChartCard title={`Ventas ${ptype === 'trimestre' ? 'por mes' : 'por día'}`} sub="Cada barra es un tramo del período elegido, tal como viene en el respaldo.">
        <ColumnChart data={buckets} series={[{ key: 'ventas', label: 'Venta', color: 'var(--chart-green)' }]} ariaLabel="Ventas por tramo" />
      </ChartCard>
      <ChartCard title="Ganancia (bruta y neta)" sub="Las dos ganancias del período, tramo a tramo.">
        <ColumnChart data={buckets} series={[{ key: 'bruta', label: 'Bruta', color: 'var(--chart-deep)' }, { key: 'neta', label: 'Neta', color: 'var(--chart-turquoise)' }]} ariaLabel="Ganancia bruta y neta por tramo" />
      </ChartCard>
      <ChartCard title="Venta por departamento" sub="Toca una fila para ver su detalle.">
        <RowChart data={depts} ariaLabel="Venta por departamento" />
      </ChartCard>
      {/* CashBars del original: sustituye a la tabla de «Fondos del
          período» (el río de caja en barras, con los datos del período). */}
      <CashBars data={buildRiver(data.days.map((d) => ({ date: d.date, ventasDia: d.ventasDia, gananciaBruta: d.gananciaBruta, gananciaNeta: d.gananciaNeta, extrasImporte: d.extras.reduce((t, x) => t + x.importe, 0) })), data.expenses, range.from, range.to)} periodLabel={range.label.toLowerCase()} />
      {/* LuminousBars del original (en Gastos vive igual, tras su
          FutureCard «Los gastos en barras»): sustituye al ColumnChart
          de gastos del IPV que había aquí. */}
      <FutureCard title="Los gastos en barras" subtitle="Cada categoría del período, en proporción a la mayor." nota="la barra más larga es la categoría donde más dinero salió en el período seleccionado arriba. Toca una barra para ver su parte del total.">
        <LuminousBars items={buildCategoryBars(data.expenses, range.from, range.to)} emptyText="Sin gastos registrados en este período: las barras se encienden cuando entre el primer gasto." />
      </FutureCard>

      {/* 10 · De dónde salen los totales de cuentas (bloque literal
          del original: solo totales; la lista cuenta por cuenta vive
          solo en «Cobrar»). */}
      <Card>
        <h3>De dónde salen los totales de cuentas</h3>
        <p className="sub">Dinero en la calle usa solo Clientes. Trabajadores y Administrativo se muestran aparte y no se suman a ese indicador.</p>
        <div className="grid-3">
          {(['cliente', 'trabajador', 'administrativo'] as const).map((cat) => {
            const rows = pending.filter((x) => x.rec.category === cat)
            const label = cat === 'cliente' ? 'Clientes' : cat === 'trabajador' ? 'Trabajadores' : 'Administrativo'
            return (
              <div className="stat" key={cat}>
                <div className="label">{label}</div>
                <div className="value">{fmtCUP(rows.reduce((t, x) => t + x.saldo, 0))}</div>
                <div className="hint">{rows.length ? `${fmtInt(rows.length)} cuenta${rows.length === 1 ? '' : 's'} pendiente${rows.length === 1 ? '' : 's'} · el detalle está en «Cobrar»` : 'Sin cuentas pendientes.'}</div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 10b · Comparar con otro período (bloque literal del original:
          tabla de indicadores con variación + DeptCompareChart y
          BucketCompareChart alimentados de los períodos reales). */}
      <section className="card" aria-label="Comparación de períodos">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Comparar con otro {PERIOD_TYPES.find((t) => t.id === ptype)?.label.toLowerCase()}</h3>
          <button type="button" className={`btn${compareOn ? ' primary' : ''}`} onClick={() => setCompareOn((v) => !v)} aria-pressed={compareOn}>
            {compareOn ? 'Comparación activa' : 'Activar comparación'}
          </button>
        </div>
        {!compareOn ? (
          <p className="sub" style={{ margin: 0 }}>Actívala para ver este período lado a lado con otro del mismo tipo (otro mes, trimestre, semestre o año), con variación absoluta y en %.</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button type="button" className="period-arrow" onClick={() => setCompareFrom((f) => shiftPeriodStart(ptype, f, -1))} aria-label="Período comparado anterior"><Icon name="chevronL" size={18} /></button>
              <p style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1, textAlign: 'center', margin: 0 }}>
                Comparado: {cmpRange.label}
                <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 400, color: 'var(--dim)' }}>{cmpRange.from} — {cmpRange.to}</span>
              </p>
              <button type="button" className="period-arrow" onClick={() => setCompareFrom((f) => shiftPeriodStart(ptype, f, 1))} aria-label="Período comparado siguiente"><Icon name="chevronR" size={18} /></button>
            </div>
            {actualAgg.count === 0 || compareAgg.count === 0 ? (
              <p className="sub" style={{ color: 'var(--danger)', margin: 0 }} role="alert">
                Falta data en {actualAgg.count === 0 ? `«${range.label}»` : `«${cmpRange.label}»`}: no hay días importados en ese período, así que no se calcula ninguna variación.
              </p>
            ) : (
              <>
                <p className="coverage-line" role="status">
                  <strong>Cobertura:</strong> {range.label}: {fmtInt(actualAgg.count)} día{actualAgg.count === 1 ? '' : 's'} importado{actualAgg.count === 1 ? '' : 's'} vs {cmpRange.label}: {fmtInt(compareAgg.count)} día{compareAgg.count === 1 ? '' : 's'}.
                  {actualAgg.count !== compareAgg.count ? ' La variación es solo indicativa de los días cargados: un período incompleto no se compara como si estuviera completo.' : ''}
                </p>
                <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                  <table className="rh-table">
                    <thead>
                      <tr><th>Indicador</th><th style={{ textAlign: 'right' }}>Actual</th><th style={{ textAlign: 'right' }}>Comparado</th><th style={{ textAlign: 'right' }}>Variación</th></tr>
                    </thead>
                    <tbody>
                      {([
                        ['Ventas', actualAgg.ventas, compareAgg.ventas],
                        ['Ganancia bruta', actualAgg.bruta, compareAgg.bruta],
                        ['Ganancia neta', actualAgg.neta, compareAgg.neta],
                        ['Gastos registrados', actualAgg.gastos, compareAgg.gastos],
                        ['Resultado (neta − gastos + extras)', actualAgg.resultado, compareAgg.resultado],
                        ['Promedio diario', actualAgg.promedio, compareAgg.promedio],
                      ] as Array<[string, number, number]>).map(([label, a, b]) => {
                        const d = fmtDelta(a, b)
                        const dd = delta(a, b)
                        return (
                          <tr key={label}>
                            <td style={{ fontWeight: 500 }}>{label}</td>
                            <td style={{ textAlign: 'right' }}>{fmtInt(a)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtInt(b)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: d.mejora == null ? undefined : d.mejora ? 'var(--accent)' : 'var(--danger)' }}>
                              {d.texto}<span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{dd.abs >= 0 ? ' (sube)' : ' (baja)'}</span>
                            </td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td style={{ fontWeight: 500 }}>Días con datos</td>
                        <td style={{ textAlign: 'right' }}>{actualAgg.count}</td>
                        <td style={{ textAlign: 'right' }}>{compareAgg.count}</td>
                        <td style={{ textAlign: 'right' }}>{actualAgg.count - compareAgg.count >= 0 ? '+' : ''}{actualAgg.count - compareAgg.count}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {actualAgg.count !== compareAgg.count ? (
                  <p className="small muted" style={{ marginBottom: 12 }}>
                    Ojo: {range.label} tiene {fmtInt(actualAgg.count)} día{actualAgg.count === 1 ? '' : 's'} importado{actualAgg.count === 1 ? '' : 's'} y {cmpRange.label} tiene {fmtInt(compareAgg.count)}; la variación es solo indicativa de los días cargados hasta completar ambos.
                  </p>
                ) : null}
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' }}>
                  <ChartCard title="Ventas por departamento: actual vs comparado">
                    <DeptCompareChart data={deptComparison} />
                  </ChartCard>
                  <ChartCard title={`Ventas ${bucketLabel}: actual vs comparado`}>
                    <BucketCompareChart data={comparisonMerged} />
                  </ChartCard>
                </div>
              </>
            )}
          </>
        )}
      </section>

      {/* 11 · Fondos económicos (medidores del original) */}
      <Card>
        <h3>Fondos económicos</h3>
        <div className="meter">
          <div className="meter-head"><span className="meter-name">Fondo de ventas del mes</span><span className="meter-pct">10 % de las ventas</span></div>
          <p className="meter-figure">{fmtCUP(mVentas * 0.1)}</p>
          <p className="meter-sub">El 10 % de las ventas de {MONTHS[am - 1]} ({fmtCUP(mVentas)} con {fmtInt(meterMonthDays.length)} días importados).</p>
          <div className="meter-track"><span className="meter-fill" style={{ width: `${meterMonthTotalDays > 0 ? Math.min(100, (meterMonthElapsed / meterMonthTotalDays) * 100) : 0}%` }} /></div>
          <p className="meter-foot">{fmtInt(meterMonthDays.length)} días con IPV / {fmtInt(meterMonthTotalDays)} días al cierre del mes.</p>
        </div>
        <div className="meter">
          <div className="meter-head"><span className="meter-name">Fondo de utilidades del trimestre</span><span className="meter-pct">15 % de las utilidades</span></div>
          <p className="meter-figure">{fmtCUP(quarterNeta * 0.15)}</p>
          <p className="meter-sub">El 15 % de la ganancia neta del trimestre ({fmtCUP(quarterNeta)} con {fmtInt(quarterDays.length)} días importados).</p>
          <div className="meter-track"><span className="meter-fill" style={{ width: `${quarterTotalDays > 0 ? Math.min(100, (quarterElapsedDays / quarterTotalDays) * 100) : 0}%` }} /></div>
          <p className="meter-foot">{fmtInt(quarterDays.length)} días con IPV / {fmtInt(quarterTotalDays)} días al cierre del trimestre.</p>
        </div>
      </Card>

      {/* 12 · Botón «+» al final, en el flujo (solo móvil en el original) */}
      <button type="button" className="fab-plus" onClick={onImportClick} aria-label="Importar IPV">
        <Icon name="plus" size={26} />
      </button>
    </div>
  )
}
