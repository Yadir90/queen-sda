/* Gráficos del SDA original, portados de client/src/charts.tsx y
   client/src/futureCharts.tsx. HTML/CSS/SVG nativos, sin librerías.
   Contrato de interacción del original: TOCAR = DETALLE — cada marca es
   un <button> real con aria-label completo; al tocarla queda seleccionada
   y DEBAJO del gráfico aparece el panel de detalle (aria-live=polite);
   sin selección, el panel muestra la pista «Toca una barra…».
   Sin datos → «Sin datos para representar en este período.»: nunca se
   dibuja un gráfico vacío ni con ceros inventados. */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { fmtCUP, fmtInt } from '../lib/utils'

export const CHART_COLOR = {
  green: 'var(--chart-green)',
  deep: 'var(--chart-deep)',
  turquoise: 'var(--chart-turquoise)',
  gray: 'var(--chart-gray)',
} as const

const compactFmt = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })
export const fmtCompact = (n: number): string => compactFmt.format(n)

export type ChartSeries = { key: string; label: string; color: string }
export type ChartDatum = { label: string; detail?: string; [key: string]: string | number | undefined }
type DetailLineData = { label: string; value: number; color: string }

export function ChartEmpty() {
  return <div className="chart-empty">Sin datos para representar en este período.</div>
}

