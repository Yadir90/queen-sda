import { useMemo, useState, type FormEvent } from 'react'
import type { StoredData, VenueInventoryItem } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
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
   como en el original, y la lista agrupada por departamento.
   Foto desde la media por slug del nombre si la hubiera (en el dato
   cargado no viene ninguna: la ausencia se dibuja como ausencia).
   Alta/edición SOLO admin, persistiendo la clave completa
   'venue-inventory' en Supabase (o el StoredData local), como
   workers-extended. Diferencias honestas: sin importar Excel,
   sin PDF por correo y sin dar de baja/eliminar como acciones
   separadas del original — la baja se hace editando el estado a
   «Baja», como permite el propio formulario de edición. */

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

  const departments = useMemo(() => [...new Set(items.map((i) => i.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), [items])
  const statuses = useMemo(() => [...new Set(items.map((i) => i.currentStatus).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), [items])
  const filtered = useMemo(() => {
    const needle = norm(search.trim())
    return items.filter((item) => {
      const matchesText = !needle || norm([item.inventoryId, item.article, item.department, item.model, item.manufacturer, item.observations].join(' ')).includes(needle)
      return matchesText && (department === 'Todos' || item.department === department) && (status === 'Todos' || item.currentStatus === status)
    })
  }, [items, search, department, status])
  const grouped = useMemo(() => {
    const map = new Map<string, VenueInventoryItem[]>()
    for (const it of filtered) {
      const key = it.department || 'Sin departamento'
      const list = map.get(key) ?? []
      list.push(it)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { sensitivity: 'base' }))
  }, [filtered])
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
  })

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
      <p className="small muted" style={{ marginBottom: 14 }}>
        Este módulo es independiente de la contabilidad y de Almacén. «Despreciable» significa frágil, que se puede romper.
      </p>
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

      <Card>
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
        <p className="small muted">{fmtInt(filtered.length)} artículo{filtered.length === 1 ? '' : 's'} con estos filtros, agrupados por departamento.</p>
      </Card>

      {items.length === 0 ? (
        <EmptyState icon="archive" title="Inventario vacío" text="Importa el Excel actualizado o añade el primer artículo a mano." />
      ) : filtered.length === 0 ? (
        <Card><p className="muted">No hay artículos que coincidan con estos filtros.</p></Card>
      ) : grouped.map(([dept, list]) => (
        <Card key={dept}>
          <h3>{dept} <span className="small muted">· {fmtInt(list.reduce((s, i) => s + i.quantity, 0))} en {fmtInt(list.length)} registro{list.length === 1 ? '' : 's'}</span></h3>
          <div className="list">
            {list.map((item) => {
              const fragile = norm(item.classification) === 'despreciable'
              const isBaja = norm(item.currentStatus) === 'baja'
              if (editing?.id === item.id) {
                return (
                  <form key={item.id} className="row" style={{ display: 'block' }} onSubmit={submitEdit}>
                    <InventoryFields draft={editDraft} onChange={setEditDraft} prefix={`editar-${item.id}`} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
                      <button type="submit" className="btn primary" disabled={busy || !editDraft.inventoryId.trim() || !editDraft.article.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
                    </div>
                  </form>
                )
              }
              return (
                <div className="row" key={item.id}>
                  <MediaImage kind="foto-almacen" entityKey={slug(item.article)} alt="" className="media-thumb alm-photo" fallback={<span className="media-thumb alm-photo" aria-hidden style={{ display: 'grid', placeItems: 'center' }}><Icon name="archive" size={22} /></span>} />
                  <span style={{ minWidth: 0 }}>
                    <strong>{item.article}</strong>
                    <span className="small muted"> · {item.inventoryId}{item.department ? ` · ${item.department}` : ''}{item.acquisitionDate ? ` · ${fmtDate(item.acquisitionDate)}` : ''}</span>
                    <br />
                    <span className="small muted">
                      Cantidad <strong>{fmtInt(item.quantity)}</strong> · Coste unitario <strong>{item.unitCost == null ? '—' : fmtCUP(item.unitCost)}</strong> · Valor <strong>{item.unitCost == null ? '—' : fmtCUP(item.unitCost * item.quantity)}</strong> · Clasificación <strong>{fragile ? 'Frágil · Despreciable' : item.classification || '—'}</strong>
                    </span>
                    {(item.model || item.manufacturer || item.observations) ? (
                      <><br /><span className="small muted">{[item.model && `Modelo: ${item.model}`, item.manufacturer && `Fabricante: ${item.manufacturer}`, item.observations].filter(Boolean).join(' · ')}</span></>
                    ) : null}
                  </span>
                  <span className={`chip ${isBaja ? 'warn' : 'ok'}`}>{item.currentStatus || '—'}</span>
                  {isAdmin ? (
                    <button type="button" className="btn" onClick={() => { setEditing(item); setEditDraft(draftFrom(item)) }}>
                      <Icon name="edit" size={14} /> Editar
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Card>
      ))}
      <p className="small muted">
        Foto del bien: se busca en la media del sistema por el nombre del artículo; el dato cargado no trae fotos de
        bienes, así que la ausencia se muestra como ausencia. Sin importación desde Excel ni PDF por correo en esta
        copia (diferencias declaradas en IGUALACION.md).
      </p>
    </div>
  )
}
