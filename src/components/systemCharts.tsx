/* Gráficos de Sistema del original, portados de client/src/App.tsx
   (DiagnosticRadar) y client/src/charts.tsx (SystemRealtimeCharts).
   PORT LITERAL de estructura y clases del original: la raíz es
   <section className="system-realtime-charts">, las pestañas son
   .system-chart-tabs, cada vista es .system-chart-panel, el anillo es
   .system-health-donut/.system-chart-legend y la rejilla es
   .system-hourgrid* — los estilos viven en components/systemMirror.css,
   copiados tal cual de theme.css. Diferencia de arquitectura declarada:
   el original dibuja Actividad/Eventos/Rendimiento con Recharts; el
   clon no carga esa librería (rendimiento en el A16), así que esos
   tres paneles usan el SVG/HTML nativo que ya traía el clon, dentro de
   la misma estructura y con las mismas lecturas.
   Regla del original: lo no medido no se dibuja — un área sin
   verificar no entra en el radar y una métrica sin dos lecturas reales
   muestra el aviso en vez del gráfico. Las lecturas pueden ser de
   apertura o sembradas desde las jornadas reales del respaldo
   (lib/sysReadings.ts): la vista «Rendimiento · Peso» se alimenta de
   ambas; Memoria y Latencia solo de las de apertura, que son las
   únicas que las miden de verdad. */

import { useEffect, useMemo, useState } from 'react'
import { ColumnChart } from './charts'
import type { SysReading } from '../lib/sysReadings'
import { fmtDateShort, fmtInt } from '../lib/utils'

/* ---------------- DiagnosticRadar (port fiel del original) ---------------- */

export interface RadarArea {
  id: string
  label: string
  score: number | null
}

