import { useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import ImportBackup from '../components/ImportBackup'
import ImportIpv from '../components/ImportIpv'
import { Icon } from '../components/icons'
import { QueenOrb, QueenReactorMark, QUEEN_REACTOR_STAGES, QUEEN_STAGE, type ReactorStageId } from '../components/QueenReactor'
import { DiagnosticRadar, LiveClock, Sparkline, SystemRealtimeCharts, type RadarArea, type SysActivity, type SysHealthPoint } from '../components/systemCharts'
import { listProfiles, resetLocalData, supabaseConfigured } from '../lib/backend'
import { loadReadings, recordReading, type SysReading } from '../lib/sysReadings'
import { effectiveSaldo, fmtCUP, fmtDate, fmtInt, isMorosa, todayISO } from '../lib/utils'
import { buildAutomationsStatus } from '../lib/automatizacionesCore.mjs'

/* Consola de Sistema del original: 16 tarjetas reordenables (SISTEMA_CARDS).
   La tarjeta de fecha y hora queda siempre primera, fuera del panel, y la
   barra de controles (buscar, organizar, modo ultraligero) queda fija
   arriba. Todo lo que se pinta sale de comprobaciones reales sobre los
   datos cargados en esta copia: lo no verificable se dice, no se rellena.
   Sistema es solo salud y funcionamiento técnico: nada de cifras de
   negocio (eso vive en Inicio). */

const FACTORY_ORDER = [
  'evolucion', 'vistazo', 'atencion', 'organismo', 'queen', 'diagnostico', 'adn', 'tiempo-real',
  'rutinas', 'monitor', 'integracion', 'accesos', 'simulacion', 'errores', 'tareas', 'cierre',
] as const
type CardId = (typeof FACTORY_ORDER)[number]

const CARD_LABEL: Record<CardId, string> = {
  evolucion: 'Evolución de Queen',
  vistazo: 'De un vistazo',
  atencion: 'Necesita tu atención hoy',
  organismo: 'El SDA como organismo',
  queen: 'Queen y red neuronal',
  diagnostico: 'Diagnóstico general',
  adn: 'ADN operativo',
  'tiempo-real': 'Sistema en tiempo real (gráficos)',
  rutinas: 'Rutinas y subrutinas de Queen',
  monitor: 'Monitor del sistema',
  integracion: 'Cómo se integra la información',
  accesos: 'Accesos directos',
  simulacion: 'Simulación de escenarios críticos',
  errores: 'Banco de errores · Sistema inmune',
  tareas: 'Tareas y disciplina',
  cierre: 'Cierre técnico e inicio',
}

const ORDER_KEY = 'queen-sda:sistema-order:v1'
const ULTRA_KEY = 'queen-sda:sistema-ultra:v1'

function resolveOrder(saved: string[]): CardId[] {
  const known = new Set<string>(FACTORY_ORDER)
  const out: CardId[] = []
  for (const id of saved) if (known.has(id) && !out.includes(id as CardId)) out.push(id as CardId)
  for (const id of FACTORY_ORDER) if (!out.includes(id)) out.push(id)
  return out
}

function loadOrder(): CardId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    return resolveOrder(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return [...FACTORY_ORDER]
  }
}

const STATE_COLOR: Record<SysHealthPoint['state'], string> = { healthy: '#23aa70', verifying: '#d4a72c', repairing: '#3182ce', error: '#d84a4a' }
const STATE_LABEL: Record<SysHealthPoint['state'], string> = { healthy: 'Correcto', verifying: 'Verificando', repairing: 'Reparando', error: 'Error' }

interface AttentionItem {
  title: string
  why: string
  severity: 'error' | 'aviso'
  go?: Section
  goLabel?: string
}

