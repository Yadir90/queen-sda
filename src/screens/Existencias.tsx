import { useMemo, useState, type FormEvent } from 'react'
import type { InventoryAdjustment, Section, StoredData } from '../types'
import { buildInventoryBook, type BookProduct } from '../lib/productosCore.mjs'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { fmtDate, fmtDecEs, fmtInt, todayISO } from '../lib/utils'
import { saveInventoryAdjustments, supabaseConfigured } from '../lib/backend'
import { sbSaveInventoryAdjustments } from '../lib/supabaseBackend'
import '../components/sectionsMirror.css'

const SB_MODE = supabaseConfigured()

/* Existencias como destino propio (oleada 3): el MISMO libro
   encadenado de Productos (buildInventoryBook de productosCore,
   sin duplicar lógica), con la presentación del ExistenciasTab
   del original (App.tsx:22478): saldo inicial + entradas − ventas
   − bajas − traslados = saldo final; el saldo final de hoy es el
   saldo inicial de mañana. Descuadres primero, buscador, lista
   por departamento y el detalle por día del producto elegido.
   AJUSTES MANUALES: los del servidor original no viajan en el
   respaldo, pero esta copia guarda los suyos (app_settings
   'existencias-ajustes' o el StoredData local) y el libro los
   aplica con la semántica del original: «inicial» fija el saldo
   inicial de su fecha y reencadena desde ahí; «baja» y «traslado»
   restan ese día como bajas/traslados manuales. */

const fmtCant = (v: number) => fmtDecEs(v, 2)

const KIND_LABEL: Record<InventoryAdjustment['kind'], string> = { inicial: 'Saldo inicial fijado', baja: 'Baja manual', traslado: 'Traslado manual' }

