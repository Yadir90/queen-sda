import { useMemo, useState, type FormEvent } from 'react'
import type { StoredData, WarehouseEntry } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { buildProductsCatalog, buildWarehouse } from '../lib/productosCore.mjs'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { MediaImage } from '../components/MediaImage'
import { slug } from '../lib/media'
import { saveWarehouseExtended, supabaseConfigured } from '../lib/backend'
import { sbSaveWarehouseExtended } from '../lib/supabaseBackend'
import { buildWarehouseBalances, nextNumericId, warehouseProductKey } from '../lib/modulosExtended'
import '../components/sectionsMirror.css'

const SB_MODE = supabaseConfigured()

/* Almacén del clon (oleada 2): la vista PRINCIPAL ya es el módulo
   MANUAL del original (AlmacenTab de su App.tsx, con los movimientos
   de listWarehouseEntries): entradas y rebajas con producto,
   cantidad, fecha y motivo («Para qué se cogió»), existencias
   calculadas por producto desde los movimientos y metadatos de
   producto (warehouse_product_meta_v1: código de barras, marca,
   categoría, descripción, fuente de imagen) cargados de
   app_settings 'almacen-extended'. La foto por producto llega por
   la media autenticada ('foto-almacen', por slug del nombre).
   Alta/edición/baja SOLO admin, persistiendo la clave completa
   'almacen-extended' en Supabase (o el StoredData local), igual que
   workers-extended. La foto del IPV (hoja «Almacén») queda como
   sección secundaria declarada al final, sin perderse.
   Diferencias honestas que se mantienen: sin escáner de códigos de
   barras con cámara ni búsqueda en internet del producto (los
   códigos reales sí se muestran desde los metadatos), y las rebajas
   manuales no crean gasto automáticamente (esa sincronización vive
   en el servidor del original; la vista calculada Salidas → Gastos
   de la foto del IPV se conserva en la sección secundaria). */

const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)