function DetailPanel({ heading, lines, noun = 'barra' }: { heading?: string; lines?: DetailLineData[]; noun?: string }) {
  if (!heading || !lines?.length) return <p className="chart-hint">Toca una {noun} para ver el detalle.</p>
  return (
    <div className="chart-selected-detail" role="status" aria-live="polite">
      <p className="chart-selected-title">{heading}</p>
      <div className="chart-selected-lines">
        {lines.map((line) => (
          <div className="chart-selected-line" key={line.label}>
            <span className="chart-tooltip-dot" style={{ background: line.color }} />
            <span>{line.label}</span>
            <strong>{fmtInt(line.value)} CUP</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Línea de detalle en frase (DayPulse / MonthHeatMap), con aria-live. */
export function DetailLine({ text }: { text: string | null }) {
  if (!text) return null
  return <p role="status" aria-live="polite" className="chart-detail-line">{text}</p>
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null
  return (
    <div className="lite-chart-legend">
      {series.map((s) => (
        <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  )
}

/** Columnas píldora del original: media marcada estilo Samsung Health
 *  (solo una serie y ≥3 marcas), modo denso automático con ≥20 datos. */
export function ColumnChart({ data, series, ariaLabel, angled = false }: { data: ChartDatum[]; series: ChartSeries[]; ariaLabel: string; angled?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)
  if (!data.length) return <ChartEmpty />
  const maximum = Math.max(1, ...data.flatMap((row) => series.map((s) => Math.max(0, Number(row[s.key]) || 0))))
  const picked = selected == null ? undefined : data[selected]
  const lines = picked ? series.map((s) => ({ label: s.label, value: Number(picked[s.key]) || 0, color: s.color })) : undefined
  const only = series.length === 1 ? series[0] : undefined
  const average = only && data.length >= 3 ? data.reduce((sum, row) => sum + Math.max(0, Number(row[only.key]) || 0), 0) / data.length : null
  return (
    <>
      <Legend series={series} />
      <div
        className={data.length >= 20 ? 'lite-chart-columns is-dense' : 'lite-chart-columns'}
        role="img"
        aria-label={average != null && only ? `${ariaLabel}. Media: ${fmtInt(Math.round(average))} CUP` : ariaLabel}
        style={{ '--chart-columns': Math.max(1, data.length), ...(average != null ? { '--avg-frac': average / maximum } : {}) } as CSSProperties}
      >
        {average != null ? <div className="lite-chart-avg" aria-hidden="true"><span className="lite-chart-avg-chip">Media {fmtCompact(average)}</span></div> : null}
        {data.map((row, index) => (
          <button
            type="button"
            className={selected === index ? 'lite-chart-column is-selected' : 'lite-chart-column'}
            key={`${row.label}-${index}`}
            onClick={() => setSelected(index)}
            aria-label={`${row.detail ?? row.label}: ${series.map((s) => `${s.label} ${fmtInt(Number(row[s.key]) || 0)} CUP`).join(', ')}`}
          >
            <span className="lite-chart-bars" aria-hidden="true">
              {series.map((s) => (
                <i key={s.key} style={{ height: `${Math.max(3, ((Math.max(0, Number(row[s.key]) || 0)) / maximum) * 100)}%`, background: s.color }} />
              ))}
            </span>
            <span className={angled ? 'lite-chart-label is-angled' : 'lite-chart-label'}>{row.label}</span>
          </button>
        ))}
      </div>
      <DetailPanel heading={picked?.detail ?? picked?.label} lines={lines} />
    </>
  )
}

/** Barras de niveles del original: % del total y degradado verde→naranja
 *  anclado al valor absoluto (backgroundSize compensado). */
export function RowChart({ data, ariaLabel }: { data: Array<{ label: string; value: number }>; ariaLabel: string }) {
  const [selected, setSelected] = useState<number | null>(null)
  if (!data.length) return <ChartEmpty />
  const maximum = Math.max(1, ...data.map((item) => Math.max(0, item.value)))
  const picked = selected == null ? undefined : data[selected]
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const showPct = total > 0 && data.every((item) => item.value >= 0)
  const pctOf = (value: number) => Math.round((value / total) * 100)
  return (
    <>
      <div className="lite-chart-rows" role="img" aria-label={ariaLabel}>
        {data.map((item, index) => {
          const wPct = Math.max(2, (Math.max(0, item.value) / maximum) * 100)
          return (
            <button
              type="button"
              key={`${item.label}-${index}`}
              className={selected === index ? 'lite-chart-row is-selected' : 'lite-chart-row'}
              onClick={() => setSelected(index)}
              aria-label={showPct ? `${item.label}: ${fmtInt(item.value)} CUP, el ${pctOf(item.value)} % del total` : `${item.label}: ${fmtInt(item.value)} CUP`}
            >
              <span>{item.label}</span>
              <i aria-hidden="true"><b style={{ width: `${wPct}%`, background: 'linear-gradient(90deg, #2fbf71, #a8c256, #e9a13b)', backgroundSize: `${10000 / wPct}% 100%`, backgroundRepeat: 'no-repeat' }} /></i>
              <strong>{fmtCompact(item.value)}{showPct ? <small>{pctOf(item.value)} %</small> : null}</strong>
            </button>
          )
        })}
      </div>
      <DetailPanel heading={picked?.label} lines={picked ? [{ label: 'Venta', value: picked.value, color: CHART_COLOR.green }] : undefined} noun="fila" />
    </>
  )
}

/** Tarjeta de gráfico del original (ChartCard): radio 22px, título
 *  font-display de 17px. */
export function ChartCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card chart-card">
      <h3 className="chart-card-title">{title}</h3>
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </section>
  )
}

/** Anillo de progreso del original (ProgressRing): al tocarlo despliega
 *  el texto que explica el número con las cifras reales. */
export function ProgressRing({ label, pct, valueText, detail, color }: { label: string; pct: number; valueText: string; detail: string; color?: string }) {
  const [open, setOpen] = useState(false)
  const size = 92
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="progress-ring-wrap">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={`${label}: ${valueText}. Toca para ver el porqué.`} className="progress-ring-btn">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--chart-green)'} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s ease' }}
          />
          <text x="50%" y="47%" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">{Math.round(clamped)}%</text>
          <text x="50%" y="64%" textAnchor="middle" fontSize="9.5" fill="var(--dim)">{valueText}</text>
        </svg>
      </button>
      <span className="progress-ring-label">{label}</span>
      {open ? <p className="progress-ring-detail">{detail}</p> : null}
    </div>
  )
}

/** Pulso diario del original (DayPulse): últimos 14 días con IPV en
 *  barras tocables; titular con el último día frente al anterior y
 *  línea de media. El IPV guarda el total de cada día, no la hora:
 *  el latido va día a día, sin horas inventadas. */
export function DayPulse({ days }: { days: Array<{ date: string; ventas: number }> }) {
  const shown = days.slice(-14)
  const [sel, setSel] = useState<string | null>(null)
  const last = shown.length ? shown[shown.length - 1] : null
  const prev = shown.length > 1 ? shown[shown.length - 2] : null
  const max = Math.max(1, ...shown.map((d) => d.ventas))
  const avg = shown.length ? shown.reduce((s, d) => s + d.ventas, 0) / shown.length : 0
  const delta = last && prev ? last.ventas - prev.ventas : null
  const deltaPct = delta != null && prev && prev.ventas > 0 ? (delta / prev.ventas) * 100 : null
  const selDay = shown.find((d) => d.date === sel) ?? null
  const selIdx = selDay ? shown.indexOf(selDay) : -1
  const selPrev = selIdx > 0 ? shown[selIdx - 1] : null
  const short = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d} ${months[(m || 1) - 1]}`
  }
  const deltaText = delta == null
    ? null
    : delta === 0
      ? `igual que el día anterior (${fmtCUP(prev!.ventas)})`
      : `${delta > 0 ? '+' : '−'}${fmtCUP(Math.abs(delta))}${deltaPct != null ? ` (${deltaPct > 0 ? '+' : '−'}${Math.abs(Math.round(deltaPct))} %)` : ''} frente al día anterior`
  const detail = selDay
    ? `${short(selDay.date)}: vendiste ${fmtCUP(selDay.ventas)}${selPrev ? ` — ${selDay.ventas === selPrev.ventas ? 'lo mismo que' : selDay.ventas > selPrev.ventas ? `${fmtCUP(selDay.ventas - selPrev.ventas)} más que` : `${fmtCUP(selPrev.ventas - selDay.ventas)} menos que`} el día anterior (${fmtCUP(selPrev.ventas)})` : ' — es el primer día con IPV del período'}. El promedio de los ${shown.length} días mostrados es ${fmtCUP(avg)}.`
    : last
      ? prev
        ? `El último día con IPV (${short(last.date)}) vendió ${fmtCUP(last.ventas)}: ${deltaText}. Toca cualquier barra y te digo el porqué de ese día.`
        : `Solo hay un día con IPV por ahora (${short(last.date)}: ${fmtCUP(last.ventas)}). Cuando entre el siguiente, el pulso comparará día frente a día.`
      : null
  return (
    <div>
      {last ? (
        <>
          <div className="pulse-head">
            <div>
              <p className="pulse-kicker">Último día · {short(last.date)}</p>
              <p className="pulse-hero">{fmtCUP(last.ventas)}</p>
            </div>
            {prev ? (
              <div>
                <p className="pulse-kicker">Día anterior · {short(prev.date)}</p>
                <p className="pulse-prev">{fmtCUP(prev.ventas)}</p>
              </div>
            ) : null}
            {delta != null ? (
              <span
                className="pulse-delta"
                style={{
                  borderColor: delta === 0 ? 'var(--border)' : delta > 0 ? 'var(--chart-green)' : 'var(--danger)',
                  color: delta === 0 ? 'var(--dim)' : delta > 0 ? 'var(--chart-green)' : 'var(--danger)',
                }}
              >
                {delta === 0 ? 'Igual que el día anterior' : `${delta > 0 ? 'Subió' : 'Bajó'} ${fmtCUP(Math.abs(delta))}${deltaPct != null ? ` (${deltaPct > 0 ? '+' : '−'}${Math.abs(Math.round(deltaPct))} %)` : ''}`}
              </span>
            ) : null}
          </div>
          <div className="pulse-chart">
            <div className="pulse-bars" role="group" aria-label="Ventas diarias de los últimos días con IPV">
              {shown.map((d, i) => {
                const isLast = i === shown.length - 1
                const isPrev = i === shown.length - 2
                const active = sel === d.date
                const color = isLast ? 'var(--chart-green)' : isPrev ? 'var(--chart-turquoise)' : 'var(--border)'
                return (
                  <button
                    key={d.date} type="button" onClick={() => setSel(active ? null : d.date)} aria-pressed={active}
                    aria-label={`${short(d.date)}: ${fmtCUP(d.ventas)}${isLast ? ' (último día)' : isPrev ? ' (día anterior)' : ''}. Toca para ver el detalle.`}
                    className="pulse-col"
                  >
                    <span className="pulse-bar" style={{ height: `${Math.max(4, (d.ventas / max) * 100)}%`, background: active ? 'var(--chart-deep)' : color }} />
                    <span className={`pulse-day${active || isLast ? ' is-strong' : ''}`}>{d.date.slice(8, 10)}</span>
                  </button>
                )
              })}
            </div>
            {shown.length > 2 ? (
              <>
                <div className="pulse-avg" style={{ bottom: `${(avg / max) * 88 + 14}px` }} aria-hidden="true" />
                <span className="pulse-avg-chip" style={{ bottom: `${(avg / max) * 88 + 14}px` }} aria-hidden="true">Media {fmtCUP(avg)}</span>
              </>
            ) : null}
          </div>
          {shown.length > 2 ? <p className="pulse-count">{shown.length} días con IPV</p> : null}
        </>
      ) : (
        <p className="muted" style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--text)' }}>Todavía no hay días con IPV:</strong> cuando importes el primero, aquí latirá día a día con sus totales reales.
        </p>
      )}
      <DetailLine text={detail} />
    </div>
  )
}

export type HeatDay = { date: string; ventas: number | null; neta: number | null }

/** Mapa térmico del mes del original (MonthHeatMap): cada día es un
 *  botón cuya intensidad respira según su venta; un día pasado sin IPV
 *  NO cuenta como venta 0 (queda marcado como ausencia). */
export function MonthHeatMap({ days, monthKey, todayISO: today, compact = false }: { days: HeatDay[]; monthKey: string; todayISO: string; compact?: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const max = Math.max(1, ...days.map((d) => d.ventas ?? 0))
  const firstDow = days.length ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0
  const selDay = days.find((d) => d.date === sel) ?? null
  const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const [my, mm] = monthKey.split('-').map(Number)
  const monthLabel = `${monthNames[(mm || 1) - 1]} de ${my}`
  const short = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][(m || 1) - 1]}`
  }
  return (
    <div>
      <h3 className="chart-card-title">{compact ? `El mes en calor · ${monthLabel}` : `Mapa térmico · ${monthLabel}`}</h3>
      <p className="sub">Cada día respira según lo que vendió.</p>
      <div className="heat-grid" role="grid" aria-label={`Calendario de ventas de ${monthLabel}`}>
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={i} className="heat-dow">{d}</span>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => <span key={`x-${i}`} />)}
        {days.map((d) => {
          const isFuture = d.date > today
          const isToday = d.date === today
          const missing = d.ventas == null && !isFuture
          const intensity = d.ventas != null ? 0.18 + 0.72 * (d.ventas / max) : 0
          return (
            <button
              key={d.date} type="button" onClick={() => setSel(sel === d.date ? null : d.date)}
              aria-label={`${short(d.date)}: ${d.ventas != null ? `venta ${fmtCUP(d.ventas)}` : isFuture ? 'todavía no llega' : 'sin IPV importado'}`}
              className={`heat-cell${isToday ? ' is-today' : ''}${missing ? ' queen-fx-pulse' : ''}`}
              style={{
                backgroundColor: d.ventas != null ? `rgba(14,159,110,${intensity})` : missing ? 'rgba(214,69,65,0.20)' : 'var(--surface-alt)',
                color: d.ventas != null && intensity > 0.55 ? '#fff' : 'var(--text)',
              }}
            >
              {Number(d.date.slice(8, 10))}
            </button>
          )
        })}
      </div>
      <DetailLine
        text={selDay ? (selDay.ventas != null
          ? `${short(selDay.date)}: venta ${fmtCUP(selDay.ventas)} · ganancia neta ${fmtCUP(selDay.neta ?? 0)}. Sale del IPV de ese día.`
          : selDay.date > today
            ? `${short(selDay.date)}: todavía no llega.`
            : `${short(selDay.date)}: sin IPV importado. Ese día no cuenta en los totales hasta que se suba su hoja.`) : null}
      />
    </div>
  )
}