export default function ExistenciasTab({ data, isAdmin, onChanged, onNavigate }: {
  data: StoredData
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
}) {
  const book = useMemo(() => buildInventoryBook(data.days, data.inventoryAdjustments), [data.days, data.inventoryAdjustments])
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [adjDate, setAdjDate] = useState(todayISO())
  const [adjKind, setAdjKind] = useState<InventoryAdjustment['kind']>('baja')
  const [adjQty, setAdjQty] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjMsg, setAdjMsg] = useState('')
  const [adjError, setAdjError] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)

  const submitAdjustment = (ev: FormEvent, product: BookProduct) => {
    ev.preventDefault()
    const quantity = Number(adjQty)
    if (!Number.isFinite(quantity) || quantity < 0) { setAdjError('Escribe una cantidad válida.'); return }
    if (adjKind !== 'inicial' && quantity <= 0) { setAdjError('La baja o el traslado necesitan una cantidad mayor que cero.'); return }
    if (!data.days.some((d) => d.date === adjDate)) { setAdjError('Esa fecha no tiene un día importado: el ajuste se aplica sobre un día del libro.'); return }
    const item: InventoryAdjustment = {
      id: `adj-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      productKey: product.key, dept: product.dept, productName: product.name, um: product.um,
      date: adjDate, kind: adjKind, quantity, note: adjNote.trim(),
    }
    setAdjQty(''); setAdjNote('')
    void persistAdjustments([...data.inventoryAdjustments, item], `Ajuste registrado: ${KIND_LABEL[adjKind].toLowerCase()} de ${product.name} el ${fmtDate(adjDate)}. El libro ya lo aplica.`)
  }

  const persistAdjustments = async (next: InventoryAdjustment[], okMsg: string) => {
    setAdjBusy(true); setAdjError(''); setAdjMsg('')
    try {
      if (SB_MODE) await sbSaveInventoryAdjustments(next)
      else saveInventoryAdjustments(next)
      setAdjMsg(okMsg)
      onChanged()
    } catch (e) {
      setAdjError(e instanceof Error ? e.message : 'No se pudo guardar el ajuste.')
    } finally { setAdjBusy(false) }
  }

  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? book.products.filter((p) => `${p.name} ${p.dept} ${p.um}`.toLowerCase().includes(q)) : book.products),
    [book.products, q],
  )
  const depts = useMemo(() => [...new Set(filtered.map((p) => p.dept))], [filtered])
  const selected: BookProduct | null = book.products.find((p) => p.key === selectedKey) ?? filtered[0] ?? null

  return (
    <div>
      <TabHeader
        icon="archive"
        title="Existencias"
        desc="Libro de existencias: saldo inicial + entradas − ventas − bajas − traslados = saldo final. El saldo final de hoy es el saldo inicial de mañana."
        badge={TAB_BADGES.existencias}
      />
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn" onClick={() => onNavigate('productos')}>
          <Icon name="chevronL" size={15} /> Volver a Productos
        </button>
        {book.latestDate ? <span className="small muted" style={{ marginLeft: 10 }}>Libro al día con el IPV del {fmtDate(book.latestDate)}.</span> : null}
      </div>

      {book.products.length === 0 ? (
        <EmptyState
          icon="archive"
          title="Todavía no hay libro de existencias"
          text="Ningún IPV importado trae productos ni entradas. Al importar el primer día, la cadena arranca sola: el saldo final de hoy será el saldo inicial de mañana."
        />
      ) : (
        <>
          {book.descuadres.length > 0 ? (
            <Card className="mod-alert-card">
              <h3><Icon name="alert" size={17} /> Descuadres de existencias · {fmtInt(book.descuadres.length)}</h3>
              <p className="small muted">Saldo final calculado contra saldo final del IPV. La diferencia se muestra hasta explicarla: baja, traslado, corrección del saldo inicial o reimportar el día.</p>
              <div className="list">
                {book.descuadres.map((d) => (
                  <button
                    key={`${d.productKey}-${d.date}`}
                    type="button"
                    className="row mod-row-btn"
                    onClick={() => setSelectedKey(d.productKey)}
                    aria-label={`Ver ${d.name}: ${d.texto}`}
                  >
                    <span className="mod-row-main">
                      <span className="mod-row-title">{d.name} <span className="small muted">· {d.dept}{d.um ? ` · ${d.um}` : ''} · {fmtDate(d.date)}</span></span>
                      <span className="small">{d.texto}</span>
                    </span>
                    <strong className="mod-danger">{fmtCant(Math.abs(d.diferencia))}</strong>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          <div className="field">
            <label htmlFor="existencias-buscar">Buscar producto</label>
            <input id="existencias-buscar" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ej.: croquetas" />
          </div>

          <div className="mod-exist-layout">
            <div className="mod-exist-list">
              {depts.length === 0 ? <p className="small muted">Sin productos que coincidan con «{search}».</p> : null}
              {depts.map((dept) => (
                <div key={dept}>
                  <h3 className="mod-dept-title">{dept}</h3>
                  <div className="list">
                    {filtered.filter((p) => p.dept === dept).map((p) => {
                      const last = p.history[p.history.length - 1]
                      return (
                        <button
                          key={p.key}
                          type="button"
                          className={`row mod-row-btn ${selected?.key === p.key ? 'is-selected' : ''}`}
                          onClick={() => setSelectedKey(p.key)}
                          aria-current={selected?.key === p.key ? 'true' : undefined}
                          aria-label={`${p.name}: saldo final ${fmtCant(p.currentStock)}${p.hasDescuadre ? ', no cuadra' : ''}`}
                        >
                          <span className="mod-row-main">
                            <span className="mod-row-title">{p.name}{p.um ? <span className="small muted"> · {p.um}</span> : null}</span>
                            <span className="small muted">
                              {last
                                ? <>Saldo inicial {fmtCant(last.saldoInicial)} · +{fmtCant(last.entradas)} entradas · −{fmtCant(last.ventas)} ventas · −{fmtCant(last.bajas + last.traslados)} bajas/traslados · = saldo final {fmtCant(last.saldoFinal)}</>
                                : 'Sin movimientos todavía'}
                            </span>
                            <span className="mod-chip-row">
                              {p.lastIpvSaldoFinal != null ? (
                                p.hasDescuadre
                                  ? <span className="chip danger"><Icon name="alert" size={11} /> No cuadra · IPV {fmtCant(p.lastIpvSaldoFinal)}</span>
                                  : <span className="chip ok"><Icon name="check" size={11} /> Cuadra con el IPV</span>
                              ) : null}
                              {p.faltaSaldoInicial ? <span className="chip warn">Sin saldo inicial fijado</span> : null}
                            </span>
                          </span>
                          <strong className="figure">{fmtCant(p.currentStock)}</strong>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {selected ? (
              <Card className="mod-exist-detail">
                <h3>{selected.name}</h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                  {selected.dept}{selected.um ? ` · ${selected.um}` : ''}
                  {selected.firstSeen ? ` · desde el ${fmtDate(selected.firstSeen)}` : ''}
                  {selected.lastSeen ? ` hasta el ${fmtDate(selected.lastSeen)}` : ''}
                </p>
                <div className="grid-2">
                  <div className="stat"><div className="label">Saldo final actual</div><div className="value">{fmtCant(selected.currentStock)}</div></div>
                  <div className="stat">
                    <div className="label">Último saldo del IPV</div>
                    <div className="value">{selected.lastIpvSaldoFinal != null ? fmtCant(selected.lastIpvSaldoFinal) : '—'}</div>
                    {selected.lastDiferencia != null && selected.lastDiferencia !== 0
                      ? <div className="hint">diferencia {fmtCant(selected.lastDiferencia)}</div>
                      : null}
                  </div>
                </div>
                <h4 className="mod-detail-h">Cadena por día</h4>
                <div className="mod-table-wrap">
                  <table className="mod-table">
                    <thead>
                      <tr><th>Día</th><th>Inicial</th><th>Entradas</th><th>Ventas</th><th>Bajas/trasl.</th><th>Final</th><th>IPV</th></tr>
                    </thead>
                    <tbody>
                      {[...selected.history].reverse().slice(0, 31).map((h) => (
                        <tr key={h.date} className={h.diferencia != null && h.diferencia !== 0 ? 'is-diff' : ''}>
                          <td>{fmtDate(h.date)}</td>
                          <td>{fmtCant(h.saldoInicial)}</td>
                          <td>{fmtCant(h.entradas)}</td>
                          <td>{fmtCant(h.ventas)}</td>
                          <td>{fmtCant(h.bajas + h.traslados)}</td>
                          <td><strong>{fmtCant(h.saldoFinal)}</strong></td>
                          <td>{h.ipvSaldoFinal != null ? fmtCant(h.ipvSaldoFinal) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4 className="mod-detail-h">Ajustes manuales de este producto</h4>
                {adjMsg ? <div className="ok-box" style={{ marginBottom: 10 }}>{adjMsg}</div> : null}
                {adjError ? <div className="error-box" style={{ marginBottom: 10 }}>{adjError}</div> : null}
                {data.inventoryAdjustments.filter((a) => a.productKey === selected.key).length === 0 ? (
                  <p className="small muted">Sin ajustes manuales: la cadena sale solo de los IPV importados.</p>
                ) : (
                  <div className="list">
                    {data.inventoryAdjustments.filter((a) => a.productKey === selected.key).map((a) => (
                      <div className="row" key={a.id}>
                        <span className="mod-row-main">
                          <span className="mod-row-title">{KIND_LABEL[a.kind]} · {fmtCant(a.quantity)}{selected.um ? ` ${selected.um}` : ''}</span>
                          <span className="small muted">{fmtDate(a.date)}{a.note ? ` · ${a.note}` : ''}</span>
                        </span>
                        {isAdmin ? (
                          <button type="button" className="btn" disabled={adjBusy} onClick={() => void persistAdjustments(data.inventoryAdjustments.filter((x) => x.id !== a.id), 'Ajuste eliminado: el libro volvió a encadenarse sin él.')}>
                            <Icon name="trash" size={14} /> Eliminar
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin ? (
                  <form onSubmit={(e) => submitAdjustment(e, selected)} style={{ marginTop: 10 }}>
                    <div className="field"><label htmlFor="adj-date">Fecha (día importado)</label>
                      <input id="adj-date" type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} required /></div>
                    <div className="field"><label htmlFor="adj-kind">Tipo de ajuste</label>
                      <select id="adj-kind" value={adjKind} onChange={(e) => setAdjKind(e.target.value as InventoryAdjustment['kind'])}>
                        <option value="baja">Baja (rebaja manual)</option>
                        <option value="traslado">Traslado</option>
                        <option value="inicial">Fijar saldo inicial</option>
                      </select></div>
                    <div className="field"><label htmlFor="adj-qty">Cantidad</label>
                      <input id="adj-qty" type="number" min="0" step="any" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} required /></div>
                    <div className="field"><label htmlFor="adj-note">Nota</label>
                      <input id="adj-note" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} maxLength={300} placeholder="Por qué se ajusta (opcional)" /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                      <button type="submit" className="btn primary" disabled={adjBusy || adjQty === ''}>{adjBusy ? 'Guardando…' : 'Registrar ajuste'}</button>
                    </div>
                    <p className="small muted" style={{ marginBottom: 0 }}>
                      El ajuste no toca el IPV: vive en el libro y la cadena se reencadena con él.
                      Fijar el saldo inicial manda sobre la apertura de ese día.
                    </p>
                  </form>
                ) : (
                  <p className="small muted" style={{ marginBottom: 0 }}>Solo el administrador registra ajustes del libro.</p>
                )}
              </Card>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
