import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AutomationRun, Bulletin, Section, Session, StoredData } from './types'
import {
  EMPTY_DATA, TEMP_PASSWORD, changePassword, ensureProfiles, getSession, listProfiles, loadData, login, logout, profileMustChange, saveAutomationState, saveBulletins, saveQueenEvolution, startLocalSession, supabaseConfigured,
} from './lib/backend'
import { recoveryParamsFromUrl, sbChangePassword, sbFetchStoredData, sbLoadActivityLog, sbLogin, sbLogout, sbOnPasswordRecovery, sbQueenChat, sbRequestPasswordReset, sbRestoreSession, sbSaveActivityLog, sbSaveAutomationState, sbSaveBulletins, sbSaveQueenState } from './lib/supabaseBackend'
import { canModifyIn, sectionAccess } from './lib/permissions'
import { loadActivityLog, logActivity, logImpersonationEvent, mergeActivityLog, setActivityActor, setActivityRemoteSaver, setImpersonationMarker, subscribeActivityLog, type ActivityEntry } from './lib/activityLog'
import { diffActivity } from './lib/activityDiff'
import { clearQuickAccess, getQuickAccess, verifyQuickPin } from './lib/quickAccess'
import { requireBiometricUnlock } from './lib/webauthn'
import { buildQueenEvolution } from './lib/queenCore.mjs'
import { ensureBulletinsForDays } from './lib/documentosCore.mjs'
import { downloadText } from './lib/download'
import { Icon, AlertDot, type IconName } from './components/icons'
import { QueenOrb, QueenReactorMark } from './components/QueenReactor'
import { MediaImage } from './components/MediaImage'
import { BRAND_LOGO_URL } from './lib/brandAssets'
import { applyUltralight, getUltralight, setUltralight } from './lib/ultralight'
import { getOfflineState, requestOfflineSync, subscribeOfflineState, type OfflineState } from './lib/offlineQueue'
import { buildQueenObservations } from './lib/queenCore.mjs'
import { effectiveSaldo, fmtCUP, fmtInt, isMorosa, todayISO } from './lib/utils'
import './components/shell.css'
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
const Menu = lazy(() => import('./screens/Menu'))
const Importar = lazy(() => import('./screens/Importar'))
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