/* ================= Comparadores de períodos (charts.tsx original) =====
 * Port literal de DeptCompareChart / BucketCompareChart del original:
 * los mismos datos ({name|label, actual, comparado}), las mismas series
 * (Actual = verde, Comparado = gris) y el mismo ColumnChart. */
export type ComparePoint = { name: string; actual: number; comparado: number }
export function DeptCompareChart({ data }: { data: ComparePoint[] }) {
  if (!data.length) return <ChartEmpty />
  return <ColumnChart angled data={data.map((item) => ({ ...item, label: item.name }))} series={[{ key: 'actual', label: 'Actual', color: CHART_COLOR.green }, { key: 'comparado', label: 'Comparado', color: CHART_COLOR.gray }]} ariaLabel="Ventas por departamento del período actual contra el comparado" />
}

export type BucketComparePoint = { label: string; actual: number; comparado: number }
export function BucketCompareChart({ data }: { data: BucketComparePoint[] }) {
  if (!data.length) return <ChartEmpty />
  return <ColumnChart data={data} series={[{ key: 'actual', label: 'Actual', color: CHART_COLOR.green }, { key: 'comparado', label: 'Comparado', color: CHART_COLOR.gray }]} ariaLabel="Ventas por tramo del período actual contra el comparado" />
}

