import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Section, Session, StoredData } from './types'
import {
  EMPTY_DATA, TEMP_PASSWORD, changePassword, ensureProfiles, getSession, loadData, login, logout, profileMustChange, supabaseConfigured,
} from './lib/backend'
import { sbChangePassword, sbFetchStoredData, sbLogin, sbLogout, sbRestoreSession } from './lib/supabaseBackend'
import Inicio from './screens/Inicio'
import Dias from './screens/Dias'
import Cuentas from './screens/Cuentas'
import Cobrar from './screens/Cobrar'
import Sistema from './screens/Sistema'
import { MasScreen, QueenScreen } from './screens/Secciones'

const SYSTEM_NAME = 'Queen SDA'
const SYSTEM_FULL = 'Queen SDA — Sistema de Automatización de Datos V2.0'
const PLACE = 'Restaurante-bar La Reina'

// El modo se decide al arrancar: con VITE_SUPABASE_URL y
// VITE_SUPABASE_ANON_KEY en el entorno manda Supabase (Auth + RLS);
// sin ellas, la app entera funciona en modo local como hasta ahora.
const SB_MODE = supabaseConfigured()

const NAV: Array<{ id: Section; label: string; icon: string; queen?: boolean }> = [
  { id: 'inicio', label: 'Inicio', icon: '🏠' },
  { id: 'cobrar', label: 'Cobrar', icon: '💳' },
  { id: 'queen', label: 'Queen', icon: '👸', queen: true },
  { id: 'sistema', label: 'Sistema', icon: '🩺' },
  { id: 'mas', label: 'Más', icon: '☰' },
]
const SIDE_EXTRA: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'dias', label: 'Días', icon: '📅' },
  { id: 'cuentas', label: 'Cuentas', icon: '🧾' },
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
        <img className="logo" src="/icons/icon-192.png" alt="Icono de Queen SDA" />
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
        <img className="logo" src="/icons/icon-192.png" alt="Icono de Queen SDA" />
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

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [section, setSection] = useState<Section>('inicio')
  const [data, setData] = useState<StoredData>(() => (SB_MODE ? { ...EMPTY_DATA } : loadData()))
  const [ready, setReady] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)

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

  if (!ready) return null
  if (!session) return <LoginScreen onLogin={(s, mc) => { setSession(s); setMustChange(mc) }} />
  if (mustChange) return <ChangePasswordScreen session={session} onDone={() => setMustChange(false)} onLogout={doLogout} />

  const isAdmin = session.role === 'admin'
  const navItems = [...NAV]
  const sideItems = [NAV[0], SIDE_EXTRA[0], SIDE_EXTRA[1], NAV[1], NAV[2], NAV[3], NAV[4]]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" />
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
        <nav className="sidenav" aria-label="Navegación principal">
          {sideItems.map((item) => (
            <button key={item.id} className={`nav-btn ${section === item.id ? 'active' : ''} ${'queen' in item && item.queen ? 'queen-btn' : ''}`} onClick={() => setSection(item.id)}>
              <span className="nav-ico" aria-hidden>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>

        <main className="main">
          {remoteError ? <div className="error-box" style={{ marginBottom: 14 }}>{remoteError}</div> : null}
          {section === 'inicio' ? <Inicio data={data} isAdmin={isAdmin} onImportClick={() => setSection('sistema')} /> : null}
          {section === 'dias' ? <Dias data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'cuentas' ? <Cuentas data={data} /> : null}
          {section === 'cobrar' ? <Cobrar data={data} isAdmin={isAdmin} onChanged={refresh} /> : null}
          {section === 'queen' ? <QueenScreen /> : null}
          {section === 'sistema' ? <Sistema data={data} session={session} onChanged={refresh} /> : null}
          {section === 'mas' ? <MasScreen onNavigate={setSection} /> : null}
        </main>
      </div>

      <nav className="bottomnav" aria-label="Navegación inferior">
        {navItems.map((item) => (
          <button key={item.id} className={`${section === item.id ? 'active' : ''} ${item.queen ? 'queen-btn' : ''}`} onClick={() => setSection(item.id)}>
            <span className="nav-ico" aria-hidden>{item.icon}</span> {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