function LoginScreen({ onLogin, onImpersonate }: {
  onLogin: (s: Session, mustChange: boolean, via?: 'contraseña' | 'PIN') => void
  onImpersonate: (target: { id: string; name: string; email: string; role: Session['role'] }, adminName: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* Selector de usuario (decisión del dueño, 2026-10-26 15:09):
     primero se escoge quién entra (foto y nombre) y después su
     vía: contraseña siempre; PIN de este dispositivo en modo
     local; y «entrar como» para el administrador con SU PIN o SU
     biometría. (La pantalla de bloqueo al abrir se retiró el 26-oct
     por la regla del dueño de las 19:09: la sesión guardada entra
     directa y solo se sale con «Cerrar sesión».) */
  const profiles = useMemo(() => listProfiles(), [])
  const adminProfile = profiles.find((p) => p.role === 'admin')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = profiles.find((p) => p.id === selectedId) ?? null
  const [pinOpen, setPinOpen] = useState(false)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [asOpen, setAsOpen] = useState(false)
  const [asPin, setAsPin] = useState('')
  const [asError, setAsError] = useState<string | null>(null)
  const [asBusy, setAsBusy] = useState(false)
  const selectedQuick = selected ? getQuickAccess(selected.id) : null
  const adminQuick = adminProfile ? getQuickAccess(adminProfile.id) : null

  const pick = (p: { id: string; email: string }) => {
    setSelectedId(p.id)
    setEmail(p.email)
    setError(null)
    setPinOpen(false)
    setPinError(null)
    setAsOpen(false)
    setAsError(null)
  }
  const submitPinLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setPinBusy(true)
    setPinError(null)
    try {
      const check = await verifyQuickPin(selected.id, pinValue)
      if (!check.ok) {
        const pseudo: Session = { profileId: selected.id, name: selected.name, email: selected.email, role: selected.role }
        logActivity('fallido', check.reason === 'locked'
          ? 'PIN de acceso desactivado tras demasiados intentos fallidos en el selector'
          : `Intento de acceso con PIN incorrecto en el selector (quedan ${check.attemptsLeft} intentos)`, { actor: pseudo })
        setPinError(check.reason === 'locked'
          ? 'Demasiados intentos fallidos: el PIN quedó desactivado en este dispositivo. Entra con tu contraseña.'
          : check.reason === 'wrong'
            ? `PIN incorrecto. Te quedan ${check.attemptsLeft} intento${check.attemptsLeft === 1 ? '' : 's'}.`
            : 'Este dispositivo ya no tiene PIN activo para tu cuenta.')
        return
      }
      const s = startLocalSession(selected.id, true)
      if (!s) { setPinError('No se pudo crear la sesión local.'); return }
      onLogin(s, profileMustChange(selected.id), 'PIN')
    } finally {
      setPinBusy(false)
      setPinValue('')
    }
  }
  const submitEnterAsPin = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected || !adminProfile) return
    setAsBusy(true)
    setAsError(null)
    try {
      const check = await verifyQuickPin(adminProfile.id, asPin)
      if (!check.ok) {
        setAsError(check.reason === 'locked'
          ? 'Demasiados intentos: el PIN del administrador quedó desactivado en este dispositivo.'
          : `PIN del administrador incorrecto. Quedan ${check.attemptsLeft} intentos.`)
        return
      }
      onImpersonate(selected, adminProfile.name)
    } finally {
      setAsBusy(false)
      setAsPin('')
    }
  }
  const enterAsBiometric = async () => {
    if (!selected || !adminProfile) return
    setAsBusy(true)
    setAsError(null)
    try {
      const unlock = await requireBiometricUnlock()
      if (!unlock.ok) { setAsError(unlock.reason ?? 'La verificación biométrica no se completó.'); return }
      onImpersonate(selected, adminProfile.name)
    } finally {
      setAsBusy(false)
    }
  }
  /* Recuperación de contraseña (Supabase): vista de pedir el enlace y
     confirmación de envío, dentro de la misma tarjeta de acceso. */
  const [view, setView] = useState<'login' | 'forgot' | 'sent'>('login')
  /* Modo ultraligero global del original: vive también en esta
     pantalla de acceso y se aplica a todo el sistema. */
  const [ultra, setUltra] = useState(() => getUltralight())
  const toggleUltra = () => { const next = !ultra; setUltra(next); setUltralight(next) }
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [forgotBusy, setForgotBusy] = useState(false)
  const submitForgot = async (e: FormEvent) => {
    e.preventDefault()
    setForgotError(null)
    setForgotBusy(true)
    try {
      const result = await sbRequestPasswordReset(email)
      if (!result.ok) { setForgotError(result.error ?? 'No se pudo enviar el correo.'); return }
      setView('sent')
    } finally {
      setForgotBusy(false)
    }
  }
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
        {/* Cabecera del acceso del original, elemento a elemento:
            logotipo de La Reina, título completo de bienvenida,
            línea del negocio, fila del reactor e interruptor del
            modo ultraligero. Debajo sigue el selector de usuario
            del dueño y sus vías de entrada. */}
        <div className="auth-head">
          <img src={BRAND_LOGO_URL} alt="Logo azul de La Reina: corona, barco y olas" className="auth-logo" />
          <h1 className="auth-welcome">Bienvenido a Queen SDA el Sistema de Automatización de Datos del PDL La Reina V2.0</h1>
          <p className="auth-tagline">El negocio, día a día: IPV, gastos, cobrar, RH y Queen.</p>
          <div className="auth-reactor-row">
            <QueenReactorMark stageId="juvenil" state="idle" size={30} />
            <span>Queen · Núcleo del reactor</span>
          </div>
        </div>
        <button type="button" className={`system-ultralight-toggle${ultra ? ' is-active' : ''}`} aria-pressed={ultra} onClick={toggleUltra} style={{ width: '100%', marginBottom: 16 }}>
          <Icon name={ultra ? 'check' : 'sparkle'} size={16} />
          <span><strong>Modo ultraligero</strong><small>{ultra ? 'Activo en todo el sistema · se mantiene hasta que lo desactives' : 'Para conexiones muy malas: se aplica a todo el sistema y queda activo'}</small></span>
        </button>
        {view === 'forgot' ? (
          <>
            <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Recuperar contraseña</h2>
            <p className="small" style={{ marginBottom: 12 }}>Escribe tu correo y te enviamos un enlace para crear una contraseña nueva. El enlace abre esta misma app y caduca en poco tiempo.</p>
            {forgotError ? <div className="error-box">{forgotError}</div> : null}
            <form onSubmit={(e) => void submitForgot(e)}>
              <div className="field">
                <label htmlFor="lg-forgot-email">Correo electrónico</label>
                <input id="lg-forgot-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <button className="btn primary block" type="submit" disabled={forgotBusy}>{forgotBusy ? 'Enviando…' : 'Enviar enlace de recuperación'}</button>
            </form>
            <button type="button" className="auth-forgot" onClick={() => { setView('login'); setForgotError(null) }}>Volver a iniciar sesión</button>
          </>
        ) : view === 'sent' ? (
          <>
            <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Revisa tu correo</h2>
            <div className="ok-box">Si ese correo tiene una cuenta, te enviamos un enlace de recuperación. Ábrelo en este mismo dispositivo y navegador para crear tu contraseña nueva.</div>
            <button type="button" className="auth-forgot" onClick={() => setView('login')}>Volver a iniciar sesión</button>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Iniciar sesión</h2>
            <p className="small muted" style={{ marginBottom: 10 }}>Escoge tu usuario y entra por tu vía: tu contraseña siempre vale; tu PIN y tu huella valen en los dispositivos donde los activaste.</p>
            <div className="auth-users" role="group" aria-label="Escoge tu usuario">
              {profiles.map((p) => {
                const ini = p.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
                return (
                  <button
                    key={p.id} type="button"
                    className={`auth-user ${selectedId === p.id ? 'selected' : ''}`}
                    aria-pressed={selectedId === p.id}
                    onClick={() => pick(p)}
                  >
                    <MediaImage
                      kind="foto-perfil" entityKey={`perfil-${p.id}`} alt=""
                      className="avatar" style={{ objectFit: 'cover', padding: 0 }}
                      fallback={<span className="avatar" aria-hidden>{ini}</span>}
                    />
                    <span className="auth-user-name">{p.name}</span>
                    <span className="auth-user-role">{p.role === 'admin' ? 'Administrador' : 'Solo lectura'}</span>
                  </button>
                )
              })}
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            <form onSubmit={(e) => void submit(e)}>
              <div className="field">
                <label htmlFor="lg-email">Correo electrónico</label>
                <input id="lg-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="lg-pass">Contraseña{selected ? ` de ${selected.name.split(' ')[0]}` : ''}</label>
                <input id="lg-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar con contraseña'}</button>
            </form>
            {!SB_MODE && selected && selectedQuick?.pinEnabled ? (
              pinOpen ? (
                <form onSubmit={(e) => void submitPinLogin(e)} style={{ marginTop: 12 }}>
                  {pinError ? <div className="error-box" style={{ marginBottom: 10 }}>{pinError}</div> : null}
                  <div className="field">
                    <label htmlFor="lg-pin">Tu PIN en este dispositivo</label>
                    <input id="lg-pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} className="auth-pin-input" value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))} required />
                  </div>
                  <button className="btn block" type="submit" disabled={pinBusy || pinValue.length < 4}>{pinBusy ? 'Comprobando…' : 'Entrar con PIN'}</button>
                </form>
              ) : (
                <button type="button" className="btn block" style={{ marginTop: 12 }} onClick={() => setPinOpen(true)}>Entrar con PIN</button>
              )
            ) : null}
            {selected && selected.role !== 'admin' && adminProfile ? (
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
                <button type="button" className="auth-forgot" aria-expanded={asOpen} onClick={() => { setAsOpen(!asOpen); setAsError(null) }}>
                  ¿Eres el administrador? Entrar como {selected.name.split(' ')[0]} con tu PIN o tu huella
                </button>
                {asOpen ? (
                  <div style={{ marginTop: 8 }}>
                    {asError ? <div className="error-box" style={{ marginBottom: 10 }}>{asError}</div> : null}
                    {adminQuick?.pinEnabled ? (
                      <form onSubmit={(e) => void submitEnterAsPin(e)}>
                        <div className="field">
                          <label htmlFor="lg-aspin">PIN del administrador</label>
                          <input id="lg-aspin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} className="auth-pin-input" value={asPin} onChange={(e) => setAsPin(e.target.value.replace(/\D/g, ''))} required />
                        </div>
                        <button className="btn block" type="submit" disabled={asBusy || asPin.length < 4}>{asBusy ? 'Comprobando…' : `Autorizar y entrar como ${selected.name.split(' ')[0]}`}</button>
                      </form>
                    ) : null}
                    {SB_MODE && adminQuick?.biometricEnabled ? (
                      <button type="button" className="btn block" style={{ marginTop: adminQuick?.pinEnabled ? 10 : 0 }} disabled={asBusy} onClick={() => void enterAsBiometric()}>
                        <Icon name="fingerprint" size={15} /> Autorizar con mi huella o cara
                      </button>
                    ) : null}
                    {!adminQuick?.pinEnabled && !(SB_MODE && adminQuick?.biometricEnabled) ? (
                      <p className="small muted">El administrador aún no tiene acceso rápido activado en este dispositivo: entra con su contraseña y actívalo en Ajustes → Seguridad para poder «entrar como» desde aquí.</p>
                    ) : null}
                    <p className="small muted" style={{ marginTop: 8 }}>La entrada queda registrada en Cronología a tu nombre, y dentro verás la banda «Estás viendo como {selected.name.split(' ')[0]}».</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="auth-note">La sesión queda recordada en este dispositivo. Ciérrala en Ajustes → Perfil cuando quieras.</p>
            {SB_MODE ? (
              <div className="auth-recovery">
                <button type="button" className="auth-forgot" onClick={() => { setView('forgot'); setError(null) }}>¿Olvidaste tu contraseña?</button>
              </div>
            ) : null}
          </>
        )}
        <p className="small muted" style={{ textAlign: 'center', marginTop: 14 }}>
          {SB_MODE
            ? 'Acceso con Supabase: tu cuenta la crea el administrador y la seguridad la pone el servidor (roles de solo lectura o administrador).'
            : 'Acceso local de esta v1: los perfiles y roles replican los de la fase 1. La seguridad final llegará con Supabase.'}
        </p>
      </section>
    </div>
  )
}

/* Pantalla de restablecimiento: la abre el enlace del correo de
   recuperación (la sesión ya viene activa de Supabase). Fija la
   contraseña nueva con updateUser (sbChangePassword) y entra a la app;
   si el enlace caducó, lo dice y manda de vuelta al acceso. */
function ResetPasswordScreen({ session, linkError, onDone, onLogout }: {
  session: Session | null
  linkError: string | null
  onDone: () => void
  onLogout: () => void
}) {
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== repeat) { setError('La contraseña nueva y su repetición no coinciden.'); return }
    setError(null)
    setBusy(true)
    try {
      const result = await sbChangePassword(next)
      if (!result.ok) { setError(result.error ?? 'No se pudo guardar la contraseña nueva.'); return }
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-wrap">
      <section className="card auth-card">
        <div className="auth-mark"><img src={BRAND_LOGO_URL} alt="Logo azul de La Reina: corona, barco y olas" className="auth-logo" /></div>
        <h1>Contraseña nueva</h1>
        <p className="auth-sub">{SYSTEM_FULL}<br />{PLACE}</p>
        {linkError || !session ? (
          <>
            <div className="error-box">{linkError ?? 'El enlace de recuperación no dejó una sesión válida. Pide uno nuevo desde «¿Olvidaste tu contraseña?».'}</div>
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onLogout}>Volver a iniciar sesión</button>
          </>
        ) : (
          <>
            <p className="small">Hola, {session.name}. Crea tu contraseña nueva para recuperar el acceso a tu cuenta.</p>
            {error ? <div className="error-box">{error}</div> : null}
            <form onSubmit={(e) => void submit(e)}>
              <div className="field">
                <label htmlFor="rp-new">Nueva contraseña</label>
                <input id="rp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="rp-rep">Repite la nueva contraseña</label>
                <input id="rp-rep" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
              </div>
              <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña y entrar'}</button>
            </form>
            <button className="btn block" style={{ marginTop: 10 }} onClick={onLogout}>Cancelar y cerrar sesión</button>
          </>
        )}
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
        <div className="auth-mark"><img src={BRAND_LOGO_URL} alt="Logo azul de La Reina: corona, barco y olas" className="auth-logo" /></div>
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

/* Píldora de conexión del original (su ConnectionStatus, D-68):
   puerto completo de sus CUATRO estados reales, alimentados por el
   motor offline del clon (lib/offlineQueue.ts: cola durable de
   escrituras, D-03) — etiquetas, detalles, estados y toque para
   reintentar la sincronización EXACTOS:
     sin red        → «Sin conexión»  / «Sin conexión confirmada» (paused)
     sincronizando  → «Sincronizando» / «Sincronizando cambios pendientes» (paused)
     pendientes > 0 → «Pendiente»     / «N cambio(s) pendiente(s)» (paused)
     si no          → «En línea»      / «En línea y sincronizado» (synced)
   El contador cuenta escrituras locales REALES encoladas, nunca un
   número decorativo. */
function ConnectionStatus() {
  const [network, setNetwork] = useState<OfflineState>(() => getOfflineState())
  useEffect(() => subscribeOfflineState(setNetwork), [])

  // Una operación lenta o un 5xx temporal no significa que Internet cayó.
  // El estado visual cambia solo tras una desconexión confirmada o mientras
  // hay cambios locales pendientes de sincronizar.
  const state = !network.online
    ? 'paused'
    : network.pending > 0 || network.syncing
      ? 'paused'
      : 'synced'
  const detail = !network.online
    ? 'Sin conexión confirmada'
    : network.syncing
      ? 'Sincronizando cambios pendientes'
      : network.pending > 0
        ? `${network.pending} cambio${network.pending === 1 ? '' : 's'} pendiente${network.pending === 1 ? '' : 's'}`
        : 'En línea y sincronizado'
  const label = !network.online ? 'Sin conexión' : network.syncing ? 'Sincronizando' : network.pending > 0 ? 'Pendiente' : 'En línea'

  return (
    <button
      type="button"
      onClick={requestOfflineSync}
      aria-label={`${detail}. Toca para comprobar de nuevo.`}
      aria-live="polite"
      data-connection-state={state}
      title={network.error || detail}
      className={`connection-status connection-status-${state}`}
    >
      <span className="connection-status-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  /* Hay sesión guardada pero no se pudo verificar al arrancar (red):
     se muestra «reintentar» en vez de echar al acceso. */
  const [bootError, setBootError] = useState(false)
  const [mustChange, setMustChange] = useState(false)
  /* Recuperación de contraseña en curso (llegada por el enlace del
     correo): mientras esté activa manda sobre el acceso normal. */
  const [recovery, setRecovery] = useState<{ active: boolean; error: string | null }>({ active: false, error: null })
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

  /* El modo ultraligero guardado vale desde el arranque, en
     todo el sistema (como en el original). */
  useEffect(() => { applyUltralight() }, [])

  useEffect(() => {
    if (SB_MODE) {
      let cancelled = false
      /* Enlace de recuperación en la URL: la app arranca en la pantalla
         de contraseña nueva aunque la sesión se restaure. */
      const fromUrl = recoveryParamsFromUrl()
      if (fromUrl.isRecovery) setRecovery({ active: true, error: fromUrl.error })
      const offRecovery = sbOnPasswordRecovery(() => {
        if (!cancelled) setRecovery({ active: true, error: null })
      })
      void (async () => {
        try {
          const remote = await sbRestoreSession()
          if (!cancelled && remote) {
            setSession(remote.session)
            setMustChange(remote.mustChange)
            /* La sesión restaurada entra DIRECTA (regla del dueño,
               26-oct 19:09: la sesión se mantiene hasta que él la
               cierre): nada de pantalla de bloqueo al abrir. El PIN y
               la biometría quedan para las acciones sensibles y para
               las vías del selector cuando no hay sesión guardada. */
          }
        } catch (e) {
          /* Sesión guardada pero no verificable ahora (red): NO se
             echa al usuario a la pantalla de acceso; se le ofrece
             reintentar con su sesión intacta. */
          if (!cancelled && e instanceof Error && e.message === 'restore-transient') setBootError(true)
        }
        if (!cancelled) setReady(true)
      })()
      return () => { cancelled = true; offRecovery() }
    }
    ensureProfiles()
    const s = getSession()
    if (s) {
      setSession(s)
      setMustChange(profileMustChange(s.profileId))
      /* Sin bloqueo al abrir: la sesión local tampoco caduca ni se
         interpone pantalla alguna (misma regla del dueño, 19:09). */
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

  /* Cuando la cola offline termina de reenviar escrituras, los datos
     del servidor ya las incluyen: se relee todo (D-03/D-68). */
  useEffect(() => {
    const onFlushed = () => refresh()
    window.addEventListener('queen-offline-flushed', onFlushed)
    return () => window.removeEventListener('queen-offline-flushed', onFlushed)
  }, [refresh])

  /* ===== Registro de actividad (decisión del dueño, 15:02) =====
     Cronología —solo del administrador— refleja lo que hacen Yan,
     Jesús y Dayami. Aquí se fija el actor y se mantiene la lista
     al día; las ediciones se detectan comparando fotos de los
     datos (ver el efecto de diffActivity más abajo) y las
     exportaciones y el uso de Queen se registran en su punto
     exacto (Documentos, Inicio, Queen). */
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>(() => loadActivityLog())
  useEffect(() => subscribeActivityLog(() => setActivityEntries(loadActivityLog())), [])
  useEffect(() => { setActivityActor(session) }, [session])
  useEffect(() => {
    if (!SB_MODE) { setActivityRemoteSaver(null); return }
    setActivityRemoteSaver(async (entries) => {
      await sbSaveActivityLog(entries as unknown as Array<Record<string, unknown>>)
    })
    if (session) {
      void sbLoadActivityLog()
        .then((items) => { if (items.length) mergeActivityLog(items as unknown as ActivityEntry[]) })
        .catch(() => { /* el registro local sigue valiendo */ })
    }
  }, [session])

  /* Detalle rastreable (precisión del dueño, 15:10): se guarda la
     foto anterior de los datos y cada cambio de una sesión que no
     es del administrador se describe por campo (qué cambió y, en
     importes, valor anterior → nuevo) con diffActivity. Al cambiar
     de sesión la foto se reinicia: nada se atribuye a quien no lo
     hizo. */
  const prevData = useRef<StoredData | null>(null)
  const prevProfileId = useRef<string | null>(null)
  useEffect(() => {
    if (prevProfileId.current !== (session?.profileId ?? null)) {
      prevProfileId.current = session?.profileId ?? null
      prevData.current = null
    }
    const prev = prevData.current
    prevData.current = data
    if (!prev || !session || session.role === 'admin') return
    for (const entry of diffActivity(prev, data)) {
      logActivity(entry.kind, entry.detail, { section: entry.section })
    }
  }, [data, session])

  /* Errores de sincronización de la cola offline: también quedan
     registrados como intentos fallidos (una escritura que no subió
     es exactamente lo que el administrador quiere poder rastrear). */
  const lastSyncError = useRef<string | null>(null)
  useEffect(() => subscribeOfflineState((state) => {
    if (state.error && state.error !== lastSyncError.current) {
      lastSyncError.current = state.error
      logActivity('fallido', `Una escritura no se pudo sincronizar: ${state.error}`)
    }
    if (!state.error) lastSyncError.current = null
  }), [])

  /* ===== «Entrar como» (decisión del dueño, 2026-10-26 15:09) =====
     El administrador entra a la cuenta de otro usuario autorizándose
     con SU PIN o SU biometría (la autorización vive en el selector
     de acceso y en Ajustes → «Entrar como otro usuario»). La sesión
     suplantada vive solo en memoria: la sesión guardada sigue
     siendo la del administrador. La entrada y la salida quedan en
     Cronología firmadas por el administrador, y lo que haga dentro
     se atribuye a él dentro de la cuenta ajena (viaAdmin). */
  const [impersonation, setImpersonation] = useState<{ byName: string; adminSession: Session | null } | null>(null)
  useEffect(() => { setImpersonationMarker(impersonation?.byName ?? null) }, [impersonation])
  const enterAs = (target: { id: string; name: string; email: string; role: Session['role'] }, adminName: string) => {
    const fromAdminSession = session && session.role === 'admin' ? session : null
    logImpersonationEvent(adminName, `${adminName.split(' ')[0]} entró a la cuenta de ${target.name} («entrar como»)`)
    setImpersonation({ byName: adminName, adminSession: fromAdminSession })
    setSession({ profileId: target.id, name: target.name, email: target.email, role: target.role })
    setMustChange(false)
    setSection('inicio')
  }
  const exitImpersonation = () => {
    if (!impersonation || !session) return
    logImpersonationEvent(impersonation.byName, `${impersonation.byName.split(' ')[0]} salió de la cuenta de ${session.name} y volvió a su sesión de administrador`)
    const back = impersonation.adminSession
    setImpersonation(null)
    if (back) {
      setSession(back)
    } else {
      /* Entró desde el selector, sin sesión propia viva: la salida
         es la pantalla de acceso. */
      setSession(null)
    }
    setSection('inicio')
  }

  const endSession = (clearQuick: boolean) => {
    /* Cerrar sesión es la ÚNICA salida (regla del dueño, 26-oct
       19:09) y apaga el acceso rápido de este dispositivo: el próximo
       ingreso será con contraseña y habrá que volver a activarlo en
       Ajustes. Dentro de una cuenta ajena («entrar como») cerrar
       sesión NO apaga el acceso rápido de esa persona: no es su
       dispositivo. */
    if (clearQuick && session && !impersonation) clearQuickAccess(session.profileId)
    setImpersonation(null)
    if (SB_MODE) void sbLogout().catch(() => { /* la sesión local ya quedó cerrada */ })
    logout()
    setSession(null)
    setMustChange(false)
    setSection('inicio')
    setRemoteError(null)
    if (SB_MODE) setData({ ...EMPTY_DATA })
  }
  const doLogout = () => endSession(true)

  /* Los retornos tempranos de arranque/acceso van DESPUÉS de todos
     los hooks (más abajo): llamarlos antes rompía la app al pasar de
     «sin sesión» a «con sesión» (React: más hooks que en el render
     anterior). Corregido en la puerta de calidad final. */
  const isAdmin = session?.role === 'admin'

  /* Acceso por sección (matriz de Yan + regla general del dueño):
     canEdit da a cada pantalla su «isAdmin» real — para Yan es
     verdadero en sus secciones de escritura y falso en las de solo
     lectura; para Jesús y Dayami, falso en todas; el administrador
     lo tiene todo. La guardia de vista bloquea también el acceso
     directo a una sección sin permiso (no basta con ocultarla). */
  const accessOf = (s: Section) => sectionAccess(session, s)
  const canEdit = (s: Section) => canModifyIn(session, s)
  useEffect(() => {
    if (session && section !== 'inicio' && sectionAccess(session, section) === 'none') {
      /* Acceso denegado: también queda registrado (precisión del
         dueño, 15:10 — no solo lo que sale bien se rastrea). */
      logActivity('fallido', `Acceso denegado a la sección «${section}» (sin permiso para su rol); se le devolvió a Inicio`, { section })
      setSection('inicio')
    }
  }, [session, section])

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
  /* Insignias de la navegación (D-67): las definiciones del original.
     Cobrar = cuentas pendientes (ya coincidía). Queen = avisos de
     Queen aún no vistos (su queenUnseenCount: la firma de los avisos
     se guarda al abrir Queen, como su «queen-alerts-seen») MÁS las
     notificaciones de su servidor, que no
     viajan en el respaldo (D-50): aquí cuentan las observaciones que
     el núcleo de Queen deriva de los datos reales de esta copia.
     Sistema = notificaciones TÉCNICAS (las suyas son kind
     sistema/task_* del mismo servidor que no viaja): aquí cuentan los
     asuntos técnicos derivables de esta copia — días descuadrados,
     boletines con error, corridas de automatización con error y el
     fallo de conexión vivo —, nunca las morosas (eso es de Cobrar). */
  const queenObservations = useMemo(() => {
    try { return buildQueenObservations(data, ref).filter((o) => o.level === 'alert') } catch { return [] }
  }, [data, ref])
  const queenAlertSig = queenObservations.map((o) => `${o.kind}:${o.text}`).join('|')
  const [queenSeenSig, setQueenSeenSig] = useState<string>(() => {
    try { return localStorage.getItem('queen-alerts-seen') ?? '' } catch { return '' }
  })
  const queenUnseenCount = section !== 'queen' && queenAlertSig && queenSeenSig !== queenAlertSig ? queenObservations.length : 0
  const openQueen = useCallback(() => {
    setSection('queen')
    setQueenSeenSig((current) => {
      if (queenAlertSig && current !== queenAlertSig) {
        try { localStorage.setItem('queen-alerts-seen', queenAlertSig) } catch { /* almacenamiento no disponible */ }
        return queenAlertSig
      }
      return current
    })
  }, [queenAlertSig])
  const technicalCount = useMemo(() => {
    let n = 0
    if (remoteError) n += 1
    n += data.days.filter((d) => d.cuadre !== 0).length
    n += bulletins.filter((b) => b.status === 'error').length
    n += data.automationRuns.filter((r) => r.status === 'error').length
    return n
  }, [data, bulletins, remoteError])
  const badgeFor = (id: Section): number => {
    if (id === 'cobrar') return pendingCount
    if (id === 'queen') return Math.min(99, queenUnseenCount)
    if (id === 'sistema') return Math.min(99, technicalCount)
    return 0
  }
  if (!ready) return <BootScreen slow={bootSlow} onRetry={() => window.location.reload()} />
  if (recovery.active) {
    return (
      <ResetPasswordScreen
        session={session}
        linkError={recovery.error}
        onDone={() => {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
          setRecovery({ active: false, error: null })
          setMustChange(false)
        }}
        onLogout={() => {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
          setRecovery({ active: false, error: null })
          doLogout()
        }}
      />
    )
  }
  if (!session && bootError) return (
    <div className="auth-wrap">
      <section className="card auth-card">
        <div className="auth-mark"><img src={BRAND_LOGO_URL} alt="Logo azul de La Reina: corona, barco y olas" className="auth-logo" /></div>
        <h1>{SYSTEM_NAME}</h1>
        <p className="auth-sub">Sistema de Automatización de Datos V2.0<br />{PLACE}</p>
        <div className="error-box" style={{ marginBottom: 12 }}>
          Tu sesión sigue guardada en este dispositivo, pero la conexión no dejó verificarla al abrir. No tienes que entrar de nuevo: comprueba la conexión y toca «Reintentar».
        </div>
        <button type="button" className="btn primary block" onClick={() => window.location.reload()}>Reintentar</button>
      </section>
    </div>
  )
  if (!session) return <LoginScreen onLogin={(s, mc, via) => { setSession(s); setMustChange(mc); logActivity('sesion', `Inicio de sesión con ${via ?? 'contraseña'}`, { actor: s }) }} onImpersonate={(target, adminName) => enterAs(target, adminName)} />
  if (mustChange) return <ChangePasswordScreen session={session} onDone={() => setMustChange(false)} onLogout={doLogout} />

  const initials = session.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  const renderSideItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`nav-btn ${section === item.id ? 'active' : ''}`}
      onClick={() => (item.queen ? openQueen() : setSection(item.id))}
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
      {/* SIN cabecera superior propia (D-65): el original no lleva
          barra con marca + usuario + «Salir» sobre el contenido; la
          marca vive en la lateral de escritorio y arriba del área
          principal solo va la cabecera de sección con el clúster de
          perfil y conexión (ver <main>). «Cerrar sesión» vive en el
          pie de la lateral, como acción de la cuenta. */}
      {impersonation ? (
        <div className="impersonation-banner" role="status">
          <span>Estás viendo como <strong>{session.name}</strong> · entrando como administrador ({impersonation.byName}). Todo lo que hagas aquí queda registrado a tu nombre dentro de esta cuenta.</span>
          <button type="button" className="btn" onClick={exitImpersonation}>Volver a mi sesión</button>
        </div>
      ) : null}
      <div className="layout">
        <nav className="sidenav ambient-bar-surface" aria-label="Navegación principal">
          <div className="side-brand">
            <span className="brand-mark"><QueenReactorMark stageId={queenSnapshot?.stageId ?? 'juvenil'} size={34} /></span>
            <div>
              <div className="brand-name">{SYSTEM_NAME}</div>
              <div className="brand-sub">Sistema de Automatización de Datos V2.0</div>
            </div>
          </div>
          <button className="side-profile" onClick={accessOf('ajustes') !== 'none' ? () => setSection('ajustes') : undefined} aria-label="Tu perfil y acceso" aria-disabled={accessOf('ajustes') === 'none'}>
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
          {SIDE_PRINCIPAL.filter((i) => accessOf(i.id) !== 'none').map(renderSideItem)}
          <div className="side-group-label">Más secciones</div>
          {SIDE_MAS.filter((i) => accessOf(i.id) !== 'none').map(renderSideItem)}
          <div className="side-foot">
            {fmtInt(data.days.length)} días importados · Dinero en la calle: {fmtCUP(dineroCalle)} (solo cuentas de clientes)
          </div>
          <button className="nav-btn" onClick={doLogout}>
            <Icon name="x" size={20} strokeWidth={1.8} />
            <span className="nav-label">Cerrar sesión</span>
          </button>
        </nav>

        <main className="main">
          {/* Cabecera de sección del original: SOLO el clúster de
              perfil y conexión a la derecha (píldora «En línea» +
              avatar que abre Ajustes); sin título propio aquí — cada
              pestaña abre con su TabHeader, como en el original la
              abre el suyo desde la carcasa. */}
          <header className="oneui-section-header">
            <p className="sr-only" aria-live="polite">{session.name}: {isAdmin ? 'Administrador' : 'Solo lectura'}</p>
            <div className="oneui-section-actions">
              <div className="profile-status-cluster" aria-label="Perfil y conectividad">
                <ConnectionStatus />
                <button
                  type="button"
                  onClick={accessOf('ajustes') !== 'none' ? () => setSection('ajustes') : undefined}
                  className="oneui-profile-button"
                  aria-label={`Ir a mi perfil: ${session.name}`}
                  aria-disabled={accessOf('ajustes') === 'none'}
                  title={session.name}
                >
                  <MediaImage
                    kind="foto-perfil" entityKey="perfil-admin" alt=""
                    fallback={<img src={BRAND_LOGO_URL} alt="" />}
                  />
                </button>
              </div>
            </div>
          </header>
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
          {/* Carcasa .md-page del original (D-21): cada pestaña entra
              con sda-tab-enter (shell.css); la key por sección
              re-dispara la entrada al cambiar de pestaña, como el
              remontaje del original. */}
          <div className="md-page" key={section}>
          {section === 'inicio' ? <Inicio data={data} isAdmin={canEdit('inicio')} onImportClick={() => setSection('importar')} onNavigate={setSection} /> : null}
          {section === 'dias' ? <Dias data={data} isAdmin={canEdit('dias')} onChanged={refresh} /> : null}
          {section === 'cuentas' ? <Cuentas data={data} isAdmin={canEdit('cuentas')} onChanged={refresh} /> : null}
          {section === 'cobrar' ? <Cobrar data={data} isAdmin={canEdit('cobrar')} onChanged={refresh} /> : null}
          {section === 'queen' ? (
            <QueenScreen
              data={data}
              supabaseMode={SB_MODE}
              onTestLanguage={SB_MODE ? sbQueenChat : undefined}
              chatOnly={accessOf('queen') === 'chat'}
            />
          ) : null}
          {section === 'sistema' ? <Sistema data={data} session={session} onChanged={refresh} onNavigate={setSection} onRunAutomation={isAdmin ? handleRunAutomation : undefined} /> : null}
          {section === 'rh' ? <RHScreen data={data} isAdmin={canEdit('rh')} onChanged={refresh} /> : null}
          {section === 'economia' ? <Economia data={data} isAdmin={canEdit('economia')} onChanged={refresh} onGoCobrar={() => setSection('cobrar')} /> : null}
          {section === 'transferencias' ? <Transferencias data={data} isAdmin={canEdit('transferencias')} onChanged={refresh} /> : null}
          {section === 'productos' ? <Productos data={data} /> : null}
          {section === 'elaboracion' ? <Elaboracion data={data} isAdmin={canEdit('elaboracion')} onChanged={refresh} /> : null}
          {section === 'almacen' ? <Almacen data={data} isAdmin={canEdit('almacen')} onChanged={refresh} /> : null}
          {section === 'inventario' ? <Inventario data={data} isAdmin={canEdit('inventario')} onChanged={refresh} /> : null}
          {section === 'laboratorio' ? <Laboratorio data={data} /> : null}
          {section === 'documentos' ? <Documentos data={data} today={ref} isAdmin={isAdmin} /> : null}
          {section === 'menu' ? <Menu data={data} today={ref} isAdmin={isAdmin} onNavigate={setSection} /> : null}
          {section === 'importar' ? <Importar data={data} canWrite={accessOf('importar') === 'write'} onChanged={refresh} /> : null}
          {section === 'historial' ? (
            <Historial data={data} bulletins={bulletins} today={ref} isAdmin={canEdit('historial')} onBulletinsChange={handleBulletinsChange} />
          ) : null}
          {section === 'archivo' ? <Archivo data={data} bulletins={bulletins} isAdmin={canEdit('archivo')} onChanged={refresh} onNavigate={setSection} /> : null}
          {section === 'entradas' ? <Entradas data={data} /> : null}
          {section === 'extras' ? <Extras data={data} isAdmin={canEdit('extras')} onChanged={refresh} /> : null}
          {section === 'existencias' ? <Existencias data={data} isAdmin={canEdit('existencias')} onChanged={refresh} onNavigate={setSection} /> : null}
          {section === 'cronologia' ? <Cronologia data={data} bulletins={bulletins} activity={activityEntries} onNavigate={setSection} /> : null}
          {section === 'ajustes' && session ? (
            <Ajustes data={data} session={session} isAdmin={isAdmin} onChanged={refresh} onNavigate={setSection} onEnterAs={(target) => enterAs(target, session.name)} onLogout={doLogout} />
          ) : null}
          {section === 'mas' ? <MasScreen onNavigate={setSection} data={data} hidden={(['ajustes', 'archivo', 'cronologia', 'dias', 'historial', 'sistema'] as Section[]).filter((s) => accessOf(s) === 'none')} /> : null}
          </div>
          </Suspense>
        </main>
      </div>

      <nav className="bottomnav ambient-bar-surface" aria-label="Navegación inferior">
        {NAV.filter((item) => accessOf(item.id) !== 'none').map((item) => {
          const active = section === item.id
          const dot = dotFor(item.id)
          const badge = badgeFor(item.id)
          return (
            <button
              key={item.id}
              className={`${active ? 'active' : ''} ${item.queen ? 'queen-btn' : ''}`}
              onClick={() => (item.queen ? openQueen() : setSection(item.id))}
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