export default function Almacen({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const entries = data.warehouseEntries
  const balances = useMemo(() => buildWarehouseBalances(entries, data.warehouseMeta), [entries, data.warehouseMeta])
  const available = balances.filter((b) => b.quantity > 0)
  const productNames = useMemo(() => [...new Set(entries.map((e) => e.product))].sort((a, b) => a.localeCompare(b, 'es')), [entries])

  const [mode, setMode] = useState<'entrada' | 'rebaja'>('entrada')
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [purpose, setPurpose] = useState('')
  const [editing, setEditing] = useState<WarehouseEntry | null>(null)
  const [editProduct, setEditProduct] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editPurpose, setEditPurpose] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<WarehouseEntry | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const qtyNum = Number(quantity)
  const editQtyNum = Number(editQuantity)
  const selectedAvailable = available.find((b) => b.product === product)?.quantity ?? 0

  const persist = async (next: WarehouseEntry[], okMsg: string) => {
    setBusy(true); setError(''); setMsg('')
    try {
      if (SB_MODE) await sbSaveWarehouseExtended(next, data.warehouseMeta)
      else saveWarehouseExtended({ entries: next })
      setMsg(okMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el movimiento.')
    } finally { setBusy(false) }
  }

  const submitNew = (ev: FormEvent) => {
    ev.preventDefault()
    const entry: WarehouseEntry = {
      id: nextNumericId(entries.map((e) => e.id)),
      date, product: product.trim(), quantity: qtyNum,
      note: mode === 'entrada' ? note.trim() : '',
      kind: mode,
      purpose: mode === 'rebaja' ? purpose.trim() : '',
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    void persist([...entries, entry], mode === 'entrada'
      ? `Entrada registrada: ${entry.product} · ${fmtQty(entry.quantity)}.`
      : `Rebaja registrada: ${entry.product} · ${fmtQty(entry.quantity)} para «${entry.purpose}».`)
      .then(() => { setProduct(''); setQuantity(''); setNote(''); setPurpose('') })
  }

  const submitEdit = (ev: FormEvent) => {
    ev.preventDefault()
    if (!editing) return
    const next = entries.map((e) => (e.id === editing.id ? {
      ...e,
      product: editProduct.trim(), quantity: editQtyNum, date: editDate,
      note: editing.kind === 'entrada' ? editNote.trim() : e.note,
      purpose: editing.kind === 'rebaja' ? editPurpose.trim() : e.purpose,
      updatedAt: Date.now(),
    } : e))
    setEditing(null)
    void persist(next, `Movimiento actualizado: ${editProduct.trim()} · ${fmtQty(editQtyNum)}.`)
  }

  const doDelete = (entry: WarehouseEntry) => {
    setConfirmDelete(null)
    void persist(entries.filter((e) => e.id !== entry.id), `Movimiento eliminado: ${entry.product} · ${fmtQty(entry.quantity)} (${fmtDate(entry.date)}).`)
  }

  // Orden del registro como en el original: por fecha y creación.
  const ordered = useMemo(() => [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0)), [entries])

  return (
    <div>
      <TabHeader icon="package" title="Almacén" desc="Control manual de existencias del almacén" badge={TAB_BADGES.almacen} />
      {msg ? <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div> : null}
      {error ? <div className="error-box" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="stats">
        <div className="stat"><span className="label">Movimientos registrados</span><span className="value">{fmtInt(entries.length)}</span></div>
        <div className="stat"><span className="label">Productos con existencias</span><span className="value">{fmtInt(available.length)}</span></div>
        <div className="stat"><span className="label">Entradas</span><span className="value">{fmtInt(entries.filter((e) => e.kind === 'entrada').length)}</span></div>
        <div className="stat"><span className="label">Rebajas</span><span className="value">{fmtInt(entries.filter((e) => e.kind === 'rebaja').length)}</span></div>
      </div>

      {isAdmin ? (
        <Card>
          <div role="tablist" aria-label="Tipo de movimiento de almacén" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button type="button" role="tab" aria-selected={mode === 'entrada'} className={`btn ${mode === 'entrada' ? 'primary' : ''}`} onClick={() => setMode('entrada')}>Entrada</button>
            <button type="button" role="tab" aria-selected={mode === 'rebaja'} className={`btn ${mode === 'rebaja' ? 'primary' : ''}`} onClick={() => setMode('rebaja')}>Rebajar producto</button>
          </div>
          {mode === 'entrada' ? (
            <form onSubmit={submitNew}>
              <h3>Entrada manual</h3>
              <div className="field"><label htmlFor="alm-product">Producto</label>
                <input id="alm-product" aria-label="Producto de almacén" list="alm-productos" value={product} onChange={(e) => setProduct(e.target.value)} required maxLength={200} /></div>
              <div className="field"><label htmlFor="alm-qty">Cantidad</label>
                <input id="alm-qty" aria-label="Cantidad que entra al almacén" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div>
              <div className="field"><label htmlFor="alm-date">Fecha</label>
                <input id="alm-date" aria-label="Fecha de entrada al almacén" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
              <div className="field"><label htmlFor="alm-note">Nota <span className="muted">(opcional)</span></label>
                <input id="alm-note" aria-label="Nota de la entrada de almacén" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
              <button type="submit" className="btn primary" disabled={busy || !product.trim() || !(qtyNum > 0) || !date}>{busy ? 'Guardando…' : 'Registrar entrada'}</button>
            </form>
          ) : available.length === 0 ? (
            <p className="muted">Primero registra una entrada para poder rebajar un producto.</p>
          ) : (
            <form onSubmit={submitNew}>
              <h3>Rebaja manual</h3>
              <div className="field"><label htmlFor="alm-wproduct">Producto</label>
                <select id="alm-wproduct" aria-label="Producto que se rebaja del almacén" value={product} onChange={(e) => setProduct(e.target.value)} required>
                  <option value="">Selecciona un producto</option>
                  {available.map((b) => <option key={b.key} value={b.product}>{b.product} (quedan {fmtQty(b.quantity)})</option>)}
                </select></div>
              <div className="field"><label htmlFor="alm-wqty">Cantidad</label>
                <input id="alm-wqty" aria-label="Cantidad que se rebaja del almacén" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div>
              <div className="field"><label htmlFor="alm-wdate">Fecha</label>
                <input id="alm-wdate" aria-label="Fecha de la rebaja" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
              <div className="field"><label htmlFor="alm-purpose">Para qué se cogió</label>
                <input id="alm-purpose" aria-label="Para qué se cogió el producto" value={purpose} onChange={(e) => setPurpose(e.target.value)} required maxLength={300} /></div>
              <p className="small muted">Si el producto tiene precio de costo, esta salida pasa automáticamente a «Gastos» por cantidad × precio de costo en el sistema principal. En esta copia la rebaja queda registrada y las existencias se recalculan; no se crea un gasto duplicado (ver la sección secundaria de la foto del IPV).</p>
              <button type="submit" className="btn primary" disabled={busy || !product || !(qtyNum > 0) || qtyNum > selectedAvailable || !purpose.trim() || !date}>{busy ? 'Guardando…' : 'Registrar rebaja'}</button>
            </form>
          )}
          <datalist id="alm-productos">{productNames.map((n) => <option key={n} value={n} />)}</datalist>
        </Card>
      ) : (
        <Card><p className="muted">Solo el administrador puede registrar, editar o eliminar movimientos del almacén. Tú ves las existencias y el registro completos.</p></Card>
      )}

      <Card>
        <h3>Existencias disponibles</h3>
        {balances.length === 0 ? (
          <p className="muted">Todavía no hay productos registrados.</p>
        ) : (
          <div className="list">
            {balances.map((b) => (
              <div className="row" key={b.key}>
                <MediaImage kind="foto-almacen" entityKey={slug(b.product)} alt="" className="media-thumb alm-photo" />
                <span>
                  <strong>{b.product}</strong>
                  <span className="small muted"> · entradas {fmtQty(b.entradas)} · rebajas {fmtQty(b.rebajas)}</span>
                  {b.meta?.barcode ? <span className="small muted"> · código de barras {b.meta.barcode}</span> : null}
                  {b.meta?.brand ? <span className="small muted"> · {b.meta.brand}</span> : null}
                  {b.meta?.category ? <span className="small muted"> · {b.meta.category}</span> : null}
                  {b.meta?.description ? <><br /><span className="small muted">{b.meta.description}</span></> : null}
                  {b.meta?.sourceUrl ? <><br /><a className="small" href={b.meta.sourceUrl} target="_blank" rel="noreferrer">Fuente de imagen</a></> : null}
                </span>
                <span className="mono">{fmtQty(b.quantity)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Existencias calculadas desde los {fmtInt(entries.length)} movimientos manuales reales. Los metadatos de producto
          (código de barras, marca, categoría, descripción y fuente) vienen de «warehouse_product_meta_v1» del sistema
          principal. El escáner de códigos de barras con cámara y la búsqueda en internet del original no están
          portados a esta copia: no se fingen.
        </p>
      </Card>

      <Card>
        <h3>Registro de movimientos</h3>
        {ordered.length === 0 ? (
          <EmptyState icon="package" title="Sin movimientos registrados" text="Cuando se registre la primera entrada o rebaja manual, aparecerá aquí con su fecha y su motivo." />
        ) : (
          <div className="list">
            {ordered.map((entry) => {
              const isWithdrawal = entry.kind === 'rebaja'
              const isEditing = editing?.id === entry.id
              if (isEditing) {
                return (
                  <form key={entry.id} className="row" onSubmit={submitEdit} style={{ display: 'block' }}>
                    <div className="field"><label>Producto</label>
                      <input aria-label={`Producto del movimiento ${entry.id}`} value={editProduct} onChange={(e) => setEditProduct(e.target.value)} required maxLength={200} /></div>
                    <div className="field"><label>Cantidad</label>
                      <input aria-label={`Cantidad del movimiento ${entry.id}`} type="number" min="0" step="any" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} required /></div>
                    <div className="field"><label>Fecha</label>
                      <input aria-label={`Fecha del movimiento ${entry.id}`} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} required /></div>
                    <div className="field"><label>{isWithdrawal ? 'Para qué se cogió' : <>Nota <span className="muted">(opcional)</span></>}</label>
                      <input aria-label={isWithdrawal ? `Para qué se cogió en la rebaja ${entry.id}` : `Nota de la entrada ${entry.id}`}
                        value={isWithdrawal ? editPurpose : editNote}
                        onChange={(e) => (isWithdrawal ? setEditPurpose(e.target.value) : setEditNote(e.target.value))}
                        maxLength={300} required={isWithdrawal} /></div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancelar</button>
                      <button type="submit" className="btn primary" disabled={busy || !editProduct.trim() || !(editQtyNum > 0) || !editDate || (isWithdrawal && !editPurpose.trim())}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
                    </div>
                  </form>
                )
              }
              return (
                <div className="row" key={entry.id}>
                  <MediaImage kind="foto-almacen" entityKey={slug(entry.product)} alt="" className="media-thumb alm-photo" />
                  <span>
                    <strong>{entry.product}</strong>
                    <span className={`chip ${isWithdrawal ? 'warn' : 'ok'}`} style={{ marginLeft: 6 }}>{isWithdrawal ? 'Rebaja' : 'Entrada'}</span>
                    <br />
                    <span className="small muted">
                      {fmtDate(entry.date)}
                      {isWithdrawal && entry.purpose ? ` · Para qué se cogió: ${entry.purpose}` : ''}
                      {!isWithdrawal && entry.note ? ` · ${entry.note}` : ''}
                      {data.warehouseMeta[warehouseProductKey(entry.product)]?.barcode ? ` · código ${data.warehouseMeta[warehouseProductKey(entry.product)]!.barcode}` : ''}
                    </span>
                  </span>
                  <span className="mono">{isWithdrawal ? '−' : '+'}{fmtQty(entry.quantity)}</span>
                  {isAdmin ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn" onClick={() => { setEditing(entry); setEditProduct(entry.product); setEditQuantity(String(entry.quantity)); setEditDate(entry.date); setEditNote(entry.note); setEditPurpose(entry.purpose); setConfirmDelete(null) }}>
                        <Icon name="edit" size={14} /> Editar
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmDelete(entry)}>
                        <Icon name="trash" size={14} /> Eliminar
                      </button>
                    </span>
                  ) : null}
                  {confirmDelete?.id === entry.id ? (
                    <span role="alertdialog" aria-label={`Eliminar movimiento de ${entry.product}`} style={{ flexBasis: '100%' }}>
                      <span className="small"><strong>¿Eliminar este movimiento?</strong> Las existencias de {entry.product} se recalculan sin él.</span>{' '}
                      <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>{' '}
                      <button type="button" className="btn primary" onClick={() => doDelete(entry)} disabled={busy}>Sí, eliminar</button>
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <IpvWarehouseSection data={data} />
    </div>
  )
}

/** Sección secundaria declarada: la foto de almacén del IPV (hoja
 *  «Almacén» de cada día), tal como entró. Era la vista principal
 *  antes de la oleada 2; no se pierde, pero ya no sustituye al
 *  almacén manual del original. */
function IpvWarehouseSection({ data }: { data: StoredData }) {
  const catalog = useMemo(() => buildProductsCatalog(data.days), [data.days])
  const wh = useMemo(() => buildWarehouse(data.days, catalog), [data.days, catalog])
  if (wh.rows.length === 0) {
    return (
      <Card>
        <h3>Foto del IPV (sección secundaria)</h3>
        <p className="muted">Sin fotos de almacén en los IPV importados: cuando un IPV traiga su hoja de Almacén llena, aquí verás sus saldos y qué salidas ya tienen costo para pasar a gasto.</p>
      </Card>
    )
  }
  return (
    <>
      <Card>
        <h3>Foto del IPV (sección secundaria)</h3>
        <p className="small muted">
          Esto NO es el almacén manual de arriba: es la foto de almacén que trae cada IPV (hoja «Almacén»), tal como
          entró — {fmtInt(wh.totals.productos)} productos en {fmtInt(wh.totals.fotos)} fotos · entradas {fmtInt(wh.totals.entradas)} ·
          salidas {fmtInt(wh.totals.salidas)} · {fmtInt(wh.pendientesCosto.length)} pendientes de costo.
        </p>
        <div className="list">
          {wh.balances.map((b) => (
            <div className="row" key={b.key}>
              <MediaImage kind="foto-almacen" entityKey={slug(b.product)} alt="" className="media-thumb alm-photo" />
              <span>
                <strong>{b.product}</strong>
                <span className="small muted"> · última foto {b.lastDate ? fmtDate(b.lastDate) : '—'} · entradas {fmtInt(b.entradas)} · bajas {fmtInt(b.bajas)} · salidas {fmtInt(b.salidas)}</span>
              </span>
              <span className="mono">
                {fmtInt(b.saldo)} {b.um}
                {b.sinCosto ? <span className="chip warn">Sin costo vigente</span> : <span className="small muted"> · costo {fmtCUP(b.costoVigente ?? 0)}</span>}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3><Icon name="receipt" size={18} /> Salidas → Gastos (foto del IPV)</h3>
        <p className="small muted">
          Una salida solo pasa a gasto si el producto tiene costo vigente verificado (el del catálogo o el precio
          de compra de la propia foto). Sin costo, queda pendiente y no se crea ningún gasto.
        </p>
        {wh.salidas.length === 0 ? (
          <p className="muted">Las fotos importadas no traen salidas registradas: nada que pasar a gasto por ahora.</p>
        ) : (
          <div className="list">
            {wh.salidas.map((s, i) => (
              <div className="row" key={`${s.date}-${s.product}-${i}`}>
                <span><strong>{s.product}</strong><br /><span className="small muted">{fmtDate(s.date)} · salieron {fmtInt(s.cantidad)} {s.um}</span></span>
                {s.estado === 'con-costo'
                  ? <span className="mono">{fmtCUP(s.importe ?? 0)} <span className="chip ok">Gasto enlazado</span><br /><span className="small muted">costo {fmtCUP(s.costoVigente ?? 0)} ({s.fuenteCosto === 'catalogo' ? 'catálogo' : 'foto del IPV'})</span></span>
                  : <span className="chip warn">Pendiente de costo</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3>Registro de movimientos (foto del IPV)</h3>
        <div className="list">
          {wh.rows.map((r, i) => (
            <div className="row" key={`${r.date}-${r.product}-${i}`}>
              <MediaImage kind="foto-almacen" entityKey={slug(r.product)} alt="" className="media-thumb alm-photo" />
              <span><strong>{r.product}</strong><br /><span className="small muted">{fmtDate(r.date)}{r.observacion ? ` · ${r.observacion}` : ''}</span></span>
              <span className="mono small">
                inicial {fmtInt(r.saldoInicial)} · +{fmtInt(r.entrada)} · baja {fmtInt(r.baja)} · salida {fmtInt(r.salida)} → <strong>{fmtInt(r.saldoFinal)} {r.um}</strong>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