/* ================= FutureCard (futureCharts.tsx original) ==============
 * Tarjeta de la galería: título font-display, subtítulo y nota «Cómo
 * leerlo». En el original lleva clases Tailwind (rounded-3xl border
 * bg-[var(--surface)] p-4 sm:p-5); el clon no tiene Tailwind, así que se
 * usan las clases card/chart-card propias, que ya replican esos valores. */
export function FutureCard({ title, subtitle, children, nota, flat = false }: { title: string; subtitle: string; children: ReactNode; nota?: string; flat?: boolean }) {
  return (
    <section aria-label={title} className={flat ? '' : 'card chart-card'}>
      <h3 className="chart-card-title">{title}</h3>
      <p className="sub" style={{ marginTop: 2 }}>{subtitle}</p>
      <div style={{ marginTop: 12 }}>{children}</div>
      {nota ? <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}><strong style={{ color: 'var(--text)' }}>Cómo leerlo:</strong> {nota}</p> : null}
    </section>
  )
}

/* ================= Constructores (futureCharts.tsx original) ==========
 * buildRiver / buildCategoryBars literales. Adaptación de arquitectura
 * (documentada): en el original los ingresos extras son una lista
 * {date, amount} aparte; en el clon viven dentro de cada día
 * (DayData.extras: {concepto, importe}), así que el llamador pasa el
 * total de extras de cada día como extrasImporte alineado con su fecha. */
