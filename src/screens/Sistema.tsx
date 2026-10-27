import { useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import '../components/systemMirror.css'
import { Icon } from '../components/icons'
import { QueenOrb, QueenReactorMark } from '../components/QueenReactor'
import QueenEvolutionPanel from '../components/QueenEvolutionPanel'
import { buildQueenEvolution, buildQueenErrorBank, buildQueenHealth, QUEEN_OWNER_DIRECTIVES } from '../lib/queenCore.mjs'
import ImmuneLiveField, { buildImmuneBankView } from '../components/ImmuneLiveField'
import { listCloneIntegrityIssues, runMaintenanceDiagnosis } from '../lib/automatizacionesCore.mjs'
import {
  CriticalSimulationPanel, DnaHelix, IntegrationMap, IpvNeuralMap, OrganismMap, QueenBrain,
  StartupTimeline, DNA_STATE_COPY, PROGRESS_POINTS, dnaPowerMode, globalStateOf, healthFor, runCriticalSimulation,
  readStartupMetrics,
  type IntegrationNodeDef, type MirrorSegment, type SimulationReport, type StartupEntry,
} from '../components/systemMirror'
import { LiveClockCard, Sparkline, SystemRealtimeCharts, type RadarArea, type SysActivity, type SysHealthPoint } from '../components/systemCharts'
import { NightCloseConsole, type CloseStep } from '../components/homeMirror'
import { listProfiles, resetLocalData, supabaseConfigured } from '../lib/backend'
import { loadReadings, recordReading, seedHistoricalReadings, type SysReading } from '../lib/sysReadings'
import { effectiveSaldo, fmtCUP, fmtDate, fmtInt, havanaNow, havanaNowParts, isMorosa, todayISO } from '../lib/utils'
import { buildAutomationsStatus, buildNightlyBackup } from '../lib/automatizacionesCore.mjs'

/* Consola de Sistema del original: 16 tarjetas reordenables (SISTEMA_CARDS).
   REFUERZO DEL DUEÑO (2026-10-25): «Haz una copia exacta de todo el
   sistema» — las piezas visuales viven en components/systemMirror.tsx /
   systemMirror.css, portadas TAL CUAL del original (clases, valores,
   keyframes y estructura) siempre que la arquitectura del clon lo
   permite; lo imposible por arquitectura queda documentado allí y en
   el informe del área.
   Estructura de la pestaña en el original (SistemaTab + SystemDnaPanel):
   TabHeader del shell (badge sparkle, chip «Núcleo de Queen») →
   system-page-heading («Sistema / Solo lo importante…») → LiveClockCard
   SIEMPRE PRIMERA, fuera del organizador (orden del dueño 2026-10-19) →
   barra de comandos (.system-command-bar: buscar con «Ir», ultraligero,
   organizar) dentro de .system-dna, fija y NO reordenable → las tarjetas.
   (SIS-R6, 27-oct: la versión anterior omitía el heading y el reloj y
   usaba una barra propia — divergencia medida con la sonda y corregida.)
   El orden de tarjetas se guarda en localStorage: es preferencia de
   ESTE dispositivo (en el clon no existe la persistencia en servidor
   del original — getSystemCardOrder vive en su backend de artefacto).
   Todo lo que se pinta sale de comprobaciones reales sobre los datos
   cargados: lo no verificable se dice, no se rellena.
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
  queen: string
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
  const [checkedAt, setCheckedAt] = useState(() => new Date().toISOString())
  const [diagBusy, setDiagBusy] = useState(false)
  /* askQueen del original: la pregunta queda escrita en el buscador
     de Queen (localStorage «queen-draft», que su consola lee al
     abrir) y se navega a su pestaña, lista para enviar. */
  const askQueen = (question: string) => {
    try { localStorage.setItem('queen-draft', question) } catch { /* sin almacenamiento */ }
    onNavigate('queen')
  }
  /* «Ejecutar diagnóstico» de los accesos directos: en el original
     dispara el diagnóstico del servidor; aquí re-ejecuta el
     diagnóstico local real (mantenimiento + integridad sobre los
     datos cargados), toma una lectura nueva y refresca la hora de
     comprobación. */
  const runDiagnostic = () => {
    if (diagBusy) return
    setDiagBusy(true)
    try {
      runMaintenanceDiagnosis(data)
      listCloneIntegrityIssues(data)
      setReadings(recordReading(data))
      setCheckedAt(new Date().toISOString())
    } finally {
      setDiagBusy(false)
    }
  }
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
          { key: 'svc-red', label: 'Servicio · Red', detail: online ? 'Conexión disponible al iniciar.' : 'Sin conexión al iniciar.', ms: null, status: online ? 'ok' : 'warn' },
          { key: 'svc-datos', label: 'Servicio · Datos y rutinas', detail: `${data.days.length} días · ${data.receivables.length} cuentas.`, ms: null, status: data.days.length ? 'ok' : 'pending' },
          { key: 'svc-centinelas', label: 'Servicio · Centinelas de Queen', detail: 'Diagnóstico y banco de errores derivados de los datos cargados.', ms: null, status: 'ok' },
          { key: 'svc-respaldo', label: 'Servicio · Respaldo en Drive', detail: data.importedAt ? `Importado el ${data.importedAt.slice(0, 10)}.` : 'Sin respaldo importado.', ms: null, status: data.importedAt ? 'ok' : 'warn' },
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
      seg('memoria', 'Memoria de Queen', (Object.keys(data.learnedKinds).length + Object.keys(data.aliases).length + Object.keys(data.cuentasOverrides).length) > 0 ? 'healthy' : 'verifying', `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} reglas permanentes, ${fmtInt(Object.keys(data.learnedKinds).length)} clasificaciones, ${fmtInt(Object.keys(data.aliases).length)} alias y ${fmtInt(Object.keys(data.cuentasOverrides).length)} decisiones registradas.`),
      seg('aprendizaje', 'Aprendizaje', data.queenLearning ? 'healthy' : 'verifying', data.queenLearning ? `${fmtInt(data.queenLearning.integratedConcepts.length)} conceptos y ${fmtInt(data.queenLearning.integratedAliases.length)} alias integrados por el ciclo de aprendizaje.` : 'El ciclo de aprendizaje aún no registra integración: Queen espera una corrección o un patrón confirmado.'),
      seg('pensamiento', 'Pensamiento operativo', integrity.length ? 'repairing' : days.length ? 'healthy' : 'verifying', integrity.length ? 'El razonamiento operativo está priorizando las incidencias detectadas.' : days.length ? `Analiza ${fmtInt(days.length)} días y el estado conectado de cada módulo.` : 'Preparado para razonar sobre el primer conjunto de datos importado.'),
      seg('ipv', 'IPV y cuadre', !days.length ? 'verifying' : descuadrados.length ? 'error' : 'healthy', !days.length ? 'Esperando datos suficientes para verificar el cuadre.' : descuadrados.length ? `${fmtInt(descuadrados.length)} de ${fmtInt(days.length)} días con cuadre distinto de cero.` : `${fmtInt(days.length)} de ${fmtInt(days.length)} días cuadrados.`),
      seg('auditoria', 'Auditoría IPV', integrity.length || descuadrados.length ? 'error' : days.length ? 'healthy' : 'verifying', `Auditoría derivable: ${fmtInt(days.length)} IPV enlazados, ${fmtInt(integrity.length)} problemas de integridad, ${fmtInt(errorBank.cells.length)} células en el banco de errores.`, [
        { label: 'IPV revisados', value: fmtInt(days.length) },
        { label: 'Cuentas revisadas', value: fmtInt(data.receivables.length) },
        { label: 'Hallazgos de integridad', value: fmtInt(integrity.length) },
      ]),
      seg('cuentas', 'Cuentas y cobros', !data.receivables.length ? 'verifying' : morosas.length ? 'verifying' : 'healthy', data.receivables.length ? `${fmtInt(data.receivables.length)} cuentas conectadas al sistema; ${fmtInt(morosas.length)} morosas.` : 'Sin cuentas para comprobar en este momento.'),
      seg('rh', 'Recursos Humanos', hasRh ? 'healthy' : 'verifying', hasRh ? 'Los datos de RH están enlazados con los IPV importados.' : 'Sin registros de RH para comprobar en este período.'),
      seg('documentos', 'Documentos y envíos', failedBulletins > 0 ? 'error' : pendingBulletins > 0 ? 'repairing' : 'healthy', failedBulletins > 0 ? `${fmtInt(failedBulletins)} boletín(es) con error en la cola.` : pendingBulletins > 0 ? `${fmtInt(pendingBulletins)} boletín(es) pendiente(s) en la cola, sin marcar enviados.` : 'No hay documentos pendientes ni fallos de envío registrados.'),
      seg('respaldos', 'Respaldos', data.importedAt ? 'healthy' : 'repairing', data.importedAt ? `Último respaldo importado el ${fmtDate(data.importedAt.slice(0, 10))}${data.exportedAt ? ` · exportado por el SDA: ${data.exportedAt}` : ''}. Respaldo nocturno en la nube: ${autoStatusEarly.cloudStatus}.` : 'Sin respaldo importado.', [
        { label: 'Último respaldo', value: data.importedAt ? fmtDate(data.importedAt.slice(0, 10)) : 'Sin respaldo' },
        { label: 'Destino (original)', value: 'Drive de La Reina / Backup SDA La Reina' },
        { label: 'Estado', value: autoStatusEarly.cloudStatus },
      ]),
      seg('limpieza', 'Limpieza del sistema', maintenance.checks.every((c) => c.status === 'healthy') ? 'healthy' : 'verifying', `Diagnóstico de mantenimiento: ${maintenance.summary}`),
      seg('autorreparacion', 'Autorreparación', 'verifying', 'Sin autorreparación automática: el mantenimiento diagnostica y declara; las incidencias que requieren tu acción aparecen arriba con su nombre.'),
      seg('seguridad', 'Acceso y seguridad', 'healthy', `${session.name} · ${isAdmin ? 'Administrador' : 'Solo lectura'} · La segunda capa con PIN protege las acciones sensibles de la sesión.`),
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
      queen: '¿Qué problemas sin resolver hay en el sistema? Cuéntamelos en lenguaje simple.',
    })
    if (morosas.length) attention.push({
      title: `${fmtInt(morosas.length)} cuentas morosas por ${fmtCUP(morosas.reduce((s, x) => s + x.saldo, 0))}`,
      why: 'Pasaron su plazo (clientes 7 días, trabajadores 15 días) y siguen pendientes. Se cobran desde Cobrar; Sistema solo señala el estado, no toca saldos.',
      severity: 'aviso', go: 'cobrar', goLabel: 'Ir a Cobrar',
      queen: `Explícame este aviso del sistema: cuentas morosas. ¿Qué hago?`,
    })
    if (!data.importedAt) attention.push({
      title: 'Esta copia aún no tiene respaldo importado',
      why: 'Sin respaldo, días y cuentas están vacíos a propósito: nada se inventa. Importa el respaldo del SDA desde la pantalla «Importar».',
      severity: 'aviso',
      queen: '¿Por qué la copia de seguridad no está al día?',
    })
    if (!sbMode) attention.push({
      title: 'Modo local: los datos viven solo en este dispositivo',
      why: 'Sin las claves de Supabase en el entorno, esta copia no se sincroniza con otros dispositivos. El sistema principal sigue siendo la fuente de verdad.',
      severity: 'aviso', go: 'inicio', goLabel: 'Ver Inicio',
      queen: '¿Por qué esta copia trabaja en modo local?',
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
      { id: 'adn', biological: 'ADN', component: 'Código base', fn: 'Conserva las instrucciones del SDA. Cada cambio se incorpora como una nueva versión para que el organismo evolucione sin perder su historia.', state: 'healthy' as MirrorSegment['state'], metric: `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} directivas registradas` },
      { id: 'cerebro', biological: 'Cerebro', component: 'Queen', fn: 'Observa el organismo, relaciona señales y toma iniciativa dentro de sus permisos. Nunca sustituye las barreras del servidor.', state: (descuadrados.length || integrity.length ? 'error' : days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: evo.score !== null ? `Etapa calculada: ${evo.stage.name} · índice ${evo.score}` : 'Sin medición todavía' },
      { id: 'memoria', biological: 'Memoria', component: 'Memoria de Queen', fn: 'Guarda directivas, correcciones confirmadas y patrones supervisados para no preguntar dos veces lo ya aprendido.', state: segments.find((x) => x.id === 'memoria')!.state, metric: `${fmtInt(QUEEN_OWNER_DIRECTIVES.length)} reglas · ${fmtInt(Object.keys(data.learnedKinds).length + Object.keys(data.aliases).length)} aprendizajes` },
      { id: 'corazon', biological: 'Corazón', component: 'Motor de datos e IPV', fn: 'Late con cada importación: contrasta el IPV, enlaza cuentas, RH, inventario y fondos, y mantiene el original protegido.', state: segments.find((x) => x.id === 'ipv')!.state, metric: `${fmtInt(days.length)} IPV enlazados` },
      { id: 'pulmones', biological: 'Pulmones', component: 'Sincronización', fn: 'Intercambia solo cambios entre el servidor y los dispositivos. Si la conexión cae, conserva el trabajo y reanuda al recuperar señal.', state: sbMode ? 'healthy' as MirrorSegment['state'] : 'repairing' as MirrorSegment['state'], metric: sbMode ? 'Sincronización diferencial activa' : 'Respiración local · esperando red' },
      { id: 'sangre', biological: 'Sangre', component: 'Datos y eventos', fn: 'Hace circular datos, cambios de estado y eventos entre todos los módulos para que cada parte trabaje con la misma información.', state: (!online ? 'repairing' : days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: online ? `${fmtInt(days.length)} días · flujo conectado` : 'Flujo sin conexión' },
      { id: 'organos', biological: 'Órganos', component: 'Módulos operativos', fn: 'Cada órgano cumple una función especializada y todos comparten el mismo corazón de datos.', state: (hasRh || data.receivables.length || days.length ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: '6 módulos coordinados', modules: ['Cuentas', 'Nómina', 'RH', 'Almacén', 'Inventario', 'Gastos'] },
      { id: 'nervioso', biological: 'Sistema nervioso', component: 'Notificaciones y salud', fn: 'Transporta señales de salud en tiempo real, despierta nodos cuando hay trabajo y avisa cuando algo requiere atención.', state: (failedBulletins ? 'error' : attention.length ? 'repairing' : online ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: attention.length ? `${fmtInt(attention.length)} aviso(s) de Sistema` : 'Señales al corriente' },
      { id: 'inmune', biological: 'Sistema inmune', component: 'Centinelas y cuarentena', fn: 'Comprueba permisos, ADN y versiones sin depender de Queen. Las lesiones quedan aisladas y declaradas en el banco de errores, sin borrar el dato origen.', state: (integrity.length || errorBank.cells.length ? 'error' : 'healthy') as MirrorSegment['state'], metric: errorBank.cells.length ? `${fmtInt(errorBank.cells.length)} célula(s) en el banco` : `${fmtInt(maintenance.checks.length)} centinelas de diagnóstico` },
      { id: 'higado', biological: 'Hígado', component: 'Auditoría', fn: 'Filtra inconsistencias, contrasta evidencias y deja un informe verificable sin alterar las cifras del IPV.', state: segments.find((x) => x.id === 'auditoria')!.state, metric: `${fmtInt(integrity.length + errorBank.cells.length)} hallazgos derivables` },
      { id: 'rinones', biological: 'Riñones', component: 'Limpieza', fn: 'Señala lo que el diagnóstico de mantenimiento encuentra sin referencias ni uso; no borra datos ni documentos: la poda de copias la hace la rutina de respaldo con su retención.', state: segments.find((x) => x.id === 'limpieza')!.state, metric: maintenance.summary },
      { id: 'sueno', biological: 'Sueño', component: 'Mantenimiento profundo', fn: 'De noche corren programados el mantenimiento y el aprendizaje. La consolidación de memoria no tiene corrida propia registrada: no se da por hecha sin un registro.', state: (data.queenLearning?.lastRunAt ? 'healthy' : 'verifying') as MirrorSegment['state'], metric: data.queenLearning?.lastRunAt ? `Última consolidación ${data.queenLearning.lastRunAt.slice(0, 10)}` : 'Sin consolidación registrada' },
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
  /* Buscador de la barra de comandos del original: NO filtra
     tarjetas; al pulsar «Ir» (o Enter) salta a la primera sección
     cuyo título o palabras clave contienen lo escrito. */
  const SYSTEM_SEARCH_TARGETS: Array<{ id: string; label: string; keywords: string }> = [
    { id: 'system-evolution-title', label: 'Evolución de Queen', keywords: 'evolucion queen etapa capacidad madurez' },
    { id: 'system-monitor-title', label: 'Monitor del sistema', keywords: 'monitor peso memoria red dispositivo lecturas umbrales caidas' },
    { id: 'organism-map-title', label: 'Mapa del organismo', keywords: 'organismo mapa modulos flujo autonomia corazon pulmones' },
    { id: 'queen-system-section-title', label: 'Queen y red neuronal', keywords: 'queen red neuronal cerebro ipv auditoria mapa' },
    { id: 'system-live-title', label: 'Diagnóstico general', keywords: 'diagnostico estado general salud actividad red' },
    { id: 'dna-system-section-title', label: 'ADN operativo', keywords: 'adn cadena respaldo mutaciones nucleo' },
    { id: 'system-activity-title', label: 'Panel de actividad', keywords: 'actividad rutinas subrutinas panel tiempo real' },
    { id: 'system-notification-title', label: 'Notificaciones del sistema', keywords: 'notificaciones avisos senales' },
  ]
  const goToSystemResult = () => {
    const q = query.trim().toLowerCase()
    if (!q) return
    const hit = SYSTEM_SEARCH_TARGETS.find((t) => t.label.toLowerCase().includes(q) || t.keywords.includes(q))
    if (hit) document.getElementById(hit.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const moveCardTo = (id: CardId, toIndex: number) => {
    const from = order.indexOf(id)
    if (from < 0) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, id)
    saveOrder(next)
  }

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
              <span className="system-evolution-sync" aria-live="polite">En vivo · 20–30 s</span>
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
      case 'vistazo': {
        /* SistemaSimplePanel del original: anillo + titular + línea
           «Comprobado a las … de hoy» + explicación en lenguaje llano
           con su pregunta a Queen DENTRO del panel desplegado. La
           línea «ok» solo nombra lo que está en verde de verdad
           (IPV al día / copia de seguridad al día). */
        const lastDay = model.days[model.days.length - 1]
        const ipvOk = Boolean(lastDay) && (ref === lastDay.date || new Date(`${ref}T12:00:00`).getTime() - new Date(`${lastDay.date}T12:00:00`).getTime() === 86400000)
        const backupOk = Boolean(data.importedAt) && Date.now() - new Date(data.importedAt!).getTime() <= 30 * 3600 * 1000
        const okLine = [ipvOk ? 'IPV al día' : null, backupOk ? 'copia de seguridad al día' : null].filter(Boolean).join(' · ')
        const checkedHour = new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', hour: 'numeric', minute: '2-digit' }).format(new Date(checkedAt))
        return (
          <section className="premium-panel sistema-glance-enter" style={{ marginBottom: 0 }} aria-label="¿Cómo está todo?">
            <div className="premium-head">
              <div className="premium-ring sistema-glance-ring" style={{ '--ring-deg': `${model.healthPct * 3.6}deg`, '--ring-color': ringColor } as React.CSSProperties} role="img" aria-label={`Salud: ${model.healthPct} de 100`}>
                <span><strong>{model.healthPct}</strong><small>salud</small></span>
              </div>
              <div className="premium-text">
                <span className="premium-kicker"><i aria-hidden /> De un vistazo</span>
                {model.attention.length === 0
                  ? <p className="premium-title"><strong>Todo bien.</strong><br /><span className="premium-sub">Nada necesita tu atención hoy{okLine ? ` · ${okLine}` : ''}.</span></p>
                  : <p className="premium-title"><strong>{model.attention.length === 1 ? 'Hay 1 cosa que necesita' : `Hay ${model.attention.length} cosas que necesitan`} tu atención hoy.</strong><br /><span className="premium-sub">Están listadas aquí abajo, cada una una sola vez.</span></p>}
                <p className="premium-sub">Comprobado a las {checkedHour} de hoy.</p>
                <div className="premium-actions">
                  <button className="btn" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>{showWhy ? 'Cerrar la explicación' : '¿Por qué este número?'}</button>
                </div>
                {showWhy ? (
                  <div className="why-panel">
                    <p>Este número resume todo en uno: que los días cuadren, que no haya problemas sin resolver y que el IPV y la copia de seguridad estén al día. Si algo de eso falla, el número baja. No es una nota: es la señal para mirar la lista de atención de aquí abajo.</p>
                    <button className="btn" onClick={() => askQueen('¿Cómo está la salud del sistema hoy? Explícame en lenguaje simple por qué tiene ese número.')}>Preguntar a Queen</button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )
      }
      case 'atencion':
        return (
          <section className="premium-panel sistema-attention-panel sistema-glance-enter" aria-label="Necesita tu atención hoy">
            <h3 className="sistema-attention-title">Necesita tu atención hoy</h3>
            {model.attention.map((item, i) => (
              <div className="attention-item" key={item.title}>
                <button className="attention-head" onClick={() => setOpenAttention(openAttention === i ? null : i)} aria-expanded={openAttention === i}>
                  <Icon name="alert" size={16} />
                  <span className="grow">{item.title}</span>
                  <Icon name={openAttention === i ? 'chevronL' : 'chevronR'} size={14} />
                </button>
                {openAttention === i ? (
                  <div className="attention-body">
                    <p>{item.why}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {item.go ? <button className="btn primary" onClick={() => onNavigate(item.go!)}>{item.goLabel ?? 'Ir'}</button> : null}
                      <button className="btn" onClick={() => askQueen(item.queen)}>Preguntar a Queen</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
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
                { name: 'Gastos', value: fmtCUP(data.expenses.reduce((s, e) => s + (e.total || 0), 0)) },
              ]}
              online={online}
              failedDocuments={model.failedBulletins}
              technicalErrors={model.integrity.length + model.descuadrados.length}
              ipvMissingAfterClose={(() => { const now = havanaNowParts(new Date()); return (now.hour > 22 || (now.hour === 22 && now.minute >= 30)) && model.days.length > 0 && model.days[model.days.length - 1]?.date !== ref })()}
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
            <QueenBrain segments={model.segments} queenSegments={queenSegments} activeCapacity={activeCapacity} suspendedCount={suspended} reviewedAt={checkedTime} focusLabel={focus?.area ?? 'Sin foco'} focusPrefix={model.segments.some((x) => x.state === 'error' || x.state === 'repairing') ? 'Foco actual' : 'Sin tarea activa'} />
            {/* Banda de entrada a la auditoría de IPV del original
                (.ipv-audit-entry), encima del mapa neuronal. */}
            <div className="ipv-audit-entry">
              <div><span>Nodo visible</span><strong>Auditoría de IPV</strong><small>{model.days.length ? `${fmtInt(model.days.length)} IPV en la cadena · pendientes de primera auditoría` : 'La cadena aparecerá al importar el primer IPV'}</small></div>
              <button type="button" onClick={() => document.getElementById('ipv-neural-map-title')?.scrollIntoView({ behavior: 'smooth' })}>Abrir mapa</button>
            </div>
            <IpvNeuralMap days={model.days.map((d) => ({ date: d.date, status: (d.cuadre !== 0 || model.integrity.some((i) => i.detail.includes(d.date)) ? 'error' : 'linked') as 'linked' | 'error', issueCount: (d.cuadre !== 0 ? 1 : 0) + ((d.mermasCosto ?? 0) > 0 ? 1 : 0), detail: d.cuadre !== 0 ? `Cuadre de ${fmtCUP(d.cuadre)} en el respaldo importado: se muestra tal como entró; su célula vive en el banco de errores.` : 'Todo cuadra con la cadena registrada; no requiere corrección.' }))} />
          </Card>
        )
      }
      case 'diagnostico':
        /* Diagnóstico del original: cabecera 02 «Lectura transversal»
           + panel en vivo (Estado general + Actividad de IA) + informe
           «Actividad de la red». El radar y las barras por áreas del clon
           salían de QueenDiagnosticPanel, que el original NO monta en
           Sistema (exportado, sin uso en App.tsx): retirados (SIS-R6). */
        const suspCount = model.segments.filter((s) => dnaPowerMode(s) === 'suspended').length
        const scanArea = model.segments.find((s) => s.state === 'error') ?? model.segments.find((s) => s.state === 'repairing') ?? model.segments.find((s) => s.id === 'auditoria') ?? model.segments[0]
        const scanDecision = scanArea.state === 'error' ? 'Incidencia detectada; queda señalada para revisión' : scanArea.state === 'repairing' ? 'Conserva el estado y volverá a comprobarlo' : scanArea.state === 'verifying' ? 'Esperando datos reales para completar la comprobación' : 'Sin tarea automática ejecutándose ahora'
        return (
          <Card>
            <header className="system-area-heading">
              <span className="system-area-index" aria-hidden="true">02</span>
              <div><small>Lectura transversal</small><h3 id="system-status-section-title">Diagnóstico general</h3><p>Resume la salud y la actividad del conjunto sin mezclar sus nodos con Queen, el ADN o el organismo.</p></div>
            </header>
            <section className="system-live-dashboard" aria-labelledby="system-live-title">
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
              <div className="system-ai-activity" aria-label="Actividad de inteligencia artificial: sin tarea automática activa">
                <div>
                  <strong>Actividad de IA</strong>
                  <span>{`${fmtInt(suspCount)} nodo${suspCount === 1 ? '' : 's'} en suspensión · se reactivan al necesitarlos`}</span>
                </div>
                <div className="system-pulse" aria-hidden="true">
                  {model.segments.map((segment, index) => <i key={segment.id} className={`dna-state-${segment.state}`} style={{ '--pulse-delay': `${index * -110}ms` } as React.CSSProperties} />)}
                </div>
                <small aria-live="polite">Última lectura {checkedTime}</small>
              </div>
              <p className="system-status-caption">Un toque muestra la leyenda del nodo; el segundo la oculta.</p>
            </section>
            <section className={`system-live-report dna-state-${scanArea.state}`} aria-labelledby="system-live-report-title" aria-live="polite">
              <header>
                <div>
                  <span className="system-live-kicker"><i aria-hidden="true" /> Informe en tiempo real</span>
                  <h3 id="system-live-report-title">Actividad de la red</h3>
                </div>
                <time dateTime={checkedAt}>{checkedTime}</time>
              </header>
              <ol className="system-live-flow">
                <li>
                  <span className="system-live-flow-index">01</span>
                  <div><small>Nodo enlazado</small><strong>{scanArea.area}</strong></div>
                </li>
                <li>
                  <span className="system-live-flow-index">02</span>
                  <div><small>Estado comprobado</small><strong>{scanArea.detail}</strong></div>
                </li>
                <li>
                  <span className="system-live-flow-index">03</span>
                  <div><small>Resultado</small><strong>{scanDecision}</strong></div>
                </li>
              </ol>
              <footer>
                <span>Estado leído: {DNA_STATE_COPY[scanArea.state].label}</span>
                <span>Se actualizará cuando cambie el estado</span>
              </footer>
            </section>
          </Card>
        )
      case 'adn': {
        const dnaIds = new Set(['interfaz', 'datos', 'ipv', 'cuentas', 'rh', 'documentos', 'respaldos', 'limpieza', 'seguridad', 'conexion'])
        const dnaSegments = model.segments.filter((x) => dnaIds.has(x.id))
        const dnaProgress = Math.max(1, Math.round(dnaSegments.reduce((t, x) => t + PROGRESS_POINTS[x.state], 0) / Math.max(1, dnaSegments.length)))
        return (
          <Card>
            <header className="system-area-heading">
              <span className="system-area-index" aria-hidden="true">03</span>
              <div><small>Instrucciones y estructura</small><h3 id="dna-system-section-title">ADN operativo</h3><p>Interfaz, datos, IPV, módulos, respaldos, limpieza, seguridad y conexión permanecen dentro de su propia cadena.</p></div>
            </header>
            <DnaHelix segments={dnaSegments} progress={dnaProgress} globalLabel={checkedTime} />
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
          { name: 'Respaldo diario automático (23:45)', state: autoStatus.backup.lastRunAt ? 'Registrado' : 'Programado en la nube', detail: autoStatus.backup.detail, tone: 'live' },
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
            <h4 style={{ margin: '16px 0 4px' }}>Tareas programadas en la nube</h4>
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              Respaldo, mantenimiento, aprendizaje, boletines y aviso de IPV corren programados en la nube (Supabase). Su última corrida registrada en esta copia se muestra tarea a tarea.
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
                      {/* Subrutinas visibles del original dentro de
                          «Supervisar Sistema». */}
                      <ul className="system-subroutine-list">
                        <li>
                          <div><strong>Leer rutinas</strong><p>Lee el estado de las rutinas y subrutinas mientras Sistema está abierto.</p></div>
                          <div className="system-task-progress is-live" role="progressbar" aria-label="Leer rutinas: en vivo"><span /></div>
                          <span>En vivo</span>
                        </li>
                        <li>
                          <div><strong>Vigilar conexión</strong><p>Observa si el dispositivo conserva red para sincronizar datos.</p></div>
                          <div className={`system-task-progress${online ? ' is-live' : ''}`} role="progressbar" aria-label={`Vigilar conexión: ${online ? 'en vivo' : 'sin conexión'}`}><span /></div>
                          <span>{online ? 'En vivo' : 'Sin conexión'}</span>
                        </li>
                        <li>
                          <div><strong>Comprobar interfaz</strong><p>Mantiene visibles las alertas y el progreso sin bloquear la pantalla.</p></div>
                          <div className="system-task-progress is-live" role="progressbar" aria-label="Comprobar interfaz: en vivo"><span /></div>
                          <span>En vivo</span>
                        </li>
                      </ul>
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
                  ) : <p className="system-routine-idle">No hay rutinas ejecutándose en este plano. Las programadas corren en la nube; en esta copia aún no se registró ninguna corrida.</p>}
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
      case 'monitor': {
        /* Monitor del original: cabecera con medidor y píldora de
           conexión, tres métricas del dispositivo (peso con anillo,
           memoria con medidor, red con minilínea), rejilla de
           servicios y cinco secciones desplegables. Las lecturas
           salen de sysReadings (reales, de este dispositivo); sin
           umbrales configurados se dice «Umbral no configurado» —
           la edición de umbrales del original vive en su servidor
           (resto nombrado SIS-R6). El reloj NO va aquí: en el
           original la LiveClockCard abre la pestaña (SIS-R6). */
        const lastReading = readings[readings.length - 1] ?? null
        const weekEvents = model.events.slice(-7)
        const prevEvents = model.events.slice(-14, -7)
        const weekFailures = weekEvents.reduce((s, e) => s + e.fallos, 0)
        const prevFailures = prevEvents.reduce((s, e) => s + e.fallos, 0)
        const trend = prevEvents.length === 0 ? 'Sin semana anterior comparable' : weekFailures < prevFailures ? 'Mejora' : weekFailures > prevFailures ? 'Empeora' : 'Sin cambio'
        const incidents = model.events.filter((e) => e.fallos > 0)
        const auditEvents = [
          ...data.automationRuns.map((r) => ({ id: `run-${r.id}`, at: r.at, summary: `${r.task}: ${r.detail}`, actor: 'Queen', organ: 'Sistema' })),
          ...model.attention.map((a, i) => ({ id: `att-${i}`, at: checkedAt, summary: a.title, actor: 'Sistema', organ: 'Diagnóstico' })),
        ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)
        return (
          <Card>
            <section className="system-monitor" aria-labelledby="system-monitor-title">
              <header>
                <div className="system-monitor-heading"><span className="system-live-kicker"><i aria-hidden="true" /> Lecturas del dispositivo</span><h3 id="system-monitor-title">Monitor del sistema</h3><p>Peso transferido, memoria disponible en este navegador y calidad de red, sin estimar datos que el dispositivo no expone.</p></div>
                <div className={`system-health-gauge system-monitor-health is-${globalStateOf(model.segments)}`} role="img" aria-label={`Salud general del sistema: ${model.healthPct}%`} style={{ '--system-health': `${model.healthPct * 3.6}deg` } as React.CSSProperties}>
                  <span><strong>{model.healthPct}%</strong><small>Salud general</small></span>
                </div>
                <span className={`system-connection-pill${online ? ' is-online' : ' is-offline'}`}><i aria-hidden="true" />{online ? 'Conectado' : 'Sin red'}</span>
              </header>
              <div className="system-metric-grid">
                <article className="is-weight" style={{ '--metric-stroke': '0 157' } as React.CSSProperties}>
                  <header><span>PESO DE LA APP</span><i aria-hidden="true" /></header>
                  <div className="system-metric-value"><strong>{lastReading?.pesoKb == null ? 'No disponible' : `${fmtInt(Math.round(lastReading.pesoKb))} KB`}</strong><small>Umbral no configurado</small></div>
                  <div className="system-metric-ring" role="img" aria-label="Peso frente al umbral: 0%"><svg viewBox="0 0 66 66" aria-hidden="true"><circle cx="33" cy="33" r="25" /><circle className="is-value" cx="33" cy="33" r="25" /></svg><span>0%</span></div>
                </article>
                <article className="is-memory" style={{ '--metric-width': '0%' } as React.CSSProperties}>
                  <header><span>MEMORIA JS</span><i aria-hidden="true" /></header>
                  <div className="system-metric-value"><strong>{lastReading?.memoriaMb == null ? 'No disponible' : `${fmtInt(Math.round(lastReading.memoriaMb))} MB`}</strong><small>Umbral no configurado</small></div>
                  <div className="system-memory-meter" role="img" aria-label="Memoria frente al umbral: 0%"><span><i /></span><b>0% del umbral</b></div>
                </article>
                <article className="is-network">
                  <header><span>RED · ÚLTIMOS 60 S</span><i aria-hidden="true" /></header>
                  <div className="system-metric-value"><strong>{online ? (lastReading?.latenciaMs == null ? 'Conectada' : `${fmtInt(Math.round(lastReading.latenciaMs))} ms`) : 'Sin conexión'}</strong><small>{sbMode ? 'Supabase configurado' : 'Modo local'}</small></div>
                  {readings.filter((r) => r.latenciaMs != null).length >= 2
                    ? <Sparkline values={readings.filter((r) => r.latenciaMs != null).slice(-12).map((r) => r.latenciaMs!)} color="#4aa8ff" />
                    : <span className="system-sparkline-empty" aria-label="Latencia de red durante los últimos 60 segundos: aún sin historial suficiente">—</span>}
                </article>
              </div>
              <div className="system-service-grid" aria-label="Estado de servicios externos">
                <div className={online ? 'is-healthy' : 'is-error'}><i /><span><strong>Red</strong><small>{online ? 'Conectada' : 'Interrumpida'}</small></span></div>
                <div className={data.importedAt ? 'is-healthy' : 'is-warning'}><i /><span><strong>Drive</strong><small>{data.importedAt ? `Respaldo del ${fmtDate(data.importedAt.slice(0, 10))} en esta copia` : 'Sin respaldo importado'}</small></span></div>
                <div className="is-neutral"><i /><span><strong>Gmail</strong><small>Sin fallo registrado</small></span></div>
              </div>
              <div className="system-monitor-sections">
                <details open>
                  <summary><span>Historial de salud</span><b>{fmtInt(weekFailures)} fallo{weekFailures === 1 ? '' : 's'} esta semana</b></summary>
                  <div className="system-health-history">
                    {model.events.length ? model.events.slice(-14).map((e) => (
                      <div key={e.date} className={e.fallos ? 'is-error' : 'is-healthy'} title={e.fallos ? `${fmtInt(e.fallos)} fallo(s) en la jornada` : 'Jornada sin fallos'}><i /><span>{e.date.slice(5)}</span><small>{e.fallos ? `${fmtInt(e.fallos)} fallos` : 'Bien'}</small></div>
                    )) : <p>Aún no hay jornadas completas para comparar.</p>}
                  </div>
                  <p className="system-week-trend"><strong>{trend}</strong> · semana actual {fmtInt(weekFailures)} / anterior {fmtInt(prevFailures)}</p>
                </details>
                <details>
                  <summary><span>Historial de caídas</span><b>{fmtInt(incidents.length)}</b></summary>
                  {incidents.length ? (
                    <ol className="system-incident-list">{incidents.map((e) => <li key={e.date}><i className="is-active" /><div><strong>JORNADA · Activa</strong><span>{fmtInt(e.fallos)} fallo(s) real(es) en la jornada: cuadre distinto de cero o merma registrada en el respaldo</span><small>{fmtDate(e.date)}</small></div></li>)}</ol>
                  ) : <p className="system-monitor-empty">No hay caídas registradas.</p>}
                </details>
                <details>
                  <summary><span>Umbrales de alerta</span><b>Yadir</b></summary>
                  <div className="system-threshold-form">
                    <label><span>Peso de la app</span><span><small>Umbral no configurado</small></span></label>
                    <label><span>Memoria JS</span><span><small>Umbral no configurado</small></span></label>
                    <label><span>Latencia de red</span><span><small>Umbral no configurado</small></span></label>
                  </div>
                </details>
                <details>
                  <summary><span>Cambios del sistema</span><b>{fmtInt(data.automationRuns.length)}</b></summary>
                  {data.automationRuns.length ? <ol className="system-change-list">{[...data.automationRuns].slice(-8).reverse().map((r) => <li key={r.id}><Icon name="check" size={15} /><div><strong>{r.task}</strong><span>{r.detail}</span><time dateTime={r.at}>{fmtDate(r.at.slice(0, 10))}</time></div></li>)}</ol> : <p className="system-monitor-empty">Aún no hay cambios versionados.</p>}
                </details>
                <details>
                  <summary><span>Línea de tiempo y auditoría</span><b>{fmtInt(auditEvents.length)}</b></summary>
                  {auditEvents.length ? <ol className="system-audit-timeline">{auditEvents.map((event) => (
                    <li key={event.id}><button type="button" aria-expanded={false}><time dateTime={event.at}>{new Intl.DateTimeFormat('es-CU', { timeZone: 'America/Havana', hour: 'numeric', minute: '2-digit' }).format(new Date(event.at))}</time><i aria-hidden="true" /><div><strong>{event.summary}</strong></div><Icon name="chevronR" size={14} className="system-event-chevron" /></button></li>
                  ))}</ol> : <p className="system-monitor-empty">No hay eventos registrados todavía.</p>}
                </details>
              </div>
            </section>
          </Card>
        )
      }
      case 'integracion': {
        const latestDay = model.days[model.days.length - 1] ?? null
        const nodes: IntegrationNodeDef[] = [
          { id: 'ipv', label: 'IPV', shortLabel: 'IPV', icon: 'grid', tab: 'dias', x: 50, y: 50, receives: 'El Excel diario y los cambios manuales confirmados dentro del SDA.', sends: 'La base del día, sin cambiar sus cifras, a todos los módulos conectados.', purpose: 'Es el corazón del flujo: concilia la jornada y conserva el original protegido.', hasData: model.days.length > 0, metric: model.days.length ? `${fmtInt(model.days.length)} IPV · último ${latestDay?.date ?? '—'}` : 'Esperando el primer IPV' },
          { id: 'economia', label: 'Economía', shortLabel: 'Economía', icon: 'chart', tab: 'economia', x: 50, y: 9, receives: 'Ventas, costos, gastos, cobros, otros ingresos y nómina ya enlazados.', sends: 'Flujo de caja, punto de equilibrio y rentabilidad hacia informes.', purpose: 'Integra resultados sin duplicar el detalle que pertenece a otras pestañas.', hasData: model.days.length > 0, metric: model.days.length ? `Actualizado desde ${latestDay?.date ?? 'el IPV'}` : 'Disponible al importar datos' },
          { id: 'almacen', label: 'Almacén', shortLabel: 'Almacén', icon: 'package', tab: 'almacen', x: 21, y: 20, receives: 'Entradas, salidas y ajustes de existencias registrados.', sends: 'Disponibilidad y costos vigentes hacia Elaboración y el IPV actualizado.', purpose: 'Mantiene el movimiento físico conectado con el costo y la disponibilidad real.', hasData: model.days.some((d) => (d.warehouse?.length ?? 0) > 0 || d.entriesCount > 0), metric: model.days.length ? 'Foto de almacén en los IPV importados' : 'Disponible al importar datos' },
          { id: 'gastos', label: 'Gastos', shortLabel: 'Gastos', icon: 'receipt', tab: 'economia', x: 79, y: 20, receives: 'Erogaciones clasificadas por fecha y departamento.', sends: 'Salidas verificadas hacia Economía y los informes del período.', purpose: 'Aporta los egresos una sola vez para evitar restarlos dos veces.', hasData: data.expenses.length > 0, metric: data.expenses.length ? `${fmtInt(data.expenses.length)} gastos enlazados` : 'Sin gastos registrados' },
          { id: 'rh', label: 'RH y nómina', shortLabel: 'RH · Nómina', icon: 'people', tab: 'rh', x: 91, y: 50, receives: 'Plantilla, asistencia, salarios del ciclo y estados de pago.', sends: 'Nómina hacia Economía y vínculos de trabajadores hacia Cobrar.', purpose: 'Une personas, jornadas y pago quincenal sin repetir sus fichas fuera de RH.', hasData: model.hasRh, metric: model.hasRh ? 'RH enlazado al último IPV' : 'Sin RH importado todavía' },
          { id: 'cobrar', label: 'Cobrar', shortLabel: 'Cobrar', icon: 'wallet', tab: 'cobrar', x: 79, y: 80, receives: 'Cuentas del IPV, altas manuales y abonos registrados.', sends: 'Pendiente y cobrado hacia Economía, boletines e informes.', purpose: 'Sigue cada saldo desde su origen y conserva la trazabilidad de los abonos.', hasData: data.receivables.length > 0, metric: data.receivables.length ? `${fmtInt(data.receivables.length)} cuenta(s) enlazada(s)` : 'Sin cuentas por enlazar' },
          { id: 'archivo', label: 'Informes y archivo', shortLabel: 'Informes', icon: 'archive', tab: 'historial', x: 50, y: 91, receives: 'Resultados integrados y documentos generados por cada módulo.', sends: 'Informes, boletines, archivos listos y respaldo verificable.', purpose: 'Es la salida documental del sistema; resume sin sustituir las fuentes.', hasData: data.bulletins.length > 0, metric: data.bulletins.length ? `${fmtInt(data.bulletins.length)} boletín(es) en Historial` : 'Disponible al importar datos' },
          { id: 'extras', label: 'Otros ingresos', shortLabel: 'Ingresos', icon: 'money', tab: 'extras', x: 21, y: 80, receives: 'Coctelería, pizzería, entradas y mesas.', sends: 'Totales por categoría hacia Economía y el IPV de vuelta.', purpose: 'Incorpora ingresos externos al flujo principal sin mezclarlos con ventas del IPV.', hasData: model.days.some((d) => (d.extras?.length ?? 0) > 0 || d.billar != null), metric: model.days.length ? 'Extras/billar leídos de los IPV y registrados en Otros ingresos' : 'Disponible al importar datos' },
          { id: 'elaboracion', label: 'Elaboración', shortLabel: 'Elaboración', icon: 'star', tab: 'elaboracion', x: 9, y: 50, receives: 'Fichas de costo, precios vigentes de almacén y mermas con motivo.', sends: 'Costo, margen, pérdida y precio sugerido hacia Economía y Menú.', purpose: 'Relaciona receta, costo real y venta para advertir pérdidas antes de decidir.', hasData: data.packageReferences.length > 0 || model.productsCount > 0, metric: model.productsCount ? `${fmtInt(model.productsCount)} productos en los IPV` : 'Disponible al importar datos' },
        ]
        return (
          <Card>
            <IntegrationMap nodes={nodes} daysCount={model.days.length} onNavigate={onNavigate} />

          </Card>
        )
      }
      case 'accesos': {
        /* En el original los accesos directos son una <nav> SUELTA en
           su posición del orden (sin tarjeta ni título): Ver respaldo
           (selecciona el nodo «respaldos» del ADN), Ejecutar
           diagnóstico (acción real), Simulación crítica y Ver
           notificaciones. La rejilla de navegación entre pantallas
           del clon no existe en el original: retirada (SIS-R6). */
        const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return (
          <nav className="system-shortcuts" aria-label="Accesos directos de Sistema">
            <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('sis-select-dna', { detail: 'respaldos' })); scrollToId('dna-system-section-title') }}><Icon name="archive" size={15} />Ver respaldo</button>
            <button type="button" disabled={diagBusy} onClick={runDiagnostic}><Icon name="check" size={15} />{diagBusy ? 'Diagnosticando…' : 'Ejecutar diagnóstico'}</button>
            <button type="button" onClick={() => scrollToId('critical-simulation-title')}><Icon name="alert" size={15} />Simulación crítica</button>
            <button type="button" onClick={() => scrollToId('system-notification-title')}><Icon name="alert" size={15} />Ver notificaciones</button>
          </nav>
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
            <h3 id="system-immune-section-title">Banco de errores · Sistema inmune</h3>
            <p className="sub">Cada error real, diagnosticado y con corrección verificada, deja una célula de memoria permanente en el ADN. Si el mismo error regresa, se reconoce al instante por su firma y se neutraliza con la respuesta conocida, sin repetir el diagnóstico lento. El reconocimiento no salta tus permisos: si un anticuerpo toca dinero, cuentas, IPV, ADN o permisos, sigue necesitando tu «Sí».</p>
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
            <p className="small muted" style={{ marginTop: 8 }}>Diagnóstico de mantenimiento: {model.maintenance.summary} {model.maintenance.checks.map((c) => `${c.label}: ${c.status === 'healthy' ? 'Correcto' : 'Aviso'}`).join(' · ')}</p>
          </Card>
        )
      }
      case 'tareas': {
        const tasks: Array<{ name: string; state: string; detail: string }> = [
          { name: 'Importación del respaldo', state: data.importedAt ? 'Completada' : 'Pendiente', detail: data.importedAt ? `Última importación: ${fmtDate(data.importedAt.slice(0, 10))}` : 'Ninguna importación en esta copia' },
          { name: 'Verificación de cuadres', state: 'Completada', detail: model.days.length ? `${fmtInt(model.days.length - model.descuadrados.length)} de ${fmtInt(model.days.length)} días cuadrados` : 'Sin días que verificar' },
          { name: 'Sincronización con el servidor', state: sbMode ? 'Continua' : 'No aplica', detail: sbMode ? 'Supabase activo: la lectura y la escritura pasan por el servidor' : 'Modo local en este dispositivo' },
          ...data.automationRuns.slice(-3).reverse().map((r) => ({ name: r.task, state: r.status, detail: `${fmtDate(r.at.slice(0, 10))} · ${r.detail}` })),
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
      case 'cierre': {
        /* Cierre del original: NightCloseConsole «cierre técnico»
           (7 pasos técnicos con sus etiquetas literales) +
           StartupTimeline. Cada paso se enciende SOLO con evidencia
           real de esta copia (respaldo importado, reimportación de
           control ejecutada aquí mismo, centinelas, integridad,
           consolidación registrada, lecturas, conexión). Los bloques
           propios del clon que vivían aquí (perfiles, restablecer
           datos locales, acceso a Importar) no están en esta tarjeta
           del original: perfiles y restablecimiento viven en Ajustes
           y la importación en su pantalla (SIS-R6). */
        const roundTrip = (() => { try { return buildNightlyBackup(data) } catch { return null } })()
        const closeSteps: CloseStep[] = [
          { key: 'respaldo', label: 'Respaldo diario verificado en Drive', done: Boolean(data.importedAt), detail: data.importedAt ? `Respaldo importado el ${fmtDate(data.importedAt.slice(0, 10))}${data.exportedAt ? ` · exportado por el SDA: ${data.exportedAt}` : ''} · rutina nocturna: ${model.autoStatusEarly.cloudStatus}` : 'Sin respaldo importado en esta copia', actionLabel: 'Ver respaldo' },
          { key: 'restauracion', label: 'Prueba de restauración al día', done: Boolean(roundTrip?.verified), detail: roundTrip ? (roundTrip.verified ? `Reimportación de control superada: ${fmtInt(roundTrip.control.days)} días y totales idénticos tras reconstruir el respaldo en memoria` : 'La reimportación de control no cuadró con los totales cargados') : 'No se pudo ejecutar la prueba de restauración en esta copia', actionLabel: 'Ver respaldo' },
          { key: 'centinelas', label: 'Diagnóstico de fin de día (centinelas)', done: model.maintenance.checks.every((c) => c.status === 'healthy'), detail: model.maintenance.summary, actionLabel: 'Ver centinelas' },
          { key: 'fantasma', label: 'Limpieza de archivos fantasma', done: model.integrity.length === 0, detail: model.integrity.length ? `${fmtInt(model.integrity.length)} problema(s) de integridad aislados en el banco de errores` : 'Sin duplicados, saldos imposibles ni pagos huérfanos en esta copia', actionLabel: 'Ver limpieza' },
          { key: 'consolidacion', label: 'Consolidación nocturna de Queen', done: Boolean(data.queenLearning?.lastRunAt), detail: data.queenLearning?.lastRunAt ? `Última consolidación registrada: ${fmtDate(String(data.queenLearning.lastRunAt).slice(0, 10))}` : 'Sin consolidación registrada en esta copia', actionLabel: 'Ver el sueño' },
          { key: 'visual', label: 'Integridad visual comprobada', done: readings.length > 0, detail: readings.length ? `${fmtInt(readings.length)} lecturas de Sistema registradas en este dispositivo` : 'Sin lecturas registradas todavía en este dispositivo', actionLabel: 'Ver interfaz' },
          { key: 'servicios', label: 'Servicios en pie al cierre', done: online, detail: online ? `Red conectada · ${sbMode ? 'Supabase configurado' : 'modo local en este dispositivo'}` : 'Sin conexión en este dispositivo al cierre', actionLabel: 'Volver a comprobar' },
        ]
        const closeAction = (key: string) => {
          if (key === 'respaldo' || key === 'restauracion') onNavigate('importar')
          else if (key === 'centinelas' || key === 'fantasma') document.getElementById('system-immune-section-title')?.scrollIntoView({ behavior: 'smooth' })
          else if (key === 'consolidacion') onNavigate('queen')
          else document.getElementById('system-monitor-title')?.scrollIntoView({ behavior: 'smooth' })
        }
        return (
          <Card>
            <h3>Cierre técnico e inicio</h3>
            <NightCloseConsole
              steps={closeSteps}
              dayLabel="cierre técnico"
              onAction={closeAction}
              subtitle="El cierre técnico de la jornada, paso a paso: respaldo, restauración, diagnóstico, limpieza, consolidación e integridad. Cada paso se enciende solo cuando su registro existe."
              completeSubtitle="Cierre técnico completo: el sistema quedó respaldado, comprobado y en pie para mañana."
              nota="esta consola es solo técnica: verifica el respaldo en Drive, la prueba de restauración, los centinelas, la limpieza de fantasmas, la consolidación nocturna de Queen, la integridad visual y los servicios. Los pasos de negocio (IPV, cuadre, boletín) viven en la consola de Inicio."
            />
            <StartupTimeline entries={startupEntries} />
          </Card>
        )
      }
    }
  }

  return (
    <div>
      {/* TabHeader como en el original renderizado (badge sparkle,
          «Sistema», desc de su lista de secciones y chip «Núcleo de
          Queen»): una versión anterior de esta pantalla lo omitía por
          una lectura equivocada de la fuente; el render lado a lado
          del 26-oct lo desmintió y se restauró. */}
      <TabHeader
        icon="sparkle"
        title="Sistema"
        desc="Si todo está bien y qué necesita tu atención hoy"
        badge={TAB_BADGES.sistema}
      />
      {/* Encabezado de página del original (SistemaTab):
          .system-page-heading, tras el TabHeader del shell. */}
      <div className="system-page-heading">
        <h2>Sistema</h2>
        <p>Solo lo importante: si todo está bien y qué necesita tu atención hoy.</p>
      </div>
      {/* LiveClockCard SIEMPRE PRIMERA, fuera del organizador
          (orden del dueño 2026-10-19; SIS-R6 la restauró: antes el
          clon afirmaba lo contrario por una lectura equivocada). */}
      <LiveClockCard />

      {/* Consola del original (su App.tsx, componente de red del
          sistema): TODA la pila vive dentro de
          .system-dna.system-network-system, con la barra de comandos
          como primera pieza. Sin ese ancestro, las reglas con ámbito
          del puerto (fondos claros de Actividad de IA y del detalle
          de ADN, tokens --system-* de claro, mapa neuronal
          transparente e integrado) nunca se activan y las tarjetas
          caen a sus bases oscuras también en modo claro — defectos
          2 y 3 del dueño (26-oct). */}
      <div className="system-dna system-network-system" aria-label="Red de inteligencia artificial y ADN del sistema">
        {/* Barra de comandos del original (.system-command-bar):
            buscar con «Ir», modo ultraligero y organizar tarjetas. */}
        <div className="system-command-bar">
          <form className="system-search" role="search" onSubmit={(e) => { e.preventDefault(); goToSystemResult() }}>
            <Icon name="search" size={16} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar sección, respaldo o rutina" aria-label="Buscar en Sistema" />
            <button type="submit">Ir</button>
          </form>
          <button type="button" className={`system-ultralight-toggle${ultra ? ' is-active' : ''}`} aria-pressed={ultra} onClick={toggleUltra}>
            <span><strong>Modo ultraligero</strong><small>{ultra ? 'Activo en todo el sistema · sigue activo hasta que lo desactives aquí' : 'Se aplica a todo el sistema y queda activo hasta que lo desactives'}</small></span>
            <i aria-hidden="true" />
          </button>
          <button type="button" className={`system-organize-toggle${organizing ? ' is-active' : ''}`} aria-pressed={organizing} onClick={() => setOrganizing((v) => !v)}>
            <span><strong>Organizar tarjetas</strong><small>{organizing ? 'Toca «Listo» al terminar de ordenar' : 'Pon las tarjetas en el orden que quieras'}</small></span>
            <b>{organizing ? 'Listo' : 'Organizar'}</b>
          </button>
        </div>

        {organizing ? (
          <section className="system-card-organizer" aria-labelledby="system-card-organizer-title">
            <header className="system-card-organizer-head">
              <div>
                <h3 id="system-card-organizer-title">Organizar tarjetas</h3>
                <p>Sube o baja cada tarjeta hasta dejar Sistema a tu gusto. El cambio se ve al momento y se guarda solo.</p>
              </div>
              <button type="button" className="system-card-organizer-done" onClick={() => setOrganizing(false)}>Listo</button>
            </header>
            <ol className="system-card-organizer-list">
              {order.map((id, index) => (
                <li key={id} className="system-card-organizer-row">
                  <span className="system-card-organizer-pos" aria-hidden="true">{index + 1}</span>
                  <span className="system-card-organizer-name">
                    <strong>{CARD_LABEL[id]}</strong>
                    {id === 'atencion' ? <small>Solo aparece cuando hay avisos</small> : null}
                  </span>
                  <span className="system-card-organizer-actions">
                    <button type="button" className="system-card-organizer-jump" onClick={() => moveCardTo(id, 0)} disabled={index === 0} aria-label={`Mover «${CARD_LABEL[id]}» al principio`}>Al principio</button>
                    <button type="button" onClick={() => move(id, -1)} disabled={index === 0} aria-label={`Subir «${CARD_LABEL[id]}»`}>Subir</button>
                    <button type="button" onClick={() => move(id, 1)} disabled={index === order.length - 1} aria-label={`Bajar «${CARD_LABEL[id]}»`}>Bajar</button>
                    <button type="button" className="system-card-organizer-jump" onClick={() => moveCardTo(id, order.length - 1)} disabled={index === order.length - 1} aria-label={`Mover «${CARD_LABEL[id]}» al final`}>Al final</button>
                  </span>
                </li>
              ))}
            </ol>
            <footer className="system-card-organizer-foot">
              <button type="button" className="system-card-organizer-reset" onClick={() => saveOrder([...FACTORY_ORDER])} disabled={order.every((id, i) => id === FACTORY_ORDER[i])}>Restablecer el orden original</button>
              <span role="status" aria-live="polite" className="system-card-organizer-status">Guardado en este dispositivo</span>
            </footer>
          </section>
        ) : null}

        <div className="sistema-stack">
          {visibleOrder.map((id) => (
            <div key={id} className="sistema-slot" style={{ order: order.indexOf(id) }}>
              {renderCard(id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