export default function Sistema({ data, session, onChanged, onNavigate, onRunAutomation }: { data: StoredData; session: Session; onChanged: () => void; onNavigate: (s: Section) => void; onRunAutomation?: (task: string) => Promise<string> }) {
  const isAdmin = session.role === 'admin'
  const [autoBusy, setAutoBusy] = useState<string | null>(null)
  const [autoMessage, setAutoMessage] = useState<string | null>(null)
  const runAutomation = async (task: string) => {
    if (!onRunAutomation || autoBusy) return
    setAutoBusy(task)
    setAutoMessage(null)
    try {
      setAutoMessage(await onRunAutomation(task))
    } catch {
      setAutoMessage('La corrida no se pudo completar en este dispositivo.')
    } finally {
      setAutoBusy(null)
    }
  }
  const sbMode = supabaseConfigured()
  const [order, setOrder] = useState<CardId[]>(loadOrder)
  const [organizing, setOrganizing] = useState(false)
  const [query, setQuery] = useState('')
  const [ultra, setUltra] = useState(() => { try { return localStorage.getItem(ULTRA_KEY) === '1' } catch { return false } })
  const [showWhy, setShowWhy] = useState(false)
  const [openAttention, setOpenAttention] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [readings, setReadings] = useState<SysReading[]>(() => loadReadings())
  const [checkedAt] = useState(() => new Date().toISOString())
  const recordedRef = useRef(false)

  // Una lectura real de rendimiento por apertura de Sistema.
  useEffect(() => {
    if (recordedRef.current) return
    recordedRef.current = true
    setReadings(recordReading(data))
    // Solo al montar: la lectura es de la apertura de la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ref = todayISO()
  const model = useMemo(() => {
    const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date))
    const descuadrados = days.filter((d) => d.cuadre !== 0)
    const pending = data.receivables
      .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
      .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
    const morosas = pending.filter((x) => isMorosa(x.rec, x.saldo, ref))
    let coveragePct: number | null = null
    let huecos = 0
    if (days.length) {
      const first = new Date(`${days[0].date}T12:00:00`).getTime()
      const last = new Date(`${days[days.length - 1].date}T12:00:00`).getTime()
      const span = Math.round((last - first) / 86400000) + 1
      coveragePct = Math.round((days.length / span) * 100)
      huecos = span - days.length
    }
    const checks: SysHealthPoint[] = [
      {
        label: 'Datos cargados',
        state: days.length ? 'healthy' : 'verifying',
        detail: `${fmtInt(days.length)} días · ${fmtInt(data.receivables.length)} cuentas · ${fmtInt(data.localPayments.length)} abonos`,
      },
      {
        label: 'Cuadre de los días',
        state: !days.length ? 'verifying' : descuadrados.length ? 'error' : 'healthy',
        detail: !days.length ? 'Sin días que comprobar todavía' : descuadrados.length ? `${fmtInt(descuadrados.length)} de ${fmtInt(days.length)} días con cuadre distinto de cero` : `${fmtInt(days.length)} de ${fmtInt(days.length)} días cuadrados`,
      },
      {
        label: 'Respaldo',
        state: data.importedAt ? 'healthy' : 'verifying',
        detail: data.importedAt ? `Último respaldo importado el ${fmtDate(data.importedAt.slice(0, 10))}` : 'Ningún respaldo importado en esta copia',
      },
      {
        label: 'Conexión',
        state: sbMode ? 'healthy' : 'verifying',
        detail: sbMode ? 'Supabase: los datos viven en el servidor y se sincronizan' : 'Modo local: los datos viven en este dispositivo',
      },
      {
        label: 'Cuentas y plazos',
        state: !data.receivables.length ? 'verifying' : morosas.length ? 'verifying' : 'healthy',
        detail: !data.receivables.length ? 'Sin cuentas cargadas' : morosas.length ? `${fmtInt(morosas.length)} cuentas morosas de ${fmtInt(pending.length)} pendientes` : 'Sin cuentas morosas',
      },
      {
        label: 'Sesión y rol',
        state: 'healthy',
        detail: `${session.name} · ${isAdmin ? 'Administrador' : 'Solo lectura'}`,
      },
    ]
    const healthyCount = checks.filter((c) => c.state === 'healthy').length
    const healthPct = Math.round((healthyCount / checks.length) * 100)

    const attention: AttentionItem[] = []
    if (descuadrados.length) attention.push({
      title: `${fmtInt(descuadrados.length)} ${descuadrados.length === 1 ? 'día importado tiene' : 'días importados tienen'} el cuadre distinto de cero`,
      why: `Son ${descuadrados.map((d) => fmtDate(d.date)).join(', ')}. El respaldo se muestra tal como entró: la corrección se hace en el IPV del sistema principal y se reimporta; aquí no se ajusta ninguna cifra en silencio.`,
      severity: 'error', go: 'dias', goLabel: 'Ver días',
    })
    if (morosas.length) attention.push({
      title: `${fmtInt(morosas.length)} cuentas morosas por ${fmtCUP(morosas.reduce((s, x) => s + x.saldo, 0))}`,
      why: 'Pasaron su plazo (clientes 7 días, trabajadores 15 días) y siguen pendientes. Se cobran desde Cobrar; Sistema solo señala el estado, no toca saldos.',
      severity: 'aviso', go: 'cobrar', goLabel: 'Ir a Cobrar',
    })
    if (!data.importedAt) attention.push({
      title: 'Esta copia aún no tiene respaldo importado',
      why: 'Sin respaldo, días y cuentas están vacíos a propósito: nada se inventa. Importa el respaldo del SDA desde la tarjeta «Cierre técnico e inicio».',
      severity: 'aviso',
    })
    if (!sbMode) attention.push({
      title: 'Modo local: los datos viven solo en este dispositivo',
      why: 'Sin las claves de Supabase en el entorno, esta copia no se sincroniza con otros dispositivos. El sistema principal sigue siendo la fuente de verdad.',
      severity: 'aviso', go: 'inicio', goLabel: 'Ver Inicio',
    })

    const radarAreas: RadarArea[] = [
      { id: 'cuadres', label: 'Cuadres', score: days.length ? Math.round(((days.length - descuadrados.length) / days.length) * 100) : null },
      { id: 'cobertura', label: 'Cobertura', score: coveragePct },
      { id: 'cuentas', label: 'Cuentas al día', score: pending.length ? Math.round(((pending.length - morosas.length) / pending.length) * 100) : data.receivables.length ? 100 : null },
      { id: 'respaldo', label: 'Respaldo', score: data.importedAt ? 100 : 0 },
      { id: 'conexion', label: 'Conexión', score: sbMode ? 100 : null },
    ]
    const activities: SysActivity[] = []
    if (days.length) activities.push({ label: 'Cuadre de días', value: ((days.length - descuadrados.length) / days.length) * 100, state: descuadrados.length ? 'bad' : 'ok' })
    if (coveragePct !== null) activities.push({ label: 'Cobertura de días', value: coveragePct, state: 'live' })
    if (data.receivables.length) activities.push({ label: 'Cuentas al día', value: pending.length ? ((pending.length - morosas.length) / pending.length) * 100 : 100, state: morosas.length ? 'warn' : 'ok' })
    const events = days.map((d) => ({ date: d.date, fallos: d.cuadre === 0 ? 0 : 1 }))
    return { days, descuadrados, pending, morosas, checks, healthPct, attention, radarAreas, activities, events, huecos }
  }, [data, session, isAdmin, sbMode, ref])

  const profiles = sbMode
    ? [{ id: session.profileId, name: session.name, email: session.email, role: session.role }]
    : listProfiles()

  const saveOrder = (next: CardId[]) => {
    setOrder(next)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)) } catch { /* sin almacenamiento: el orden vive en memoria */ }
  }
  const move = (id: CardId, dir: -1 | 1) => {
    const idx = order.indexOf(id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= order.length) return
    const next = [...order]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    saveOrder(next)
  }
  const toggleUltra = () => {
    setUltra((v) => {
      try { localStorage.setItem(ULTRA_KEY, v ? '0' : '1') } catch { /* igual */ }
      return !v
    })
  }
  const doReset = () => {
    resetLocalData()
    setConfirmReset(false)
    setMessage('Datos locales restablecidos: días, cuentas y abonos de este dispositivo quedaron vacíos. El sistema original no se tocó.')
    onChanged()
  }

  const ringColor = model.healthPct >= 85 ? 'var(--accent)' : model.healthPct >= 70 ? '#c9a227' : model.healthPct >= 50 ? '#e07b24' : 'var(--danger)'
  const checkedTime = new Intl.DateTimeFormat('es-CU', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(checkedAt))
  const pesoReadings = readings.flatMap((r) => (r.pesoKb == null ? [] : [r.pesoKb]))
  const visibleOrder = order.filter((id) => id !== 'atencion' || model.attention.length > 0)
    .filter((id) => !query.trim() || CARD_LABEL[id].toLowerCase().includes(query.trim().toLowerCase()))

  const renderCard = (id: CardId) => {
    switch (id) {
      case 'evolucion': {
        const stageState = model.attention.some((a) => a.severity === 'error') ? 'alert' : 'idle'
        return (
          <Card>
            <div className="evo-wrap">
              <QueenReactorMark stageId={QUEEN_STAGE} state={stageState} size={76} />
              <div style={{ minWidth: 0 }}>
                <p className="eyebrow">Evolución de Queen</p>
                <h3 className="evo-stage">Etapa {QUEEN_REACTOR_STAGES[QUEEN_STAGE].label}</h3>
                <p className="sub" style={{ margin: 0 }}>Salud del organismo en esta copia: {model.healthPct} % · Estado: {stageState === 'alert' ? 'en alerta' : 'en calma'}</p>
              </div>
            </div>
            <div className="evo-stages">
              {(Object.keys(QUEEN_REACTOR_STAGES) as ReactorStageId[]).map((s) => (
                <span key={s} className={`evo-stage-chip${s === QUEEN_STAGE ? ' current' : ''}`}>
                  <i style={{ background: QUEEN_REACTOR_STAGES[s].color }} />{QUEEN_REACTOR_STAGES[s].label}
                </span>
              ))}
            </div>
            <p className="small muted">La etapa es la registrada del Reactor Evolutivo (Joven). Esta copia muestra su identidad y su salud medida aquí; su evolución se calcula en el organismo principal con todas sus señales.</p>
          </Card>
        )
      }
      case 'vistazo':
        return (
          <section className="premium-panel" style={{ marginBottom: 0 }} aria-label="De un vistazo">
            <div className="premium-head">
              <div className="premium-ring" style={{ '--ring-deg': `${model.healthPct * 3.6}deg`, '--ring-color': ringColor } as React.CSSProperties}>
                <span><strong>{model.healthPct}</strong><small>salud</small></span>
              </div>
              <div className="premium-text">
                <span className="premium-kicker"><i aria-hidden /> De un vistazo</span>
                <p className="premium-title">{model.attention.length === 0 ? 'Todo bien' : `Hay ${model.attention.length} ${model.attention.length === 1 ? 'cosa' : 'cosas'} que necesitan tu atención hoy`}</p>
                <p className="premium-sub">Comprobado a las {checkedTime} · {fmtInt(model.checks.filter((c) => c.state === 'healthy').length)} de {fmtInt(model.checks.length)} comprobaciones en correcto</p>
                <div className="premium-actions">
                  <button className="btn" onClick={() => setShowWhy((v) => !v)}>¿Por qué este número?</button>
                  <button className="btn" onClick={() => onNavigate('queen')}>Preguntar a Queen</button>
                </div>
              </div>
            </div>
            {showWhy ? (
              <div className="why-list">
                {model.checks.map((c) => (
                  <div className="rt-health-row" key={c.label}>
                    <i style={{ background: STATE_COLOR[c.state] }} />
                    <span className="grow">{c.label}<span className="muted">{c.detail}</span></span>
                    <span className="chip">{STATE_LABEL[c.state]}</span>
                  </div>
                ))}
                <p className="small muted">La salud es el porcentaje de comprobaciones en estado «Correcto». Cada comprobación lee datos reales de esta copia; ninguna cifra viene de fuera.</p>
              </div>
            ) : null}
          </section>
        )
      case 'atencion':
        return (
          <Card>
            <h3>Necesita tu atención hoy</h3>
            {model.attention.map((item, i) => (
              <div className="attention-item" key={item.title}>
                <button className="attention-head" onClick={() => setOpenAttention(openAttention === i ? null : i)} aria-expanded={openAttention === i}>
                  <i style={{ background: item.severity === 'error' ? 'var(--danger)' : '#d4a72c' }} />
                  <span className="grow">{item.title}</span>
                  <Icon name={openAttention === i ? 'chevronL' : 'chevronR'} size={16} />
                </button>
                {openAttention === i ? (
                  <div className="attention-body">
                    <p>{item.why}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {item.go ? <button className="btn" onClick={() => onNavigate(item.go!)}>{item.goLabel ?? 'Ir'}</button> : null}
                      <button className="btn" onClick={() => onNavigate('queen')}>Preguntar a Queen</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        )
      case 'organismo':
        return (
          <Card>
            <h3>El SDA como organismo</h3>
            <p className="sub">Centinelas de esta copia: cada uno lee su señal real y declara su estado.</p>
            {model.checks.map((c) => (
              <div className="rt-health-row" key={c.label}>
                <i style={{ background: STATE_COLOR[c.state] }} />
                <span className="grow">{c.label}<span className="muted">{c.detail}</span></span>
                <span className="chip">{STATE_LABEL[c.state]}</span>
              </div>
            ))}
          </Card>
        )
      case 'queen':
        return (
          <Card>
            <h3>Queen y red neuronal</h3>
            <div className="evo-wrap" style={{ alignItems: 'flex-start' }}>
              <QueenOrb size={44} />
              <p className="sub" style={{ margin: 0 }}>
                En esta copia Queen vigila {fmtInt(model.days.length)} días importados, {fmtInt(data.receivables.length)} cuentas y la salud de {fmtInt(model.checks.length)} centinelas.
                Su conversación y su red se conectan en la fase de IA; aquí no hay respuestas simuladas.
              </p>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => onNavigate('queen')}>Abrir la consola de Queen</button>
            </div>
          </Card>
        )
      case 'diagnostico':
        return (
          <Card>
            <h3>Diagnóstico general</h3>
            <p className="sub">Salud por áreas, medida de los datos de esta copia. Las áreas sin verificar no entran en el radar: no se dibujan como cero.</p>
            {!ultra ? <DiagnosticRadar areas={model.radarAreas} /> : null}
            <div className="diag-areas">
              {model.radarAreas.map((a) => (
                <div className="diag-area" key={a.id}>
                  <div className="diag-area-head"><span>{a.label}</span><strong>{a.score === null ? 'Sin verificar' : `${a.score}/100`}</strong></div>
                  <div className="diag-bar"><i style={{ width: `${a.score ?? 0}%`, background: 'linear-gradient(90deg, #23aa70, #a8c256, #e9a13b)', backgroundSize: `${10000 / Math.max(1, a.score ?? 0)}% 100%`, backgroundRepeat: 'no-repeat' }} /></div>
                </div>
              ))}
            </div>
          </Card>
        )
      case 'adn':
        return (
          <Card>
            <h3>ADN operativo</h3>
            <p className="sub">Las reglas que este sistema no negocia, heredadas del SDA original:</p>
            {[
              'El IPV es la fuente de verdad: el sistema nunca altera sus cifras.',
              'Nada se inventa: un dato ausente se muestra como ausencia, nunca como cero.',
              'Plazos de cobro: clientes 7 días, trabajadores 15 días; vencida = morosa.',
              '«Dinero en la calle» son solo las cuentas de clientes.',
              'La quincena contable (1–15 y 16–fin de mes) no se confunde con el ciclo de RH de 15 días exactos.',
              'Queen no toca dinero, cuentas, IPV, ADN ni permisos sin el «Sí» del dueño.',
            ].map((rule) => (
              <div className="list-row" key={rule} style={{ cursor: 'default' }}>
                <span className="lr-check"><Icon name="check" size={15} /></span>
                <span className="grow" style={{ fontSize: '0.9rem' }}>{rule}</span>
              </div>
            ))}
          </Card>
        )
      case 'tiempo-real':
        return (
          <Card>
            <h3>Sistema en tiempo real (gráficos)</h3>
            {ultra ? (
              <p className="sub" style={{ margin: 0 }}>Modo ultraligero: salud {model.healthPct} % · {fmtInt(model.checks.length)} componentes · {fmtInt(model.descuadrados.length)} fallos de cuadre · {fmtInt(readings.length)} lecturas de rendimiento guardadas. Desactiva el modo ultraligero para ver los gráficos.</p>
            ) : (
              <SystemRealtimeCharts health={model.checks} activities={model.activities} events={model.events} readings={readings} checkedAt={checkedAt} />
            )}
          </Card>
        )
      case 'rutinas': {
        const nowDate = new Date()
        const nowTime = `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`
        const autoStatus = buildAutomationsStatus(data, data.automationRuns, data.queenLearning, { date: todayISO(), time: nowTime })
        const rutinas: Array<{ name: string; state: string; detail: string; value?: number; tone?: SysActivity['state'] }> = [
          { name: 'Importación de respaldo', state: data.importedAt ? 'Completada' : 'Pendiente', detail: data.importedAt ? `Última: ${fmtDate(data.importedAt.slice(0, 10))}` : 'Sin ejecuciones en esta copia', value: data.importedAt ? 100 : 0, tone: 'ok' },
          { name: 'Verificación de cuadres', state: 'Completada', detail: model.days.length ? `${fmtInt(model.days.length - model.descuadrados.length)} de ${fmtInt(model.days.length)} días cuadrados` : 'Sin días que verificar', value: model.days.length ? ((model.days.length - model.descuadrados.length) / model.days.length) * 100 : 0, tone: model.descuadrados.length ? 'bad' : 'ok' },
          { name: 'Revisión de plazos y morosidad', state: 'Completada', detail: `${fmtInt(model.morosas.length)} morosas de ${fmtInt(model.pending.length)} pendientes`, value: model.pending.length ? ((model.pending.length - model.morosas.length) / model.pending.length) * 100 : 100, tone: model.morosas.length ? 'warn' : 'ok' },
          { name: 'Respaldo diario automático (23:45)', state: autoStatus.backup.lastRunAt ? 'Registrado' : 'En el sistema principal', detail: autoStatus.backup.lastRunAt ? autoStatus.backup.detail : 'La rutina automática vive en el SDA original; en esta copia la tarea equivalente está construida y pendiente de despliegue en la nube.', tone: 'live' },
        ]
        const manualTasks = ['respaldo', 'mantenimiento', 'aprendizaje', 'boletines']
        return (
          <Card>
            <h3>Rutinas y subrutinas de Queen</h3>
            {rutinas.map((r) => (
              <div className="routine-row" key={r.name}>
                <div className="routine-head"><span>{r.name}</span><span className="chip">{r.state}</span></div>
                <p className="small muted" style={{ margin: '2px 0 6px' }}>{r.detail}</p>
                {r.value !== undefined ? (
                  <span className="rt-act-track"><i style={{ width: `${Math.max(0, Math.min(100, r.value))}%`, background: r.tone === 'bad' ? '#d84a4a' : r.tone === 'warn' ? '#d4a72c' : 'var(--chart-green)' }} /></span>
                ) : null}
              </div>
            ))}
            <h4 style={{ margin: '16px 0 4px' }}>Automatizaciones del sistema externo</h4>
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              Las tareas programadas del original (respaldo, mantenimiento, aprendizaje, boletines y aviso de IPV) están construidas para correr en la nube sobre Supabase, con el mismo resultado. Mientras no se despliegan, su estado es «{autoStatus.cloudStatus}»: aquí no se declara ninguna activa sin estarlo.
            </p>
            {autoStatus.tasks.map((t) => (
              <div className="routine-row" key={t.key}>
                <div className="routine-head"><span>{t.name} · {t.schedule}</span><span className="chip">{t.cloudStatus}</span></div>
                <p className="small muted" style={{ margin: '2px 0 6px' }}>{t.lastDetail}</p>
                {isAdmin && onRunAutomation && manualTasks.includes(t.key) ? (
                  <button className="btn" disabled={autoBusy != null} onClick={() => void runAutomation(t.key)}>
                    {autoBusy === t.key ? 'Ejecutando…' : 'Ejecutar ahora en este dispositivo'}
                  </button>
                ) : null}
              </div>
            ))}
            <p className="small muted" style={{ margin: '8px 0 0' }}>IPV de hoy: {autoStatus.ipvToday.detail}</p>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              Aprendizaje integrado: {fmtInt(autoStatus.learning.integratedConcepts)} conceptos · {fmtInt(autoStatus.learning.integratedAliases)} alias · conflictos pendientes del dueño: {fmtInt(autoStatus.learning.pendingConflicts)}. Boletines en cola: {fmtInt(autoStatus.bulletins.pending)}.
            </p>
            {autoMessage ? <p className="small" role="status" style={{ margin: '8px 0 0' }}>{autoMessage}</p> : null}
          </Card>
        )
      }
      case 'monitor':
        return (
          <Card>
            <h3>Monitor del sistema</h3>
            <LiveClock />
            <table className="kv">
              <tbody>
                <tr><td>Modo de datos</td><td>{sbMode ? 'Supabase (servidor)' : 'Local (este dispositivo)'}</td></tr>
                <tr><td>Último respaldo importado</td><td>{data.importedAt ? fmtDate(data.importedAt.slice(0, 10)) : 'Ninguno'}</td></tr>
                <tr><td>Respaldo exportado por el SDA</td><td>{data.exportedAt || '—'}</td></tr>
                <tr><td>Lecturas de Sistema guardadas</td><td>{fmtInt(readings.length)}</td></tr>
              </tbody>
            </table>
            {pesoReadings.length >= 2 ? (
              <>
                <p className="small muted" style={{ margin: '12px 0 4px' }}>Peso de los datos cargados por lectura (KB)</p>
                <Sparkline values={pesoReadings.slice(-30)} />
              </>
            ) : (
              <p className="small muted" style={{ marginTop: 10 }}>La mini línea del monitor se dibuja con dos o más lecturas reales de Sistema en este dispositivo; todavía no las hay.</p>
            )}
          </Card>
        )
      case 'integracion':
        return (
          <Card>
            <h3>Cómo se integra la información</h3>
            <p className="sub">El recorrido real de los datos en esta copia. Toca un destino para ir.</p>
            {[
              { icon: 'upload' as const, text: 'El respaldo del SDA entra por importación y puebla días y cuentas sin tocar sus cifras.', go: undefined },
              { icon: 'calendar' as const, text: 'Días: cada jornada importada, con su cuadre tal como entró.', go: 'dias' as Section, label: 'Ir a Días' },
              { icon: 'dashboard' as const, text: 'Inicio resume el período solo con los días importados.', go: 'inicio' as Section, label: 'Ir a Inicio' },
              { icon: 'wallet' as const, text: 'Las cuentas del respaldo se cobran en Cobrar; el abono se aplica a la más antigua primero.', go: 'cobrar' as Section, label: 'Ir a Cobrar' },
              { icon: 'sparkle' as const, text: sbMode ? 'En modo Supabase los abonos se guardan en el servidor y se ven en todos los dispositivos.' : 'En modo local los abonos quedan como capa en este dispositivo.', go: undefined },
            ].map((row, i) => (
              <div className="list-row" key={i} style={{ cursor: 'default' }}>
                <span className="row-ico"><Icon name={row.icon} size={20} /></span>
                <span className="grow" style={{ fontSize: '0.9rem' }}>{row.text}</span>
                {row.go ? <button className="btn" onClick={() => onNavigate(row.go!)}>{row.label}</button> : null}
              </div>
            ))}
          </Card>
        )
      case 'accesos':
        return (
          <Card>
            <h3>Accesos directos</h3>
            <div className="access-grid">
              {([
                { go: 'inicio' as Section, icon: 'dashboard' as const, label: 'Inicio' },
                { go: 'cobrar' as Section, icon: 'wallet' as const, label: 'Cobrar' },
                { go: 'dias' as Section, icon: 'calendar' as const, label: 'Días' },
                { go: 'cuentas' as Section, icon: 'receipt' as const, label: 'Cuentas' },
                { go: 'mas' as Section, icon: 'more' as const, label: 'Más secciones' },
              ]).map((a) => (
                <button key={a.go} className="quick-action" onClick={() => onNavigate(a.go)}>
                  <span className="qa-ico"><Icon name={a.icon} size={19} /></span>
                  <span className="qa-label">{a.label}</span>
                </button>
              ))}
              <button className="quick-action" onClick={() => onNavigate('queen')}>
                <span className="qa-ico"><QueenOrb size={24} /></span>
                <span className="qa-label">Queen</span>
              </button>
            </div>
          </Card>
        )
      case 'simulacion': {
        const scenarios = [
          { name: 'Días sin importar entre el primero y el último', active: model.huecos > 0, detail: model.days.length ? (model.huecos > 0 ? `Activo: faltan ${fmtInt(model.huecos)} días en el rango importado; un día ausente no cuenta como venta 0.` : 'No aplica: el rango importado está completo.') : 'Sin días importados: la simulación no tiene rango que leer.' },
          { name: 'Cuentas vencidas sin cobrar', active: model.morosas.length > 0, detail: model.morosas.length ? `Activo: ${fmtInt(model.morosas.length)} cuentas morosas por ${fmtCUP(model.morosas.reduce((s, x) => s + x.saldo, 0))}.` : 'No aplica: no hay cuentas morosas en esta copia.' },
          { name: 'Respaldo ausente', active: !data.importedAt, detail: data.importedAt ? `No aplica: el último respaldo entró el ${fmtDate(data.importedAt.slice(0, 10))}.` : 'Activo: esta copia no tiene respaldo; las pantallas quedan vacías a propósito.' },
          { name: 'Día con cuadre distinto de cero', active: model.descuadrados.length > 0, detail: model.descuadrados.length ? `Activo: ${fmtInt(model.descuadrados.length)} días por revisar en el sistema principal.` : 'No aplica: todos los días importados cuadran.' },
        ]
        return (
          <Card>
            <h3>Simulación de escenarios críticos</h3>
            <p className="sub">Cada escenario se lee contra el estado actual de esta copia; la simulación no ejecuta ningún cambio.</p>
            {scenarios.map((s) => (
              <div className="rt-health-row" key={s.name}>
                <i style={{ background: s.active ? '#d84a4a' : '#23aa70' }} />
                <span className="grow">{s.name}<span className="muted">{s.detail}</span></span>
                <span className="chip">{s.active ? 'Activo' : 'No aplica'}</span>
              </div>
            ))}
          </Card>
        )
      }
      case 'errores':
        return (
          <Card>
            <h3>Banco de errores · Sistema inmune</h3>
            <p className="sub">Cada error verificado deja una célula. Sin errores verificados, el banco queda vacío: no se siembran células de ejemplo.</p>
            {model.descuadrados.length ? model.descuadrados.map((d) => (
              <div className="immune-cell" key={d.date}>
                <div className="immune-head"><strong>Cuadre distinto de cero</strong><span className="chip morosa">{fmtCUP(d.cuadre)}</span></div>
                <table className="kv">
                  <tbody>
                    <tr><td>Firma</td><td>cuadre≠0 · {d.date}</td></tr>
                    <tr><td>Módulo</td><td>Días · IPV</td></tr>
                    <tr><td>Causa</td><td>El cuadre del día no es cero en el respaldo importado</td></tr>
                    <tr><td>Anticuerpo</td><td>Revisar ese IPV en el sistema principal y reimportar el respaldo</td></tr>
                    <tr><td>Detecciones</td><td>1</td></tr>
                    <tr><td>Neutralizaciones</td><td>0</td></tr>
                  </tbody>
                </table>
              </div>
            )) : (
              <div className="ok-box" style={{ marginBottom: 0 }}>Sin células: ningún error verificado en los datos cargados. Todos los días importados cuadran.</div>
            )}
          </Card>
        )
      case 'tareas': {
        const tasks: Array<{ name: string; state: string; detail: string }> = [
          { name: 'Importación del respaldo', state: data.importedAt ? 'Completada' : 'Pendiente', detail: data.importedAt ? `Última importación: ${fmtDate(data.importedAt.slice(0, 10))}` : 'Ninguna importación en esta copia' },
          { name: 'Verificación de cuadres', state: 'Completada', detail: model.days.length ? `${fmtInt(model.days.length - model.descuadrados.length)} de ${fmtInt(model.days.length)} días cuadrados` : 'Sin días que verificar' },
          { name: 'Sincronización con el servidor', state: sbMode ? 'Continua' : 'No aplica', detail: sbMode ? 'Supabase activo: la lectura y la escritura pasan por el servidor' : 'Modo local en este dispositivo' },
          { name: 'Copia exacta del sistema externo', state: 'En curso', detail: 'Igualación pantalla por pantalla contra el SDA original, con confirmación visual del dueño' },
        ]
        return (
          <Card>
            <h3>Tareas y disciplina</h3>
            {tasks.map((t) => (
              <div className="rt-health-row" key={t.name}>
                <span className="grow">{t.name}<span className="muted">{t.detail}</span></span>
                <span className="chip">{t.state}</span>
              </div>
            ))}
          </Card>
        )
      }
      case 'cierre':
        return (
          <Card>
            <h3>Cierre técnico e inicio</h3>
            <div className="startup-list">
              {[
                { ok: true, label: 'Arranque y sesión', detail: `${session.name} · ${isAdmin ? 'Administrador' : 'Solo lectura'}` },
                { ok: model.days.length > 0, label: 'Carga de datos', detail: `${fmtInt(model.days.length)} días · ${fmtInt(data.receivables.length)} cuentas · ${fmtInt(data.localPayments.length)} abonos` },
                { ok: Boolean(data.importedAt), label: 'Respaldo', detail: data.importedAt ? `Importado el ${fmtDate(data.importedAt.slice(0, 10))}${data.exportedAt ? ` · exportado por el SDA: ${data.exportedAt}` : ''}` : 'Sin respaldo importado' },
                { ok: model.healthPct >= 70, label: 'Salud de arranque', detail: `${model.healthPct} % de comprobaciones en correcto` },
              ].map((e) => (
                <div className="rt-health-row" key={e.label}>
                  <i style={{ background: e.ok ? '#23aa70' : '#d4a72c' }} />
                  <span className="grow">{e.label}<span className="muted">{e.detail}</span></span>
                </div>
              ))}
            </div>

            {isAdmin ? (
              <>
                <h4 className="sistema-h4">Importar IPV del día (Excel)</h4>
                <ImportIpv onImported={onChanged} existingDays={data.days} bare />
                <h4 className="sistema-h4">Importar respaldo del SDA</h4>
                <ImportBackup onImported={onChanged} bare />
              </>
            ) : null}

            <h4 className="sistema-h4">Perfiles de acceso</h4>
            <p className="sub">{sbMode
              ? 'Las cuentas viven en Supabase Auth con su rol en el servidor; aquí solo se muestra tu propia sesión (la lista completa la gestiona el administrador en el panel de Supabase).'
              : 'Acceso local de demostración estructural: replica los roles de la fase 1. La seguridad final será la de Supabase.'}</p>
            {profiles.map((p) => (
              <div className="list-row" key={p.id} style={{ cursor: 'default' }}>
                <span className="grow">{p.name}<span className="muted">{p.email}</span></span>
                <span className="chip">{p.role === 'admin' ? 'Administrador' : 'Solo lectura'}</span>
              </div>
            ))}

            {isAdmin && sbMode ? (
              <>
                <h4 className="sistema-h4">Datos en el servidor</h4>
                <p className="sub" style={{ margin: 0 }}>En modo Supabase no hay datos locales que restablecer: días, cuentas y abonos viven en el servidor. Importar un respaldo más fresco (arriba) actualiza el servidor sin duplicar; los abonos de Cobrar ya registrados no se tocan.</p>
              </>
            ) : null}

            {isAdmin && !sbMode ? (
              <>
                <h4 className="sistema-h4">Datos locales</h4>
                <p className="sub">Restablecer borra de este dispositivo los días, las cuentas y los abonos locales. No toca el sistema original ni ningún servidor.</p>
                {message ? <div className="ok-box">{message}</div> : null}
                {!confirmReset ? (
                  <button className="btn danger" onClick={() => setConfirmReset(true)}>Restablecer datos locales</button>
                ) : (
                  <div>
                    <p className="small">¿Seguro? Esta acción no se puede deshacer en este dispositivo.</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn danger" onClick={doReset}>Sí, restablecer</button>
                      <button className="btn" onClick={() => setConfirmReset(false)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </Card>
        )
    }
  }

  return (
    <div>
      <TabHeader icon="sparkle" title="Sistema" desc="Salud, seguridad y funcionamiento" badge={TAB_BADGES.sistema} />

      {/* Tarjeta de fecha y hora: siempre primera, fuera del panel. */}
      <Card className="clock-card">
        <LiveClock />
      </Card>

      {/* Barra de controles: fija arriba, no se reordena. */}
      <div className="sistema-controls">
        <div className="field" style={{ margin: 0, flex: '1 1 180px' }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar tarjeta…" aria-label="Buscar tarjeta de Sistema" />
        </div>
        <button className={`btn${organizing ? ' primary' : ''}`} onClick={() => setOrganizing((v) => !v)}>{organizing ? 'Listo' : 'Organizar'}</button>
        <button className={`btn${ultra ? ' primary' : ''}`} onClick={toggleUltra} aria-pressed={ultra}>Ultraligero</button>
      </div>

      {organizing ? (
        <Card>
          <h3>Organizar tarjetas</h3>
          <p className="sub">El orden se guarda en este dispositivo y se aplica a la consola, como en el original. La tarjeta de fecha y hora y esta barra quedan siempre fijas arriba.</p>
          {order.map((id) => (
            <div className="list-row" key={id} style={{ cursor: 'default' }}>
              <span className="grow">{CARD_LABEL[id]}{id === 'atencion' ? <span className="muted">Solo aparece cuando hay avisos</span> : null}</span>
              <button className="btn" onClick={() => move(id, -1)} aria-label={`Subir ${CARD_LABEL[id]}`}>↑</button>
              <button className="btn" onClick={() => move(id, 1)} aria-label={`Bajar ${CARD_LABEL[id]}`}>↓</button>
            </div>
          ))}
          <button className="btn" onClick={() => saveOrder([...FACTORY_ORDER])}>Restablecer orden de fábrica</button>
        </Card>
      ) : null}

      <div className="sistema-stack">
        {visibleOrder.map((id) => (
          <div key={id} className="sistema-slot" style={{ order: order.indexOf(id) }}>
            {renderCard(id)}
          </div>
        ))}
        {visibleOrder.length === 0 ? (
          <Card><p className="sub" style={{ margin: 0 }}>Ninguna tarjeta coincide con esa búsqueda.</p></Card>
        ) : null}
      </div>

      {/* Procedencia de las cuentas: plegable cerrado por defecto. */}
      <details className="card fold-card">
        <summary>Procedencia de las cuentas</summary>
        <div className="fold-body">
          <p>Las cuentas que ves en Cobrar salen del respaldo del SDA{data.backupOf ? ` (${data.backupOf})` : ''}{data.exportedAt ? `, exportado el ${data.exportedAt}` : ''}{data.importedAt ? ` e importado en esta copia el ${fmtDate(data.importedAt.slice(0, 10))}` : ''}. El respaldo es la fuente: sus saldos no se ajustan aquí.</p>
          <p>Los abonos registrados en Cobrar se aplican como una capa sobre ese saldo{sbMode ? ' guardada en Supabase (tabla payments), visible en todos los dispositivos' : ' guardada en este dispositivo'}, sin reescribir el respaldo. Si dos respaldos no coinciden, manda el último importado.</p>
        </div>
      </details>
    </div>
  )
}
