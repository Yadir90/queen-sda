import { useMemo, useState, type FormEvent } from 'react'
import type { StoredData, VenueInventoryItem } from '../types'
import { ActionMenu, Card, EmptyState, InfoHelp, TabHeader, TAB_BADGES, ViewModeToggle, useCatalogLayout } from '../components/ui'
import { Icon } from '../components/icons'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { MediaImage } from '../components/MediaImage'
import { slug } from '../lib/media'
import { saveVenueInventory, supabaseConfigured } from '../lib/backend'
import { sbSaveVenueInventory } from '../lib/supabaseBackend'
import { nextInventoryId, nextNumericId } from '../lib/modulosExtended'
import '../components/sectionsMirror.css'

const SB_MODE = supabaseConfigured()

/* Inventario de bienes del local (oleada 2): destino propio con los
   219 bienes REALES cargados de app_settings 'venue-inventory'
   (venue_inventory_items del original, InventarioTab de su
   App.tsx). Campos del original: ID Inventario, fecha de
   adquisición, artículo, coste por artículo, cantidad,
   departamento, estado, clasificación, modelo, fabricante y
   observaciones — los que el dato no trae se muestran vacíos («—»),
   nunca inventados. Buscador y filtros por departamento y estado
   como en el original; la lista es PLANA (sin agrupar), con el
   alternador cuadrícula/lista del original (useCatalogLayout,
   «sda-layout-inventario», por defecto cuadrícula) y tarjetas
   .catalog-card con cabecera, rejilla de datos 2×2 (4 en lista
   ancha) y ActionMenu (Editar / Dar de baja con motivo opcional /
   Eliminar, con sus diálogos de confirmación) — puerto de la
   tarjeta del original; su CSS comenta que así «el flex no reduce
   el texto hasta mostrar una letra por línea» (defecto que el
   dueño fotografió el 26-oct en la fila anterior).
   Foto desde la media por slug del nombre si la hubiera (en el dato
   cargado no viene ninguna: la ausencia se dibuja como el recuadro
   tonal del original). Alta/edición SOLO admin, persistiendo la
   clave completa 'venue-inventory' en Supabase (o el StoredData
   local), como workers-extended. Diferencias honestas: sin
   importar Excel, sin PDF por correo y sin acciones de foto del
   menú (tomar/subir/quitar): la foto de bienes no viaja en el dato. */

interface Draft {
  inventoryId: string
  acquisitionDate: string
  article: string
  unitCost: string
  quantity: string
  department: string
  currentStatus: string
  classification: string
  model: string
  manufacturer: string
  observations: string
}

const emptyDraft = (): Draft => ({
  inventoryId: '', acquisitionDate: '', article: '', unitCost: '', quantity: '1',
  department: '', currentStatus: 'Activo', classification: '', model: '', manufacturer: '', observations: '',
})
const draftFrom = (it: VenueInventoryItem): Draft => ({
  inventoryId: it.inventoryId, acquisitionDate: it.acquisitionDate ?? '', article: it.article,
  unitCost: it.unitCost == null ? '' : String(it.unitCost), quantity: String(it.quantity),
  department: it.department, currentStatus: it.currentStatus || 'Activo', classification: it.classification,
  model: it.model, manufacturer: it.manufacturer, observations: it.observations,
})
const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es')