export const FX = { deep: '#0B3D2E', emerald: '#0E9F6E', turquoise: '#0EA5BD', gold: '#C9A227', amber: '#E9A13B', red: '#D64541' } as const

export type RiverDay = { date: string; ventasDia: number; gananciaBruta: number; gananciaNeta: number; extrasImporte: number }
export type RiverExpense = { date: string; category: string; total: number }
export type RiverData = {
  ventas: number; costo: number; bruta: number; nomina: number; insumos: number
  otrosGastos: number; totalGastos: number; extras: number; utilidad: number
  dias: number; hayDatos: boolean
}
export function buildRiver(days: RiverDay[], expenses: RiverExpense[], fromISO: string, toISO: string): RiverData {
  const inRange = (iso: string) => iso >= fromISO && iso <= toISO
  const ds = days.filter((d) => inRange(d.date))
  const ventas = ds.reduce((s, d) => s + d.ventasDia, 0)
  const bruta = ds.reduce((s, d) => s + d.gananciaBruta, 0)
  const neta = ds.reduce((s, d) => s + d.gananciaNeta, 0)
  let nomina = 0, insumos = 0, otrosGastos = 0
  for (const e of expenses) {
    if (!inRange(e.date)) continue
    const cat = e.category.toLowerCase()
    if (cat.includes('nómina') || cat.includes('nomina')) nomina += e.total
    else if (cat.includes('insumo')) insumos += e.total
    else otrosGastos += e.total
  }
  const totalGastos = nomina + insumos + otrosGastos
  const extrasTotal = ds.reduce((s, d) => s + d.extrasImporte, 0)
  return {
    ventas, costo: ventas - bruta, bruta,
    nomina, insumos, otrosGastos, totalGastos,
    extras: extrasTotal,
    utilidad: neta - totalGastos + extrasTotal,
    dias: ds.length,
    hayDatos: ds.length > 0 || totalGastos > 0 || extrasTotal > 0,
  }
}

