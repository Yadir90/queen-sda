import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AutomationRun, Bulletin, Section, Session, StoredData } from './types'
import {
  EMPTY_DATA, TEMP_PASSWORD, changePassword, ensureProfiles, getSession, loadData, login, logout, profileMustChange, saveAutomationState, saveBulletins, saveQueenEvolution, supabaseConfigured,
} from './lib/backend'
import { sbChangePassword, sbFetchStoredData, sbLogin, sbLogout, sbQueenChat, sbRestoreSession, sbSaveAutomationState, sbSaveBulletins, sbSaveQueenState } from './lib/supabaseBackend'
import { buildQueenEvolution } from './lib/queenCore.mjs'
import { ensureBulletinsForDays } from './lib/documentosCore.mjs'
import { downloadText } from './lib/download'
import { Icon, AlertDot, type IconName } from './components/icons'
import { QueenOrb, QueenReactorMark } from './components/QueenReactor'
import { MediaImage } from './components/MediaImage'
import { effectiveSaldo, fmtCUP, fmtInt, isMorosa, todayISO } from './lib/utils'
import Inicio from './screens/Inicio'
import { MasScreen } from './screens/Secciones'

/* Carga bajo demanda por vista, como en el original («carga diferida
   por vista»): la primera pantalla (Inicio) y la rejilla de Más van en
   el paquete inicial; cada otra sección es un trozo propio que se
   descarga la primera vez que se abre y queda en la caché de la PWA.
   En un Galaxy A16 con datos contados, el arranque no debe pagar el
   peso de las 16 pantallas enteras. */
const Dias = lazy(() => import('./screens/Dias'))
const Cuentas = lazy(() => import('./screens/Cuentas'))
const Cobrar = lazy(() => import('./screens/Cobrar'))
const Sistema = lazy(() => import('./screens/Sistema'))
const RHScreen = lazy(() => import('./screens/RH'))
const Economia = lazy(() => import('./screens/Economia'))
const Transferencias = lazy(() => import('./screens/Transferencias'))
const Productos = lazy(() => import('./screens/Productos'))
const Elaboracion = lazy(() => import('./screens/Elaboracion'))
const Almacen = lazy(() => import('./screens/Almacen'))
const Inventario = lazy(() => import('./screens/Inventario'))
const Laboratorio = lazy(() => import('./screens/Laboratorio'))
const Documentos = lazy(() => import('./screens/Documentos'))
const Historial = lazy(() => import('./screens/Historial'))
const QueenScreen = lazy(() => import('./screens/Queen'))
const Archivo = lazy(() => import('./screens/Archivo'))
const Entradas = lazy(() => import('./screens/Entradas'))
const Extras = lazy(() => import('./screens/Extras'))
const Existencias = lazy(() => import('./screens/Existencias'))
const Cronologia = lazy(() => import('./screens/Cronologia'))
const Ajustes = lazy(() => import('./screens/Ajustes'))

const SYSTEM_NAME = 'Queen SDA'
const SYSTEM_FULL = 'Queen SDA — Sistema de Automatización de Datos V2.0'
const PLACE = 'Restaurante-bar La Reina'

// El modo se decide al arrancar: con VITE_SUPABASE_URL y
// VITE_SUPABASE_ANON_KEY en el entorno manda Supabase (Auth + RLS);
// sin ellas, la app entera funciona en modo local como hasta ahora.
const SB_MODE = supabaseConfigured()

type NavItem = { id: Section; label: string; icon: IconName; queen?: boolean }

/* Orden e iconos de la barra inferior del original:
   Inicio dashboard · Cobrar wallet · Queen (orbe Reactor) · Sistema
   sparkle · Más more. Sin un solo emoji: SVG propio del sistema. */
const NAV: NavItem[] = [
  { id: 'inicio', label: 'Inicio', icon: 'dashboard' },
  { id: 'cobrar', label: 'Cobrar', icon: 'wallet' },
  { id: 'queen', label: 'Queen', icon: 'sparkle', queen: true },
  { id: 'sistema', label: 'Sistema', icon: 'sparkle' },
  { id: 'mas', label: 'Más', icon: 'more' },
]
/* Barra lateral de escritorio: EXACTAMENTE la del original
   (primaryTabs de su App.tsx): grupo Principal = Cobrar, Gastos,
   Inicio, Queen — Gastos abre Economía, donde viven los gastos en
   esta copia — y grupo «Más secciones» con el resto en orden
   alfabético en español, Sistema entre RH · Pagos y Transferencias.
   La lateral NO lleva entrada «Más» (esa es solo de la barra móvil).
   Orden corregido en la puerta de calidad final contra el código
   original: antes Sistema estaba en Principal y sobraba «Más». */