function InventoryFields({ draft, onChange, prefix, idReadOnly }: { draft: Draft; onChange: (d: Draft) => void; prefix: string; idReadOnly?: boolean }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  return (
    <div>
      <div className="field"><label htmlFor={`${prefix}-inv-id`}>ID Inventario</label>
        <input id={`${prefix}-inv-id`} aria-label="ID Inventario asignado por el sistema" value={draft.inventoryId} readOnly={idReadOnly ?? true} placeholder="Se asigna al guardar" onChange={(e) => set('inventoryId', e.target.value)} /></div>
      <div className="field"><label htmlFor={`${prefix}-fecha`}>Fecha de adquisición</label>
        <input id={`${prefix}-fecha`} aria-label="Fecha de adquisición" type="date" value={draft.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)} /></div>
      <div className="field"><label htmlFor={`${prefix}-art`}>Artículo</label>
        <input id={`${prefix}-art`} aria-label="Artículo" value={draft.article} onChange={(e) => set('article', e.target.value)} required maxLength={200} /></div>
      <div className="field"><label htmlFor={`${prefix}-qty`}>Cantidad</label>
        <input id={`${prefix}-qty`} aria-label="Cantidad disponible" type="number" min="0" step="any" value={draft.quantity} onChange={(e) => set('quantity', e.target.value)} required /></div>
      <div className="field"><label htmlFor={`${prefix}-cost`}>Coste por artículo</label>
        <input id={`${prefix}-cost`} aria-label="Coste por artículo opcional" type="number" min="0" step="any" value={draft.unitCost} onChange={(e) => set('unitCost', e.target.value)} placeholder="Sin coste" /></div>
      <div className="field"><label htmlFor={`${prefix}-dept`}>Departamento</label>
        <input id={`${prefix}-dept`} aria-label="Departamento" value={draft.department} onChange={(e) => set('department', e.target.value)} maxLength={120} /></div>
      <div className="field"><label htmlFor={`${prefix}-status`}>Estado</label>
        <select id={`${prefix}-status`} aria-label="Estado actual" value={draft.currentStatus} onChange={(e) => set('currentStatus', e.target.value)}>
          <option>Activo</option><option>En reparación</option><option>En mal estado</option><option>Baja</option>
        </select></div>
      <div className="field"><label htmlFor={`${prefix}-clas`}>Clasificación</label>
        <select id={`${prefix}-clas`} aria-label="Clasificación" value={draft.classification} onChange={(e) => set('classification', e.target.value)}>
          <option value="">Sin clasificar</option><option value="Despreciable">Despreciable (frágil)</option><option value="No despreciable">No despreciable</option>
        </select></div>
      <div className="field"><label htmlFor={`${prefix}-mod`}>Modelo</label>
        <input id={`${prefix}-mod`} aria-label="Modelo" value={draft.model} onChange={(e) => set('model', e.target.value)} maxLength={160} /></div>
      <div className="field"><label htmlFor={`${prefix}-fab`}>Fabricante</label>
        <input id={`${prefix}-fab`} aria-label="Fabricante" value={draft.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} maxLength={160} /></div>
      <div className="field"><label htmlFor={`${prefix}-obs`}>Observaciones</label>
        <input id={`${prefix}-obs`} aria-label="Observaciones" value={draft.observations} onChange={(e) => set('observations', e.target.value)} maxLength={500} /></div>
      <p className="small muted">El coste es opcional. Si queda vacío, se muestra «—» y no entra en el valor total.</p>
    </div>
  )
}

