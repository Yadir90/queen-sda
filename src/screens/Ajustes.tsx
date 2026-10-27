import { useEffect, useRef, useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { ActionMenu, Card, InfoHelp, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { MediaImage } from '../components/MediaImage'
import '../components/sectionsMirror.css'
import { listProfiles, login, resetLocalData, saveRhSettings, supabaseConfigured, updateOwnProfile } from '../lib/backend'
import { sbSaveRhSettings, sbUpdateOwnProfile, sbVerifyPassword } from '../lib/supabaseBackend'
import {
  deleteMyCredential, listMyCredentials, platformAuthenticatorAvailable,
  registerBiometric, requireBiometricUnlock, webauthnSupported,
  type MyCredential,
} from '../lib/webauthn'
import { clearQuickPin, getQuickAccess, pinStorageSupported, setBiometricUnlock, setQuickPin, verifyQuickPin, type QuickAccessRecord } from '../lib/quickAccess'
import { buildBackupExport, BULLETIN_RECIPIENTS } from '../lib/documentosCore.mjs'
import { downloadText } from '../lib/download'
import { saveMedia } from '../lib/media'
import { fmtDate, fmtInt } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Ajustes — reconstruido regla a regla contra el AjustesTab del
   original (su App.tsx) en la ronda del 26-oct: mismo inventario
   y orden de tarjetas (Perfil del administrador con el PIN de
   seguridad dentro · Informes por correo · Fecha ancla de los
   ciclos de RH · Respaldo completo · Borrar todos los datos) y
   «Cerrar sesión» en su sitio del original, junto a «Guardar
   perfil y acceso» (defecto 6 del dueño: en el clon solo vivía
   en la lateral de escritorio y en el teléfono no aparecía).
   Encima de esa base, las piezas propias de esta copia que el
   dueño encargó (biometría WebAuthn y «Entrar como», 26-oct) se
   quedan, presentadas con el mismo idioma visual.
   Sustituciones declaradas (honestas, no fingidas):
     · El PIN del original es su segunda capa para exportar y
       cambiar ajustes; en esta copia esa autorización la hace la
       biometría registrada (candado de acciones sensibles) y el
       PIN que se configura aquí es el de acceso rápido por
       dispositivo (desbloqueo de la sesión guardada y «Entrar
       como»). El formulario es el del original — PIN actual /
       nuevo / confirmar + contraseña para restablecer — y cada
       botón hace de verdad lo que dice sobre ese PIN.
     · El «Usuario» del original es su nombre de acceso; aquí el
       acceso es el correo: editable en modo local y fijo con
       Supabase (la identidad la gestiona el servidor de Auth).
     · Los destinatarios del boletín son los fijos del sistema
       (BULLETIN_RECIPIENTS): la tarjeta los muestra y enlaza la
       cola de Historial, sin un editor que no cambiaría nada. */

const fmtFull = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}
const fmtDayShort = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(d)
}
const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function AjustesTab({ data, session, isAdmin, onChanged, onNavigate, onEnterAs, onLogout }: {
  data: StoredData
  session: Session
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
  onEnterAs?: (target: { id: string; name: string; email: string; role: Session['role'] }) => void
  onLogout?: () => void
}) {
  const sbMode = supabaseConfigured()

  /* ===== Perfil del administrador ===== */
  const [displayName, setDisplayName] = useState(session.name)
  const [username, setUsername] = useState(session.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const credentialsTouched = currentPassword !== '' || newPassword !== ''
  const saveProfileDisabled = profileBusy || !displayName.trim() || !username.trim()
    || (credentialsTouched && !currentPassword) || (!!newPassword && newPassword.length < 6)

  const handlePhoto = async (file: File | null) => {
    if (!file) return
    setProfileMsg('')
    setProfileError('')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('read'))
        reader.readAsDataURL(file)
      })
      const base64 = dataUrl.split(',')[1] || ''
      await saveMedia({ kind: 'foto-perfil', entityKey: 'perfil-admin', label: 'Foto del administrador', mime: file.type || 'image/jpeg', dataBase64: base64 })
      setProfileMsg('Foto actualizada: es la que se muestra en el encabezado y en el selector de acceso.')
      onChanged()
    } catch {
      setProfileError('La foto no se pudo guardar: se conserva en el servidor y este dispositivo no lo alcanzó ahora. Tu foto anterior sigue igual.')
    }
  }

  const saveProfile = async () => {
    setProfileMsg('')
    setProfileError('')
    /* Candado de acciones sensibles de esta copia: con credencial
       biométrica registrada, guardar cambios en Ajustes la pide
       (equivalente funcional del PIN del original). */
    const unlock = await requireBiometricUnlock()
    if (!unlock.ok) { setProfileError(unlock.reason ?? 'Verificación biométrica no completada: el perfil no se guardó.'); return }
    setProfileBusy(true)
    try {
      const patch: { name?: string; email?: string; currentPassword?: string; newPassword?: string } = {}
      if (displayName.trim() !== session.name) patch.name = displayName.trim()
      if (!sbMode && username.trim().toLowerCase() !== session.email.toLowerCase()) patch.email = username.trim()
      if (newPassword) { patch.currentPassword = currentPassword; patch.newPassword = newPassword }
      if (Object.keys(patch).length === 0) { setProfileMsg('No hay cambios que guardar.'); return }
      const res = sbMode
        ? await sbUpdateOwnProfile(patch)
        : updateOwnProfile(session.profileId, patch)
      if (!res.ok) { setProfileError(res.error ?? 'No se pudo guardar el perfil.'); return }
      setCurrentPassword('')
      setNewPassword('')
      setProfileMsg(newPassword ? 'Perfil y contraseña guardados.' : 'Perfil guardado.')
      onChanged()
    } finally {
      setProfileBusy(false)
    }
  }

  /* ===== PIN de seguridad (= PIN de acceso rápido de esta copia) ===== */
  const [quick, setQuick] = useState<QuickAccessRecord | null>(() => getQuickAccess(session.profileId))
  const refreshQuick = () => setQuick(getQuickAccess(session.profileId))
  const pinConfigured = !!quick?.pinEnabled
  const [pinCurrent, setPinCurrent] = useState('')
  const [pinNew, setPinNew] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinPassword, setPinPassword] = useState('')
  const [pinMsg, setPinMsg] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const pinIsValid = pinNew.length >= 4 && pinNew.length <= 6

  const clearPinForm = () => { setPinCurrent(''); setPinNew(''); setPinConfirm(''); setPinPassword('') }
  const changePinWithCurrent = async () => {
    setPinMsg(''); setPinError(''); setPinBusy(true)
    try {
      const check = await verifyQuickPin(session.profileId, pinCurrent)
      if (!check.ok) {
        setPinError(check.reason === 'locked'
          ? 'Demasiados intentos: tu PIN quedó desactivado en este dispositivo. Restablécelo con tu contraseña.'
          : `PIN actual incorrecto. Te quedan ${check.attemptsLeft} intentos.`)
        return
      }
      await setQuickPin(session.profileId, pinNew)
      clearPinForm()
      refreshQuick()
      setPinMsg('PIN cambiado en este dispositivo.')
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'No se pudo cambiar el PIN.')
    } finally { setPinBusy(false) }
  }
  const savePinWithPassword = async () => {
    setPinMsg(''); setPinError(''); setPinBusy(true)
    try {
      const okPass = sbMode ? await sbVerifyPassword(pinPassword) : login(session.email, pinPassword).ok
      if (!okPass) { setPinError('La contraseña no coincide: el PIN no se tocó.'); return }
      await setQuickPin(session.profileId, pinNew)
      clearPinForm()
      refreshQuick()
      setPinMsg(pinConfigured
        ? 'PIN restablecido en este dispositivo.'
        : 'PIN activado en este dispositivo: al abrir la app podrás desbloquear tu sesión con él.')
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'No se pudo guardar el PIN.')
    } finally { setPinBusy(false) }
  }
  const disablePin = () => {
    clearQuickPin(session.profileId)
    clearPinForm()
    refreshQuick()
    setPinMsg('PIN desactivado en este dispositivo.')
    setPinError('')
  }

  /* ===== Biometría WebAuthn (añadido del dueño, 2026-10-26) ===== */
  const [bioCreds, setBioCreds] = useState<MyCredential[] | null>(null)
  const [bioUnavailable, setBioUnavailable] = useState(false)
  const [bioLabel, setBioLabel] = useState('Este dispositivo')
  const [bioMsg, setBioMsg] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  const [bioPlatform, setBioPlatform] = useState<boolean | null>(null)
  const bioSupported = webauthnSupported()
  useEffect(() => {
    if (sbMode && bioSupported) { void platformAuthenticatorAvailable().then(setBioPlatform) }
  }, [sbMode, bioSupported])
  const loadBio = async () => {
    const { rows, unavailable } = await listMyCredentials()
    setBioCreds(rows)
    setBioUnavailable(unavailable)
  }
  useEffect(() => { if (sbMode) void loadBio() }, [sbMode])
  const doRegisterBio = async () => {
    setBioBusy(true)
    setBioMsg('')
    const res = await registerBiometric(bioLabel.trim() || 'Este dispositivo')
    setBioBusy(false)
    if (res.ok) {
      setBioMsg('Biometría registrada en este dispositivo. Desde ahora, exportar documentos y guardar cambios en Ajustes te pedirán la huella o la cara aquí.')
      void loadBio()
    } else {
      setBioMsg(res.reason ?? 'El registro no se completó.')
    }
  }
  const doDeleteBio = async (credentialId: string) => {
    setBioBusy(true)
    const ok = await deleteMyCredential(credentialId)
    setBioBusy(false)
    setBioMsg(ok ? 'Credencial eliminada. Este dispositivo ya no desbloquea acciones sensibles.' : 'No se pudo eliminar la credencial ahora.')
    if (ok) void loadBio()
  }

  /* ===== «Entrar como» (decisión del dueño, 2026-10-26 15:09) ===== */
  const [enterAsId, setEnterAsId] = useState<string | null>(null)
  const [enterAsPin, setEnterAsPin] = useState('')
  const [enterAsError, setEnterAsError] = useState('')
  const [enterAsBusy, setEnterAsBusy] = useState(false)
  const doEnterAsPin = async (target: { id: string; name: string; email: string; role: Session['role'] }) => {
    setEnterAsBusy(true)
    setEnterAsError('')
    try {
      const check = await verifyQuickPin(session.profileId, enterAsPin)
      if (!check.ok) {
        setEnterAsError(check.reason === 'locked'
          ? 'Demasiados intentos: tu PIN quedó desactivado en este dispositivo.'
          : `PIN incorrecto. Te quedan ${check.attemptsLeft} intentos.`)
        return
      }
      onEnterAs?.(target)
    } finally {
      setEnterAsBusy(false)
      setEnterAsPin('')
    }
  }
  const doEnterAsBio = async (target: { id: string; name: string; email: string; role: Session['role'] }) => {
    setEnterAsBusy(true)
    setEnterAsError('')
    try {
      const unlock = await requireBiometricUnlock()
      if (!unlock.ok) { setEnterAsError(unlock.reason ?? 'La verificación biométrica no se completó.'); return }
      onEnterAs?.(target)
    } finally {
      setEnterAsBusy(false)
    }
  }

  /* ===== Fecha ancla de RH ===== */
  const [anchor, setAnchor] = useState(data.anchorDate)
  const [anchorMsg, setAnchorMsg] = useState('')
  const [anchorBusy, setAnchorBusy] = useState(false)
  const saveAnchor = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) { setAnchorMsg('Escribe la fecha ancla en formato AAAA-MM-DD.'); return }
    const unlock = await requireBiometricUnlock()
    if (!unlock.ok) { setAnchorMsg(unlock.reason ?? 'Verificación biométrica no completada: el ancla no se guardó.'); return }
    setAnchorBusy(true)
    try {
      if (sbMode) await sbSaveRhSettings({ anchorDate: anchor })
      else saveRhSettings({ anchorDate: anchor })
      setAnchorMsg('Fecha ancla guardada. Los ciclos de RH se recalculan solos desde ella.')
      onChanged()
    } catch {
      setAnchorMsg('No se pudo guardar la fecha ancla ahora. Revisa la conexión e inténtalo de nuevo.')
    } finally {
      setAnchorBusy(false)
    }
  }

  /* ===== Respaldo completo ===== */
  const [backupMsg, setBackupMsg] = useState('')
  const downloadBackup = (kind: 'json' | 'csv') => {
    const today = new Date().toISOString().slice(0, 10)
    if (kind === 'json') {
      const backup = buildBackupExport(data, today)
      downloadText(JSON.stringify(backup, null, 2), `backup-sda-${today}.json`, 'application/json;charset=utf-8')
      setBackupMsg(`Respaldo JSON descargado: ${fmtInt(data.days.length)} días, con las cuentas, los gastos y las nóminas.`)
      return
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines: string[] = ['seccion;fecha;concepto;detalle;importe']
    for (const d of data.days) lines.push(['dia', d.date, 'Ventas del día', '', d.ventasDia].map(esc).join(';'))
    for (const g of data.expenses ?? []) lines.push(['gasto', g.date, g.concept ?? '', g.category ?? '', g.total].map(esc).join(';'))
    for (const r of data.receivables ?? []) lines.push(['cuenta', r.date ?? '', r.client ?? '', `${r.category ?? ''} · ${r.status ?? ''} · original ${r.originalAmount ?? ''}`, r.amount ?? ''].map(esc).join(';'))
    downloadText(lines.join('\n'), `respaldo-sda-${today}.csv`, 'text/csv;charset=utf-8')
    setBackupMsg('Respaldo CSV descargado: días, gastos y cuentas por cobrar en una tabla.')
  }

  /* ===== Borrar todos los datos (solo modo local) ===== */
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetMsg, setResetMsg] = useState('')
  const doReset = () => {
    resetLocalData()
    setConfirmReset(false)
    setResetText('')
    setResetMsg('Datos locales restablecidos: días, cuentas y abonos de este dispositivo quedaron vacíos. El sistema original no se tocó.')
    onChanged()
  }

  const bulletins = data.bulletins ?? []
  const bulletinsPending = bulletins.filter((b) => b.status !== 'enviado').length
  const bulletinsSent = bulletins.filter((b) => b.status === 'enviado').length
  const initials = session.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  return (
    <section aria-label="Ajustes">
      <TabHeader
        icon="settings"
        title="Ajustes"
        desc="Perfil, acceso y configuración"
        badge={TAB_BADGES.ajustes}
      />
      <h2 className="ajustes-h2">
        Ajustes{' '}
        <InfoHelp label="Cómo funcionan los Ajustes">
          Aquí configuras el perfil y el acceso, los informes por correo, el ancla de los ciclos de RH y los respaldos. El núcleo de IA y el ADN técnico están en la pestaña Sistema.
        </InfoHelp>
      </h2>

      {/* ===== Perfil del administrador (original) ===== */}
      <Card className="ajustes-card" >
        <div aria-label="Perfil del administrador">
          <h3 className="ajustes-h3">
            Perfil del administrador{' '}
            <InfoHelp label="Cómo funciona el Perfil">
              Este es el perfil del administrador del sistema, Yadir. Su nombre y su foto se muestran en el encabezado. La contraseña sigue siendo la llave para iniciar sesión. La segunda capa para exportar documentos y cambiar ajustes es la huella o la cara registrada en este dispositivo; el PIN de abajo es el de acceso rápido de este aparato.
            </InfoHelp>
          </h3>
          <div className="ajustes-profile-head">
            <MediaImage
              kind="foto-perfil" entityKey="perfil-admin" alt=""
              className="avatar ajustes-avatar" style={{ objectFit: 'cover', padding: 0 }}
              fallback={<span className="avatar ajustes-avatar" aria-hidden>{initials || 'Q'}</span>}
            />
            <div>
              <div className="ajustes-profile-name">{session.name}</div>
              <div className="small muted">Usuario: {isAdmin ? 'Administrador' : 'Solo lectura'}</div>
            </div>
          </div>
          <div className="ajustes-grid">
            <div className="field">
              <label htmlFor="perfil-nombre">Nombre visible</label>
              <input id="perfil-nombre" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="perfil-usuario">Usuario</label>
              <input id="perfil-usuario" type="email" value={username} onChange={(e) => setUsername(e.target.value)} disabled={sbMode} autoComplete="username" />
              {sbMode ? <p className="small muted" style={{ margin: '4px 0 0' }}>Con Supabase, tu usuario es tu correo de acceso y lo gestiona el servidor.</p> : null}
            </div>
            <div className="field ajustes-span2">
              <span className="ajustes-fieldlabel">
                Foto del administrador (Yadir){' '}
                <InfoHelp label="Cómo se guarda la foto del administrador">Esta foto se conserva tal como la eliges, sin filtros ni cambio de fondo.</InfoHelp>
              </span>
              <ActionMenu label="Cambiar foto">
                <button type="button" onClick={() => cameraRef.current?.click()}><Icon name="camera" size={15} /> Tomar foto</button>
                <button type="button" onClick={() => galleryRef.current?.click()}><Icon name="upload" size={15} /> Elegir imagen</button>
              </ActionMenu>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden-input" aria-label="Tomar foto del perfil" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handlePhoto(f) }} />
              <input ref={galleryRef} type="file" accept="image/*" className="hidden-input" aria-label="Elegir foto del perfil desde el dispositivo" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handlePhoto(f) }} />
            </div>
            <div className="field">
              <label htmlFor="perfil-clave-actual">Contraseña actual</label>
              <input id="perfil-clave-actual" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Tu contraseña actual" autoComplete="current-password" />
            </div>
            <div className="field">
              <label htmlFor="perfil-clave-nueva">Contraseña nueva (opcional)</label>
              <input id="perfil-clave-nueva" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nueva (mínimo 6 caracteres)" autoComplete="new-password" />
            </div>
          </div>
          <div className="ajustes-actions">
            <button type="button" className="btn primary ajustes-pill" disabled={saveProfileDisabled} onClick={() => void saveProfile()}>
              {profileBusy ? 'Guardando…' : 'Guardar perfil y acceso'}
            </button>
            {onLogout ? (
              <button type="button" className="btn ajustes-logout" onClick={onLogout}>Cerrar sesión</button>
            ) : null}
          </div>
          {profileMsg ? <p className="small ajustes-ok" role="status">{profileMsg}</p> : null}
          {profileError ? <p className="small ajustes-err" role="alert">{profileError}</p> : null}

          {/* ===== PIN de seguridad (subsección del original) ===== */}
          <div className="ajustes-subsection" aria-label="PIN de seguridad">
            <div className="ajustes-subhead">
              <div>
                <h4 className="ajustes-h4">PIN de seguridad</h4>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {pinConfigured
                    ? 'Activo en este dispositivo: desbloquea tu sesión guardada al abrir la app y autoriza «Entrar como». La contraseña sigue siendo la vía principal; cerrar sesión lo apaga.'
                    : 'Configúralo para desbloquear tu sesión guardada en este dispositivo sin escribir la contraseña. Nunca se guarda en claro: queda un hash con sal, con 5 intentos como máximo.'}
                </p>
              </div>
              <span className={`chip ${pinConfigured ? 'ok' : 'warn'}`}>{pinConfigured ? 'Activo' : 'Pendiente'}</span>
            </div>
            {!pinStorageSupported() ? (
              <p className="small muted" style={{ marginBottom: 0 }}>Este navegador no permite guardar el PIN con hash seguro en este contexto: el acceso rápido por PIN no se ofrece aquí.</p>
            ) : (
              <>
                <div className="ajustes-grid">
                  {pinConfigured ? (
                    <div className="field">
                      <label htmlFor="pin-actual">PIN actual</label>
                      <input id="pin-actual" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pinCurrent} onChange={(e) => setPinCurrent(e.target.value.replace(/\D/g, ''))} autoComplete="off" placeholder="4 a 6 números" className="ajustes-pin-input" />
                    </div>
                  ) : null}
                  <div className="field">
                    <label htmlFor="pin-nuevo">{pinConfigured ? 'PIN nuevo' : 'Nuevo PIN'}</label>
                    <input id="pin-nuevo" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pinNew} onChange={(e) => setPinNew(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" placeholder="4 a 6 números" className="ajustes-pin-input" />
                  </div>
                  <div className="field">
                    <label htmlFor="pin-confirmar">Confirmar PIN nuevo</label>
                    <input id="pin-confirmar" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" placeholder="Repite el PIN" className="ajustes-pin-input" />
                  </div>
                  <div className="field">
                    <label htmlFor="pin-clave">Contraseña para {pinConfigured ? 'restablecer' : 'configurar'}</label>
                    <input id="pin-clave" type="password" value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} autoComplete="current-password" placeholder="Tu contraseña" />
                  </div>
                </div>
                <div className="ajustes-actions">
                  {pinConfigured ? (
                    <button type="button" className="btn primary ajustes-pill" disabled={pinBusy || !pinCurrent || !pinIsValid || pinNew !== pinConfirm} onClick={() => void changePinWithCurrent()}>
                      {pinBusy ? 'Guardando…' : 'Cambiar PIN'}
                    </button>
                  ) : null}
                  <button type="button" className="btn ajustes-pill" disabled={pinBusy || !pinPassword || !pinIsValid || pinNew !== pinConfirm} onClick={() => void savePinWithPassword()}>
                    {pinBusy ? 'Guardando…' : pinConfigured ? 'Restablecer con contraseña' : 'Configurar PIN'}
                  </button>
                  {pinConfigured ? (
                    <button type="button" className="btn ajustes-pill" disabled={pinBusy} onClick={disablePin}>Desactivar PIN</button>
                  ) : null}
                </div>
                {pinMsg ? <p className="small ajustes-ok" role="status">{pinMsg}</p> : null}
                {pinError ? <p className="small ajustes-err" role="alert">{pinError}</p> : null}
              </>
            )}
          </div>

          {/* ===== Huella o cara (añadido del dueño en esta copia) ===== */}
          <p className="small muted" style={{ margin: '12px 0 0' }}>
            <strong>Acceso rápido en este dispositivo:</strong> este PIN desbloquea tu sesión guardada solo en este equipo, con intentos limitados, y se apaga al cerrar sesión. La huella o la cara hacen además de candado de las acciones sensibles (exportar y cambiar ajustes), en la subsección siguiente.
          </p>

          <div className="ajustes-subsection" aria-label="Huella o cara en este dispositivo">
            <div className="ajustes-subhead">
              <div>
                <h4 className="ajustes-h4">Huella o cara en este dispositivo</h4>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  La huella o la cara autorizan la sesión y las acciones sensibles — exportar documentos y guardar cambios en Ajustes — según el dispositivo. La verifica el propio teléfono: nada biométrico sale de él; el servidor guarda solo la clave pública y comprueba cada desbloqueo con un reto de un solo uso.
                </p>
              </div>
              <span className={`chip ${bioCreds && bioCreds.length > 0 ? 'ok' : ''}`}>{bioCreds && bioCreds.length > 0 ? 'Registrada' : 'Sin registrar'}</span>
            </div>
            {!sbMode ? (
              <p className="small muted" style={{ marginBottom: 0 }}>El registro biométrico necesita la sesión de Supabase (el servidor emite y verifica los retos): en modo local no se puede registrar y no se finge ningún registro.</p>
            ) : !bioSupported ? (
              <p className="small muted" style={{ marginBottom: 0 }}>Este navegador no soporta WebAuthn: la biometría no se puede usar en él y el acceso sigue siendo tu contraseña.</p>
            ) : (
              <>
                {bioPlatform === false ? (
                  <p className="small muted">Este dispositivo no declara huella/cara integrada disponible: el registro puede no ofrecer autenticador de plataforma aquí.</p>
                ) : null}
                {bioUnavailable ? (
                  <p className="small muted">La tabla de credenciales aún no responde en el servidor: en cuanto esté aplicada, aquí podrás registrar este dispositivo.</p>
                ) : bioCreds && bioCreds.length > 0 ? (
                  <div className="list">
                    {bioCreds.map((c) => (
                      <div className="row" key={c.credential_id}>
                        <span className="mod-row-main">
                          <span className="mod-row-title"><Icon name="fingerprint" size={15} /> {c.device_label || 'Dispositivo sin nombre'}</span>
                          <span className="small muted">
                            Registrada el {fmtDate(c.created_at.slice(0, 10))}
                            {c.last_used_at ? ` · último desbloqueo ${fmtDate(c.last_used_at.slice(0, 10))}` : ' · aún sin desbloqueos'}
                          </span>
                        </span>
                        <button type="button" className="btn" disabled={bioBusy} onClick={() => void doDeleteBio(c.credential_id)}>Eliminar</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="small muted">Todavía no tienes ninguna credencial registrada.</p>
                )}
                <div className="mod-inline-form" style={{ marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="ajustes-bio-nombre">Nombre de este dispositivo</label>
                    <input id="ajustes-bio-nombre" type="text" maxLength={80} value={bioLabel} onChange={(e) => setBioLabel(e.target.value)} placeholder="Este dispositivo" />
                  </div>
                  <button type="button" className="btn primary" disabled={bioBusy} onClick={() => void doRegisterBio()}>
                    <Icon name="fingerprint" size={15} /> {bioBusy ? 'Esperando al dispositivo…' : 'Registrar huella o cara en este dispositivo'}
                  </button>
                </div>
                {bioMsg ? <p className="small" role="status" style={{ marginBottom: 0 }}>{bioMsg}</p> : null}
                <p className="small" style={{ marginTop: 10 }}>
                  Apertura de la app con huella o cara en este dispositivo:{' '}
                  {quick?.biometricEnabled ? (
                    <><strong>activada</strong>.{' '}
                      <button type="button" className="btn" onClick={() => { setBiometricUnlock(session.profileId, false); refreshQuick(); setPinMsg('Apertura biométrica desactivada en este dispositivo.') }}>Desactivar</button></>
                  ) : bioCreds && bioCreds.length > 0 ? (
                    <><strong>sin activar</strong>.{' '}
                      <button type="button" className="btn" onClick={() => { setBiometricUnlock(session.profileId, true); refreshQuick(); setPinMsg('Apertura biométrica activada en este dispositivo: al abrir la app podrás desbloquear con tu huella o cara.') }}>Activar apertura biométrica</button></>
                  ) : (
                    <span className="muted">registra primero tu huella o cara aquí arriba y después podrás activar la apertura biométrica.</span>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ===== Informes por correo (original) ===== */}
      <Card className="ajustes-card">
        <div aria-label="Informes por correo">
          <h3 className="ajustes-h3">Informes por correo</h3>
          <p className="small muted">
            Boletín con las cifras, los gráficos sin duplicar y los avisos de Queen, con su PDF del período. Cada importación de un IPV genera el boletín de la fecha de ese IPV y lo deja pendiente de envío en la cola; también se genera el de hoy a las 23:00 (hora de La Habana). El despachador externo los recoge cuando cumplen su espera y los envía desde el correo del negocio; hasta que un boletín no consta como «Enviado» en Historial, no se da por mandado.
          </p>
          <p className="small muted" style={{ marginBottom: 6 }}>Destinatarios del boletín (fijos del sistema):</p>
          <div className="list">
            {BULLETIN_RECIPIENTS.map((r: string) => (
              <div className="row ajustes-mail-row" key={r}><span>{r}</span><span className="chip">Boletín diario</span></div>
            ))}
          </div>
          <div className="ajustes-historial-row">
            <span className="small" style={{ minWidth: 0 }}>
              <strong>Historial de boletines</strong>
              <span className="small muted" style={{ display: 'block' }}>
                {bulletins.length === 0
                  ? 'Todavía no hay boletines generados.'
                  : `${bulletins.length} boletín${bulletins.length === 1 ? '' : 'es'} guardado${bulletins.length === 1 ? '' : 's'} · ${bulletinsPending} pendiente${bulletinsPending === 1 ? '' : 's'} de envío · ${bulletinsSent} enviado${bulletinsSent === 1 ? '' : 's'}`}
              </span>
            </span>
            <button type="button" className="btn primary ajustes-pill" onClick={() => onNavigate('historial')}>Ver historial</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Los documentos se exportan desde Documentos: cualquier perfil puede exportarlos, excepto el respaldo del sistema, que queda solo para el administrador.
          </p>
        </div>
      </Card>

      {/* ===== Fecha ancla de los ciclos de RH (original) ===== */}
      <Card className="ajustes-card">
        <h3 className="ajustes-h3">Fecha ancla de los ciclos de RH</h3>
        <p className="small muted">
          Los ciclos duran 15 días exactos y se paga al día 16. Con el ancla actual ({fmtFull(data.anchorDate)}),
          un ciclo va del {fmtDayShort(data.anchorDate)} al {fmtDayShort(addDaysIso(data.anchorDate, 14))} y se paga el {fmtDayShort(addDaysIso(data.anchorDate, 15))}.
          Cambiarla recalcula los ciclos solos; no mueve ninguna nómina ya pagada.
        </p>
        {isAdmin ? (
          <div className="mod-inline-form">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="anchor-date">Nueva fecha ancla</label>
              <input id="anchor-date" type="date" value={anchor} onChange={(e) => { setAnchor(e.target.value); setAnchorMsg('') }} />
            </div>
            <button type="button" className="btn primary" disabled={anchorBusy || !anchor || anchor === data.anchorDate} onClick={() => void saveAnchor()}>
              {anchorBusy ? 'Guardando…' : 'Guardar ancla'}
            </button>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Solo el administrador puede cambiar el ancla.</p>
        )}
        {anchorMsg ? <p className="small ajustes-ok" role="status" style={{ marginBottom: 0 }}>{anchorMsg}</p> : null}
      </Card>

      {/* ===== Respaldo completo (original) ===== */}
      <Card className="ajustes-card">
        <h3 className="ajustes-h3">Respaldo completo (días, gastos y cuentas por cobrar)</h3>
        <p className="small muted">
          Tienes {fmtInt(data.days.length)} día{data.days.length === 1 ? '' : 's'} guardado{data.days.length === 1 ? '' : 's'}.
          El respaldo JSON incluye el archivo completo de cuentas por cobrar (las del IPV: pendientes, pagadas y su historial; y las manuales),
          las fotos de cuentas de cada IPV importado, tu perfil (nombre y foto) y los ajustes de informes por correo.
          La contraseña nunca sale: ni en texto plano ni su hash. El CSV resume días, gastos y cuentas en una tabla.
        </p>
        <div className="ajustes-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn primary ajustes-pill" onClick={() => downloadBackup('json')}>
            <Icon name="download" size={15} /> Descargar JSON
          </button>
          <button type="button" className="btn ajustes-pill" onClick={() => downloadBackup('csv')}>
            <Icon name="download" size={15} /> Descargar CSV
          </button>
        </div>
        {backupMsg ? <p className="small ajustes-ok" role="status" style={{ marginBottom: 0 }}>{backupMsg}</p> : null}
      </Card>

      {/* ===== Borrar todos los datos (original, zona de peligro) ===== */}
      <Card className="ajustes-card">
        <h3 className="ajustes-h3 ajustes-danger-title">Borrar todos los datos</h3>
        {!sbMode ? (
          <>
            <p className="small muted">
              {fmtInt(data.days.length)} días importados
              {data.importedAt ? ` · última importación ${fmtDate(data.importedAt.slice(0, 10))}` : ''}
              {data.exportedAt ? ` · respaldo de origen exportado el ${fmtDate(data.exportedAt.slice(0, 10))}` : ''}.
              Se vacían los días, las cuentas y los abonos guardados en ESTE dispositivo. El sistema original y el servidor no se tocan.
            </p>
            {resetMsg ? <div className="ok-box" role="status">{resetMsg}</div> : null}
            {!confirmReset ? (
              <button type="button" className="btn danger" onClick={() => setConfirmReset(true)}>
                <Icon name="trash" size={15} /> Borrar los datos de este dispositivo
              </button>
            ) : (
              <div className="error-box" role="alert">
                <p style={{ marginTop: 0 }}>
                  <strong>¿Borrar todos los datos de este dispositivo?</strong> Escribe BORRAR para confirmar.
                </p>
                <div className="mod-inline-form">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="clear-confirm">Confirmación</label>
                    <input id="clear-confirm" type="text" value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="BORRAR" />
                  </div>
                  <button type="button" className="btn danger" disabled={resetText.trim().toUpperCase() !== 'BORRAR'} onClick={doReset}>
                    Sí, borrar
                  </button>
                  <button type="button" className="btn" onClick={() => { setConfirmReset(false); setResetText('') }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Con Supabase los datos viven en el servidor, no en este dispositivo: no hay datos locales que borrar aquí.
          </p>
        )}
      </Card>

      {/* ===== Entrar como otro usuario (añadido del dueño en esta copia) ===== */}
      {isAdmin && onEnterAs ? (
        <Card className="ajustes-card">
          <h3 className="ajustes-h3">Entrar como otro usuario</h3>
          <p className="small muted">
            Capacidad solo del administrador: entras a la cuenta de Jesús,
            Dayami o Yan autorizándote con TU PIN o TU huella — sin saber sus contraseñas. La entrada queda
            registrada en Cronología con tu nombre y la hora, todo lo que hagas dentro se atribuye a ti
            dentro de esa cuenta, y arriba verás siempre la banda «Estás viendo como…» con la salida de
            vuelta a tu sesión.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {listProfiles().filter((p) => p.id !== session.profileId).map((p) => (
              <div key={p.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="avatar" aria-hidden>{p.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <span style={{ flex: 1, minWidth: 140 }}>
                    <strong>{p.name}</strong><br />
                    <span className="small muted">{p.email} · Solo lectura</span>
                  </span>
                  <button type="button" className="btn" aria-expanded={enterAsId === p.id} onClick={() => { setEnterAsId(enterAsId === p.id ? null : p.id); setEnterAsError(''); setEnterAsPin('') }}>
                    Entrar como {p.name.split(' ')[0]}
                  </button>
                </div>
                {enterAsId === p.id ? (
                  <div style={{ marginTop: 10 }}>
                    {enterAsError ? <div className="error-box" style={{ marginBottom: 10 }}>{enterAsError}</div> : null}
                    {quick?.pinEnabled ? (
                      <form onSubmit={(e) => { e.preventDefault(); void doEnterAsPin(p) }} className="mod-inline-form">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`enteras-pin-${p.id}`}>Tu PIN de administrador</label>
                          <input id={`enteras-pin-${p.id}`} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} className="auth-pin-input" value={enterAsPin} onChange={(e) => setEnterAsPin(e.target.value.replace(/\D/g, ''))} required />
                        </div>
                        <button type="submit" className="btn primary" disabled={enterAsBusy || enterAsPin.length < 4}>{enterAsBusy ? 'Comprobando…' : 'Autorizar y entrar'}</button>
                      </form>
                    ) : null}
                    {sbMode && quick?.biometricEnabled ? (
                      <button type="button" className="btn" style={{ marginTop: quick?.pinEnabled ? 10 : 0 }} disabled={enterAsBusy} onClick={() => void doEnterAsBio(p)}>
                        <Icon name="fingerprint" size={15} /> Autorizar con mi huella o cara
                      </button>
                    ) : null}
                    {!quick?.pinEnabled && !(sbMode && quick?.biometricEnabled) ? (
                      <p className="small muted">Para usar «Entrar como» activa primero tu PIN aquí arriba (en «PIN de seguridad»{sbMode ? ' o tu huella' : ''}): la entrada a una cuenta ajena se autoriza siempre con tu PIN o tu biometría, nunca con la contraseña de la otra persona.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </section>
  )
}
