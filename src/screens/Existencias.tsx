import { useMemo, useState } from 'react'
import type { Section, StoredData } from '../types'
import { buildInventoryBook, type BookProduct } from '../lib/productosCore.mjs'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { fmtDate, fmtInt } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Existencias como destino propio (oleada 3): el MISMO libro
   encadenado de Productos (buildInventoryBook de productosCore,
   sin duplicar lógica), con la presentación del ExistenciasTab
   del original (App.tsx:22478): saldo inicial + entradas − ventas
   − bajas − traslados = saldo final; el saldo final de hoy es el
   saldo inicial de mañana. Descuadres primero, buscador, lista
   por departamento y el detalle por día del producto elegido.
   DECLARADO: los ajustes manuales del libro del original
   (rebajas, traslados y saldos iniciales fijados a mano) se
   guardan en el servidor del original y no viajan en el
   respaldo: esta copia muestra el libro tal como lo encadenan
   los IPV y no ofrece registrar ajustes que no podría guardar. */

const fmtCant = (v: number) => new Intl.NumberFormat('es-CU', { maximumFractionDigits: 2 }).format(v)

export default function ExistenciasTab({ data, onNavigate }: {
  data: StoredData
  onNavigate: (s: Section) => void
}) {
  const book = useMemo(() => buildInventoryBook(data.days), [data.days])
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

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
                <p className="small muted" style={{ marginBottom: 0 }}>
                  Ajustes manuales del libro (rebajas, traslados o fijar un saldo inicial a mano): en el sistema
                  original se guardan en su servidor y no viajan en el respaldo. Esta copia no los registra:
                  el libro se encadena solo de los IPV importados, y cualquier descuadre se explica reimportando
                  el día corregido o desde el propio IPV, nunca escribiendo sobre la cadena aquí.
                </p>
              </Card>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