const SIDE_PRINCIPAL: NavItem[] = [
  { id: 'cobrar', label: 'Cobrar', icon: 'wallet' },
  { id: 'economia', label: 'Gastos', icon: 'receipt' },
  { id: 'inicio', label: 'Inicio', icon: 'dashboard' },
  { id: 'queen', label: 'Queen', icon: 'sparkle', queen: true },
]
const SIDE_MAS: NavItem[] = [
  { id: 'almacen', label: 'Almacén', icon: 'package' },
  { id: 'dias', label: 'Días', icon: 'calendar' },
  { id: 'documentos', label: 'Documentos', icon: 'doc' },
  { id: 'economia', label: 'Economía', icon: 'chart' },
  { id: 'elaboracion', label: 'Elaboración', icon: 'receipt' },
  { id: 'historial', label: 'Historial', icon: 'receipt' },
  { id: 'inventario', label: 'Inventario', icon: 'archive' },
  { id: 'laboratorio', label: 'Laboratorio', icon: 'flask' },
  { id: 'productos', label: 'Productos', icon: 'package' },
  { id: 'rh', label: 'RH · Pagos', icon: 'people' },
  { id: 'sistema', label: 'Sistema', icon: 'sparkle' },
  { id: 'transferencias', label: 'Transferencias', icon: 'transfer' },
]

function LoginScreen({ onLogin }: { onLogin: (s: Session, mustChange: boolean) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (SB_MODE) {
      setBusy(true)
      try {
        const result = await sbLogin(email, password)
        if (!result.ok) { setError(result.error); return }
        onLogin(result.session, result.mustChange ?? false)
      } finally {
        setBusy(false)
      }
      return
    }
    const result = login(email, password)
    if (!result.ok) { setError(result.error); return }
    onLogin(result.session, result.mustChange)
  }
  return (
    <div className="auth-wrap">
      <section className="card auth-card">
        {/* La etapa del Reactor pinta también la pantalla de acceso:
            marca de 84px en estado thinking, como en el original. */}
        <div className="auth-mark"><QueenReactorMark stageId="juvenil" state="thinking" size={84} /></div>
        <h1>{SYSTEM_NAME}</h1>
        <p className="auth-sub">Sistema de Automatización de Datos V2.0<br />{PLACE}</p>
        <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Iniciar sesión</h2>
        {error ? <div className="error-box">{error}</div> : null}
        <form onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="lg-email">Correo electrónico</label>
            <input id="lg-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="lg-pass">Contraseña</label>
            <input id="lg-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 14 }}>
          {SB_MODE
            ? 'Acceso con Supabase: tu cuenta la crea el administrador y la seguridad la pone el servidor (roles de solo lectura o administrador).'
            : 'Acceso local de esta v1: los perfiles y roles replican los de la fase 1. La seguridad final llegará con Supabase.'}
        </p>
      </section>
    </div>
  )
}

