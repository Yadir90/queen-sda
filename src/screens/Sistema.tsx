import { useState } from 'react'
import type { Session, StoredData } from '../types'
import { Card } from '../components/ui'
import ImportBackup from '../components/ImportBackup'
import { listProfiles, resetLocalData, supabaseConfigured } from '../lib/backend'
import { fmtDate, fmtInt } from '../lib/utils'

export default function Sistema({ data, session, onChanged }: { data: StoredData; session: Session; onChanged: () => void }) {
  const isAdmin = session.role === 'admin'
  const sbMode = supabaseConfigured()
  const [confirmReset, setConfirmReset] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const profiles = sbMode
    ? [{ id: session.profileId, name: session.name, email: session.email, role: session.role }]
    : listProfiles()

  const doReset = () => {
    resetLocalData()
    setConfirmReset(false)
    setMessage('Datos locales restablecidos: días, cuentas y abonos de este dispositivo quedaron vacíos. El sistema original no se tocó.')
    onChanged()
  }

  return (
    <div>
      <h1 className="section-title">Sistema</h1>

      <Card>
        <p className="eyebrow">Salud y funcionamiento técnico</p>
        <h2>{sbMode ? 'Estado de la conexión con Supabase' : 'Estado de esta copia local'}</h2>
        <table className="kv">
          <tbody>
            <tr><td>Días importados</td><td>{fmtInt(data.days.length)}</td></tr>
            <tr><td>Cuentas cargadas</td><td>{fmtInt(data.receivables.length)}</td></tr>
            <tr><td>Abonos de Cobrar</td><td>{fmtInt(data.localPayments.length)}</td></tr>
            <tr><td>Último respaldo importado</td><td>{data.importedAt ? fmtDate(data.importedAt.slice(0, 10)) : 'Ninguno'}</td></tr>
            <tr><td>Respaldo exportado por el SDA</td><td>{data.exportedAt || '—'}</td></tr>
            <tr><td>Modo de datos</td><td>{sbMode ? 'Supabase (servidor, sincronizado)' : 'Local (este dispositivo)'}</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          {sbMode
            ? 'Los datos viven en Supabase y son los mismos en todos los dispositivos: la lectura exige una cuenta con rol y la escritura es solo del administrador (lo impone el servidor, no solo esta pantalla).'
            : 'Esta v1 trabaja local-primero: los datos viven en este dispositivo. La conexión con Supabase (cuenta gratuita del dueño) y el despliegue llegan en la siguiente fase; la pantalla no cambia.'}
        </p>
      </Card>

      {isAdmin ? <ImportBackup onImported={onChanged} /> : null}

      <Card>
        <h3>Perfiles de acceso</h3>
        <p className="sub">{sbMode
          ? 'Las cuentas viven en Supabase Auth con su rol en el servidor; aquí solo se muestra tu propia sesión (la lista completa la gestiona el administrador en el panel de Supabase).'
          : 'Acceso local de demostración estructural: replica los roles de la fase 1. La seguridad final será la de Supabase.'}</p>
        {profiles.map((p) => (
          <div className="list-row" key={p.id}>
            <span className="grow">{p.name}<span className="muted">{p.email}</span></span>
            <span className="chip">{p.role === 'admin' ? 'Administrador' : 'Solo lectura'}</span>
          </div>
        ))}
      </Card>

      {isAdmin && sbMode ? (
        <Card>
          <h3>Datos en el servidor</h3>
          <p className="sub">En modo Supabase no hay datos locales que restablecer: días, cuentas y abonos viven en el servidor. Importar un respaldo más fresco (arriba) actualiza el servidor sin duplicar; los abonos de Cobrar ya registrados no se tocan.</p>
        </Card>
      ) : null}

      {isAdmin && !sbMode ? (
        <Card>
          <h3>Datos locales</h3>
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
        </Card>
      ) : null}
    </div>
  )
}
