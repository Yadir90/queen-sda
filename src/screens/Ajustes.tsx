import { useState } from 'react'
import type { Section, Session, StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { listProfiles, resetLocalData, saveRhSettings, supabaseConfigured } from '../lib/backend'
import { sbSaveRhSettings } from '../lib/supabaseBackend'
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
   PIN numérico y la biometría del original — su segunda capa
   para exportar y cambiar ajustes — no existen en esta copia;
   los sustituye la capa de acceso (contraseña de la cuenta y,
   con Supabase, los roles del servidor). La edición del perfil
   (nombre visible, usuario y foto) también es del servidor del
   original: aquí el perfil se consulta, no se edita, y no se
   finge ningún guardado. */

export default function AjustesTab({ data, session, isAdmin, onChanged, onNavigate }: {
  data: StoredData
  session: Session
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
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

  const saveAnchor = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) { setAnchorMsg('Escribe la fecha ancla en formato AAAA-MM-DD.'); return }
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
        <p className="small muted" style={{ margin: 0 }}>
          En el sistema original, un PIN numérico actúa como segunda capa tras la contraseña (autoriza
          exportaciones, salvo boletines, y cambios en Ajustes) y el rostro o la huella autorizan la sesión y
          las emisiones según el dispositivo. <strong>Esta copia no tiene PIN ni biometría</strong>: los sustituye
          la capa de acceso — la contraseña de tu cuenta y, con Supabase, los roles del servidor —, que es la
          única diferencia de arquitectura admitida en esta copia. No se muestra ningún PIN configurado porque
          no existe ninguno que configurar aquí.
        </p>
      </Card>

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
          Los documentos exportados (nómina, informes, respaldos) se entregan solo al administrador, desde
          «Archivo listo», no por esta cola.
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
