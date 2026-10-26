import { useEffect, useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { listProfiles, resetLocalData, saveRhSettings, supabaseConfigured } from '../lib/backend'
import { sbSaveRhSettings } from '../lib/supabaseBackend'
import {
  deleteMyCredential, listMyCredentials, platformAuthenticatorAvailable,
  registerBiometric, requireBiometricUnlock, webauthnSupported,
  type MyCredential,
} from '../lib/webauthn'
import { clearQuickPin, getQuickAccess, pinStorageSupported, setBiometricUnlock, setQuickPin, verifyQuickPin, type QuickAccessRecord } from '../lib/quickAccess'
import { BULLETIN_RECIPIENTS } from '../lib/documentosCore.mjs'
import { fmtDate, fmtInt } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Ajustes (oleada 3): pantalla propia armada SOLO con las
   capacidades que esta copia ya tiene de verdad —
     · Perfiles y roles: en modo local, los perfiles de la capa
       local (listProfiles); con Supabase, la seguridad la pone el
       servidor (Auth + RLS) y aquí se muestra tu sesión y el rol.
     · Ancla de los ciclos de RH: editable por el administrador
       con la misma vía que usa RH (saveRhSettings en local,
       sbSaveRhSettings con Supabase); los ciclos se recalculan
       solos desde el ancla.
     · Informes: los destinatarios del boletín son los fijos del
       sistema (BULLETIN_RECIPIENTS) y se muestran; la cola vive
       en Historial (enlace, sin duplicar la pantalla).
     · Respaldo: exportar e importar viven en Documentos y en
       Sistema (enlaces, sin duplicar).
     · Datos locales de este dispositivo: restablecer (solo modo
       local, con confirmación escrita), como en Sistema.
   SUSTITUCIÓN DECLARADA (la diferencia admitida del clon): el
   PIN numérico del original — su segunda capa para exportar y
   cambiar ajustes — no existe en esta copia; lo sustituye la
   capa de acceso (contraseña de la cuenta y, con Supabase, los
   roles del servidor). La edición del perfil (nombre visible,
   usuario y foto) también es del servidor del original: aquí el
   perfil se consulta, no se edita, y no se finge ningún guardado.
   BIOMETRÍA (AÑADIDO DEL DUEÑO en esta copia, 2026-10-26, fuera
   de la paridad): la huella/cara SÍ existe aquí, con WebAuthn —
   registro por usuario y dispositivo en esta misma tarjeta, con
   verificación en el servidor (función queen-webauthn) y candado
   sobre exportar documentos y guardar cambios en Ajustes cuando
   hay credencial registrada. */

export default function AjustesTab({ data, session, isAdmin, onChanged, onNavigate, onEnterAs }: {
  data: StoredData
  session: Session
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
  onEnterAs?: (target: { id: string; name: string; email: string; role: Session['role'] }) => void
}) {
  const sbMode = supabaseConfigured()
  const profiles = sbMode
    ? [{ id: session.profileId, name: session.name, email: session.email, role: session.role }]
    : listProfiles()

  const [anchor, setAnchor] = useState(data.anchorDate)
  const [anchorMsg, setAnchorMsg] = useState('')
  const [anchorBusy, setAnchorBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetMsg, setResetMsg] = useState('')

  /* ===== Biometría WebAuthn (añadido del dueño, 2026-10-26) ===== */
  const [bioCreds, setBioCreds] = useState<MyCredential[] | null>(null)
  const [bioUnavailable, setBioUnavailable] = useState(false)
  /* Acceso rápido por dispositivo (dueño, 2026-10-26): estado del
     PIN y de la apertura biométrica de ESTE usuario en ESTE
     dispositivo, guardado por lib/quickAccess en localStorage. */
  const [quick, setQuick] = useState<QuickAccessRecord | null>(() => getQuickAccess(session.profileId))
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinMsg, setPinMsg] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const refreshQuick = () => setQuick(getQuickAccess(session.profileId))
  const doSetPin = async () => {
    setPinBusy(true)
    try {
      await setQuickPin(session.profileId, pin1)
      setPin1('')
      setPin2('')
      refreshQuick()
      setPinMsg('PIN activado en este dispositivo: al abrir la app podrás desbloquear tu sesión con él.')
    } catch (e) {
      setPinMsg(e instanceof Error ? e.message : 'No se pudo guardar el PIN.')
    } finally {
      setPinBusy(false)
    }
  }

  /* ===== «Entrar como» (decisión del dueño, 2026-10-26 15:09) =====
     Solo el administrador: entra a la cuenta de otro usuario
     autorizándose con SU PIN o SU biometría, sin saber la clave
     ajena. La entrada y la salida quedan en Cronología y todo lo
     que haga dentro se atribuye al administrador en esa cuenta. */
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

  const saveAnchor = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) { setAnchorMsg('Escribe la fecha ancla en formato AAAA-MM-DD.'); return }
    /* Candado biométrico (añadido del dueño): guardar un cambio en
       Ajustes pide la huella/cara si el usuario tiene credencial
       registrada; sin credencial, el guardado sigue como hoy. */
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

  const doReset = () => {
    resetLocalData()
    setConfirmReset(false)
    setResetText('')
    setResetMsg('Datos locales restablecidos: días, cuentas y abonos de este dispositivo quedaron vacíos. El sistema original no se tocó.')
    onChanged()
  }

  return (
    <section aria-label="Ajustes">
      <TabHeader
        icon="settings"
        title="Ajustes"
        desc="Aquí configuras el perfil y el acceso, los informes por correo, el ancla de los ciclos de RH y los respaldos. El núcleo de IA y el ADN técnico están en la pestaña Sistema."
        badge={TAB_BADGES.ajustes}
      />

      <Card>
        <h3>Perfil y acceso</h3>
        <p className="small muted">
          {sbMode
            ? 'Con Supabase, las cuentas las crea el administrador y la seguridad la pone el servidor: cada persona entra con su correo y su contraseña, y su rol (administrador o solo lectura) decide lo que puede tocar. Los perfiles de abajo son los de esta sesión; la lista completa vive en el servidor.'
            : 'En modo local, los perfiles viven en este dispositivo y replican los del sistema: un administrador y tres cuentas de solo lectura. La seguridad final la pone Supabase cuando la app se conecta.'}
        </p>
        <div className="list">
          {profiles.map((p) => (
            <div className="row" key={p.id}>
              <span className="mod-row-main">
                <span className="mod-row-title">{p.name}{p.id === session.profileId ? ' (tú)' : ''}</span>
                <span className="small muted">{p.email}</span>
              </span>
              <span className={`chip ${p.role === 'admin' ? 'ok' : ''}`}>{p.role === 'admin' ? 'Administrador' : 'Solo lectura'}</span>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Tu sesión: <strong>{session.name}</strong> · {isAdmin ? 'Administrador' : 'Solo lectura'}. Cambiar el nombre
          visible, el usuario o la foto del perfil es una función del servidor del sistema original y no está en
          esta copia: el perfil se consulta aquí, no se edita, y la contraseña se cambia desde la propia cuenta
          (al primer ingreso la app ya obliga a crearla).
        </p>
      </Card>

      <Card>
        <h3>Seguridad: PIN y biometría</h3>
        <p className="small muted">
          En el sistema original, un PIN numérico actúa como segunda capa tras la contraseña (autoriza
          exportaciones, salvo boletines, y cambios en Ajustes) y el rostro o la huella autorizan la sesión y
          las emisiones según el dispositivo. En esta copia ese PIN-candado <strong>no existe</strong>: lo sustituye la capa
          de acceso — la contraseña de tu cuenta y, con Supabase, los roles del servidor. Otra cosa distinta
          es el PIN de acceso rápido por dispositivo (decisión del dueño, 26-oct): desbloquea tu sesión
          guardada en este aparato y se configura más abajo, en esta misma tarjeta.
        </p>
        <p className="small muted">
          La <strong>biometría sí está en esta copia</strong> (añadido del dueño, 26-oct): huella o cara con
          WebAuthn, registrada por usuario y por dispositivo. La verifica el propio teléfono — nada biométrico
          sale del dispositivo — y el servidor guarda solo la clave pública de la credencial y comprueba cada
          desbloqueo con un reto de un solo uso. Con una credencial registrada, exportar documentos y guardar
          cambios en Ajustes piden la huella o la cara (con una ventana corta de desbloqueo tras verificar);
          sin credencial registrada, todo sigue como siempre.
        </p>
        {!sbMode ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            El registro biométrico necesita la sesión de Supabase (el servidor emite y verifica los retos):
            en modo local no se puede registrar y no se finge ningún registro.
          </p>
        ) : !bioSupported ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Este navegador no soporta WebAuthn: la biometría no se puede usar en él y el acceso sigue siendo
            tu contraseña.
          </p>
        ) : (
          <>
            {bioPlatform === false ? (
              <p className="small muted">
                Este dispositivo no declara huella/cara integrada disponible: el registro puede no ofrecer
                autenticador de plataforma aquí.
              </p>
            ) : null}
            {bioUnavailable ? (
              <p className="small muted">
                La tabla de credenciales aún no responde en el servidor (se crea con el despliegue de esta
                pieza): en cuanto esté aplicada, aquí podrás registrar este dispositivo.
              </p>
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
                    <button type="button" className="btn" disabled={bioBusy} onClick={() => void doDeleteBio(c.credential_id)}>
                      Eliminar
                    </button>
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
          </>
        )}

        {/* Acceso rápido en este dispositivo (decisión del dueño,
            2026-10-26 14:33): desbloqueo de la sesión guardada con
            PIN o biometría. NO es el PIN-candado del original: es una
            puerta local de este dispositivo; la contraseña sigue
            siendo la vía principal y cerrar sesión lo apaga. */}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
          <h4 style={{ margin: '0 0 6px' }}>Acceso rápido en este dispositivo</h4>
          <p className="small muted">
            Tras entrar con tu contraseña, puedes activar aquí el desbloqueo rápido de tu sesión guardada
            EN ESTE DISPOSITIVO: con un PIN creado por ti o con tu huella o cara (la misma credencial de
            arriba). Al abrir la app se te pedirá ese desbloqueo; la contraseña sigue siendo la vía
            principal y manda si la sesión ya no es válida. Cerrar sesión apaga el acceso rápido hasta
            el próximo ingreso con contraseña. El PIN nunca se guarda en claro: queda un hash con sal en
            este dispositivo, con 5 intentos como máximo — al quinto fallo el PIN se desactiva solo.
          </p>
          {quick?.pinEnabled ? (
            <p className="small" role="status">
              PIN de acceso rápido: <strong>activado</strong> en este dispositivo.{' '}
              <button type="button" className="btn" disabled={pinBusy} onClick={() => { clearQuickPin(session.profileId); refreshQuick(); setPinMsg('PIN desactivado en este dispositivo.') }}>Desactivar PIN</button>
            </p>
          ) : (
            <p className="small muted">PIN de acceso rápido: sin activar en este dispositivo.</p>
          )}
          {pinStorageSupported() ? (
            <div className="mod-inline-form" style={{ marginTop: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="ajustes-pin-nuevo">{quick?.pinEnabled ? 'PIN nuevo (para cambiarlo)' : 'Crea tu PIN (4 a 6 dígitos)'}</label>
                <input id="ajustes-pin-nuevo" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} value={pin1} onChange={(e) => { setPin1(e.target.value.replace(/\D/g, '')); setPinMsg('') }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="ajustes-pin-repite">Repite el PIN</label>
                <input id="ajustes-pin-repite" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} value={pin2} onChange={(e) => { setPin2(e.target.value.replace(/\D/g, '')); setPinMsg('') }} />
              </div>
              <button type="button" className="btn primary" disabled={pinBusy || pin1.length < 4 || pin1 !== pin2} onClick={() => void doSetPin()}>
                {pinBusy ? 'Guardando…' : quick?.pinEnabled ? 'Cambiar PIN' : 'Activar PIN'}
              </button>
            </div>
          ) : (
            <p className="small muted">Este navegador no permite guardar el PIN con hash seguro en este contexto: el acceso rápido por PIN no se ofrece aquí.</p>
          )}
          {pinMsg ? <p className="small" role="status">{pinMsg}</p> : null}
          {sbMode ? (
            <p className="small" style={{ marginTop: 10 }}>
              Apertura con huella o cara en este dispositivo:{' '}
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
          ) : (
            <p className="small muted" style={{ marginTop: 10 }}>
              La apertura biométrica necesita la sesión de Supabase (el servidor verifica el reto): en modo local solo está el PIN.
            </p>
          )}
        </div>
      </Card>

      {isAdmin && onEnterAs ? (
        <Card>
          <h3>Entrar como otro usuario</h3>
          <p className="small muted">
            Capacidad solo del administrador (decisión del dueño, 2026-10-26): entras a la cuenta de Jesús,
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
                      <p className="small muted">Para usar «Entrar como» activa primero tu acceso rápido aquí arriba (tu PIN en este dispositivo{sbMode ? ' o tu huella' : ''}): la entrada a una cuenta ajena se autoriza siempre con tu PIN o tu biometría, nunca con la contraseña de la otra persona.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <h3>Ciclos de RH · Fecha ancla</h3>
        <p className="small muted">
          Los ciclos de nómina son exactos de 15 días contados desde el ancla; el pago cae el día 16 del ciclo.
          Ancla actual: <strong>{fmtDate(data.anchorDate)}</strong>. Cambiarla recalcula los ciclos solos; no mueve
          ninguna nómina ya pagada.
        </p>
        {isAdmin ? (
          <div className="mod-inline-form">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ajustes-ancla">Fecha ancla (AAAA-MM-DD)</label>
              <input id="ajustes-ancla" type="date" value={anchor} onChange={(e) => { setAnchor(e.target.value); setAnchorMsg('') }} />
            </div>
            <button type="button" className="btn primary" disabled={anchorBusy || anchor === data.anchorDate} onClick={() => void saveAnchor()}>
              {anchorBusy ? 'Guardando…' : 'Guardar ancla'}
            </button>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Solo el administrador puede cambiar el ancla.</p>
        )}
        {anchorMsg ? <p className="small" role="status" style={{ marginBottom: 0 }}>{anchorMsg}</p> : null}
      </Card>

      <Card>
        <h3>Informes por correo · Boletines</h3>
        <p className="small muted">
          Cada importación genera el boletín de la fecha de su IPV y queda pendiente de envío en la cola.
          Destinatarios del boletín (fijos del sistema, los mismos del original):
        </p>
        <div className="list">
          {BULLETIN_RECIPIENTS.map((r) => (
            <div className="row" key={r}><span>{r}</span><span className="chip">Boletín diario</span></div>
          ))}
        </div>
        <p className="small muted">
          Los documentos se exportan desde Documentos: cualquier perfil puede exportarlos (decisión
          del dueño, 2026-10-26), excepto el respaldo del sistema, que queda solo para el administrador.
        </p>
        <div className="mod-link-row">
          <button type="button" className="btn" onClick={() => onNavigate('historial')}>
            <Icon name="clock" size={15} /> Ver la cola en Historial
          </button>
          <button type="button" className="btn" onClick={() => onNavigate('documentos')}>
            <Icon name="doc" size={15} /> Documentos y respaldo
          </button>
          <button type="button" className="btn" onClick={() => onNavigate('sistema')}>
            <Icon name="sparkle" size={15} /> Importar en Sistema
          </button>
        </div>
      </Card>

      <Card>
        <h3>Datos de este dispositivo</h3>
        <p className="small muted">
          {fmtInt(data.days.length)} días importados en esta copia
          {data.importedAt ? ` · última importación ${fmtDate(data.importedAt.slice(0, 10))}` : ''}
          {data.exportedAt ? ` · respaldo de origen exportado el ${fmtDate(data.exportedAt.slice(0, 10))}` : ''}.
          Exportar el respaldo completo está en Documentos; importar un respaldo o un IPV, en Sistema.
        </p>
        {!sbMode ? (
          <>
            {resetMsg ? <div className="ok-box" role="status">{resetMsg}</div> : null}
            {!confirmReset ? (
              <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
                <Icon name="trash" size={15} /> Restablecer los datos locales
              </button>
            ) : (
              <div className="error-box" role="alert">
                <p style={{ marginTop: 0 }}>
                  <strong>¿Restablecer los datos locales de este dispositivo?</strong> Se vacían los días, las
                  cuentas y los abonos guardados en ESTE dispositivo. El sistema original y el servidor no se
                  tocan. Escribe BORRAR para confirmar.
                </p>
                <div className="mod-inline-form">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="ajustes-borrar">Confirmación</label>
                    <input id="ajustes-borrar" type="text" value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="BORRAR" />
                  </div>
                  <button type="button" className="btn" disabled={resetText.trim().toUpperCase() !== 'BORRAR'} onClick={doReset}>
                    Sí, restablecer
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
            Con Supabase los datos viven en el servidor, no en este dispositivo: no hay datos locales que
            restablecer aquí.
          </p>
        )}
      </Card>
    </section>
  )
}
