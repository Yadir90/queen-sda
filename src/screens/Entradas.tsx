import { useMemo, useState } from 'react'
import type { DayEntryDetail, StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { printHtml } from '../lib/download'
import { BRAND_CUNO_URL } from '../lib/brandAssets'
import '../components/sectionsMirror.css'

/* Entradas de productos (oleada 3): espejo del EntradasTab del
   original (App.tsx:8766) alimentado SOLO de DayData.entriesDetail
   — la mercancía que entró en cada IPV, con su precio de compra —
   y de DayData.entriesImporte. KPIs del mes, inversión por
   departamento con barras, filtro por departamento, buscador y el
   detalle agrupado por fecha, del más reciente al más antiguo.
   La «ganancia de lo entrado» se deriva como en el original:
   cantidad × precio de venta − importe a precio de compra.
   La factura de entradas del mes se genera con el constructor
   de documentos de esta copia (documentosCore.entradasInvoiceHtml)
   y se abre como vista de impresión/PDF. LO QUE NO VIAJA,
   declarado y no fingido: las fotos de factura de entradas del
   original viven como blob en su servidor y no vienen en el
   respaldo (esta copia no tiene ninguna foto que mostrar). */

interface EntryRow extends DayEntryDetail {
  date: string
  importeVenta: number
  ganancia: number
}

const deptLabel = (name: string) => (name === 'Elaboración' ? 'Elaboración (cocina)' : name)

export default function EntradasTab({ data }: { data: StoredData }) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of data.days) set.add(d.date.slice(0, 7))
    return [...set].sort().reverse()
  }, [data.days])
  const [monthKey, setMonthKey] = useState('')
  const activeMonth = monthKey || months[0] || ''
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('Todos')

  const allRows = useMemo<EntryRow[]>(
    () => data.days.flatMap((d) => (d.entriesDetail ?? []).map((e) => {
      const importeVenta = e.cantidad * e.precioVenta
      return { ...e, date: d.date, importeVenta, ganancia: importeVenta - e.importe }
    })),
    [data.days],
  )
  const monthRows = useMemo(
    () => allRows.filter((r) => r.date.startsWith(activeMonth)),
    [allRows, activeMonth],
  )

  const totals = useMemo(() => ({
    importe: monthRows.reduce((s, r) => s + r.importe, 0),
    ganancia: monthRows.reduce((s, r) => s + r.ganancia, 0),
    registros: monthRows.length,
    cantidad: monthRows.reduce((s, r) => s + r.cantidad, 0),
  }), [monthRows])

  const porDepto = useMemo(() => {
    const map = new Map<string, { name: string; importe: number; ganancia: number; registros: number }>()
    for (const r of monthRows) {
      const cur = map.get(r.dept) ?? { name: r.dept, importe: 0, ganancia: 0, registros: 0 }
      cur.importe += r.importe
      cur.ganancia += r.ganancia
      cur.registros += 1
      map.set(r.dept, cur)
    }
    return [...map.values()].sort((a, b) => b.importe - a.importe)
  }, [monthRows])

  const detalle = useMemo(() => {
    const q = query.trim().toLowerCase()
    return monthRows.filter((r) =>
      (deptFilter === 'Todos' || r.dept === deptFilter)
      && (!q || r.descripcion.toLowerCase().includes(q) || r.dept.toLowerCase().includes(q)))
  }, [monthRows, deptFilter, query])

  const porFecha = useMemo(() => {
    const map = new Map<string, EntryRow[]>()
    for (const r of detalle) map.set(r.date, [...(map.get(r.date) ?? []), r])
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [detalle])

  const deptSubtotal = deptFilter === 'Todos' ? null : porDepto.find((d) => d.name === deptFilter) ?? null
  const [invoiceError, setInvoiceError] = useState('')
  const openInvoice = async () => {
    const docs = await import('../lib/documentosCore.mjs')
    const rep = docs.buildEntradasInvoiceData(data, activeMonth)
    if (!rep.rows.length) { setInvoiceError('Este mes no tiene entradas que facturar.'); return }
    setInvoiceError('')
    if (!printHtml(docs.withStampImage(docs.entradasInvoiceHtml(rep), BRAND_CUNO_URL))) setInvoiceError('El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
  }

  return (
    <div>
      <TabHeader
        icon="package"
        title="Entradas"
        desc="Entradas de productos: salen solas de la columna «Entrada» de cada IPV que importas; aquí solo se consultan. Al reimportar un día, sus entradas se reemplazan con él."
        badge={TAB_BADGES.entradas}
      />
      {invoiceError ? <div className="error-box" style={{ marginBottom: 14 }}>{invoiceError}</div> : null}
      {allRows.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <button type="button" className="btn" onClick={() => void openInvoice()}>
            <Icon name="doc" size={16} /> Factura de entradas del mes (PDF)
          </button>
        </div>
      ) : null}

      {months.length > 1 ? (
        <div className="view-chips" role="group" aria-label="Mes de las entradas">
          {months.map((m) => (
            <button key={m} type="button" className={`view-chip ${m === activeMonth ? 'active' : ''}`} aria-pressed={m === activeMonth} onClick={() => { setMonthKey(m); setDeptFilter('Todos') }}>
              {fmtDate(`${m}-01`).replace(/^\d+ de /, '').replace(' de ', ' ')}
            </button>
          ))}
        </div>
      ) : null}

      {allRows.length === 0 ? (
        <EmptyState
          icon="package"
          title="Sin entradas registradas"
          text="Las entradas aparecen solas cuando importas el IPV del día y ese día tuvo productos con cantidad en la columna «Entrada». Sin días con entradas en el respaldo, aquí no hay nada que mostrar: no se rellena."
        />
      ) : monthRows.length === 0 ? (
        <EmptyState icon="package" title="Sin entradas en este mes" text="Ningún producto entró en las fechas de este mes según los IPV importados." />
      ) : (
        <>
          <div className="grid-2 mod-kpis">
            <div className="stat"><div className="label">Inversión del mes</div><div className="value">{fmtCUP(totals.importe)}</div></div>
            <div className="stat"><div className="label">Ganancia de lo entrado</div><div className="value">{fmtCUP(totals.ganancia)}</div></div>
            <div className="stat"><div className="label">Nº de entradas</div><div className="value">{fmtInt(totals.registros)}</div></div>
            <div className="stat"><div className="label">Cantidad total</div><div className="value">{fmtInt(totals.cantidad)}</div></div>
          </div>

          {porDepto.length > 0 ? (
            <Card>
              <h3>Inversión por departamento</h3>
              <div className="mod-bars">
                {porDepto.map((d) => (
                  <div key={d.name} className="mod-bar-row">
                    <div className="mod-bar-head">
                      <span>{deptLabel(d.name)}</span>
                      <strong>{fmtCUP(d.importe)}</strong>
                    </div>
                    <div className="mod-bar-track">
                      <span style={{ width: `${totals.importe ? Math.max(3, (d.importe / totals.importe) * 100) : 0}%` }} />
                    </div>
                    <p className="small muted">{fmtInt(d.registros)} entrada{d.registros === 1 ? '' : 's'} · ganancia {fmtCUP(d.ganancia)}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {porDepto.length > 0 ? (
            <div className="view-chips" role="group" aria-label="Filtrar entradas por departamento">
              {['Todos', ...porDepto.map((d) => d.name)].map((d) => (
                <button key={d} type="button" className={`view-chip ${deptFilter === d ? 'active' : ''}`} aria-pressed={deptFilter === d} onClick={() => setDeptFilter(d)}>
                  {d === 'Todos' ? 'Todos' : deptLabel(d)}
                </button>
              ))}
            </div>
          ) : null}
          {deptSubtotal ? (
            <div className="ok-box" role="status">
              {deptLabel(deptSubtotal.name)}: <strong>{fmtCUP(deptSubtotal.importe)}</strong> de inversión en {fmtInt(deptSubtotal.registros)} entrada{deptSubtotal.registros === 1 ? '' : 's'} · ganancia de lo entrado {fmtCUP(deptSubtotal.ganancia)}. Abajo ves solo ese departamento.
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="entradas-buscar">Buscar producto</label>
            <input id="entradas-buscar" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto o departamento…" />
          </div>

          {detalle.length === 0 ? (
            <p className="small muted">Ningún producto coincide con «{query}».</p>
          ) : (
            porFecha.map(([fecha, items]) => (
              <Card key={fecha} className="mod-day-card">
                <div className="mod-day-head">
                  <strong>{fmtDate(fecha)}</strong>
                  <span className="small muted">
                    Inversión <strong>{fmtCUP(items.reduce((s, i) => s + i.importe, 0))}</strong> · Ganancia <strong>{fmtCUP(items.reduce((s, i) => s + i.ganancia, 0))}</strong>
                  </span>
                </div>
                <div className="list">
                  {items.map((i, idx) => (
                    <div className="row" key={`${i.dept}-${i.descripcion}-${idx}`}>
                      <span className="mod-row-main">
                        <span className="mod-row-title">{i.descripcion} <span className="small muted">({i.dept}{i.um ? ` · ${i.um}` : ''}{i.codigo ? ` · Cód. ${i.codigo}` : ''})</span></span>
                        <span className="small muted">{fmtInt(i.cantidad)} × compra {fmtCUP(i.precioCompra)} · venta {fmtCUP(i.precioVenta)}</span>
                      </span>
                      <span className="mod-row-fig">
                        <strong>{fmtCUP(i.importe)}</strong>
                        <span className="small muted">ganancia {fmtCUP(i.ganancia)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}

          <Card>
            <h3>Factura de entradas</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Cada día puede llevar la foto de su factura archivada junto a las entradas.
              Esas fotos viven como archivos en el servidor y <strong>no viajan en el respaldo</strong>:
              no se recibió ninguna, así que no hay foto que mostrar ni se simula el archivo. El comprobante
              en PDF de las entradas tampoco se genera aquí. Lo que sí está completo es el detalle de arriba:
              cada entrada real de cada IPV importado, con su precio de compra.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
