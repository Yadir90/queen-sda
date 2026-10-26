import { useMemo, useState } from 'react'
import type { StoredData } from '../types'
import { Card, EmptyState, TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import { ChartCard, ColumnChart, RowChart } from '../components/charts'
import {
  buildProductsCatalog, buildPriceSuggestions, detectPriceChanges,
  type CatalogProduct,
} from '../lib/productosCore.mjs'
import { fmtCUP, fmtDate, fmtInt } from '../lib/utils'
import { MediaImage } from '../components/MediaImage'
import { productMediaKey } from '../lib/media'
import '../components/sectionsMirror.css'

/* Productos del externo: el catálogo maestro calculado desde los días
   del IPV, como en el original — existencia real del libro encadenado,
   costo promedio ponderado de las entradas, precio vigente del último
   IPV, margen y contraste de importes. Queen SEÑALA los cambios de
   precio detectados entre IPV consecutivos; nunca aplica un cambio
   sola. La FOTO de cada producto llega por la media autenticada
   (tabla media, 'foto-producto' por slug(dept+nombre+um), la clave
   de productKeyOf): sin fila en media, la tarjeta va sin foto, como
   ausencia, nunca con una imagen inventada. Diferencia honesta: los
   cambios de precio/costo registrados a mano, las excepciones de
   precio y los ajustes de existencia viven en la base del original
   y no viajan en el respaldo; aquí la historia sale solo de los IPV
   y los gastos. */

type Vista = 'activos' | 'historial' | 'cambios'

const DEPTS = ['Elaboración', 'Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Cantina', 'Pizzas']

function stockChip(p: CatalogProduct) {
  if (p.stockStatus === 'agotado') return <span className="chip danger">Agotado</span>
  if (p.stockStatus === 'critico') return <span className="chip danger">Crítico</span>
  if (p.stockStatus === 'bajo') return <span className="chip warn">Bajo</span>
  if (p.stockStatus === 'sin-ritmo') return <span className="chip">Sin ritmo</span>
  return <span className="chip ok">Normal</span>
}

export default function Productos({ data }: { data: StoredData }) {
  const [vista, setVista] = useState<Vista>('activos')
  const [dept, setDept] = useState<string>('todos')
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const catalog = useMemo(() => buildProductsCatalog(data.days, data.inventoryAdjustments), [data.days, data.inventoryAdjustments])
  const suggestions = useMemo(() => buildPriceSuggestions(catalog), [catalog])
  const changes = useMemo(() => detectPriceChanges(data.days), [data.days])
  const sugByKey = useMemo(() => new Map(suggestions.items.map((i) => [i.productKey, i])), [suggestions])
  const lowStock = useMemo(
    () => catalog.products.filter((x) => x.currentStock > 0.001 && (x.stockStatus === 'critico' || x.stockStatus === 'bajo')),
    [catalog],
  )
  const explicadas = useMemo(
    () => catalog.products.flatMap((x) => x.priceChecks.filter((c) => c.estado === 'explicada').map((c) => ({ p: x, c }))),
    [catalog],
  )
  const entradasDistintas = useMemo(
    () => catalog.products.flatMap((x) => x.entradasHistorial.filter((en) => en.distinto).map((en) => ({ p: x, e: en }))),
    [catalog],
  )
  const openProduct = (prod: CatalogProduct) => {
    setDept('todos')
    setQuery('')
    setVista(prod.currentStock > 0.001 ? 'activos' : 'historial')
    setOpenKey(prod.productKey)
    requestAnimationFrame(() => {
      document.getElementById(`prod-${prod.productKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const enRiesgo = useMemo(
    () => suggestions.items.filter((i) => i.dept === 'Elaboración' && i.marginPct != null && i.marginPct < 40),
    [suggestions],
  )
  const deptCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of catalog.products) map.set(p.dept, (map.get(p.dept) ?? 0) + 1)
    return map
  }, [catalog])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.products.filter((p) => {
      if (vista === 'activos' && !(p.currentStock > 0.001)) return false
      if (vista === 'historial' && p.currentStock > 0.001) return false
      if (dept !== 'todos' && p.dept !== dept) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [catalog, vista, dept, query])

  const topVendidos = useMemo(
    () => [...catalog.products].filter((p) => p.gananciaHistorica > 0).sort((a, b) => b.gananciaHistorica - a.gananciaHistorica).slice(0, 7),
    [catalog],
  )
  const rankingCompleto = useMemo(
    () => [...catalog.products].filter((p) => p.gananciaHistorica !== 0).sort((a, b) => b.gananciaHistorica - a.gananciaHistorica),
    [catalog],
  )
  const porDept = useMemo(
    () => DEPTS.filter((d) => (deptCounts.get(d) ?? 0) > 0).map((d) => ({ label: d, value: deptCounts.get(d) ?? 0 })),
    [deptCounts],
  )

  if (data.days.length === 0) {
    return (
      <div>
        <TabHeader icon="package" title="Productos" desc="Catálogo maestro desde los IPV" badge={TAB_BADGES.productos} />
        <EmptyState icon="package" title="Sin días importados" text="El catálogo se construye con los productos de los IPV. Importa el respaldo o un IPV y aparecerá aquí." />
      </div>
    )
  }

  return (
    <div>
      <TabHeader icon="package" title="Productos" desc="Catálogo maestro: existencia real, costo promedio y precio vigente desde los IPV" badge={TAB_BADGES.productos} />

      <div className="stats">
        <div className="stat"><span className="label">Productos del catálogo</span><span className="value">{fmtInt(catalog.totalProductos)}</span></div>
        <div className="stat"><span className="label">Con existencia</span><span className="value">{fmtInt(catalog.conExistencia)}</span></div>
        <div className="stat"><span className="label">Margen elaborados</span><span className="value">{suggestions.averages.elaborados != null ? `${suggestions.averages.elaborados} %` : '—'}</span></div>
        <div className="stat"><span className="label">Margen bebidas</span><span className="value">{suggestions.averages.bebidas != null ? `${suggestions.averages.bebidas} %` : '—'}</span></div>
        <div className="stat"><span className="label">Margen general</span><span className="value">{suggestions.averages.general != null ? `${suggestions.averages.general} %` : '—'}</span></div>
        <div className="stat"><span className="label">Platos en riesgo (&lt;40 %)</span><span className="value">{fmtInt(enRiesgo.length)}</span></div>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Márgenes: promedio del margen unitario de cada producto con costo y precio vigentes (la misma fórmula del
        original). En el sistema principal los márgenes se leen de su estado vivo —con los cambios manuales de precio
        y costo que no viajan en el respaldo—, por eso pueden diferir un poco de los de aquí.
      </p>

      {/* Stock bajo — primer bloque del original (ProductosTab): crítico
          hasta 1 día de cobertura, bajo hasta 3, con el ritmo real. */}
      <Card>
        <h3><Icon name="alert" size={18} /> Stock bajo · {fmtInt(lowStock.length)}</h3>
        <p className="small muted">Se calcula con las unidades realmente vendidas en los IPV. Crítico significa hasta 1 día de cobertura y bajo, hasta 3 días. Los días sin venta no se inventan como cero.</p>
        {lowStock.length ? (
          <div className="list">
            {lowStock.slice(0, 8).map((prod) => (
              <button key={prod.productKey} type="button" className="row" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }} onClick={() => openProduct(prod)}>
                <span><strong>{prod.name}</strong><br /><span className="small muted">Quedan {fmtInt(prod.currentStock)}{prod.um ? ` ${prod.um}` : ''} · promedio vendido {prod.promedioVentaDiaria} por día con venta · cobertura estimada {prod.coberturaDias != null ? `${prod.coberturaDias} día${Math.abs(prod.coberturaDias - 1) < 0.01 ? '' : 's'}` : 'sin calcular'}</span></span>
                <span className={`chip ${prod.stockStatus === 'critico' ? 'danger' : 'warn'}`}>{prod.stockStatus === 'critico' ? 'Crítico' : 'Bajo'}</span>
              </button>
            ))}
          </div>
        ) : <p className="small muted">Ningún producto con existencia está por debajo de tres días de su ritmo real de venta.</p>}
      </Card>

      {changes.length > 0 ? (
        <Card>
          <h3><Icon name="clock" size={18} /> Registro de cambios de precio</h3>
          <p className="small muted">
            Queen los detecta al comparar IPV consecutivos y los SEÑALA: no aplica ningún cambio sola.
            {changes.some((c) => c.name === 'Tequila Corrales Gold') ? ' Incluye el Tequila Corrales Gold: 10.000 → 12.000 CUP el 22 de octubre.' : ''}
          </p>
          <div className="list">
            {changes.slice(0, 12).map((c, i) => (
              <div className="row" key={`${c.productKey}-${c.kind}-${c.date}-${i}`}>
                <span>
                  <strong>{c.name}</strong> <span className="muted">· {c.dept} · precio de {c.kind}</span><br />
                  <span className="small muted">{fmtDate(c.date)} · {c.kind === 'compra' ? 'Detectado en la Entrada del IPV' : 'Detectado entre IPVs consecutivos'}</span>
                </span>
                <span className="mono">{fmtCUP(c.oldPrice ?? 0)} → <strong>{fmtCUP(c.newPrice)}</strong></span>
              </div>
            ))}
          </div>
          {changes.length > 12 ? <p className="small muted">…y {fmtInt(changes.length - 12)} cambios más en el historial de cada ficha.</p> : null}
        </Card>
      ) : null}

      <ChartCard title="Productos por departamento" sub="Toca una barra para ver su detalle">
        <RowChart data={porDept} ariaLabel="Productos por departamento" />
      </ChartCard>
      <ChartCard title="Rentabilidad por producto" sub="Suma la ganancia que cada producto declaró en todos los IPV guardados. No recalcula días antiguos con el precio o costo actual. Toca una columna para ver su detalle.">
        <ColumnChart
          data={topVendidos.map((p) => ({ label: p.name, ganancia: p.gananciaHistorica }))}
          series={[{ key: 'ganancia', label: 'Ganancia histórica', color: 'var(--chart-green)' }]}
          ariaLabel="Ganancia histórica por producto"
          angled
        />
        {rankingCompleto.length > topVendidos.length ? (
          <details style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>Ver ranking completo</summary>
            <div className="list">
              {rankingCompleto.map((prod, i) => (
                <div className="row" key={prod.productKey}>
                  <span><button type="button" className="rh-name" onClick={() => openProduct(prod)}><strong>{i + 1}. {prod.name}</strong></button><br /><span className="small muted">{fmtInt(prod.unidadesVendidas)} unidades · ventas {fmtCUP(prod.ventaHistorica)}</span></span>
                  <strong style={{ color: prod.gananciaHistorica < 0 ? 'var(--danger)' : 'var(--deep)' }}>{fmtCUP(prod.gananciaHistorica)}</strong>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </ChartCard>

      <div className="view-chips" role="tablist" aria-label="Vista de productos">
        <button type="button" className={`view-chip ${vista === 'activos' ? 'active' : ''}`} onClick={() => setVista('activos')}>Con existencia ({fmtInt(catalog.conExistencia)})</button>
        <button type="button" className={`view-chip ${vista === 'historial' ? 'active' : ''}`} onClick={() => setVista('historial')}>Historial ({fmtInt(catalog.totalProductos - catalog.conExistencia)})</button>
        <button type="button" className={`view-chip ${vista === 'cambios' ? 'active' : ''}`} onClick={() => setVista('cambios')}>Cambios de precio ({fmtInt(changes.length)})</button>
      </div>
      <div className="view-chips sub" role="tablist" aria-label="Departamento">
        <button type="button" className={`view-chip ${dept === 'todos' ? 'active' : ''}`} onClick={() => setDept('todos')}>Todos</button>
        {DEPTS.filter((d) => (deptCounts.get(d) ?? 0) > 0).map((d) => (
          <button key={d} type="button" className={`view-chip ${dept === d ? 'active' : ''}`} onClick={() => setDept(d)}>{d} ({fmtInt(deptCounts.get(d) ?? 0)})</button>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 340 }}>
        <label htmlFor="prod-search">Buscar producto</label>
        <input id="prod-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre del producto" />
      </div>

      {vista === 'cambios' ? (
        <Card>
          <h3>Historial de cambios detectados</h3>
          {changes.length === 0 ? <p className="muted">Sin cambios de precio entre los IPV importados.</p> : (
            <div className="list">
              {changes.map((c, i) => (
                <div className="row" key={`${c.productKey}-${c.kind}-${c.date}-${i}`}>
                  <span><strong>{c.name}</strong> <span className="muted">· {c.dept}</span><br /><span className="small muted">{fmtDate(c.date)} · precio de {c.kind}</span></span>
                  <span className="mono">{fmtCUP(c.oldPrice ?? 0)} → <strong>{fmtCUP(c.newPrice)}</strong></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Nada con ese filtro" text={vista === 'activos' ? 'Cambia la vista, el departamento o la búsqueda. Los que están en 0 viven en el Historial.' : 'Cambia la vista, el departamento o la búsqueda.'} />
      ) : (
        <div className="list">
          {shown.map((p) => {
            const sug = sugByKey.get(p.productKey)
            const open = openKey === p.productKey
            return (
              <Card key={p.productKey} className="prod-card"><span id={`prod-${p.productKey}`} style={{ display: 'block', height: 0, overflow: 'hidden' }} aria-hidden="true" />
                <button type="button" className="prod-head" onClick={() => setOpenKey(open ? null : p.productKey)} aria-expanded={open}>
                  <MediaImage kind="foto-producto" entityKey={productMediaKey(p.dept, p.name, p.um)} alt="" className="media-thumb prod-photo" />
                  <span className="prod-title">
                    <strong>{p.name}</strong>
                    <span className="small muted">{p.dept} · {p.menuFamily}{p.um ? ` · ${p.um}` : ''}</span>
                  </span>
                  <span className="prod-nums">
                    <span className="mono">{p.currentStock > 0.001 ? `${fmtInt(p.currentStock)} en existencia` : 'Sin existencia'}</span>
                    {p.margenPct != null ? <span className={`chip ${p.margenPct < 0 ? 'danger' : p.dept === 'Elaboración' && p.margenPct < 40 ? 'warn' : 'ok'}`}>Margen {p.margenPct} %</span> : <span className="chip">Sin costo</span>}
                    {stockChip(p)}
                    <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}><Icon name="chevronR" size={17} /></span>
                  </span>
                </button>
                {p.precioCambioHoy ? <p className="small" style={{ margin: '6px 0 0' }}><Icon name="alert" size={14} /> {p.precioCambioHoy} CUP — cambio detectado en el último IPV.</p> : null}
                {open ? (
                  <div className="prod-detail">
                    <MediaImage
                      kind="foto-producto" entityKey={productMediaKey(p.dept, p.name, p.um)} alt={`Foto de ${p.name}`}
                      style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 14, marginBottom: 10, background: 'var(--surface-tonal)' }}
                    />
                    <table className="kv">
                      <tbody>
                        <tr><td>Precio de venta vigente</td><td>{p.precioVentaVigente != null ? fmtCUP(p.precioVentaVigente) : '—'}</td></tr>
                        <tr><td>Costo vigente (promedio ponderado)</td><td>{p.precioCompraVigente != null ? fmtCUP(p.precioCompraVigente) : '—'}</td></tr>
                        <tr><td>Ganancia por unidad</td><td>{p.gananciaUnidad != null ? fmtCUP(p.gananciaUnidad) : '—'}</td></tr>
                        <tr><td>Existencia real (libro)</td><td>{fmtInt(p.currentStock)} {p.um}</td></tr>
                        <tr><td>Cobertura al ritmo de venta</td><td>{p.coberturaDias != null ? `${p.coberturaDias} días` : 'Sin ritmo de venta'}</td></tr>
                        <tr><td>Vendido en el período</td><td>{fmtInt(p.unidadesVendidas)} {p.um} · {fmtCUP(p.ventaHistorica)}</td></tr>
                        <tr><td>Valor en existencia (costo / venta)</td><td>{p.valorCosto != null ? fmtCUP(p.valorCosto) : '—'} / {p.valorVenta != null ? fmtCUP(p.valorVenta) : '—'}</td></tr>
                        <tr><td>Primera vez en el IPV</td><td>{p.primeraVez ? fmtDate(p.primeraVez) : '—'}</td></tr>
                        <tr><td>Última entrada</td><td>{p.ultimaEntrada ? fmtDate(p.ultimaEntrada) : 'Sin entradas registradas'}</td></tr>
                      </tbody>
                    </table>
                    {sug && sug.status !== 'sin-datos' ? (
                      <p className="small" style={{ marginBottom: 4 }}>
                        <strong>Sugerencia de Queen:</strong> precio sugerido <strong>{fmtCUP(sug.suggestedPrice ?? 0)}</strong>
                        {sug.suggestionBasis === 'historico' ? ' manteniendo tu ganancia histórica' : ' por la meta de margen'}
                        {' '}· equilibrio {fmtCUP(sug.breakEvenPrice ?? 0)} · estado: {sug.status}.
                        La sugerencia es solo eso: Queen nunca cambia un precio sola.
                      </p>
                    ) : null}
                    {p.entradasHistorial.length > 0 ? (
                      <>
                        <h4>Entradas y costo promedio</h4>
                        <div className="list">
                          {p.entradasHistorial.map((e) => (
                            <div className="row" key={e.date}>
                              <span>{fmtDate(e.date)} · entraron {fmtInt(e.cantidad)} {p.um}</span>
                              <span className="mono">{fmtCUP(e.costoEntrada)}/u{e.distinto ? ` · cambió el costo (antes ${fmtCUP(e.costoAnterior ?? 0)})` : ''} · promedio {fmtCUP(e.costoPromedio)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {p.precioHistorial.length > 0 ? (
                      <>
                        <h4>Historial de precios de venta</h4>
                        <div className="list">
                          {p.precioHistorial.map((e, i) => (
                            <div className="row" key={`${e.date}-${i}`}>
                              <span>{fmtDate(e.date)}</span>
                              <span className="mono">{e.oldPrice != null ? `${fmtCUP(e.oldPrice)} → ` : 'precio inicial '}<strong>{fmtCUP(e.newPrice)}</strong></span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {p.ultimoPriceCheck && p.ultimoPriceCheck.estado !== 'ok' ? (
                      <p className="small"><Icon name="alert" size={14} /> {p.ultimoPriceCheck.texto}</p>
                    ) : null}
                    {p.hasDescuadre ? (
                      <p className="small"><Icon name="alert" size={14} /> Último conteo físico con descuadre: diferencia de {p.lastDiferencia} {p.um} contra el libro.</p>
                    ) : null}
                    {p.faltaSaldoInicial ? (
                      <p className="small muted">Este producto apareció vendiendo sin saldo inicial ni entradas en su primer IPV: su existencia parte de 0 y puede no reflejar lo que había.</p>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      {catalog.descuadres.length > 0 ? (
        <Card>
          <h3><Icon name="alert" size={18} /> Descuadres contra conteo físico ({fmtInt(catalog.descuadres.length)})</h3>
          <p className="small muted">Solo se señalan contra conteos FÍSICOS del IPV (la existencia teórica nunca descuadra por definición).</p>
          <div className="list">
            {catalog.descuadres.slice(0, 10).map((d, i) => (
              <div className="row" key={`${d.productKey}-${d.date}-${i}`}>
                <span><strong>{d.name}</strong><br /><span className="small muted">{fmtDate(d.date)} · esperado {d.esperado} · contado {d.contado}</span></span>
                <span className="mono">{d.diferencia > 0 ? '+' : ''}{d.diferencia} {d.um}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {explicadas.length > 0 || entradasDistintas.length > 0 ? (
        <Card>
          <h3>Diferencias explicadas (visibles, sin ajustar en silencio)</h3>
          {explicadas.length > 0 ? (
            <div className="list">
              {explicadas.map(({ p: prod, c }) => (
                <div className="row" key={`precio-${prod.productKey}-${c.date}`} style={{ background: 'var(--turquoise-soft)', borderRadius: 12, padding: '8px 12px' }}>
                  <span className="small"><strong>{prod.name}</strong> · {fmtDate(c.date)} — {c.texto}</span>
                </div>
              ))}
            </div>
          ) : null}
          {entradasDistintas.length > 0 ? (
            <div className="list">
              {entradasDistintas.map(({ p: prod, e }) => (
                <div className="row" key={`costo-${prod.productKey}-${e.date}`} style={{ background: 'var(--warn-soft)', borderRadius: 12, padding: '8px 12px' }}>
                  <span className="small"><strong>{prod.name}</strong> · {fmtDate(e.date)} — Entraron {fmtInt(e.cantidad)}{prod.um ? ` ${prod.um}` : ''} a {fmtCUP(e.costoEntrada)}: el costo promedio pasa de {e.costoAnterior != null ? fmtCUP(e.costoAnterior) : '—'} a <strong>{fmtCUP(e.costoPromedio)}</strong>.</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      {catalog.sinExplicar.length > 0 ? (
        <Card>
          <h3><Icon name="alert" size={18} /> Importes sin explicar ({fmtInt(catalog.sinExplicar.length)})</h3>
          <div className="list">
            {catalog.sinExplicar.slice(0, 8).map((s, i) => (
              <div className="row" key={`${s.productKey}-${s.date}-${i}`}><span className="small">{s.texto}</span></div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