export type CategoryBar = { label: string; total: number; pct: number }
export function buildCategoryBars(expenses: RiverExpense[], fromISO: string, toISO: string): CategoryBar[] {
  const map = new Map<string, number>()
  for (const e of expenses) {
    if (e.date < fromISO || e.date > toISO) continue
    map.set(e.category, (map.get(e.category) ?? 0) + e.total)
  }
  const rows = [...map.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total)
  const max = rows[0]?.total ?? 0
  return rows.map((r) => ({ ...r, pct: max > 0 ? (r.total / max) * 100 : 0 }))
}

/* ================= LuminousBars (futureCharts.tsx original) =========== */
export function LuminousBars({ items, emptyText }: { items: CategoryBar[]; emptyText: string }) {
  const [sel, setSel] = useState<string | null>(null)
  if (!items.length) return <p className="small muted" style={{ margin: 0 }}>{emptyText}</p>
  const total = items.reduce((s, i) => s + i.total, 0)
  const selItem = items.find((i) => i.label === sel) ?? null
  return (
    <div>
      <div style={{ display: 'grid', gap: 10 }}>
        {items.map((item, idx) => (
          <button key={item.label} type="button" onClick={() => setSel(sel === item.label ? null : item.label)} aria-label={`${item.label}: ${fmtCUP(item.total)}. Toca para ver su parte del total.`} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>
            <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{item.label}</span>
              <span style={{ color: 'var(--dim)' }}>{fmtCUP(item.total)} · <strong style={{ color: 'var(--text)' }}>{total > 0 ? Math.round((item.total / total) * 100) : 0} %</strong></span>
            </span>
            <span style={{ display: 'block', marginTop: 4, height: 10, overflow: 'hidden', borderRadius: 999, background: 'var(--border)' }}>
              <span style={{ display: 'block', height: '100%', borderRadius: 999, width: `${Math.max(2, item.pct)}%`, background: `linear-gradient(90deg, ${idx % 2 ? FX.turquoise : FX.emerald}, ${FX.gold})`, backgroundSize: `${10000 / Math.max(2, item.pct)}% 100%`, backgroundRepeat: 'no-repeat', transition: 'width .6s ease' }} />
            </span>
          </button>
        ))}
      </div>
      <DetailLine text={selItem ? `${selItem.label}: ${fmtCUP(selItem.total)}, el ${total > 0 ? Math.round((selItem.total / total) * 100) : 0} % de los gastos del período. La barra más larga es la categoría mayor.` : null} />
    </div>
  )
}

/* ================= CashBars (futureCharts.tsx original) ===============
 * El dueño eliminó el Sankey («Río de caja») en 2026-10-18: los mismos
 * datos reales en barras horizontales — etiqueta, cifra y % de la venta. */