export default function Inventario({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const items = data.venueInventory
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('Todos')
  const [status, setStatus] = useState('Todos')
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editing, setEditing] = useState<VenueInventoryItem | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft())
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [layout, toggleLayout] = useCatalogLayout('sda-layout-inventario', 'grid')
  const [confirmLow, setConfirmLow] = useState<VenueInventoryItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VenueInventoryItem | null>(null)
  const [lowReason, setLowReason] = useState('')

  const departments = useMemo(() => [...new Set(items.map((i) => i.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), [items])
  const statuses = useMemo(() => [...new Set(items.map((i) => i.currentStatus).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), [items])
  const filtered = useMemo(() => {
    const needle = norm(search.trim())
    return items.filter((item) => {
      const matchesText = !needle || norm([item.inventoryId, item.article, item.department, item.model, item.manufacturer, item.observations].join(' ')).includes(needle)
      return matchesText && (department === 'Todos' || item.department === department) && (status === 'Todos' || item.currentStatus === status)
    })
  }, [items, search, department, status])
  const activeItems = items.filter((i) => norm(i.currentStatus) !== 'baja')
  const totalQuantity = activeItems.reduce((s, i) => s + i.quantity, 0)
  const knownValue = activeItems.reduce((s, i) => s + (i.unitCost == null ? 0 : i.unitCost * i.quantity), 0)
  const withoutCost = activeItems.filter((i) => i.unitCost == null).length

  const persist = async (next: VenueInventoryItem[], okMsg: string) => {
    setBusy(true); setError(''); setMsg('')
    try {
      if (SB_MODE) await sbSaveVenueInventory(next)
      else saveVenueInventory(next)
      setMsg(okMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el inventario.')
    } finally { setBusy(false) }
  }

  const toItem = (d: Draft, base: VenueInventoryItem | null): VenueInventoryItem => ({
    id: base ? base.id : nextNumericId(items.map((i) => i.id)),
    inventoryId: base ? base.inventoryId : (d.inventoryId.trim() || nextInventoryId(items)),
    acquisitionDate: d.acquisitionDate ? d.acquisitionDate : null,
    article: d.article.trim(),
    unitCost: d.unitCost === '' ? null : Math.max(0, Number(d.unitCost) || 0),
    quantity: Math.max(0, Number(d.quantity) || 0),
    department: d.department.trim(),
    currentStatus: d.currentStatus,
    classification: d.classification,
    model: d.model.trim(),
    manufacturer: d.manufacturer.trim(),
    observations: d.observations.trim(),
    source: base ? base.source : 'manual',
    lowReason: base?.lowReason,
  })

  const applyLow = () => {
    if (!confirmLow) return
    const target = confirmLow
    const reason = lowReason.trim()
    setConfirmLow(null); setLowReason('')
    void persist(items.map((i) => (i.id === target.id ? { ...i, currentStatus: 'Baja', lowReason: reason || i.lowReason } : i)), `«${target.article}» dado de baja.`)
  }
  const applyDelete = () => {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    void persist(items.filter((i) => i.id !== target.id), `«${target.article}» eliminado del inventario.`)
  }

  const submitAdd = (ev: FormEvent) => {
    ev.preventDefault()
    const item = toItem(draft, null)
    setShowAdd(false); setDraft(emptyDraft())
    void persist([...items, item], `Artículo añadido con el ID ${item.inventoryId}.`)
  }
  const submitEdit = (ev: FormEvent) => {
    ev.preventDefault()
    if (!editing) return
    const updated = toItem(editDraft, editing)
    setEditing(null)
    void persist(items.map((i) => (i.id === editing.id ? updated : i)), 'Artículo actualizado.')
  }

  return (
    <div>
      <TabHeader icon="archive" title="Inventario" desc="Registro independiente de los bienes del local" badge={TAB_BADGES.inventario} />
      <div style={{ marginBottom: 14 }}>
        <InfoHelp label="Cómo funciona Inventario">
          Este módulo es independiente de la contabilidad y de Almacén. Al importar de nuevo, el ID Inventario decide qué artículo se actualiza: los IDs que siguen se conservan y actualizan, los nuevos se añaden y los que ya no aparecen se eliminan. «Despreciable» significa frágil, que se puede romper.
        </InfoHelp>
      </div>
      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}
      {error ? <div className="error-box" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="stats">
        <div className="stat"><span className="label">Registros</span><span className="value">{fmtInt(items.length)}</span></div>
        <div className="stat"><span className="label">Cantidad activa</span><span className="value">{fmtInt(totalQuantity)}</span></div>
        <div className="stat"><span className="label">Valor conocido</span><span className="value">{fmtCUP(knownValue)}</span></div>
      </div>
      <p className="small muted" style={{ marginBottom: 14 }}>Suma solo los artículos con coste · {fmtInt(withoutCost)} sin coste</p>

      {isAdmin ? (
        <div style={{ marginBottom: 14 }}>
          <button type="button" className="btn primary" onClick={() => { setShowAdd((v) => !v); setMsg('') }}>
            <Icon name="plus" size={17} /> Añadir artículo
          </button>
        </div>
      ) : (
        <Card><p className="muted">Solo el administrador puede añadir o editar bienes. Tú ves el registro completo.</p></Card>
      )}
      {showAdd && isAdmin ? (
        <Card>
          <form id="alta-inventario" onSubmit={submitAdd}>
            <h3>Alta manual</h3>
            <p className="small muted">El sistema asignará automáticamente el siguiente ID consecutivo.</p>
            <InventoryFields draft={draft} onChange={setDraft} prefix="alta" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={busy || !draft.article.trim()}>{busy ? 'Guardando…' : 'Guardar alta'}</button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="inv-filters">
        <div className="field"><label htmlFor="inv-search">Buscar</label>
          <input id="inv-search" aria-label="Buscar en Inventario" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, artículo, modelo…" /></div>
        <div className="field"><label htmlFor="inv-dept">Departamento</label>
          <select id="inv-dept" aria-label="Filtrar por departamento" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option>Todos</option>{departments.map((d) => <option key={d}>{d}</option>)}
          </select></div>
        <div className="field"><label htmlFor="inv-status">Estado</label>
          <select id="inv-status" aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>Todos</option>{statuses.map((s) => <option key={s}>{s}</option>)}
          </select></div>
      </div>
      <div className="inv-toggle-row">
        <ViewModeToggle layout={layout} onToggle={toggleLayout} label="Inventario" />
      </div>

      {items.length === 0 ? (
        <EmptyState icon="archive" title="Inventario vacío" text="Importa el Excel actualizado o añade el primer artículo a mano." />
      ) : filtered.length === 0 ? (
        <Card><p className="muted">No hay artículos que coincidan con estos filtros.</p></Card>
      ) : (
        <ul className={layout === 'grid' ? 'catalog-layout-grid' : 'catalog-layout-list'} aria-label={`Artículos del Inventario en ${layout === 'grid' ? 'cuadrícula' : 'lista'}`}>
          {filtered.map((item) => {
            const fragile = norm(item.classification) === 'despreciable'
            const isBaja = norm(item.currentStatus) === 'baja'
            return (
              <li key={item.id} className="catalog-card">
                {editing?.id === item.id ? (
                  <form onSubmit={submitEdit}>
                    <InventoryFields draft={editDraft} onChange={setEditDraft} prefix={`editar-${item.id}`} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
                      <button type="submit" className="btn primary" disabled={busy || !editDraft.inventoryId.trim() || !editDraft.article.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className={layout === 'grid' ? 'inventory-card-grid-head' : 'inventory-card-list-head'}>
                      <div className="inventory-card-main">
                        <MediaImage kind="foto-almacen" entityKey={slug(item.article)} alt={`Foto de ${item.article}`} className="inventory-card-photo" fallback={<span className="inventory-card-photo-fallback" aria-hidden><Icon name="archive" size={24} /></span>} />
                        <div className="inventory-card-copy">
                          <p className="inventory-card-name">{item.article}</p>
                          <p className="inventory-card-meta">{item.inventoryId}{item.department ? ` · ${item.department}` : ''}{item.acquisitionDate ? ` · ${fmtDate(item.acquisitionDate)}` : ''}</p>
                        </div>
                      </div>
                      <span className={`inventory-card-status${isBaja ? ' is-baja' : ''}`}>{item.currentStatus || '—'}</span>
                    </div>
                    <div className={`inventory-card-stats ${layout === 'grid' ? 'inventory-card-grid-stats' : 'inventory-card-list-stats'}`}>
                      <div><span className="stat-label">Cantidad</span><strong>{fmtInt(item.quantity)}</strong></div>
                      <div><span className="stat-label">Coste unitario</span><strong>{item.unitCost == null ? '—' : fmtCUP(item.unitCost)}</strong></div>
                      <div><span className="stat-label">Valor</span><strong>{item.unitCost == null ? '—' : fmtCUP(item.unitCost * item.quantity)}</strong></div>
                      <div><span className="stat-label">Clasificación</span><strong>{fragile ? 'Frágil · Despreciable' : item.classification || '—'}</strong></div>
                    </div>
                    {(item.model || item.manufacturer || item.observations) ? (
                      <p className="inventory-card-notes">{[item.model && `Modelo: ${item.model}`, item.manufacturer && `Fabricante: ${item.manufacturer}`, item.observations].filter(Boolean).join(' · ')}</p>
                    ) : null}
                    {isAdmin ? (
                      <div className="inventory-card-actions">
                        <ActionMenu label={`Acciones de ${item.article}`}>
                          <button type="button" onClick={() => { setEditing(item); setEditDraft(draftFrom(item)); setConfirmDelete(null); setConfirmLow(null) }}>
                            <Icon name="edit" size={14} /> Editar
                          </button>
                          {!isBaja ? (
                            <button type="button" onClick={() => { setConfirmLow(item); setConfirmDelete(null); setLowReason('') }}>Dar de baja</button>
                          ) : null}
                          <button type="button" className="danger" onClick={() => { setConfirmDelete(item); setConfirmLow(null) }}>
                            <Icon name="trash" size={14} /> Eliminar
                          </button>
                        </ActionMenu>
                      </div>
                    ) : null}
                    {confirmLow?.id === item.id ? (
                      <div className="inventory-confirm" role="alertdialog" aria-label={`Dar de baja ${item.article}`}>
                        <p className="confirm-title">Dar de baja este artículo</p>
                        <input aria-label="Motivo de la baja opcional" value={lowReason} onChange={(e) => setLowReason(e.target.value)} placeholder="Motivo (opcional)" />
                        <div className="inventory-confirm-actions">
                          <button type="button" className="btn" onClick={() => setConfirmLow(null)}>Cancelar</button>
                          <button type="button" className="btn btn-gold" disabled={busy} onClick={applyLow}>Confirmar baja</button>
                        </div>
                      </div>
                    ) : null}
                    {confirmDelete?.id === item.id ? (
                      <div className="inventory-confirm is-danger" role="alertdialog" aria-label={`Eliminar ${item.article}`}>
                        <p><strong>¿Eliminar {item.article}?</strong> Se quitará por completo del inventario.</p>
                        <div className="inventory-confirm-actions">
                          <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                          <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={applyDelete}>Sí, eliminar</button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