function ChangePasswordScreen({ session, onDone, onLogout }: { session: Session; onDone: () => void; onLogout: () => void }) {
  const [temp, setTemp] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== repeat) { setError('La contraseña nueva y su repetición no coinciden.'); return }
    if (SB_MODE) {
      // En Supabase la persona ya entró con su contraseña temporal: Auth solo
      // pide la nueva (no hay que repetir la temporal en otro campo).
      setBusy(true)
      try {
        const result = await sbChangePassword(next)
        if (!result.ok) { setError(result.error ?? 'No se pudo cambiar la contraseña.'); return }
        onDone()
      } finally {
        setBusy(false)
      }
      return
    }
    const result = changePassword(session.profileId, temp, next)
    if (!result.ok) { setError(result.error ?? 'No se pudo cambiar la contraseña.'); return }
    onDone()
  }
  return (
    <div className="auth-wrap">
      <section className="card auth-card">
        <div className="auth-mark"><QueenReactorMark stageId="juvenil" state="thinking" size={84} /></div>
        <h1>Cambiar contraseña</h1>
        <p className="auth-sub">{SYSTEM_FULL}<br />{PLACE}</p>
        <p className="small">Hola, {session.name}. Por seguridad, debes crear una contraseña nueva antes de continuar.</p>
        {error ? <div className="error-box">{error}</div> : null}
        <form onSubmit={(e) => void submit(e)}>
          {!SB_MODE ? (
            <div className="field">
              <label htmlFor="cp-temp">Contraseña temporal</label>
              <input id="cp-temp" type="password" autoComplete="current-password" value={temp} onChange={(e) => setTemp(e.target.value)} required />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="cp-new">Nueva contraseña</label>
            <input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="cp-rep">Repite la nueva contraseña</label>
            <input id="cp-rep" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </div>
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar y continuar'}</button>
        </form>
        <button className="btn block" style={{ marginTop: 10 }} onClick={onLogout}>Cerrar sesión</button>
        {!SB_MODE ? <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>Contraseña temporal inicial de la fase 1: {TEMP_PASSWORD}</p> : null}
      </section>
    </div>
  )
}

function BootScreen({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  return (
    <div className="queen-boot-screen">
      <div className="queen-boot" role="status" aria-live="polite">
        <div className="queen-boot-mark queen-orb-stage-juvenil" aria-hidden="true">
          <QueenReactorMark stageId="juvenil" state="thinking" size={84} />
        </div>
        <p className="queen-boot-title">Preparando el sistema</p>
        <p className="queen-boot-status">Queen está conectando tus datos…</p>
        <div className="queen-boot-progress" aria-hidden="true"><i /></div>
        {slow ? (
          <div className="queen-boot-slow">
            <p>Está tardando más de lo normal: puede ser la conexión o que el servidor está despertando.</p>
            <button type="button" className="btn primary block" onClick={onRetry}>Reintentar ahora</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [section, setSection] = useState<Section>('inicio')
  const [data, setData] = useState<StoredData>(() => (SB_MODE ? { ...EMPTY_DATA } : loadData()))
  const [ready, setReady] = useState(false)
  const [bootSlow, setBootSlow] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)

  useEffect(() => {
    if (ready) { setBootSlow(false); return }
    const timer = window.setTimeout(() => setBootSlow(true), 7000)
    return () => window.clearTimeout(timer)
  }, [ready])

  useEffect(() => {
    if (SB_MODE) {
      let cancelled = false
      void (async () => {
        try {
          const remote = await sbRestoreSession()
          if (!cancelled && remote) {
            setSession(remote.session)
            setMustChange(remote.mustChange)
          }
        } catch {
          // Sin sesión restaurable: se queda la pantalla de acceso.
        }
        if (!cancelled) setReady(true)
      })()
      return () => { cancelled = true }
    }
    ensureProfiles()
    const s = getSession()
    if (s) {
      setSession(s)
      setMustChange(profileMustChange(s.profileId))
    }
    setReady(true)
  }, [])

  const refreshRemote = useCallback(async () => {
    try {
      const remote = await sbFetchStoredData()
      setData(remote)
      setRemoteError(null)
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : 'No se pudieron leer los datos de Supabase.')
    }
  }, [])

  // En modo Supabase, al entrar o restaurar la sesión se cargan los datos del servidor.
  useEffect(() => {
    if (SB_MODE && session) void refreshRemote()
  }, [session, refreshRemote])

  const refresh = useCallback(() => {
    if (SB_MODE) {
      void refreshRemote()
      return
    }
    setData(loadData())
  }, [refreshRemote])

  const doLogout = () => {
    if (SB_MODE) void sbLogout().catch(() => { /* la sesión local ya quedó cerrada */ })
    logout()
    setSession(null)
    setMustChange(false)
    setSection('inicio')
    setRemoteError(null)
    if (SB_MODE) setData({ ...EMPTY_DATA })
  }

  /* Los retornos tempranos de arranque/acceso van DESPUÉS de todos
     los hooks (más abajo): llamarlos antes rompía la app al pasar de
     «sin sesión» a «con sesión» (React: más hooks que en el render
     anterior). Corregido en la puerta de calidad final. */
  const isAdmin = session?.role === 'admin'

  /* Boletines: un boletín pendiente por cada día importado que aún
     no lo tenga (generación al importar, como el original). Se
     derivan al leer y, si el administrador tiene días sin boletín
     persistido, la cola se guarda sola una vez por lote nuevo. */
  const bulletins = useMemo(
    () => ensureBulletinsForDays(data, data.bulletins, { now: todayISO() }),
    [data],
  )
  const bulletinsDirty = bulletins.length !== data.bulletins.length
  const persistingBulletins = useRef(false)
  useEffect(() => {
    if (!bulletinsDirty || !isAdmin || persistingBulletins.current) return
    persistingBulletins.current = true
    const persist = async () => {
      try {
        if (SB_MODE) await sbSaveBulletins(bulletins)
        else saveBulletins(bulletins)
        setData((d) => ({ ...d, bulletins }))
      } catch {
        /* La tabla puede no existir aún en el proyecto: la cola
           sigue visible derivada al leer; no se finge guardado. */
      } finally {
        persistingBulletins.current = false
      }
    }
    void persist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulletinsDirty, isAdmin])

  /* Evolución de Queen: la medición la calcula queenCore al leer
     (determinista, mismas señales) y se guarda como dato cuando
     cambia. La medición es estable para los mismos datos (su fecha
     es la del respaldo), así que esto no entra en bucle. */
  const queenSnapshot = useMemo(
    () => buildQueenEvolution(data, todayISO()).snapshot,
    [data],
  )
  const queenDirty = queenSnapshot != null
    && (data.queenEvolution == null
      || data.queenEvolution.stageId !== queenSnapshot.stageId
      || data.queenEvolution.score !== queenSnapshot.score
      || data.queenEvolution.measuredAt !== queenSnapshot.measuredAt)
  const persistingQueen = useRef(false)
  useEffect(() => {
    if (!queenDirty || !isAdmin || !queenSnapshot || persistingQueen.current) return
    persistingQueen.current = true
    const persist = async () => {
      try {
        if (SB_MODE) await sbSaveQueenState(queenSnapshot)
        else saveQueenEvolution(queenSnapshot)
        setData((d) => ({ ...d, queenEvolution: queenSnapshot }))
      } catch {
        /* La tabla puede no existir aún en el proyecto: la medición
           sigue visible calculada al leer; no se finge guardado. */
      } finally {
        persistingQueen.current = false
      }
    }
    void persist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queenDirty, isAdmin])

  /* Automatizaciones: corridas manuales desde Sistema (solo admin)
     sobre el MISMO núcleo que correrá en la nube. Cada corrida deja
     su constancia en el registro persistido; la tarea programada
     sigue declarada «pendiente de despliegue» hasta que exista. */
  const handleRunAutomation = useCallback(async (task: string): Promise<string> => {
    /* El núcleo de automatizaciones solo se usa al ejecutar una tarea
       a mano (admin, desde Sistema): se descarga bajo demanda y no
       pesa en el arranque. */
    const {
      buildNightlyBackup, createAutomationRun, dispatchPendingBulletins, pruneAutomationRuns, runMaintenanceDiagnosis, runNightlyLearning,
    } = await import('./lib/automatizacionesCore.mjs')
    const now = new Date()
    let runs = [...data.automationRuns]
    const record = async (run: AutomationRun) => {
      runs = pruneAutomationRuns([...runs, run])
      try {
        if (SB_MODE) await sbSaveAutomationState({ automationRuns: runs })
        else saveAutomationState({ automationRuns: runs })
      } catch { /* la tabla puede no existir aún: la corrida queda en memoria y Sistema lo declara */ }
      setData((d) => ({ ...d, automationRuns: runs }))
    }
    if (task === 'respaldo') {
      const { backup, filename, control, verified } = buildNightlyBackup(data, now)
      if (verified) downloadText(JSON.stringify(backup, null, 2), filename, 'application/json;charset=utf-8')
      const detail = verified
        ? `Respaldo ${filename} generado en este dispositivo y verificado por reimportación de control (${control.days} días, ventas ${control.ventas}, cuadre ${control.cuadreTotal}); se descargó el archivo. La copia automática en la nube queda pendiente de despliegue.`
        : 'El respaldo generado NO pasó la verificación de reimportación: no se descargó ni se dio por bueno.'
      await record(createAutomationRun('respaldo', verified ? 'ok' : 'error', detail, now))
      return detail
    }
    if (task === 'mantenimiento') {
      const lastBackup = runs.filter((r) => r.task === 'respaldo' && r.status === 'ok')
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null
      const result = runMaintenanceDiagnosis(data, {
        now,
        backupStatus: lastBackup ? { lastAt: lastBackup.at, lastVerificationOk: true } : null,
        histories: { automationRuns: runs.length },
      })
      await record(createAutomationRun('mantenimiento', result.status === 'healthy' ? 'ok' : 'atencion', result.summary, now))
      return result.summary
    }
    if (task === 'aprendizaje') {
      const { state, summary } = runNightlyLearning(data, data.queenLearning, { now })
      try {
        if (SB_MODE) await sbSaveAutomationState({ queenLearning: state })
        else saveAutomationState({ queenLearning: state })
      } catch { /* sin tabla todavía: queda en memoria */ }
      setData((d) => ({ ...d, queenLearning: state }))
      await record(createAutomationRun('aprendizaje', 'ok', summary, now))
      return summary
    }
    if (task === 'boletines') {
      const result = await dispatchPendingBulletins(bulletins, { now })
      await record(createAutomationRun('boletines', result.transported ? 'ok' : 'atencion', result.transported ? result.reason : `Despacho sin envío: ${result.reason}`, now))
      return result.reason
    }
    return 'Tarea desconocida.'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, bulletins])

  const handleBulletinsChange = useCallback((next: Bulletin[]) => {
    setData((d) => ({ ...d, bulletins: next }))
    if (SB_MODE) {
      void sbSaveBulletins(next).catch(() => { /* queda en memoria; la pantalla declara el estado real */ })
    } else {
      saveBulletins(next)
    }
  }, [])

  /* Estado real para puntos ambientales y badges de la navegación
     (como en el original: estado real, no decoración). */
  const ref = todayISO()
  const pending = data.receivables
    .map((r) => ({ rec: r, saldo: effectiveSaldo(r, data.localPayments) }))
    .filter((x) => x.rec.status !== 'pagada' && !x.rec.closeKind && x.saldo > 0)
  const pendingCount = pending.length
  const vencidasCount = pending.filter((x) => isMorosa(x.rec, x.saldo, ref)).length
  const dineroCalle = pending.filter((x) => x.rec.category === 'cliente').reduce((s, x) => s + x.saldo, 0)
  const lastDay = data.days.length ? data.days[data.days.length - 1] : null
  const dotFor = (id: Section): 'ok' | 'warn' | 'bad' | null => {
    if (id === 'inicio') return !lastDay ? null : lastDay.cuadre === 0 ? 'ok' : 'warn'
    if (id === 'cobrar') return vencidasCount > 0 ? 'bad' : pendingCount > 0 ? 'warn' : 'ok'
    if (id === 'sistema') return remoteError ? 'bad' : 'ok'
    return null
  }
  const badgeFor = (id: Section): number => {
    if (id === 'cobrar') return pendingCount
    if (id === 'sistema') return vencidasCount
    return 0
  }
  if (!ready) return <BootScreen slow={bootSlow} onRetry={() => window.location.reload()} />
  if (!session) return <LoginScreen onLogin={(s, mc) => { setSession(s); setMustChange(mc) }} />
  if (mustChange) return <ChangePasswordScreen session={session} onDone={() => setMustChange(false)} onLogout={doLogout} />

  const initials = session.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  const renderSideItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`nav-btn ${section === item.id ? 'active' : ''}`}
      onClick={() => setSection(item.id)}
      aria-current={section === item.id ? 'page' : undefined}
    >
      {item.queen
        ? <QueenOrb size={27} stageId={queenSnapshot?.stageId ?? 'juvenil'} />
        : <Icon name={item.icon} size={20} strokeWidth={section === item.id ? 2.55 : 1.8} />}
      <span className="nav-label">{item.label}</span>
      {badgeFor(item.id) > 0 ? <span className="nav-badge" style={{ position: 'static' }}>{badgeFor(item.id)}</span> : null}
    </button>
  )

  return (
    <div className="app-shell">
      <header className="topbar ambient-bar-surface">
        <div className="brand">
          <QueenOrb size={34} stageId={queenSnapshot?.stageId ?? 'juvenil'} />
          <div>
            <div className="brand-name">{SYSTEM_NAME}</div>
            <div className="brand-sub">Sistema de Automatización de Datos V2.0 · {PLACE}</div>
          </div>
        </div>
        <div className="spacer" />
        <div className="user-chip">
          <strong>{session.name}</strong>
          {isAdmin ? 'Administrador' : 'Solo lectura'}
        </div>
        <button className="btn" onClick={doLogout}>Salir</button>
      </header>

      <div className="layout">
        <nav className="sidenav ambient-bar-surface" aria-label="Navegación principal">
          <div className="side-brand">
            <span className="brand-mark"><QueenReactorMark stageId={queenSnapshot?.stageId ?? 'juvenil'} size={34} /></span>
            <div>
              <div className="brand-name">{SYSTEM_NAME}</div>
              <div className="brand-sub">Sistema de Automatización de Datos V2.0</div>
            </div>
          </div>
          <button className="side-profile" onClick={() => setSection('sistema')} aria-label="Tu perfil y acceso">
            <MediaImage
            kind="foto-perfil" entityKey="perfil-admin" alt=""
            className="avatar" style={{ objectFit: 'cover', padding: 0 }}
            fallback={<span className="avatar" aria-hidden>{initials || 'Q'}</span>}
          />
            <span>
              <span className="p-name">{session.name}</span><br />
              <span className="p-role">{isAdmin ? 'Administrador' : 'Solo lectura'}</span>
            </span>
          </button>
          <div className="side-group-label">Principal</div>
          {SIDE_PRINCIPAL.map(renderSideItem)}
          <div className="side-group-label">Más secciones</div>
          {SIDE_MAS.map(renderSideItem)}
          <div className="side-foot">
            {fmtInt(data.days.length)} días importados · Dinero en la calle: {fmtCUP(dineroCalle)} (solo cuentas de clientes)
          </div>
        </nav>

        <main className="main">
          {remoteError ? <div className="error-box" style={{ marginBottom: 14 }}>{remoteError}</div> : null}
          <Suspense fallback={(
            <section className="card" role="status" aria-live="polite" style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <QueenReactorMark stageId={queenSnapshot?.stageId ?? 'juvenil'} state="thinking" size={52} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>Cargando la sección…</p>
              <div className="queen-boot-progress" aria-hidden="true"><i /></div>
            </section>
          )}>
          {section === 'inicio' ? <Inicio data={data} isAdmin={isAdmin} onImportClick={() => setSection('sistema')} onNavigate={setSection} /> : null}
          {section === 'dias' ? <Dias data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'cuentas' ? <Cuentas data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'cobrar' ? <Cobrar data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'queen' ? (
            <QueenScreen
              data={data}
              supabaseMode={SB_MODE}
              onTestLanguage={SB_MODE ? sbQueenChat : undefined}
            />
          ) : null}
          {section === 'sistema' ? <Sistema data={data} session={session} onChanged={refresh} onNavigate={setSection} onRunAutomation={isAdmin ? handleRunAutomation : undefined} /> : null}
          {section === 'rh' ? <RHScreen data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'economia' ? <Economia data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'transferencias' ? <Transferencias data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'productos' ? <Productos data={data} /> : null}
          {section === 'elaboracion' ? <Elaboracion data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'almacen' ? <Almacen data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'inventario' ? <Inventario data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'laboratorio' ? <Laboratorio data={data} /> : null}
          {section === 'documentos' ? <Documentos data={data} today={ref} /> : null}
          {section === 'historial' ? (
            <Historial data={data} bulletins={bulletins} today={ref} isAdmin={isAdmin} onBulletinsChange={handleBulletinsChange} />
          ) : null}
          {section === 'archivo' ? <Archivo data={data} bulletins={bulletins} onNavigate={setSection} /> : null}
          {section === 'entradas' ? <Entradas data={data} /> : null}
          {section === 'extras' ? <Extras data={data} /> : null}
          {section === 'existencias' ? <Existencias data={data} onNavigate={setSection} /> : null}
          {section === 'cronologia' ? <Cronologia data={data} bulletins={bulletins} onNavigate={setSection} /> : null}
          {section === 'ajustes' && session ? (
            <Ajustes data={data} session={session} isAdmin={isAdmin} onChanged={refresh} onNavigate={setSection} />
          ) : null}
          {section === 'mas' ? <MasScreen onNavigate={setSection} data={data} /> : null}
          </Suspense>
        </main>
      </div>

      <nav className="bottomnav ambient-bar-surface" aria-label="Navegación inferior">
        {NAV.map((item) => {
          const active = section === item.id
          const dot = dotFor(item.id)
          const badge = badgeFor(item.id)
          return (
            <button
              key={item.id}
              className={`${active ? 'active' : ''} ${item.queen ? 'queen-btn' : ''}`}
              onClick={() => setSection(item.id)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-capsule">
                {item.queen
                  ? <QueenOrb size={35} stageId={queenSnapshot?.stageId ?? 'juvenil'} />
                  : <Icon name={item.icon} size={21} strokeWidth={active ? 2.55 : 2.15} />}
                {dot ? <AlertDot state={dot} /> : null}
                {badge > 0 ? <span className="nav-badge">{badge}</span> : null}
              </span>
              {item.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
