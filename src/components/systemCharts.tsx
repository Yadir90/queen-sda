/* Gráficos de Sistema del original, portados de client/src/App.tsx
   (DiagnosticRadar) y client/src/charts.tsx (SystemRealtimeCharts).
   SVG/HTML nativos, sin librerías. Regla del original: lo no medido no
   se dibuja — un área sin verificar no entra en el radar y una métrica
   sin dos lecturas reales muestra el aviso en vez del gráfico. */

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
  const dateLine = new Intl.DateTimeFormat('es-CU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
  const timeLine = new Intl.DateTimeFormat('es-CU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
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

const VIEWS = [
  { id: 'salud', label: 'Salud' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'rendimiento', label: 'Rendimiento' },
  { id: 'horas', label: 'Día × hora' },
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
    <div>
      <div className="rt-head">
        <span className="premium-kicker"><i aria-hidden /> Lectura gráfica</span>
        <time dateTime={checkedAt}>{checkedLabel}</time>
      </div>
      <div className="rt-tabs" role="tablist" aria-label="Gráficos del sistema">
        {VIEWS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>
        ))}
      </div>

      {view === 'salud' ? (
        <div role="tabpanel" aria-label="Distribución de salud del sistema">
          {healthSummary.length ? (
            <div className="rt-donut-layout">
              <div className="rt-donut" role="img" aria-label={`Estados de ${health.length} componentes del sistema`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r={donutRadius} fill="none" stroke="var(--surface-tonal)" strokeWidth="11" />
                  {donutSegments.map((item) => (
                    <circle
                      key={item.state} cx="60" cy="60" r={donutRadius} fill="none" strokeWidth="11"
                      stroke={item.color}
                      strokeDasharray={`${item.length} ${donutCircumference - item.length}`}
                      strokeDashoffset={-item.start}
                      transform="rotate(-90 60 60)"
                      opacity={healthState && healthState !== item.state ? 0.3 : 1}
                    />
                  ))}
                </svg>
                <span><strong>{health.length}</strong><small>componentes</small></span>
              </div>
              <div className="rt-legend" aria-label="Estados de salud">
                {healthSummary.map((item) => (
                  <button key={item.state} type="button" aria-pressed={healthState === item.state} onClick={() => setHealthState((cur) => (cur === item.state ? null : item.state))}>
                    <i style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} /><span>{item.name}</span><strong>{item.value}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : <div className="chart-empty">Sin componentes que mostrar.</div>}
          <p className="rt-reading" role="status">{selectedHealth ? `${selectedHealth.name}: ${selectedHealth.value} componente${selectedHealth.value === 1 ? '' : 's'}.` : 'Toca un estado en la leyenda para aislar su lectura.'}</p>
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
        <div role="tabpanel" aria-label="Avance de rutinas activas">
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
              <p className="rt-reading">Avances calculados de los datos reales de esta copia en este momento.</p>
            </>
          ) : <div className="chart-empty">No hay tareas activas ni pendientes ahora.</div>}
        </div>
      ) : null}

      {view === 'eventos' ? (
        <div role="tabpanel" aria-label="Fallos registrados por día">
          {events.length ? (
            <ColumnChart
              ariaLabel="Días con cuadre distinto de cero por jornada importada"
              series={[{ key: 'fallos', label: 'Fallos de cuadre', color: 'var(--danger)' }]}
              data={events.map((e) => ({ label: e.date.slice(5), detail: fmtDateShort(e.date), fallos: e.fallos }))}
            />
          ) : <div className="chart-empty">Sin jornadas importadas todavía: no hay eventos que contar.</div>}
          <p className="rt-reading">Un fallo = un día importado cuyo cuadre no es cero. Sale del respaldo, sin tocarlo.</p>
        </div>
      ) : null}

      {view === 'rendimiento' ? (
        <div role="tabpanel" aria-label="Rendimiento de esta copia">
          <div className="rt-tabs rt-metric-tabs" role="tablist" aria-label="Métrica de rendimiento">
            {METRICS.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={metricId === m.id} className={metricId === m.id ? 'active' : ''} onClick={() => setMetricId(m.id)}>{m.label} ({m.unit})</button>
            ))}
          </div>
          {perfLine ? (
            <>
              <svg viewBox={`0 0 ${perfLine.w} ${perfLine.h}`} className="rt-perf" role="img" aria-label={`Línea de ${metric.label} desde cero`}>
                <line x1="8" y1={perfLine.h - 10} x2={perfLine.w - 8} y2={perfLine.h - 10} stroke="var(--border)" />
                <polyline points={perfLine.pts} fill="none" stroke={metric.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <p className="rt-reading">{metricValues.length} lecturas disponibles · eje desde 0 · {metric.unit} · última: {fmtInt(metricValues[metricValues.length - 1].value)} {metric.unit}</p>
            </>
          ) : (
            <div className="chart-empty">La métrica «{metric.label}» aún no tiene dos lecturas reales en esta copia: se muestra este aviso en vez del gráfico. Cada apertura de Sistema deja una lectura medida en este dispositivo.</div>
          )}
        </div>
      ) : null}

      {view === 'horas' ? (
        <div role="tabpanel" aria-label="Comprobaciones por día y hora">
          {hourGrid.days.length && hourGrid.max > 0 ? (
            <>
              <p className="rt-reading" style={{ textAlign: 'left', margin: '0 0 10px' }}>
                Hora punta: <strong>{hourGrid.peak ? `${String(hourGrid.peak.hour).padStart(2, '0')}:00` : '—'}</strong>
                {hourGrid.peak ? ` — ${hourGrid.peak.count} lectura${hourGrid.peak.count === 1 ? '' : 's'} el ${fmtDateShort(hourGrid.peak.day)}` : ''}
              </p>
              <div className="hour-grid" role="img" aria-label="Rejilla de lecturas por día y hora">
                <div className="hour-row hour-axis" aria-hidden="true">
                  <span className="hour-day" />
                  {Array.from({ length: 24 }).map((_, h) => (
                    <span key={h} className={`hour-cell axis${hourGrid.peak?.hour === h ? ' axis-peak' : ''}`} title={hourGrid.peak?.hour === h ? 'Punta: la hora más cargada' : undefined}>{h === 0 || h === 6 || h === 12 || h === 18 ? h : h === 23 ? 24 : hourGrid.peak?.hour === h ? '▾' : ''}</span>
                  ))}
                </div>
                {hourGrid.days.map((day) => (
                  <div className="hour-row" key={day}>
                    <span className="hour-day" title={fmtDateShort(day)}>{dayLetter(day)}</span>
                    {Array.from({ length: 24 }).map((_, h) => {
                      const c = hourGrid.counts.get(`${day}|${h}`) ?? 0
                      const isPeak = hourGrid.peak?.day === day && hourGrid.peak?.hour === h
                      return (
                        <span
                          key={h}
                          className={`hour-cell${isPeak ? ' is-peak' : ''}`}
                          style={{ background: hourLevelColor(hourGrid.level(c)) }}
                          title={`${fmtDateShort(day)} · ${String(h).padStart(2, '0')}:00 · ${c} lectura${c === 1 ? '' : 's'}${isPeak ? ' · Punta' : ''}`}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="hour-legend" aria-label="Leyenda de niveles">
                {hourGrid.legend.map((l) => (
                  <span key={l.level}><i style={{ background: hourLevelColor(l.level) }} />{l.label}</span>
                ))}
                <span className="muted">lecturas por hora</span>
              </div>
            </>
          ) : (
            <div className="chart-empty">Todavía no hay lecturas con hora registradas en esta copia: no se rellena actividad que no se midió. La rejilla «Día × hora» se puebla con las lecturas reales de Sistema.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