export function CashBars({ data, periodLabel }: { data: RiverData; periodLabel: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const d = data
  if (!d.hayDatos || d.ventas <= 0) {
    return (
      <FutureCard title="¿En qué se va el dinero?" subtitle={`Las partes de la venta de ${periodLabel}, en barras.`}
        nota="cada barra es una parte de la venta: su etiqueta, su cifra y su porcentaje. Sin venta registrada no hay barras que dibujar.">
        <p className="small muted" style={{ margin: 0, lineHeight: 1.55 }}>En {periodLabel} no hay IPV con ventas ni gastos registrados: cuando entren los datos, las barras se dibujan solas.</p>
      </FutureCard>
    )
  }
  const pctVenta = (v: number) => (d.ventas > 0 ? (v / d.ventas) * 100 : 0)
  type Row = { key: string; label: string; value: number; color: string; detail: string }
  const rows: Row[] = [
    { key: 'costo', label: 'Costo de lo vendido', value: d.costo, color: FX.turquoise, detail: `Costo de lo vendido: ${fmtCUP(d.costo)}, el ${Math.round(pctVenta(d.costo))} % de la venta. Es lo que costaron los productos que salieron: la venta menos la ganancia bruta de los IPV.` },
    { key: 'bruta', label: 'Ganancia bruta', value: d.bruta, color: FX.emerald, detail: `Ganancia bruta: ${fmtCUP(d.bruta)}, el ${Math.round(pctVenta(d.bruta))} % de la venta. Es lo que queda tras el costo, antes de pagar los gastos del negocio.` },
    { key: 'nomina', label: 'Nómina RH', value: d.nomina, color: FX.gold, detail: `Nómina RH: ${fmtCUP(d.nomina)} en salarios registrados en Gastos, el ${Math.round(pctVenta(d.nomina))} % de la venta.` },
    { key: 'insumos', label: 'Insumos (gasto)', value: d.insumos, color: '#7FB3D5', detail: `Insumos: ${fmtCUP(d.insumos)} de compras registradas en Gastos, el ${Math.round(pctVenta(d.insumos))} % de la venta.` },
    { key: 'otros', label: 'Otros gastos', value: d.otrosGastos, color: '#B39DDB', detail: `Otros gastos: ${fmtCUP(d.otrosGastos)} (salidas de caja y demás categorías de Gastos), el ${Math.round(pctVenta(d.otrosGastos))} % de la venta.` },
  ]
  const selRow = rows.find((r) => r.key === sel) ?? null
  const barRow = (label: string, value: number, color: string, bold = false, h = 10) => (
    <>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <span style={{ fontWeight: bold ? 700 : 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ color: bold ? 'var(--text)' : 'var(--dim)', fontWeight: bold ? 700 : 400 }}>{fmtCUP(value)} · {Math.round(pctVenta(value))} %</span>
      </span>
      <span style={{ display: 'block', marginTop: 4, height: h, overflow: 'hidden', borderRadius: 999, background: 'var(--border)' }}>
        <span style={{ display: 'block', height: '100%', borderRadius: 999, width: `${Math.max(1.5, Math.min(100, pctVenta(value)))}%`, background: color, transition: 'width .6s ease' }} />
      </span>
    </>
  )
  return (
    <FutureCard title="¿En qué se va el dinero?" subtitle={`Las partes de la venta de ${periodLabel}, en barras.`}
      nota="cada barra se mide contra la venta total: si la venta es la barra completa (100 %), cada parte ocupa su pedazo. Toca una barra para ver su porqué.">
      <div style={{ marginBottom: 12 }}>{barRow('Venta bruta total', d.ventas, FX.deep, true, 12)}</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((row) => (
          <button key={row.key} type="button" onClick={() => setSel(sel === row.key ? null : row.key)} aria-label={`${row.label}: ${fmtCUP(row.value)}, ${Math.round(pctVenta(row.value))} por ciento de la venta. Toca para ver el porqué.`} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>
            {barRow(row.label, row.value, row.color)}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {d.extras > 0 ? <span className="chip">+ Ingresos extras · {fmtCUP(d.extras)} (suman a favor)</span> : null}
        <span className="chip" style={{ borderColor: d.utilidad < 0 ? FX.red : FX.emerald, color: d.utilidad < 0 ? FX.red : FX.emerald, fontWeight: 700 }}>
          Utilidad neta: {fmtCUP(d.utilidad)} · {Math.round(pctVenta(d.utilidad))} % de la venta{d.utilidad < 0 ? ' (el período va en rojo)' : ''}
        </span>
      </div>
      <DetailLine text={selRow ? selRow.detail : `Utilidad neta: ${fmtCUP(d.utilidad)}. Es la ganancia neta de los IPV, menos los gastos, más los ingresos extras: lo que el negocio ganó de verdad en el período.`} />
    </FutureCard>
  )
}
