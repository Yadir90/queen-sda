import { useMemo, useState, type CSSProperties } from 'react'
import type { Section, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { ColumnChart, RowChart, ChartCard, DayPulse, MonthHeatMap, ProgressRing, type ChartDatum, type HeatDay } from '../components/charts'
import { effectiveSaldo, fmtCUP, fmtDate, fmtDateShort, fmtInt, isMorosa, todayISO } from '../lib/utils'

/* Inicio (panorama) — orden de bloques del sistema original:
   selector de período · línea de cobertura · (mes) este mes vs el
   anterior · acciones rápidas · resumen de hoy · «El negocio en
   gráficos» (DayPulse, tres anillos, mapa térmico) · «DE UN VISTAZO»
   con anillo de salud · alerta en rojo · tarjetas de gráficos del
   período · desglose por categoría · medidores de fondos · botón «+».
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

export default function Inicio({ data, isAdmin, onImportClick, onNavigate }: { data: StoredData; isAdmin: boolean; onImportClick: () => void; onNavigate: (s: Section) => void }) {
  const today = todayISO()
  const lastDay = data.days.length ? data.days[data.days.length - 1] : null
  const [ptype, setPtype] = useState<PeriodType>('mes')
  const [anchor, setAnchor] = useState<string>(() => lastDay?.date ?? today)
  const [whyOpen, setWhyOpen] = useState(false)

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
          <p className="eyebrow">De un vistazo</p>
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

  // Fondos del período.
  const fondos = {
    efectivo: sum((d) => d.fondos.efectivo),
    transferencias: sum((d) => d.fondos.transferencias),
    cuentas: sum((d) => d.fondos.totalCuentasPorCobrar),
    divisas: sum((d) => d.fondos.divisasCUP),
    zelle: sum((d) => d.fondos.zelle),
    total: sum((d) => d.fondos.totalFondos),
  }

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
  const squaredMonth = curMonthDays.filter((d) => d.cuadre === 0).length
  const covPct = elapsedMonthDays > 0 ? (curMonthDays.length / elapsedMonthDays) * 100 : 0
  const cuadrePct = curMonthDays.length > 0 ? (squaredMonth / curMonthDays.length) * 100 : 0
  const alDiaPct = pending.length > 0 ? ((pending.length - vencidas.length) / pending.length) * 100 : 100
  const curMonthMissing = elapsedMonthDays - curMonthDays.length
  const health = Math.round((covPct + cuadrePct + alDiaPct) / 3)
  const healthColor = health >= 85 ? 'var(--accent)' : health >= 70 ? 'var(--gold)' : health >= 50 ? '#e07b24' : 'var(--danger)'
  const attentionCount = vencidas.length + Math.max(0, curMonthMissing)
  const nowTime = new Date().toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' })

  const monthVentas = sum((d) => d.ventasDia, curMonthDays)
  const monthNetaAll = sum((d) => d.gananciaNeta, curMonthDays)
  const marginPct = monthVentas > 0 ? (monthNetaAll / monthVentas) * 100 : 0

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
  const bestDept = depts.length ? depts[0] : null
  const summaryBullets: string[] = [
    prevDay
      ? `El último día con IPV (${fmtDateShort(lastDay.date)}) vendió ${fmtCUP(lastDay.ventasDia)} — ${lastDay.ventasDia === prevDay.ventasDia ? 'lo mismo que' : lastDay.ventasDia > prevDay.ventasDia ? `${fmtCUP(lastDay.ventasDia - prevDay.ventasDia)} más que` : `${fmtCUP(prevDay.ventasDia - lastDay.ventasDia)} menos que`} el día anterior.`
      : `El último día con IPV (${fmtDateShort(lastDay.date)}) vendió ${fmtCUP(lastDay.ventasDia)}.`,
    lastDay.cuadre === 0 ? 'El cuadre del último día es exacto (0).' : `El último día trae un descuadre de ${fmtCUP(lastDay.cuadre)}: revísalo en Días.`,
    pending.length > 0 ? `Hay ${fmtInt(pending.length)} cuentas pendientes por ${fmtCUP(pending.reduce((s, x) => s + x.saldo, 0))}; el dinero en la calle (solo clientes) es ${fmtCUP(dineroCalle)}.` : 'No hay cuentas pendientes de cobro.',
    vencidas.length > 0 ? `${fmtInt(vencidas.length)} cuentas están vencidas por ${fmtCUP(vencidasTotal)}.` : 'Ninguna cuenta está vencida hoy.',
    ...(bestDept ? [`El departamento que más vendió en el período: ${bestDept.label} (${fmtCUP(bestDept.value)}).`] : []),
  ]

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
    if (t === 'quincena') setAnchor(lastClosedQuincenaAnchor(today))
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
          <span className="period-label">{range.label}</span>
          <button type="button" className="period-arrow" onClick={() => shift(1)} aria-label="Período siguiente"><Icon name="chevronR" size={19} /></button>
          <button type="button" className="btn" onClick={goCurrent}>Ir al actual</button>
        </div>
        <p className="period-note">La quincena de aquí es la natural del mes (1–15 y 16–fin de mes) y abre la última cerrada. Los ciclos de RH son de 15 días exactos con pago el día 16 y viven en su módulo: no son lo mismo.</p>
      </div>

      {/* 2 · Línea de cobertura */}
      <p className="coverage-line">
        <strong>{fmtInt(periodDays.length)} días con IPV</strong> de {fmtInt(covDates.length)} días del período.
        {missing.length > 0 ? <> Faltan: {missing.map((iso) => fmtDateShort(iso)).join(', ')} — un día ausente no cuenta como venta 0.</> : ' Sin huecos en lo transcurrido del período.'}
      </p>

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

      {/* 5 · Resumen de hoy */}
      <Card>
        <div className="smart-summary">
          <span className="ss-ico"><Icon name="sparkle" size={22} /></span>
          <div>
            <h3 style={{ marginTop: 4 }}>Resumen de hoy</h3>
            <ul>
              {summaryBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </div>
      </Card>

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

      {/* 7 · DE UN VISTAZO con anillo de salud */}
      <section className="premium-panel" aria-label="De un vistazo">
        <div className="premium-head">
          <div
            className="premium-ring"
            style={{ '--ring-color': healthColor, '--ring-deg': `${health * 3.6}deg` } as CSSProperties}
            role="img" aria-label={`Salud del sistema: ${health} de 100`}
          >
            <span><strong>{health}</strong><small>salud</small></span>
          </div>
          <div className="premium-text">
            <span className="premium-kicker"><i /> De un vistazo</span>
            <p className="premium-title">{attentionCount === 0 ? 'Todo bien' : `Hay ${fmtInt(attentionCount)} cosas que necesitan tu atención hoy`}</p>
            <p className="premium-sub">Comprobado a las {nowTime} · con los datos reales importados.</p>
            <div className="premium-actions">
              <button type="button" className="btn" onClick={() => setWhyOpen((v) => !v)} aria-expanded={whyOpen}>¿Por qué este número?</button>
              <button type="button" className="btn" onClick={() => onNavigate('queen')}>Preguntar a Queen</button>
            </div>
          </div>
        </div>
        {whyOpen ? (
          <div className="chart-selected-detail" role="status" aria-live="polite" style={{ marginTop: 14 }}>
            <p className="chart-selected-title">La salud promedia tres comprobaciones reales de este mes</p>
            <div className="chart-selected-lines">
              <div className="chart-selected-line"><span className="chart-tooltip-dot" style={{ background: 'var(--chart-green)' }} /><span>Días con IPV ({curMonthDays.length} de {elapsedMonthDays})</span><strong>{Math.round(covPct)} %</strong></div>
              <div className="chart-selected-line"><span className="chart-tooltip-dot" style={{ background: 'var(--chart-deep)' }} /><span>Días con cuadre exacto ({squaredMonth} de {curMonthDays.length})</span><strong>{Math.round(cuadrePct)} %</strong></div>
              <div className="chart-selected-line"><span className="chart-tooltip-dot" style={{ background: 'var(--chart-turquoise)' }} /><span>Cuentas al día ({pending.length - vencidas.length} de {pending.length} pendientes)</span><strong>{Math.round(alDiaPct)} %</strong></div>
            </div>
          </div>
        ) : null}
      </section>

      {/* 8 · Alerta en rojo si el mes va negativo */}
      {monthNetaAll < 0 ? (
        <Card className="alert-red">
          <h3>Este mes va en rojo</h3>
          <p className="sub">La ganancia neta acumulada del mes en curso es {fmtCUP(monthNetaAll)}. Revisa los gastos o pregúntale a Queen por el detalle.</p>
          <button type="button" className="btn" onClick={() => onNavigate('queen')}>Preguntar a Queen</button>
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
      <ChartCard title="Fondos del período" sub="Cómo se cobró lo vendido en el período, según los IPV.">
        <div>
          <div className="rec-detail" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <div className="row"><span>Efectivo</span><strong>{fmtCUP(fondos.efectivo)}</strong></div>
            <div className="row"><span>Transferencias</span><strong>{fmtCUP(fondos.transferencias)}</strong></div>
            <div className="row"><span>Cuentas por cobrar</span><strong>{fmtCUP(fondos.cuentas)}</strong></div>
            <div className="row"><span>Divisas (en CUP)</span><strong>{fmtCUP(fondos.divisas)}</strong></div>
            <div className="row"><span>Zelle</span><strong>{fmtCUP(fondos.zelle)}</strong></div>
          </div>
          <div className="fondos-total"><span>Total de fondos</span><span className="figure">{fmtCUP(fondos.total)}</span></div>
          <p className="small muted" style={{ marginBottom: 0 }}>Ventas del período: {fmtCUP(ventas)} · Ganancia bruta {fmtCUP(bruta)} · Ganancia neta {fmtCUP(neta)}.</p>
        </div>
      </ChartCard>
      {buckets.some((b) => Number(b.total) > 0) ? (
        <ChartCard title="Gastos registrados del período" sub="Los gastos que trae cada IPV del período.">
          <ColumnChart data={buckets} series={[{ key: 'total', label: 'Gastos', color: 'var(--chart-turquoise)' }]} ariaLabel="Gastos registrados por tramo" />
        </ChartCard>
      ) : null}

      {/* 10 · Desglose de cuentas por categoría */}
      <Card>
        <h3>Cuentas por categoría</h3>
        <p className="sub">Lo pendiente hoy, por tipo de cuenta. El dinero en la calle cuenta solo a los clientes.</p>
        <div className="grid-3">
          {(['cliente', 'trabajador', 'administrativo'] as const).map((cat) => {
            const rows = pending.filter((x) => x.rec.category === cat)
            const label = cat === 'cliente' ? 'Clientes' : cat === 'trabajador' ? 'Trabajadores' : 'Administrativos'
            return (
              <div className="stat" key={cat}>
                <div className="label">{label}</div>
                <div className="value">{fmtCUP(rows.reduce((s, x) => s + x.saldo, 0))}</div>
                <div className="hint">{fmtInt(rows.length)} cuentas pendientes</div>
              </div>
            )
          })}
        </div>
      </Card>

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