export function DiagnosticRadar({ areas }: { areas: RadarArea[] }) {
  const scored = areas.filter((a): a is { id: string; label: string; score: number } => a.score !== null)
  if (scored.length < 3) return null
  const cx = 160
  const cy = 146
  const R = 84
  const pt = (i: number, frac: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / scored.length
    return { x: cx + Math.cos(ang) * R * frac, y: cy + Math.sin(ang) * R * frac, cos: Math.cos(ang), sin: Math.sin(ang) }
  }
  const ringPts = (f: number) => scored.map((_, i) => { const p = pt(i, f); return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }).join(' ')
  const shapePts = scored.map((a, i) => { const p = pt(i, Math.max(0, Math.min(100, a.score)) / 100); return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }).join(' ')
  const excluded = areas.length - scored.length
  return (
    <figure className="radar-figure">
      <svg viewBox="0 0 320 300" role="img" aria-label={`Radar de salud por áreas: ${scored.map((a) => `${a.label} ${a.score} de 100`).join('; ')}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ringPts(f)} fill="none" stroke="var(--border)" strokeWidth={f === 1 ? 1.4 : 1} />)}
        {scored.map((a, i) => { const p = pt(i, 1); return <line key={a.id} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="var(--border)" /> })}
        <polygon points={shapePts} fill="var(--accent)" fillOpacity={0.16} stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {scored.map((a, i) => { const p = pt(i, Math.max(0, Math.min(100, a.score)) / 100); return <circle key={a.id} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} /> })}
        {scored.map((a, i) => { const p = pt(i, 1.24); const lx = Math.max(72, Math.min(248, p.x)); const ly = p.y + (p.sin > 0.35 ? 12 : p.sin < -0.35 ? -12 : 0); return <text key={a.id} x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize={11.5} fontWeight={650} fill="var(--dim)">{a.label} · {a.score}</text> })}
      </svg>
      {excluded > 0 ? <figcaption>{excluded} área{excluded === 1 ? '' : 's'} sin verificar no entra{excluded === 1 ? '' : 'n'} en el radar: no se dibuja{excluded === 1 ? '' : 'n'} como cero.</figcaption> : null}
    </figure>
  )
}

/* ---------------- Reloj en vivo y mini-línea ---------------- */

export function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(new Date()) }
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])
  // Formato del LiveClockCard original: 12 horas con am/pm, nunca militar.
  const dateLine = new Intl.DateTimeFormat('es-CU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
  const h24 = now.getHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const timeLine = `${h12}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`
  return (
    <div className="live-clock">
      <p className="lc-date">{dateLine}</p>
      <p className="lc-time">{timeLine}</p>
    </div>
  )
}

export function Sparkline({ values, color = '#45d6b0' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const w = 260
  const h = 56
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 8) + 4).toFixed(1)},${(h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" role="img" aria-label="Mini línea de lecturas del sistema">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* ---------------- Sistema en tiempo real: 5 vistas ---------------- */

export type SysHealthState = 'healthy' | 'verifying' | 'repairing' | 'error'
export interface SysHealthPoint { label: string; state: SysHealthState; detail: string }
export interface SysActivity { label: string; value: number; state: 'ok' | 'warn' | 'bad' | 'live' }
export interface SysEventDay { date: string; fallos: number }

const STATE_LABEL: Record<SysHealthState, string> = { healthy: 'Correcto', verifying: 'Verificando', repairing: 'Reparando', error: 'Error' }
const STATE_COLOR: Record<SysHealthState, string> = { healthy: '#23aa70', verifying: '#d4a72c', repairing: '#3182ce', error: '#d84a4a' }

type MetricId = 'pesoKb' | 'memoriaMb' | 'latenciaMs'
const METRICS: Array<{ id: MetricId; label: string; unit: string; color: string }> = [
  { id: 'pesoKb', label: 'Peso', unit: 'KB', color: '#23aa70' },
  { id: 'memoriaMb', label: 'Memoria', unit: 'MB', color: '#0e9db3' },
  { id: 'latenciaMs', label: 'Latencia', unit: 'ms', color: '#e9a13b' },
]

/* SYSTEM_CHART_VIEWS del original, tal cual (ids incluidos). */
const VIEWS = [
  { id: 'salud', label: 'Salud' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'rendimiento', label: 'Rendimiento' },
  { id: 'rejilla', label: 'Día × hora' },
] as const
type ViewId = (typeof VIEWS)[number]['id']

export function SystemRealtimeCharts({ health, activities, events, readings, checkedAt }: {
  health: SysHealthPoint[]
  activities: SysActivity[]
  events: SysEventDay[]
  readings: SysReading[]
  checkedAt: string
}) {
  const [view, setView] = useState<ViewId>('salud')
  const [healthState, setHealthState] = useState<SysHealthState | null>(null)
  const [metricId, setMetricId] = useState<MetricId>('pesoKb')

  const healthSummary = useMemo(() => {
    const counts: Record<SysHealthState, number> = { healthy: 0, verifying: 0, repairing: 0, error: 0 }
    for (const p of health) counts[p.state] += 1
    return (Object.keys(counts) as SysHealthState[])
      .map((state) => ({ state, name: STATE_LABEL[state], value: counts[state], color: STATE_COLOR[state] }))
      .filter((item) => item.value > 0)
  }, [health])
  const selectedHealth = healthState ? healthSummary.find((item) => item.state === healthState) ?? null : null

  const donutRadius = 52
  const donutCircumference = 2 * Math.PI * donutRadius
  const donutGap = 2.5
  const donutTotal = Math.max(1, health.length)
  let donutCursor = 0
  const donutSegments = healthSummary.map((item) => {
    const fraction = item.value / donutTotal
    const segment = { ...item, length: Math.max(0, fraction * donutCircumference - donutGap), start: donutCursor + donutGap / 2 }
    donutCursor += fraction * donutCircumference
    return segment
  })

  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]
  const metricValues = readings.flatMap((r) => {
    const v = r[metricId]
    return v == null ? [] : [{ at: r.at, value: v }]
  })

  // Rejilla día × hora desde las marcas de tiempo REALES de las lecturas
  // (port del original): una hora sin lecturas queda vacía.
  const hourGrid = useMemo(() => {
    const counts = new Map<string, number>()
    const daySet = new Set<string>()
    for (const r of readings) {
      const at = new Date(r.at)
      if (Number.isNaN(at.getTime())) continue
      const dayKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
      const key = `${dayKey}|${at.getHours()}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      daySet.add(dayKey)
    }
    const days = [...daySet].sort().slice(-7)
    let max = 0
    let peak: { day: string; hour: number; count: number } | null = null
    for (const day of days) {
      for (let h = 0; h < 24; h += 1) {
        const c = counts.get(`${day}|${h}`) ?? 0
        if (c > max) { max = c; peak = { day, hour: h, count: c } }
      }
    }
    const b1 = Math.max(1, Math.ceil(max / 3))
    const b2 = Math.max(b1 + 1, Math.ceil((2 * max) / 3))
    const level = (c: number) => (c === 0 ? 0 : c <= b1 ? 1 : c <= b2 ? 2 : 3)
    const legend: Array<{ level: number; label: string }> = [{ level: 0, label: '0' }]
    if (max >= 1) legend.push({ level: 1, label: b1 === 1 ? '1' : `1–${b1}` })
    if (max > b1) legend.push({ level: 2, label: `${b1 + 1}–${Math.min(b2, max)}` })
    if (max > b2) legend.push({ level: 3, label: `más de ${b2}` })
    return { days, counts, max, peak, level, legend }
  }, [readings])
  const hourLevelColor = (level: number) => level === 0 ? 'var(--surface-tonal)' : level === 1 ? 'color-mix(in srgb, #23aa70 30%, var(--surface-tonal))' : level === 2 ? 'color-mix(in srgb, #23aa70 58%, var(--surface-tonal))' : '#23aa70'
  const dayLetter = (dayKey: string) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${dayKey}T12:00:00`).getDay()] ?? ''
  const checkedLabel = new Intl.DateTimeFormat('es-CU', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(checkedAt))

  const perfLine = useMemo(() => {
    if (metricValues.length < 2) return null
    const w = 300
    const h = 110
    const vals = metricValues.map((v) => v.value)
    const max = Math.max(...vals)
    const pts = metricValues.map((v, i) => `${(8 + (i / (metricValues.length - 1)) * (w - 16)).toFixed(1)},${(h - 10 - (v.value / (max || 1)) * (h - 24)).toFixed(1)}`).join(' ')
    return { pts, w, h, max }
  }, [metricValues])

  return (
    <section className="system-realtime-charts" aria-labelledby="system-realtime-charts-title">
      <header>
        <div>
          <span className="system-live-kicker"><i aria-hidden="true" /> Lectura gráfica</span>
          <h3 id="system-realtime-charts-title">Sistema en tiempo real</h3>
          <p>Salud, actividad, eventos y rendimiento con las lecturas reales disponibles.</p>
        </div>
        <time dateTime={checkedAt}>{checkedLabel}</time>
      </header>
      <div className="system-chart-tabs" role="tablist" aria-label="Gráficos del sistema">
        {VIEWS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
        ))}
      </div>

      {view === 'salud' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Distribución de salud del sistema">
          {healthSummary.length ? (
            <div className="system-health-chart-layout">
              <div className="system-health-donut" role="img" aria-label={`Estados de ${health.length} componentes del sistema`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle className="system-health-donut-track" cx="60" cy="60" r={donutRadius} strokeWidth="11" />
                  {donutSegments.map((item) => (
                    <circle
                      key={item.state} className="system-health-donut-segment" cx="60" cy="60" r={donutRadius} strokeWidth="11"
                      stroke={item.color}
                      strokeDasharray={`${item.length} ${donutCircumference - item.length}`}
                      strokeDashoffset={-item.start}
                      transform="rotate(-90 60 60)"
                      opacity={healthState && healthState !== item.state ? 0.3 : 1}
                      onClick={() => setHealthState(item.state)}
                    />
                  ))}
                </svg>
                <span><strong>{health.length}</strong><small>componentes</small></span>
              </div>
              <div className="system-chart-legend" aria-label="Estados de salud">
                {healthSummary.map((item) => (
                  <button key={item.state} type="button" aria-pressed={healthState === item.state} onClick={() => setHealthState((cur) => (cur === item.state ? null : item.state))}>
                    <i style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} /><span>{item.name}</span><strong>{item.value}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : <div className="chart-empty">Sin componentes que mostrar.</div>}
          <p className="system-chart-reading" role="status">{selectedHealth ? `${selectedHealth.name}: ${selectedHealth.value} componente${selectedHealth.value === 1 ? '' : 's'}.` : 'Toca un estado para aislar su lectura.'}</p>
          <div className="rt-health-list">
            {health.map((p) => (
              <div className="rt-health-row" key={p.label}>
                <i style={{ background: STATE_COLOR[p.state] }} />
                <span className="grow">{p.label}<span className="muted">{p.detail}</span></span>
                <span className="chip">{STATE_LABEL[p.state]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === 'actividad' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Avance de rutinas activas">
          {activities.length ? (
            <>
              <div className="rt-activity">
                {activities.map((a) => (
                  <div className="rt-act-row" key={a.label}>
                    <span className="rt-act-name">{a.label}</span>
                    <span className="rt-act-track"><i style={{ width: `${Math.max(0, Math.min(100, a.value))}%`, background: a.state === 'bad' ? STATE_COLOR.error : a.state === 'warn' ? STATE_COLOR.verifying : a.state === 'live' ? 'var(--chart-turquoise)' : 'var(--chart-green)' }} /></span>
                    <strong>{Math.round(a.value)} %</strong>
                  </div>
                ))}
              </div>
              <p className="system-chart-reading">Avances calculados de los datos reales de esta copia en este momento; las tareas derivadas de las jornadas sembradas cuentan como actividad histórica real, no inventada.</p>
            </>
          ) : <div className="chart-empty">No hay tareas activas ni pendientes ahora.</div>}
        </div>
      ) : null}

      {view === 'eventos' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Fallos registrados por día">
          {events.length ? (
            <ColumnChart
              ariaLabel="Fallos reales por jornada importada: cuadre distinto de cero y mermas con costo"
              series={[{ key: 'fallos', label: 'Fallos', color: 'var(--danger)' }]}
              data={events.map((e) => ({ label: e.date.slice(5), detail: fmtDateShort(e.date), fallos: e.fallos }))}
            />
          ) : <div className="chart-empty">Aún no hay jornadas completas para representar.</div>}
          <p className="system-chart-reading">Un fallo por jornada = cuadre distinto de cero (1) más merma con costo registrada ese día (1). Un valor 0 es una jornada registrada sin fallos; una fecha ausente no se dibuja.</p>
        </div>
      ) : null}

      {view === 'rendimiento' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Tendencia de rendimiento">
          <div className="system-performance-switch" role="group" aria-label="Métrica de rendimiento">
            {METRICS.map((m) => (
              <button key={m.id} type="button" aria-pressed={metricId === m.id} onClick={() => setMetricId(m.id)}>{m.label}</button>
            ))}
          </div>
          {perfLine ? (
            <>
              <svg viewBox={`0 0 ${perfLine.w} ${perfLine.h}`} className="rt-perf" role="img" aria-label={`Línea de ${metric.label} desde cero`}>
                <line x1="8" y1={perfLine.h - 10} x2={perfLine.w - 8} y2={perfLine.h - 10} stroke="var(--border)" />
                <polyline points={perfLine.pts} fill="none" stroke={metric.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <p className="system-chart-reading">{metricValues.length} lecturas disponibles · eje desde 0 · {metric.unit} · última: {fmtInt(metricValues[metricValues.length - 1].value)} {metric.unit}</p>
            </>
          ) : (
            <div className="chart-empty">Esta métrica necesita dos lecturas reales. «Peso» se siembra con el peso real de cada jornada del respaldo y crece con cada apertura; «Memoria» y «Latencia» solo las miden las lecturas de apertura de este dispositivo.</div>
          )}
        </div>
      ) : null}

      {view === 'rejilla' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Comprobaciones del sistema por día y hora">
          {hourGrid.days.length && hourGrid.max > 0 && hourGrid.peak ? (
            <>
              <div className="system-hourgrid-head">
                <strong>{String(hourGrid.peak.hour).padStart(2, '0')}:00</strong>
                <p>Hora punta de comprobaciones: {hourGrid.peak.count} lectura{hourGrid.peak.count === 1 ? '' : 's'} el {new Intl.DateTimeFormat('es-CU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${hourGrid.peak.day}T12:00:00`))} a las {String(hourGrid.peak.hour).padStart(2, '0')}:00.</p>
              </div>
              <div className="system-hourgrid" role="img" aria-label={`Rejilla de comprobaciones por día y hora: la hora más cargada es las ${String(hourGrid.peak.hour).padStart(2, '0')}:00 del ${hourGrid.peak.day}, con ${hourGrid.peak.count} lecturas`}>
                <div className="system-hourgrid-peak" style={{ left: `calc(34px + (100% - 34px) * ${(hourGrid.peak.hour + 0.5) / 24})` }} aria-hidden="true"><span>Punta</span></div>
                {hourGrid.days.map((day) => (
                  <div className="system-hourgrid-row" key={day}>
                    <span className="system-hourgrid-day">{dayLetter(day)} {day.slice(8)}</span>
                    <div className="system-hourgrid-cells">
                      {Array.from({ length: 24 }, (_, h) => {
                        const c = hourGrid.counts.get(`${day}|${h}`) ?? 0
                        return <i key={h} style={{ background: hourLevelColor(hourGrid.level(c)) }} title={`${day} ${String(h).padStart(2, '0')}:00 — ${c} lectura${c === 1 ? '' : 's'}`} />
                      })}
                    </div>
                  </div>
                ))}
                <div className="system-hourgrid-axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 (h)</span></div>
              </div>
              <div className="system-hourgrid-legend" aria-label="Leyenda de lecturas por hora">
                {hourGrid.legend.map((item) => <span key={item.level}><i style={{ background: hourLevelColor(item.level) }} />{item.label}</span>)}
              </div>
              <p className="system-chart-reading">Cada bloque es una hora: su intensidad es el número de comprobaciones registradas en esa hora. Una hora sin lecturas queda en el tono vacío; no se rellena actividad que no se midió. Las jornadas sembradas del respaldo se agrupan a las 12:00 porque el respaldo trae la fecha, no la hora: esa columna marca jornadas, no una hora medida.</p>
            </>
          ) : <div className="chart-empty">Aún no hay comprobaciones con hora registrada para dibujar la rejilla.</div>}
        </div>
      ) : null}
    </section>
  )
}
