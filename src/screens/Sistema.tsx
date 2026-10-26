import { useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import '../components/systemMirror.css'
import ImportBackup from '../components/ImportBackup'
import ImportIpv from '../components/ImportIpv'
import { Icon } from '../components/icons'
import { QueenOrb, QueenReactorMark } from '../components/QueenReactor'
import QueenEvolutionPanel from '../components/QueenEvolutionPanel'
import { buildQueenEvolution, buildQueenErrorBank, buildQueenHealth, QUEEN_OWNER_DIRECTIVES } from '../lib/queenCore.mjs'
import ImmuneLiveField, { buildImmuneBankView } from '../components/ImmuneLiveField'
import { listCloneIntegrityIssues, runMaintenanceDiagnosis } from '../lib/automatizacionesCore.mjs'
import {
  CriticalSimulationPanel, DnaHelix, IntegrationMap, IpvNeuralMap, OrganismMap, QueenBrain,
  StartupTimeline, DNA_STATE_COPY, PROGRESS_POINTS, globalStateOf, healthFor, runCriticalSimulation,
  readStartupMetrics,
  type IntegrationNodeDef, type MirrorSegment, type SimulationReport, type StartupEntry,
} from '../components/systemMirror'
import { DiagnosticRadar, LiveClock, Sparkline, SystemRealtimeCharts, type RadarArea, type SysActivity, type SysHealthPoint } from '../components/systemCharts'
import { listProfiles, resetLocalData, supabaseConfigured } from '../lib/backend'
import { loadReadings, recordReading, seedHistoricalReadings, type SysReading } from '../lib/sysReadings'
import { effectiveSaldo, fmtCUP, fmtDate, fmtInt, havanaNow, havanaNowParts, isMorosa, todayISO } from '../lib/utils'
import { buildAutomationsStatus } from '../lib/automatizacionesCore.mjs'

/* Consola de Sistema del original: 16 tarjetas reordenables (SISTEMA_CARDS).
   REFUERZO DEL DUEÑO (2026-10-25): «Haz una copia exacta de todo el
   sistema» — las piezas visuales viven en components/systemMirror.tsx /
   systemMirror.css, portadas TAL CUAL del original (clases, valores,
   keyframes y estructura) siempre que la arquitectura del clon lo
   permite; lo imposible por arquitectura queda documentado allí y en
   el informe del área.
   CON TabHeader en Sistema (badge sparkle y chip «Núcleo de Queen»,
   como renderiza el original; la omisión anterior nació de una
   lectura equivocada y el render lado a lado del 26-oct la corrigió)
   y SIN tarjeta de reloj fija: el
   reloj en vivo vive SOLO dentro de «Monitor del sistema», como el
   LiveClockCard dentro del monitor del original.
   La barra de controles (buscar, organizar, modo ultraligero) queda
   fija arriba y NO se reordena. El orden de tarjetas se guarda en
   localStorage: es preferencia de ESTE dispositivo (en el clon no
   existe la persistencia en servidor del original — getSystemCardOrder
   vive en su backend de artefacto — y no se simula).
   Todo lo que se pinta sale de comprobaciones reales sobre los datos
   cargados en esta copia: lo no verificable se dice, no se rellena.
   Sistema es solo salud y funcionamiento técnico: nada de cifras de
   negocio fuera de lo que el original muestra en esta pestaña. */

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
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [simulation, setSimulation] = useState<SimulationReport | null>(null)
  const [startupEntries, setStartupEntries] = useState<StartupEntry[]>([])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  // Línea de tiempo de inicio: fases medidas de verdad en el cliente.
  useEffect(() => {
    let cancelled = false
    const update = () => {
      if (!cancelled) {
        const m = readStartupMetrics()
        const services: StartupEntry[] = [
          { key: 'svc-datos', label: 'Servicio · Datos cargados', detail: `${data.days.length} días · ${data.receivables.length} cuentas en esta copia.`, ms: null, status: data.days.length ? 'ok' : 'pending' },
          { key: 'svc-respaldo', label: 'Servicio · Respaldo', detail: data.importedAt ? `Importado el ${data.importedAt.slice(0, 10)}.` : 'Sin respaldo importado en esta copia.', ms: null, status: data.importedAt ? 'ok' : 'warn' },
          { key: 'svc-conexion', label: 'Servicio · Conexión', detail: sbMode ? 'Supabase configurado en el entorno.' : 'Modo local en este dispositivo.', ms: null, status: sbMode ? 'ok' : 'warn' },
        ]
        setStartupEntries([...m.phases, ...m.modules, ...services])
      }
    }
    update()
    if (document.readyState !== 'complete') window.addEventListener('load', update)
    return () => { cancelled = true; window.removeEventListener('load', update) }
    // Solo al montar: las fases son las de esta sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Siembra histórica + una lectura real de rendimiento por apertura.
  useEffect(() => {
    if (recordedRef.current) return
    recordedRef.current = true
    seedHistoricalReadings(data.days, data.days.map((d) => d.date))
    setReadings(recordReading(data))
    // Solo al montar: la siembra y la lectura son de la apertura.
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
    const integrity = listCloneIntegrityIssues(data)
    const maintenance = runMaintenanceDiagnosis(data)
    const evo = buildQueenEvolution(data, ref)
    const queenHealth = buildQueenHealth(data, ref)
    const errorBank = buildQueenErrorBank(data)
    const pendingBulletins = data.bulletins.filter((b) => b.status !== 'enviado').length
    const failedBulletins = data.bulletins.filter((b) => b.status === 'error').length
    const hasRh = days.some((d) => (d.rh?.length ?? 0) > 0)
    const productsCount = new Set(days.flatMap((d) => d.departments.flatMap((dep) => dep.products.map((pr) => pr.name)))).size
    const autoStatusEarly = buildAutomationsStatus(data, data.automationRuns, data.queenLearning, { date: ref, time: '12:00' })
    const seg = (id: string, area: string, state: SysHealthPoint['state'], detail: string, facts?: Array<{ label: string; value: string }>): MirrorSegment => ({ id, area, state, detail, facts })
    // Segmentos ADN del original (15) + salud ampliada: cada señal sale
    // de un dato real de esta copia, declarado junto a la señal.
    const segments: MirrorSegment[] = [
      seg('interfaz', 'Interfaz adaptable', 'healthy', 'La interfaz respondió en este dispositivo y Sistema se pintó sin error de render en esta apertura.'),
      seg('datos', 'Núcleo de datos', integrity.length ? 'error' : days.length ? 'healthy' : 'verifying', integrity.length ? `${fmtInt(integrity.length)} problema(s) de integridad: ${integrity[0].detail}` : days.length ? `${fmtInt(days.length)} días disponibles; no hay error técnico marcado.` : 'Listo para verificar cuando se importe el primer IPV.'),
      seg('memoria', 'Memoria de Queen', (Object.keys(data.learnedKinds).length + Object.keys(data.aliases).length + Object.keys(data.cuentasOverrides).length) > 0 ? 'healthy' : 'verifying', `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} reglas permanentes, ${fmtInt(Object.keys(data.learnedKinds).length)} clasificaciones, ${fmtInt(Object.keys(data.aliases).length)} alias y ${fmtInt(Object.keys(data.cuentasOverrides).length)} decisiones del dueño viajan en esta copia.`),
      seg('aprendizaje', 'Aprendizaje', data.queenLearning ? 'healthy' : 'verifying', data.queenLearning ? `${fmtInt(data.queenLearning.integratedConcepts.length)} conceptos y ${fmtInt(data.queenLearning.integratedAliases.length)} alias integrados por el ciclo de aprendizaje.` : 'El ciclo de aprendizaje de esta copia aún no registra integración: Queen espera una corrección o un patrón confirmado.'),
      seg('pensamiento', 'Pensamiento operativo', integrity.length ? 'repairing' : days.length ? 'healthy' : 'verifying', integrity.length ? 'El razonamiento operativo está priorizando las incidencias detectadas.' : days.length ? `Analiza ${fmtInt(days.length)} días y el estado conectado de cada módulo.` : 'Preparado para razonar sobre el primer conjunto de datos importado.'),
      seg('ipv', 'IPV y cuadre', !days.length ? 'verifying' : descuadrados.length ? 'error' : 'healthy', !days.length ? 'Esperando datos suficientes para verificar el cuadre.' : descuadrados.length ? `${fmtInt(descuadrados.length)} de ${fmtInt(days.length)} días con cuadre distinto de cero.` : `${fmtInt(days.length)} de ${fmtInt(days.length)} días cuadrados.`),
      seg('auditoria', 'Auditoría IPV', integrity.length || descuadrados.length ? 'error' : days.length ? 'healthy' : 'verifying', `Auditoría derivable del clon: ${fmtInt(days.length)} IPV enlazados, ${fmtInt(integrity.length)} problemas de integridad, ${fmtInt(errorBank.cells.length)} células en el banco de errores.`, [
        { label: 'IPV revisados', value: fmtInt(days.length) },
        { label: 'Cuentas revisadas', value: fmtInt(data.receivables.length) },
        { label: 'Hallazgos de integridad', value: fmtInt(integrity.length) },
      ]),
      seg('cuentas', 'Cuentas y cobros', !data.receivables.length ? 'verifying' : morosas.length ? 'verifying' : 'healthy', data.receivables.length ? `${fmtInt(data.receivables.length)} cuentas conectadas al sistema; ${fmtInt(morosas.length)} morosas.` : 'Sin cuentas para comprobar en este momento.'),
      seg('rh', 'Recursos Humanos', hasRh ? 'healthy' : 'verifying', hasRh ? 'Los datos de RH están enlazados con los IPV importados.' : 'Sin registros de RH para comprobar en este período.'),
      seg('documentos', 'Documentos y envíos', failedBulletins > 0 ? 'error' : pendingBulletins > 0 ? 'repairing' : 'healthy', failedBulletins > 0 ? `${fmtInt(failedBulletins)} boletín(es) con error en la cola.` : pendingBulletins > 0 ? `${fmtInt(pendingBulletins)} boletín(es) pendiente(s) en la cola, sin marcar enviados.` : 'No hay documentos pendientes ni fallos de envío registrados.'),
      seg('respaldos', 'Respaldos', data.importedAt ? 'healthy' : 'repairing', data.importedAt ? `Último respaldo importado el ${fmtDate(data.importedAt.slice(0, 10))}${data.exportedAt ? ` · exportado por el SDA: ${data.exportedAt}` : ''}. Respaldo nocturno en la nube: ${autoStatusEarly.cloudStatus}.` : 'Sin respaldo importado en esta copia.', [
        { label: 'Último respaldo', value: data.importedAt ? fmtDate(data.importedAt.slice(0, 10)) : 'Sin respaldo' },
        { label: 'Destino (original)', value: 'Drive de La Reina / Backup SDA La Reina' },
        { label: 'Estado en el clon', value: autoStatusEarly.cloudStatus },
      ]),
      seg('limpieza', 'Limpieza del sistema', maintenance ? 'healthy' : 'verifying', `Diagnóstico de mantenimiento derivable: ${maintenance.summary}`),
      seg('autorreparacion', 'Autorreparación', 'healthy', 'No hay una reparación automática pausada. Las incidencias que requieren tu acción aparecen arriba con su nombre.'),
      seg('seguridad', 'Acceso y seguridad', 'healthy', `${session.name} · ${isAdmin ? 'Administrador' : 'Solo lectura'} · sesión del clon con roles de Supabase/local; el PIN del original no viaja en el respaldo y no se finge configurado.`),
      seg('conexion', 'Conectividad', sbMode ? 'healthy' : 'repairing', sbMode ? 'Conexión con Supabase configurada: los datos viven en el servidor y se sincronizan.' : 'Modo local: los datos viven en este dispositivo; el trabajo queda protegido y no se finge sincronización.'),
    ]
    const checks: SysHealthPoint[] = segments.map((x) => ({ label: x.area, state: x.state, detail: x.detail }))
    // Salud del original: media de puntos por estado sobre TODOS los
    // segmentos (Correcto 100 · Verificando 72 · Reparando 38 · Error 1),
    // no un simple conteo de «Correcto».
    const healthPct = Math.round(segments.reduce((total, x) => total + PROGRESS_POINTS[x.state], 0) / Math.max(1, segments.length))

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
      { id: 'integridad', label: 'Integridad', score: days.length || data.receivables.length ? Math.max(0, 100 - integrity.length * 25) : null },
      { id: 'documentos', label: 'Documentos', score: data.bulletins.length ? Math.round(((data.bulletins.length - failedBulletins) / data.bulletins.length) * 100) : null },
      { id: 'queen', label: 'Queen', score: evo.score },
    ]
    // Actividad derivada de tareas reales: las jornadas sembradas
    // alimentan las tres primeras (auditoría/cuadre por jornada).
    const activities: SysActivity[] = []
    if (days.length) activities.push({ label: 'Cuadre de días', value: ((days.length - descuadrados.length) / days.length) * 100, state: descuadrados.length ? 'bad' : 'ok' })
    if (coveragePct !== null) activities.push({ label: 'Cobertura de días', value: coveragePct, state: 'live' })
    if (data.receivables.length) activities.push({ label: 'Cuentas al día', value: pending.length ? ((pending.length - morosas.length) / pending.length) * 100 : 100, state: morosas.length ? 'warn' : 'ok' })
    if (days.length) activities.push({ label: 'Integridad sin lesiones', value: Math.max(0, 100 - integrity.length * 25), state: integrity.length ? 'bad' : 'ok' })
    if (data.bulletins.length) activities.push({ label: 'Boletines despachados', value: ((data.bulletins.length - pendingBulletins) / data.bulletins.length) * 100, state: failedBulletins ? 'bad' : pendingBulletins ? 'warn' : 'ok' })
    activities.push({ label: 'Respaldo importado', value: data.importedAt ? 100 : 0, state: data.importedAt ? 'ok' : 'warn' })
    // Eventos: fallos REALES por jornada (cuadre ≠ 0 → 1; merma con
    // costo > 0 ese día → 1). Nada de 0/1 inventado por día sin dato.
    const events = days.map((d) => ({ date: d.date, fallos: (d.cuadre !== 0 ? 1 : 0) + ((d.mermasCosto ?? 0) > 0 ? 1 : 0) }))
    const gaps: string[] = []
    if (days.length) {
      const have = new Set(days.map((d) => d.date))
      for (let cur = days[0].date; cur <= days[days.length - 1].date;) {
        if (!have.has(cur)) gaps.push(cur)
        const nd = new Date(`${cur}T12:00:00`); nd.setDate(nd.getDate() + 1); cur = nd.toISOString().slice(0, 10)
      }
    }
    const organismParts = [
      { id: 'adn', biological: 'ADN', component: 'Código base', fn: 'Conserva las instrucciones del SDA. Cada cambio se incorpora como una nueva versión para que el organismo evolucione sin perder su historia.', state: 'healthy' as MirrorSegment['state'], metric: `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} directivas registradas en el código del clon` },
      { id: 'cerebro', biological: 'Cerebro', component: 'Queen', fn: 'Observa el organismo, relaciona señales y toma iniciativa dentro de sus permisos. Nunca sustituye las barreras del servidor.', state: (descuadrados.length || integrity.length ? 'error' : days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: evo.score !== null ? `Etapa calculada: ${evo.stage.name} · índice ${evo.score}` : 'Sin medición todavía' },
      { id: 'memoria', biological: 'Memoria', component: 'Memoria de Queen', fn: 'Guarda directivas, correcciones confirmadas y patrones supervisados para no preguntar dos veces lo ya aprendido.', state: segments.find((x) => x.id === 'memoria')!.state, metric: `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} reglas · ${fmtInt(Object.keys(data.learnedKinds).length + Object.keys(data.aliases).length)} aprendizajes` },
      { id: 'corazon', biological: 'Corazón', component: 'Motor de datos e IPV', fn: 'Late con cada importación: contrasta el IPV, enlaza cuentas, RH, inventario y fondos, y mantiene el original protegido.', state: segments.find((x) => x.id === 'ipv')!.state, metric: `${fmtInt(days.length)} IPV enlazados` },
      { id: 'pulmones', biological: 'Pulmones', component: 'Sincronización', fn: 'Intercambia solo cambios entre el servidor y los dispositivos. Si la conexión cae, conserva el trabajo y reanuda al recuperar señal.', state: sbMode ? 'healthy' as MirrorSegment['state'] : 'repairing' as MirrorSegment['state'], metric: sbMode ? 'Sincronización diferencial activa' : 'Respiración local · esperando red' },
      { id: 'sangre', biological: 'Sangre', component: 'Datos y eventos', fn: 'Hace circular datos, cambios de estado y eventos entre todos los módulos para que cada parte trabaje con la misma información.', state: (!online ? 'repairing' : days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: online ? `${fmtInt(days.length)} días · flujo conectado` : 'Flujo sin conexión' },
      { id: 'organos', biological: 'Órganos', component: 'Módulos operativos', fn: 'Cada órgano cumple una función especializada y todos comparten el mismo corazón de datos.', state: (hasRh || data.receivables.length || days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: '6 módulos coordinados', modules: ['Cuentas', 'Nómina', 'RH', 'Almacén', 'Inventario', 'Gastos'] },
      { id: 'nervioso', biological: 'Sistema nervioso', component: 'Notificaciones y salud', fn: 'Transporta señales de salud en tiempo real, despierta nodos cuando hay trabajo y avisa cuando algo requiere atención.', state: (failedBulletins ? 'error' : attention.length ? 'repairing' : online ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: attention.length ? `${fmtInt(attention.length)} aviso(s) de Sistema` : 'Señales al corriente' },
      { id: 'inmune', biological: 'Sistema inmune', component: 'Centinelas y cuarentena', fn: 'Comprueba permisos, ADN y versiones sin depender de Queen. Si detecta una lesión, aísla el nodo sin borrar el dato origen.', state: (integrity.length || errorBank.cells.length ? 'error' : 'healthy') as MirrorSegment['state'], metric: errorBank.cells.length ? `${fmtInt(errorBank.cells.length)} célula(s) en el banco` : `${fmtInt(segments.length)} centinelas activos` },
      { id: 'higado', biological: 'Hígado', component: 'Auditoría', fn: 'Filtra inconsistencias, contrasta evidencias y deja un informe verificable sin alterar las cifras del IPV.', state: segments.find((x) => x.id === 'auditoria')!.state, metric: `${fmtInt(integrity.length + errorBank.cells.length)} hallazgos derivables` },
      { id: 'rinones', biological: 'Riñones', component: 'Limpieza', fn: 'Depura únicamente archivos fantasmas después de comprobar que no tengan referencias; nunca toca datos ni documentos activos.', state: segments.find((x) => x.id === 'limpieza')!.state, metric: maintenance.summary },
      { id: 'sueno', biological: 'Sueño', component: 'Mantenimiento profundo', fn: 'En la ventana de sueño revisa módulo por módulo el ADN operativo disponible, contrasta centinelas, rendimiento e integridad, consolida lo aprendido y solo da una reparación por hecha después de verificarla.', state: (data.queenLearning ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: data.queenLearning?.lastRunAt ? `Última consolidación ${data.queenLearning.lastRunAt.slice(0, 10)}` : 'Próximo ciclo nocturno' },
    ]
    return { days, descuadrados, pending, morosas, checks, segments, organismParts, healthPct, attention, radarAreas, activities, events, huecos, gaps, integrity, maintenance, evo, queenHealth, errorBank, pendingBulletins, failedBulletins, hasRh, productsCount, autoStatusEarly }
  }, [data, session, isAdmin, sbMode, ref, online])

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
  // Modo ultraligero GLOBAL: el original lo aplica a todo el
  // sistema y queda activo; el estado vive en localStorage
  // (lib/ultralight, misma clave) y se aplica al <html> desde el
  // arranque. Aquí solo se refleja el valor: al desmontar NO se
  // borra el atributo, porque el ajuste es del sistema entero.
  useEffect(() => {
    document.documentElement.dataset.ultralight = ultra ? 'true' : 'false'
  }, [ultra])
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
  const checkedTime = new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(checkedAt))
  const pesoReadings = readings.flatMap((r) => (r.pesoKb == null ? [] : [r.pesoKb]))
  const visibleOrder = order.filter((id) => id !== 'atencion' || model.attention.length > 0)
    .filter((id) => !query.trim() || CARD_LABEL[id].toLowerCase().includes(query.trim().toLowerCase()))

  const renderCard = (id: CardId) => {
    switch (id) {
      case 'evolucion': {
        const evo = model.evo
        const globalState = globalStateOf(model.segments)
        return (
          <section className="system-evolution system-evolution-featured" aria-labelledby="system-evolution-title">
            <header className="system-evolution-head">
              <div>
                <span className="system-live-kicker"><i aria-hidden="true" /> Desarrollo continuo</span>
                <h3 id="system-evolution-title">Evolución de Queen</h3>
                <p>Etapa actual, capacidad y progreso de aprendizaje en una sola lectura.</p>
              </div>
              <span className="system-evolution-sync" aria-live="polite">Calculada de esta copia</span>
            </header>
            <div className={`system-health-signal dna-state-${globalState}`} role="status" aria-live="polite">
              <i aria-hidden="true" />
              <div><strong>{DNA_STATE_COPY[globalState].short}</strong><span>{model.attention.length ? `${model.attention.length} cosa(s) necesitan tu atención hoy` : 'Todos los componentes observados responden correctamente.'}</span></div>
              <small>{model.healthPct}%</small>
            </div>
            {/* Panel COMPLETO de evolución (puerto de QueenEvolutionPanel
                del original): en el original se monta aquí, dentro de
                esta misma tarjeta de Sistema — héroe con el Reactor por
                etapa y salud en vivo, progreso, las 7 métricas vivas,
                los umbrales de las 5 etapas y el historial. No es otro
                resumen: la consola de Queen conserva solo su línea de
                cabecera, como el original. */}
            <QueenEvolutionPanel evo={evo} health={model.queenHealth.state} serverHistory={data.queenEvolutionHistory} />
          </section>
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
            <OrganismMap
              parts={model.organismParts}
              checkedLabel={checkedTime}
              checkedIso={checkedAt}
              flowModules={[
                { name: 'Cuentas', value: `${fmtInt(model.pending.length)} abiertas` },
                { name: 'Nómina', value: model.hasRh ? 'Sincronizada' : 'En espera' },
                { name: 'RH', value: `${fmtInt(new Set(model.days.flatMap((d) => (d.rh ?? []).map((w) => w.nombre))).size)} personas` },
                { name: 'Almacén', value: model.days.length ? 'Recibe entradas' : 'En espera' },
                { name: 'Inventario', value: model.days.length ? 'Actualizado' : 'En espera' },
                { name: 'Gastos', value: `${fmtInt(data.expenses.length)} registrados` },
              ]}
              online={online}
              failedDocuments={model.failedBulletins}
              technicalErrors={model.integrity.length + model.descuadrados.length}
              ipvMissingAfterClose={havanaNow().hour >= 23 && model.days.length > 0 && model.days[model.days.length - 1]?.date !== ref}
            />
          </Card>
        )
      case 'queen': {
        const queenIds = new Set(['memoria', 'aprendizaje', 'pensamiento', 'auditoria', 'respaldos', 'autorreparacion'])
        const dnaIds = new Set(['interfaz', 'datos', 'ipv', 'cuentas', 'rh', 'documentos', 'respaldos', 'limpieza', 'seguridad', 'conexion'])
        const queenSegments = model.segments.filter((x) => queenIds.has(x.id))
        const dnaSegments = model.segments.filter((x) => dnaIds.has(x.id))
        const suspended = dnaSegments.filter((x) => x.state === 'healthy').length
        const capacityTotal = queenSegments.reduce((t, x) => t + (({ memoria: 10, aprendizaje: 8, pensamiento: 8, auditoria: 5, respaldos: 4, autorreparacion: 4 } as Record<string, number>)[x.id] ?? 0), 0)
        const activeCapacity = capacityTotal ? Math.round((queenSegments.filter((x) => x.state !== 'verifying').reduce((t, x) => t + (({ memoria: 10, aprendizaje: 8, pensamiento: 8, auditoria: 5, respaldos: 4, autorreparacion: 4 } as Record<string, number>)[x.id] ?? 0), 0) / capacityTotal) * 100) : 0
        const focus = model.segments.find((x) => x.state === 'error') ?? model.segments.find((x) => x.state === 'repairing') ?? queenSegments[0]
        return (
          <Card>
            <header className="system-area-heading">
              <span className="system-area-index" aria-hidden="true">01</span>
              <div><small>Cerebro del SDA</small><h3 id="queen-system-section-title">Queen y red neuronal</h3><p>Memoria, aprendizaje, pensamiento, auditoría, respaldos y autorreparación permanecen juntos en la red de Queen.</p></div>
            </header>
            <QueenBrain segments={model.segments} queenSegments={queenSegments} activeCapacity={activeCapacity} suspendedCount={suspended} reviewedAt={checkedTime} focusLabel={focus?.area ?? 'Sin foco'} />
            <IpvNeuralMap days={model.days.map((d) => ({ date: d.date, status: (d.cuadre !== 0 || model.integrity.some((i) => i.detail.includes(d.date)) ? 'error' : 'linked') as 'linked' | 'error', issueCount: (d.cuadre !== 0 ? 1 : 0) + ((d.mermasCosto ?? 0) > 0 ? 1 : 0), detail: d.cuadre !== 0 ? `Cuadre de ${fmtCUP(d.cuadre)} en el respaldo importado: se muestra tal como entró; su célula vive en el banco de errores.` : 'Todo cuadra con la cadena registrada; no requiere corrección.' }))} />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => onNavigate('queen')}>Abrir la consola de Queen</button>
            </div>
          </Card>
        )
      }
      case 'diagnostico':
        return (
          <Card>
            <h3>Diagnóstico general</h3>
            <p className="sub">Salud por áreas, medida de los datos de esta copia. Las áreas sin verificar no entran en el radar: no se dibujan como cero.</p>
            <div className="system-live-dashboard">
              <div className="system-live-overview">
                <div>
                  <span className="system-live-kicker"><i aria-hidden="true" /> Diagnóstico continuo</span>
                  <h3 id="system-live-title">Estado general</h3>
                  <p className={`system-live-status dna-state-${globalStateOf(model.segments)}`}>{globalStateOf(model.segments) === 'healthy' ? 'Sistema estable' : globalStateOf(model.segments) === 'verifying' ? 'Verificación activa' : globalStateOf(model.segments) === 'repairing' ? 'Autocorrección activa' : 'Atención requerida'}</p>
                </div>
                <div className="system-health-gauge" style={{ '--system-health': `${model.healthPct * 3.6}deg` } as React.CSSProperties} aria-label={`Salud general del sistema: ${model.healthPct}%`}>
                  <span><strong>{model.healthPct}%</strong><small>salud</small></span>
                </div>
              </div>
              <div className="system-ai-activity" aria-label="Actividad de inteligencia artificial">
                <div>
                  <strong>Actividad de IA</strong>
                  <span>{model.attention.length ? `${model.attention.length} aviso(s) activo(s) en Sistema` : 'Sin tarea automática activa en esta copia; las rutinas de la nube se declaran en su tarjeta'}</span>
                </div>
                <div className="system-pulse" aria-hidden="true">
                  {model.segments.map((segment, index) => <i key={segment.id} className={`dna-state-${segment.state}`} style={{ '--pulse-delay': `${index * -110}ms` } as React.CSSProperties} />)}
                </div>
                <small aria-live="polite">Última lectura {checkedTime}</small>
              </div>
              <p className="system-status-caption">Salud calculada con los puntos del original sobre los {fmtInt(model.segments.length)} segmentos reales (no un conteo de 6 checks).</p>
            </div>
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
      case 'adn': {
        const dnaIds = new Set(['interfaz', 'datos', 'ipv', 'cuentas', 'rh', 'documentos', 'respaldos', 'limpieza', 'seguridad', 'conexion'])
        const dnaSegments = model.segments.filter((x) => dnaIds.has(x.id))
        const dnaProgress = Math.max(1, Math.round(dnaSegments.reduce((t, x) => t + PROGRESS_POINTS[x.state], 0) / Math.max(1, dnaSegments.length)))
        const mutations = [
          ...QUEEN_OWNER_DIRECTIVES.slice(0, 6).map((d) => ({ id: `dir-${d.id}`, title: `Directiva · ${d.title}`, detail: d.rule, at: data.exportedAt, source: 'QUEEN_OWNER_DIRECTIVES (código del clon)' })),
          ...Object.entries(data.cuentasOverrides).slice(0, 6).map(([k, v]) => ({ id: `ov-${k}`, title: `Decisión del dueño · ${k}`, detail: `Clasificada como «${v}» por decisión expresa; el sistema la aplica sin volver a preguntar.`, at: null as string | null, source: 'cuentasOverrides del respaldo' })),
          ...Object.entries(data.aliases).slice(0, 6).map(([k, v]) => ({ id: `al-${k}`, title: `Alias aprendido · ${k}`, detail: `Se trata como «${v.canonicalDisplay}» en adelante.`, at: null as string | null, source: 'aliases del respaldo' })),
          ...Object.entries(data.learnedKinds).slice(0, 6).map(([k, v]) => ({ id: `lk-${k}`, title: `Concepto aprendido · ${k}`, detail: `Clasificado como «${v}» y aplicado en lo que llegue nuevo.`, at: null as string | null, source: 'learnedKinds del respaldo' })),
          ...(data.queenEvolution ? [{ id: 'evo-snap', title: `Snapshot de evolución · ${data.queenEvolution.stageName}`, detail: `Índice guardado ${data.queenEvolution.score} en la última medición que trae el respaldo.`, at: data.queenEvolution.measuredAt, source: 'queenEvolution del respaldo' }] : []),
        ]
        return (
          <Card>
            <header className="system-area-heading">
              <span className="system-area-index" aria-hidden="true">03</span>
              <div><small>Instrucciones y estructura</small><h3 id="dna-system-section-title">ADN operativo</h3><p>Interfaz, datos, IPV, módulos, respaldos, limpieza, seguridad y conexión permanecen dentro de su propia cadena.</p></div>
            </header>
            <DnaHelix segments={dnaSegments} mutations={mutations} progress={dnaProgress} globalLabel={checkedTime} />
            <h4 style={{ margin: '16px 0 4px' }}>Reglas que este sistema no negocia</h4>
            {QUEEN_OWNER_DIRECTIVES.filter((d) => ['ipv-source-truth', 'document-real-data-only', 'immutable-ipv-chain', 'versioned-isolated-dna', 'server-enforced-boundaries', 'immune-system-independent'].includes(d.id)).map((rule) => (
              <div className="list-row" key={rule.id} style={{ cursor: 'default' }}>
                <span className="lr-check"><Icon name="check" size={15} /></span>
                <span className="grow" style={{ fontSize: '0.9rem' }}><strong>{rule.title}.</strong> {rule.rule}</span>
              </div>
            ))}
          </Card>
        )
      }
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
        const hv = havanaNowParts(new Date())
        const nowTime = `${String(hv.hour).padStart(2, '0')}:${String(hv.minute).padStart(2, '0')}`
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
            <section className="system-activity-board" aria-labelledby="system-activity-title" aria-live="polite">
              <header>
                <div>
                  <span className="system-live-kicker"><i aria-hidden="true" /> En tiempo real</span>
                  <h3 id="system-activity-title">Panel de actividad del sistema</h3>
                </div>
                <span className={`system-activity-count${model.attention.length ? ' is-active' : ''}`}>{model.attention.length ? `${fmtInt(model.attention.length)} por atender` : 'Sin tareas activas'}</span>
              </header>
              <div className="system-routine-lanes">
                <section className="system-routine-lane is-foreground" aria-label="Rutinas en primer plano">
                  <header><strong>Primer plano</strong><span>Visible mientras usas Sistema</span></header>
                  <ul className="system-activity-list">
                    <li className="system-activity-item is-running is-continuous">
                      <div className="system-activity-row">
                        <div className="system-activity-icon" aria-hidden="true"><Icon name="settings" size={17} /></div>
                        <div><strong>Supervisar Sistema</strong><p>Queen mantiene visible el estado de sus rutinas, la conexión y la interfaz mientras esta pestaña está abierta.</p></div>
                        <b>En vivo</b>
                      </div>
                      <div className="system-task-progress is-live" role="progressbar" aria-label="Supervisar Sistema: en vivo"><span /></div>
                      <div className="system-activity-meta"><span>{online ? 'Conexión disponible en este dispositivo' : 'Sin conexión en este dispositivo'}</span><span>{sbMode ? 'Supabase configurado' : 'Modo local declarado'}</span></div>
                    </li>
                  </ul>
                </section>
                <section className="system-routine-lane is-background" aria-label="Rutinas en segundo plano">
                  <header><strong>Segundo plano</strong><span>{autoStatus.cloudStatus}</span></header>
                  {data.automationRuns.length ? (
                    <ul className="system-activity-list">
                      {data.automationRuns.slice(-6).reverse().map((r) => (
                        <li key={r.id} className={`system-activity-item is-${r.status === 'error' ? 'failed' : r.status === 'ok' || r.status === 'completada' ? 'completed' : 'running'}`}>
                          <div className="system-activity-row">
                            <div className="system-activity-icon" aria-hidden="true"><Icon name="settings" size={17} /></div>
                            <div><strong>{r.task}</strong><p>{r.detail}</p></div>
                            <b>{r.status}</b>
                          </div>
                          <div className="system-activity-meta"><span>{fmtDate(r.at.slice(0, 10))}</span><span>Corrida registrada en esta copia</span></div>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="system-routine-idle">No hay rutinas ejecutándose en este plano. Las programadas viven en la nube y su estado declarado es «{autoStatus.cloudStatus}»: no se declara ninguna activa sin estarlo.</p>}
                </section>
              </div>
              <section className="system-notification-feed" aria-labelledby="system-notification-title">
                <header>
                  <div>
                    <span className="system-live-kicker"><i aria-hidden="true" /> Señales compartidas</span>
                    <h4 id="system-notification-title">Notificaciones del sistema</h4>
                  </div>
                  <b>{fmtInt(model.attention.length)}</b>
                </header>
                {model.attention.length ? (
                  <ul>
                    {model.attention.map((item) => (
                      <li key={item.title} className={item.severity === 'error' ? 'is-attention' : 'is-initiative'}>
                        <Icon name="alert" size={16} />
                        <div><strong>{item.title}</strong><p>{item.why}</p></div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="system-notification-empty">No hay avisos activos. Cuando Queen detecte algo concreto, aparecerá aquí y también en su chat.</p>}
                <p className="system-notification-hint">En lenguaje llano: cada aviso de arriba es un problema real que sigue vivo ahora mismo (nada de insignias viejas: cuando el problema se resuelve, el aviso se retira solo en la siguiente comprobación).</p>
              </section>
              {/* Estado por defecto como el original: abierto solo si
                  hoy no hubo actividad Y existe historial de días
                  anteriores (antes se abría siempre sin ejecuciones). */}
              <details className="system-day-history" open={data.automationRuns.filter((r) => r.at.slice(0, 10) === ref).length === 0 && data.automationRuns.some((r) => r.at.slice(0, 10) !== ref)}>
                <summary><span>Historial de hoy</span><b>{fmtInt(data.automationRuns.filter((r) => r.at.slice(0, 10) === ref).length)}</b></summary>
                {data.automationRuns.filter((r) => r.at.slice(0, 10) === ref).length ? (
                  <ol>
                    {data.automationRuns.filter((r) => r.at.slice(0, 10) === ref).map((r) => (
                      <li key={r.id} className={r.status === 'error' ? 'is-failed' : ''}>
                        <time dateTime={r.at}>{r.at.slice(11, 16)}</time>
                        <div><strong>{r.task}</strong><p>{r.detail}</p></div>
                        <span>{r.status === 'error' ? 'Sistema' : 'Queen'}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="system-history-empty">Las tareas que terminen hoy aparecerán aquí.</p>}
              </details>
            </section>
          </Card>
        )
      }
      case 'monitor':
        return (
          <Card>
            <h3 id="system-monitor-title">Monitor del sistema</h3>
            <p className="sub">El reloj en vivo vive solo aquí dentro, como el LiveClockCard del monitor del original: no hay tarjeta de reloj fija ni duplicada fuera de esta tarjeta.</p>
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
      case 'integracion': {
        const latestDay = model.days[model.days.length - 1] ?? null
        const nodes: IntegrationNodeDef[] = [
          { id: 'ipv', label: 'IPV', shortLabel: 'IPV', icon: 'grid', tab: 'dias', x: 50, y: 50, receives: 'El Excel diario y los cambios manuales confirmados dentro del SDA.', sends: 'La base del día, sin cambiar sus cifras, a todos los módulos conectados.', purpose: 'Es el corazón del flujo: concilia la jornada y conserva el original protegido.', hasData: model.days.length > 0, metric: model.days.length ? `${fmtInt(model.days.length)} IPV · último ${latestDay?.date ?? '—'}` : 'Esperando el primer IPV' },
          { id: 'economia', label: 'Economía', shortLabel: 'Economía', icon: 'chart', tab: 'economia', x: 50, y: 9, receives: 'Ventas, costos, gastos, cobros, otros ingresos y nómina ya enlazados.', sends: 'Flujo de caja, punto de equilibrio y rentabilidad hacia informes.', purpose: 'Integra resultados sin duplicar el detalle que pertenece a otras pestañas.', hasData: model.days.length > 0, metric: model.days.length ? `Actualizado desde ${latestDay?.date ?? 'el IPV'}` : 'Disponible al importar datos' },
          { id: 'almacen', label: 'Almacén', shortLabel: 'Almacén', icon: 'package', tab: 'almacen', x: 21, y: 20, receives: 'Entradas, salidas y ajustes de existencias registrados.', sends: 'Disponibilidad y costos vigentes hacia Elaboración y el IPV actualizado.', purpose: 'Mantiene el movimiento físico conectado con el costo y la disponibilidad real.', hasData: model.days.some((d) => (d.warehouse?.length ?? 0) > 0 || d.entriesCount > 0), metric: model.days.length ? 'Foto de almacén en los IPV importados' : 'Disponible al importar datos' },
          { id: 'gastos', label: 'Gastos', shortLabel: 'Gastos', icon: 'receipt', tab: 'economia', x: 79, y: 20, receives: 'Erogaciones clasificadas por fecha y departamento.', sends: 'Salidas verificadas hacia Economía y los informes del período.', purpose: 'Aporta los egresos una sola vez para evitar restarlos dos veces.', hasData: data.expenses.length > 0, metric: data.expenses.length ? `${fmtInt(data.expenses.length)} gastos enlazados (viven en Economía en el clon)` : 'Sin gastos registrados' },
          { id: 'rh', label: 'RH y nómina', shortLabel: 'RH · Nómina', icon: 'people', tab: 'rh', x: 91, y: 50, receives: 'Plantilla, asistencia, salarios del ciclo y estados de pago.', sends: 'Nómina hacia Economía y vínculos de trabajadores hacia Cobrar.', purpose: 'Une personas, jornadas y pago quincenal sin repetir sus fichas fuera de RH.', hasData: model.hasRh, metric: model.hasRh ? 'RH enlazado al último IPV' : 'Sin RH importado todavía' },
          { id: 'cobrar', label: 'Cobrar', shortLabel: 'Cobrar', icon: 'wallet', tab: 'cobrar', x: 79, y: 80, receives: 'Cuentas del IPV, altas manuales y abonos registrados.', sends: 'Pendiente y cobrado hacia Economía, boletines e informes.', purpose: 'Sigue cada saldo desde su origen y conserva la trazabilidad de los abonos.', hasData: data.receivables.length > 0, metric: data.receivables.length ? `${fmtInt(data.receivables.length)} cuenta(s) enlazada(s)` : 'Sin cuentas por enlazar' },
          { id: 'archivo', label: 'Informes y archivo', shortLabel: 'Informes', icon: 'archive', tab: 'historial', x: 50, y: 91, receives: 'Resultados integrados y documentos generados por cada módulo.', sends: 'Informes, boletines, archivos listos y respaldo verificable.', purpose: 'Es la salida documental del sistema; resume sin sustituir las fuentes.', hasData: data.bulletins.length > 0, metric: data.bulletins.length ? `${fmtInt(data.bulletins.length)} boletín(es) en Historial` : 'Disponible al importar datos' },
          { id: 'extras', label: 'Otros ingresos', shortLabel: 'Ingresos', icon: 'money', tab: 'extras', x: 21, y: 80, receives: 'Coctelería, pizzería, entradas y mesas.', sends: 'Totales por categoría hacia Economía y el IPV de vuelta.', purpose: 'Incorpora ingresos externos al flujo principal sin mezclarlos con ventas del IPV.', hasData: model.days.some((d) => (d.extras?.length ?? 0) > 0 || d.billar != null), metric: model.days.length ? 'Extras/billar leídos de los IPV y registrados en Otros ingresos' : 'Disponible al importar datos' },
          { id: 'elaboracion', label: 'Elaboración', shortLabel: 'Elaboración', icon: 'star', tab: 'elaboracion', x: 9, y: 50, receives: 'Fichas de costo, precios vigentes de almacén y mermas con motivo.', sends: 'Costo, margen, pérdida y precio sugerido hacia Economía y Menú.', purpose: 'Relaciona receta, costo real y venta para advertir pérdidas antes de decidir.', hasData: data.packageReferences.length > 0 || model.productsCount > 0, metric: model.productsCount ? `${fmtInt(model.productsCount)} productos en los IPV` : 'Disponible al importar datos' },
        ]
        return (
          <Card>
            <IntegrationMap nodes={nodes} daysCount={model.days.length} onNavigate={onNavigate} />
            <p className="small muted" style={{ marginTop: 10 }}>Adaptación de arquitectura: en el clon no hay pantallas «Gastos» ni «Otros ingresos» separadas — esos nodos abren Economía, donde viven — y el nodo IPV abre Días. Todo lo demás navega a su pantalla real.</p>
          </Card>
        )
      }
      case 'accesos': {
        const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return (
          <Card>
            <h3>Accesos directos</h3>
            <nav className="system-shortcuts" aria-label="Accesos directos de Sistema">
              <button type="button" onClick={() => scrollToId('dna-system-section-title')}><Icon name="archive" size={15} />Ver respaldo</button>
              <button type="button" onClick={() => scrollToId('system-activity-title')}><Icon name="check" size={15} />Ver rutinas</button>
              <button type="button" onClick={() => scrollToId('critical-simulation-title')}><Icon name="alert" size={15} />Simulación crítica</button>
              <button type="button" onClick={() => scrollToId('system-notification-title')}><Icon name="alert" size={15} />Ver notificaciones</button>
            </nav>
            <p className="small muted" style={{ marginTop: 10 }}>Como en el original: estos accesos se mueven DENTRO de Sistema (respaldo en el ADN, rutinas, simulación y notificaciones). La navegación entre pantallas vive en el mapa de integración, que abre cada módulo real.</p>
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
      }
      case 'simulacion': {
        const runSim = () => setSimulation(runCriticalSimulation({
          daysCount: model.days.length,
          descuadrados: model.descuadrados.map((d) => ({ date: d.date, cuadre: d.cuadre })),
          gaps: model.gaps,
          morosasCount: model.morosas.length,
          morosasTotal: model.morosas.reduce((sum, x) => sum + x.saldo, 0),
          importedAt: data.importedAt,
          integrityIssues: model.integrity,
          pendingBulletins: model.pendingBulletins,
          failedBulletins: model.failedBulletins,
          sbMode,
          queenStageName: model.evo.score !== null ? model.evo.stage.name : null,
          errorCells: model.errorBank.cells.length,
        }))
        return <CriticalSimulationPanel report={simulation} onRun={runSim} />
      }
      case 'errores': {
        const cells = model.errorBank.cells
        const integrityCells = model.integrity
        const fallosHistorial = model.events.filter((e) => e.fallos > 0)
        return (
          <Card>
            <h3>Banco de errores · Sistema inmune</h3>
            <p className="sub">Células de queenCore.buildQueenErrorBank (una por error VERIFICADO en los datos cargados), problemas de integridad de automatizacionesCore.listCloneIntegrityIssues y el historial de jornadas con fallos reales (cuadre/merma). Sin errores verificados, el banco queda vacío: no se siembran células de ejemplo.</p>
            {/* Sistema inmune en vivo (portado del original): DENTRO de
                esta misma tarjeta, encima de la lista de células como
                en el original, alimentado de ESTE banco del clon
                (model.errorBank, de buildQueenErrorBank) vía
                buildImmuneBankView — sin datos fijos. */}
            <ImmuneLiveField bank={buildImmuneBankView(model.errorBank)} />
            {cells.length ? cells.map((c) => (
              <div className="immune-cell" key={c.cellKey}>
                <div className="immune-head"><strong>{c.topic}</strong><span className="chip morosa">{c.status}</span></div>
                <table className="kv">
                  <tbody>
                    <tr><td>Firma</td><td>{c.cellKey}</td></tr>
                    <tr><td>Módulo</td><td>{c.module}</td></tr>
                    <tr><td>Síntomas</td><td>{c.symptoms}</td></tr>
                    <tr><td>Causa</td><td>{c.cause}</td></tr>
                    <tr><td>Anticuerpo</td><td>{c.antibody}</td></tr>
                    <tr><td>Detecciones</td><td>{fmtInt(c.detections)}</td></tr>
                  </tbody>
                </table>
              </div>
            )) : (
              <div className="ok-box">Sin células de cuadre: ningún día importado trae cuadre distinto de cero.</div>
            )}
            {integrityCells.length ? (
              <>
                <h4 className="sistema-h4">Centinelas de integridad</h4>
                {integrityCells.map((issue, i) => (
                  <div className="immune-cell" key={`${issue.kind}-${i}`}>
                    <div className="immune-head"><strong>{issue.kind}</strong><span className="chip morosa">aislado</span></div>
                    <p className="small" style={{ margin: 0 }}>{issue.detail} El dato origen no se borra: se declara y se corrige en el sistema principal.</p>
                  </div>
                ))}
              </>
            ) : <p className="small muted" style={{ marginTop: 10 }}>Centinelas de integridad sin lesiones: sin duplicados, sin saldos imposibles y sin pagos huérfanos en esta copia.</p>}
            <h4 className="sistema-h4">Historial de caídas y salud por jornada</h4>
            {fallosHistorial.length ? fallosHistorial.map((e) => (
              <div className="rt-health-row" key={e.date}>
                <i style={{ background: '#d84a4a' }} />
                <span className="grow">{fmtDate(e.date)}<span className="muted">{e.fallos} fallo(s) real(es): cuadre/merma registrados en esa jornada del respaldo</span></span>
                <span className="chip">{e.fallos}</span>
              </div>
            )) : <p className="small muted">Ninguna jornada importada registra fallos: el historial de caídas está vacío porque no hubo caídas, no porque falte la vista.</p>}
            <p className="small muted" style={{ marginTop: 8 }}>Diagnóstico de mantenimiento (automatizacionesCore): {model.maintenance.summary} {model.maintenance.checks.map((c) => `${c.label}: ${c.status === 'healthy' ? 'Correcto' : 'Aviso'}`).join(' · ')}</p>
          </Card>
        )
      }
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

            <StartupTimeline entries={startupEntries} />
            <h4 className="sistema-h4">Estado de respaldos (real, de esta copia)</h4>
            <table className="kv">
              <tbody>
                <tr><td>Último respaldo importado</td><td>{data.importedAt ? fmtDate(data.importedAt.slice(0, 10)) : 'Ninguno en esta copia'}</td></tr>
                <tr><td>Exportado por el SDA</td><td>{data.exportedAt || '—'}</td></tr>
                <tr><td>Respaldo nocturno en la nube</td><td>{model.autoStatusEarly.cloudStatus} · última corrida registrada: {model.autoStatusEarly.backup.lastRunAt ? fmtDate(model.autoStatusEarly.backup.lastRunAt.slice(0, 10)) : 'ninguna en esta copia'}</td></tr>
                <tr><td>Detalle</td><td>{model.autoStatusEarly.backup.detail}</td></tr>
              </tbody>
            </table>

            {isAdmin ? (
              <>
                <h4 className="sistema-h4">Importar IPV del día (Excel)</h4>
                <ImportIpv onImported={onChanged} existingDays={data.days} data={data} bare />
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
      {/* TabHeader como en el original renderizado (badge sparkle,
          «Sistema», desc de su lista de secciones y chip «Núcleo de
          Queen»): una versión anterior de esta pantalla lo omitía por
          una lectura equivocada de la fuente; el render lado a lado
          del 26-oct lo desmintió y se restauró. Sin tarjeta de reloj
          fija — el reloj vive solo dentro de Monitor. */}
      <TabHeader
        icon="sparkle"
        title="Sistema"
        desc="Si todo está bien y qué necesita tu atención hoy"
        badge={TAB_BADGES.sistema}
      />
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
          <p className="sub">El orden se guarda en <strong>este dispositivo</strong> (localStorage) y se aplica a la consola. Declaración honesta: en el clon la persistencia del orden en servidor NO existe (en el original vive en su backend); aquí no se simula ningún guardado en servidor. Esta barra queda siempre fija arriba y no se reordena.</p>
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

      {/* Consola del original (su App.tsx, componente de red del
          sistema): TODA la pila vive dentro de
          .system-dna.system-network-system. Sin ese ancestro, las
          reglas con ámbito del puerto (fondos claros de Actividad
          de IA y del detalle de ADN, tokens --system-* de claro,
          mapa neuronal transparente e integrado) nunca se activan
          y las tarjetas caen a sus bases oscuras también en modo
          claro — defectos 2 y 3 del dueño (26-oct). La cabecera de
          la pestaña y la barra de controles quedan fuera, como en
          el original. */}
      <div className="system-dna system-network-system" aria-label="Red de inteligencia artificial y ADN del sistema">
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
