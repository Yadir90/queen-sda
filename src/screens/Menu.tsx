import { useMemo, useState } from 'react'
import { buildMenuData, menuHtml } from '../lib/documentosCore.mjs'
import { printHtml } from '../lib/download'
import { requireBiometricUnlock } from '../lib/webauthn'
import { exportNeedsBiometric } from '../lib/permissions'
import { logActivity } from '../lib/activityLog'
import type { Section, StoredData } from '../types'
import { fmtCUP, fmtDate } from '../lib/utils'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import '../components/sectionsMirror.css'

/**
 * Menú — pantalla propia (D-R5-03, 26-oct).
 *
 * Hasta esta oleada la entrada «Menú» de la rejilla «Más» abría
 * Documentos y el dueño lo reportó como defecto («Cuando abro Menú
 * me sale esto»): en el original Menú es su pestaña, con su
 * TabHeader («Menú del día desde Productos, editable y en PDF»,
 * insignia «Para clientes») y su editor «Menú del día».
 *
 * En esta copia el menú se DERIVA del catálogo de Productos con la
 * existencia y el precio vigentes (buildMenuData, el mismo núcleo
 * del PDF de Documentos): no hay selecciones guardadas por día como
 * en el servidor del original, así que la pantalla no finge botones
 * de «guardar» que no persistirían nada. Lo que se corrige en
 * Productos se refleja aquí al momento. La regla de cocina (nunca
 * camarón, langosta, res ni tortuga) excluye y reporta aparte.
 * El menú no lleva firma ni cuño (regla del dueño).
 */
export default function Menu({ data, today, isAdmin, onNavigate }: {
  data: StoredData
  today: string
  isAdmin: boolean
  onNavigate: (s: Section) => void
}) {
  const role = isAdmin ? 'admin' : 'lectura'
  const [date, setDate] = useState(today)
  const [msg, setMsg] = useState('')
  const menu = useMemo(() => buildMenuData(data, date), [data, date])

  const runExport = async (action: () => void, label = 'un documento') => {
    if (!exportNeedsBiometric(role)) {
      action()
      logActivity('exportacion', `Exportó ${label}`, { section: 'menu' })
      return
    }
    const unlock = await requireBiometricUnlock()
    if (!unlock.ok) {
      setMsg(`Exportación cancelada: ${unlock.reason ?? 'la verificación biométrica no se completó.'}`)
      logActivity('fallido', `Exportación de ${label} cancelada: la verificación biométrica no se completó`, { section: 'menu' })
      return
    }
    action()
  }

  const openMenu = () => {
    setMsg(printHtml(menuHtml(menu)) ? 'Menú: se abrió la vista del documento — desde ahí se imprime o se guarda como PDF.' : 'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
  }

  return (
    <section>
      <TabHeader
        icon="doc"
        title="Menú"
        desc="Menú del día desde Productos, editable y en PDF"
        badge={TAB_BADGES.menu}
      />
      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}

      <Card>
        <h2>Menú del día</h2>
        <p className="sub">
          Se genera solo desde Productos: lo que tiene existencia, a su precio de venta vigente.
          El menú no lleva firma ni cuño. La regla de cocina deja fuera camarón, langosta, res y tortuga.
        </p>
        <div className="field">
          <label htmlFor="menu-fecha">Fecha del menú</label>
          <input id="menu-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
        </div>
        <table className="kv"><tbody>
          <tr><td>Productos en el menú</td><td>{menu.itemCount}</td></tr>
          <tr><td>Fecha</td><td>{fmtDate(date)}</td></tr>
          <tr><td>Secciones</td><td>{menu.sections.map((s) => s.section).join(' · ') || '—'}</td></tr>
        </tbody></table>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn primary" disabled={!menu.itemCount} onClick={() => void runExport(openMenu, 'el menú (PDF)')}>Abrir menú (PDF)</button>
          <button className="btn" onClick={() => onNavigate('productos')}>Editar en Productos</button>
        </div>
      </Card>

      {menu.excluded.length ? (
        <div className="error-box" style={{ marginBottom: 14 }}>
          <strong>Excluidos por la regla de cocina</strong> (no salen en el menú):{' '}
          {menu.excluded.map((x) => `${x.name} (${x.rule})`).join(' · ')}
        </div>
      ) : null}

      {menu.itemCount === 0 ? (
        <Card>
          <p className="sub" style={{ margin: 0 }}>
            El menú está vacío: ningún producto tiene existencia y precio de venta vigentes.
            Revisa el catálogo en Productos.
          </p>
        </Card>
      ) : menu.sections.map((sec) => (
        <Card key={sec.section}>
          <h3 style={{ marginTop: 0 }}>{sec.section}</h3>
          {sec.families.map((fam) => (
            <div key={fam.family} style={{ marginBottom: 10 }}>
              {sec.families.length > 1 ? <p className="eyebrow" style={{ margin: '8px 0 4px' }}>{fam.family}</p> : null}
              {fam.items.map((item) => (
                <div className="list row" key={item.name}>
                  <span className="mod-row-main">
                    <span className="mod-row-title">{item.name}</span>
                    {item.description ? <span className="small muted">{item.description}</span> : null}
                  </span>
                  <strong>{fmtCUP(item.price)}</strong>
                </div>
              ))}
            </div>
          ))}
        </Card>
      ))}
    </section>
  )
}
