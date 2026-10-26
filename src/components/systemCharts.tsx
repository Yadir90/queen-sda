/* Gráficos de Sistema del original, portados de client/src/App.tsx
   (DiagnosticRadar) y client/src/charts.tsx (SystemRealtimeCharts).
   PORT LITERAL de estructura y clases del original: la raíz es
   <section className="system-realtime-charts">, las pestañas son
   .system-chart-tabs, cada vista es .system-chart-panel, el anillo es
   .system-health-donut/.system-chart-legend y la rejilla es
   .system-hourgrid* — los estilos viven en components/systemMirror.css,
   copiados tal cual de theme.css. D-19 CORREGIDA: Actividad, Eventos y
   Rendimiento se dibujan con Recharts 2.15.3, la misma librería,
   versión y configuración del original (márgenes, ejes, celdas y
   líneas literales de charts.tsx), al igual que la mini línea del
   monitor (SystemSparkline). El modelo de datos de entrada sigue
   siendo el de esta copia (sysReadings y los derivados de Sistema):
   lo que cambia es el motor de dibujo, no las lecturas.
   Regla del original: lo no medido no se dibuja — un área sin
   verificar no entra en el radar y una métrica sin dos lecturas reales
   muestra el aviso en vez del gráfico. Las lecturas pueden ser de
   apertura o sembradas desde las jornadas reales del respaldo
   (lib/sysReadings.ts): la vista «Rendimiento · Peso» se alimenta de
   ambas; Memoria y Latencia solo de las de apertura, que son las
   únicas que las miden de verdad. */

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SysReading } from '../lib/sysReadings'
import { havanaNowParts } from '../lib/utils'

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

/* SystemSparkline del original (charts.tsx): Recharts, sin animación.
   El contenedor fija la altura que antes ocupaba el SVG (56 px). */
export function Sparkline({ values, color }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const data = values.map((value) => ({ value }))
  return (
    <div className="sparkline" style={{ height: 56 }} role="img" aria-label="Mini línea de lecturas del sistema">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke={color ?? '#45d6b0'} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
/* PERFORMANCE_METRICS del original: mismos colores y orden. */
const METRICS: Array<{ id: MetricId; label: string; unit: string; color: string }> = [
  { id: 'pesoKb', label: 'Peso', unit: 'KB', color: '#0b7285' },
  { id: 'memoriaMb', label: 'Memoria', unit: 'MB', color: '#23aa70' },
  { id: 'latenciaMs', label: 'Latencia', unit: 'ms', color: '#4a8fe7' },
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
  /* Métrica por defecto del original: Memoria. */
  const [metricId, setMetricId] = useState<MetricId>('memoriaMb')

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

  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[1]
  const metricValues = readings.flatMap((r) => {
    const v = r[metricId]
    return v == null ? [] : [{ at: r.at, value: v }]
  })
  /* Series de Recharts con la preparación del original: actividad con
     etiqueta corta y «En vivo» al 100 %, eventos con las últimas 14
     jornadas y rendimiento con la hora de cada lectura. */
  const activityData = activities.slice(0, 8).map((a) => ({
    ...a,
    value: a.state === 'live' ? 100 : Math.max(0, Math.min(100, a.value)),
    shortLabel: a.label.length > 19 ? `${a.label.slice(0, 18)}…` : a.label,
  }))
  const eventData = [...events].reverse().slice(-14).map((e) => ({ ...e, label: e.date.slice(5), failedCount: e.fallos }))
  const performance = metricValues.map((v) => ({
    label: new Intl.DateTimeFormat('es-CU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v.at)),
    value: v.value,
  }))

  // Rejilla día × hora desde las marcas de tiempo REALES de las lecturas
  // (port del original): una hora sin lecturas queda vacía.
  const hourGrid = useMemo(() => {
    const counts = new Map<string, number>()
    const daySet = new Set<string>()
    for (const r of readings) {
      const at = new Date(r.at)
      if (Number.isNaN(at.getTime())) continue
      /* Día y hora en America/Havana (D-04), no en la zona del dispositivo. */
      const hv = havanaNowParts(at)
      const dayKey = hv.iso
      const key = `${dayKey}|${hv.hour}`
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
  const checkedLabel = new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(checkedAt))

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
        <div className="system-chart-panel" role="tabpanel" aria-label="Avance de tareas activas">
          {activityData.length ? (
            <>
              <div className="system-wide-chart" role="img" aria-label="Avance porcentual de rutinas activas">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityData} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fill: 'var(--dim)', fontSize: 10 }} />
                    <YAxis type="category" dataKey="shortLabel" width={92} tick={{ fill: 'var(--text)', fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Avance" radius={[0, 8, 8, 0]} isAnimationActive={false}>
                      {activityData.map((item) => <Cell key={`${item.label}-${item.state}`} fill={item.state === 'bad' ? STATE_COLOR.error : item.state === 'warn' ? STATE_COLOR.verifying : item.state === 'live' ? 'var(--chart-turquoise)' : 'var(--chart-green)'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="system-chart-reading">Las rutinas continuas se muestran completas como señal «En vivo»; las demás usan su avance real.</p>
            </>
          ) : <div className="chart-empty">No hay tareas activas ni pendientes ahora.</div>}
        </div>
      ) : null}

      {view === 'eventos' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Fallos registrados por día">
          {eventData.length ? (
            <>
              <div className="system-wide-chart" role="img" aria-label="Fallos del sistema por jornada observada">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={eventData} margin={{ top: 6, right: 8, bottom: 2, left: -18 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--dim)', fontSize: 10 }} />
                    <YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fill: 'var(--dim)', fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="failedCount" name="Fallos" radius={[7, 7, 0, 0]} isAnimationActive={false}>
                      {eventData.map((item) => <Cell key={item.date} fill={item.failedCount > 0 ? STATE_COLOR.error : STATE_COLOR.healthy} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="system-chart-reading">Un fallo por jornada = cuadre distinto de cero (1) más merma con costo registrada ese día (1). Un valor 0 es una jornada registrada sin fallos; una fecha ausente no se dibuja.</p>
            </>
          ) : <div className="chart-empty">Aún no hay jornadas completas para representar.</div>}
        </div>
      ) : null}

      {view === 'rendimiento' ? (
        <div className="system-chart-panel" role="tabpanel" aria-label="Tendencia de rendimiento">
          <div className="system-performance-switch" role="group" aria-label="Métrica de rendimiento">
            {METRICS.map((m) => (
              <button key={m.id} type="button" aria-pressed={metricId === m.id} onClick={() => setMetricId(m.id)}>{m.label}</button>
            ))}
          </div>
          {performance.length >= 2 ? (
            <>
              <div className="system-wide-chart" role="img" aria-label={`${metric.label} del sistema en ${metric.unit}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performance} margin={{ top: 8, right: 10, bottom: 2, left: -14 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--dim)', fontSize: 9 }} minTickGap={22} />
                    <YAxis domain={[0, 'auto']} tick={{ fill: 'var(--dim)', fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" name={`${metric.label} (${metric.unit})`} stroke={metric.color} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="system-chart-reading">{performance.length} lecturas disponibles · eje desde 0 · {metric.unit}.</p>
            </>
          ) : (
            <div className="chart-empty">Esta métrica necesita dos lecturas reales. La próxima se toma en unos segundos.</div>
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
