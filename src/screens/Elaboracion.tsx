import { useMemo, useState, type FormEvent } from 'react'
import type { PackageReference, StoredData } from '../types'
import { Card, EmptyState, TabHeader } from '../components/ui'
import { Icon } from '../components/icons'
import { ChartCard, ColumnChart, RowChart } from '../components/charts'
import {
  buildProductsCatalog, buildPriceSuggestions, derivePackageReferences, expenseComparisons,
  packageDerivedCosts,
  type DerivedPackage, type PackageSuggestion,
} from '../lib/productosCore.mjs'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { savePackageReference, deletePackageReference, supabaseConfigured } from '../lib/backend'
import { sbDeletePackageReference, sbSavePackageReference } from '../lib/supabaseBackend'

/* Elaboración del externo, con las subpestañas del original SIEMPRE
   visibles (Productos · Rentabilidad · Barra · ml · Paquetes y
   rendimientos · Precios · Historial), también con una ficha abierta.
   Honestidad de datos: las fichas de costo (recetas), la configuración
   de Barra · ml y el historial de precios de ingredientes de las
   fichas viven en la base del sistema principal y NO viajan en el
   respaldo; aquí esas vistas trabajan con lo que sí viaja (catálogo
   del IPV, gastos y referencias guardadas) y lo dicen. Las
   referencias de paquetes son las del dueño: se guardan solo con su
   confirmación; lo que Queen aprende de Gastos se calcula al leer y
   se marca como aprendido hasta que él lo guarda. */

const SB_MODE = supabaseConfigured()

type Sub = 'productos' | 'rentabilidad' | 'barra' | 'paquetes' | 'precios' | 'historial'

const AREAS: Array<{ id: string; label: string; depts: string[] }> = [
  { id: 'cocina', label: 'Cocina', depts: ['Elaboración'] },
  { id: 'pizzas', label: 'Pizzas', depts: ['Pizzas'] },
  { id: 'cocteleria', label: 'Coctelería', depts: ['Cantina'] },
]

function trendChip(p: DerivedPackage) {
  if (p.trend === 'subio') return <span className="chip warn">Subió {p.changePct != null ? `${Math.round(p.changePct * 10) / 10} %` : ''}</span>
  if (p.trend === 'bajo') return <span className="chip ok">Bajó {p.changePct != null ? `${Math.round(p.changePct * 10) / 10} %` : ''}</span>
  if (p.trend === 'igual') return <span className="chip">Sin cambio</span>
  return <span className="chip">Sin historial previo</span>
}

export default function Elaboracion({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const [sub, setSub] = useState<Sub>('productos')
  const [area, setArea] = useState('cocina')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const catalog = useMemo(() => buildProductsCatalog(data.days), [data.days])
  const suggestions = useMemo(() => buildPriceSuggestions(catalog), [catalog])
  const refsView = useMemo(() => derivePackageReferences(data.packageReferences, data.expenses), [data.packageReferences, data.expenses])
  const comparisons = useMemo(() => expenseComparisons(data.expenses, refsView.packages), [data.expenses, refsView])
  const sugByKey = useMemo(() => new Map(suggestions.items.map((i) => [i.productKey, i])), [suggestions])

  const perdidaCount = suggestions.counts.perdida
  const preciosBadge = suggestions.counts.perdida + suggestions.counts.riesgo
  const archivadas = 0 // las fichas archivadas del original no viajan en el respaldo

  const persist = async (ref: PackageReference, msg: string) => {
    setError(null)
    try {
      if (SB_MODE) await sbSavePackageReference(ref)
      else savePackageReference(ref)
      setOk(msg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la referencia.')
    }
  }
  const remove = async (id: string, name: string) => {
    setError(null)
    try {
      if (SB_MODE) await sbDeletePackageReference(id)
      else deletePackageReference(id)
      setOk(`Referencia «${name}» borrada.`)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar la referencia.')
    }
  }

  // Confirmar una referencia aprendida por Queen (virtual) o una
  // sugerencia: se guarda con sus observaciones derivadas.
  const confirmDerived = (p: DerivedPackage) => {
    const ref: PackageReference = {
      id: p.id.startsWith('auto:') ? `ref-${Date.now()}` : p.id,
      name: p.name, variety: p.variety, packageLabel: p.packageLabel, unitLabel: p.unitLabel,
      unitsPerPackage: p.unitsPerPackage, subUnitLabel: p.subUnitLabel, subUnitsPerUnit: p.subUnitsPerUnit,
      supplier: p.supplier, note: p.note,
      observations: p.entries.map((e) => ({
        id: e.id, recordedOn: e.recordedOn, packageCost: e.packageCost,
        unitsPerPackage: e.unitsPerPackage, subUnitsPerUnit: e.subUnitsPerUnit,
        place: e.place, presentation: e.presentation, note: e.note, source: e.source, sourceRef: e.sourceRef,
      })),
    }
    void persist(ref, `Referencia «${p.name}» guardada. En adelante Queen la usa para comparar cada gasto.`)
  }
  const confirmSuggestion = (s: PackageSuggestion, units: number, unitLabel: string) => {
    const ref: PackageReference = {
      id: `ref-${Date.now()}`,
      name: s.suggestedName || s.concept, variety: '', packageLabel: s.packageLabel,
      unitLabel, unitsPerPackage: units, subUnitLabel: '', subUnitsPerUnit: 0,
      supplier: '', note: `Creada desde una sugerencia de Queen (gasto «${s.concept}» del ${s.date}).`,
      observations: [{
        id: `obs-${Date.now()}`, recordedOn: s.date, packageCost: s.unitValue,
        unitsPerPackage: units, subUnitsPerUnit: 0, place: '', presentation: s.packageLabel,
        note: `Del gasto «${s.concept}» — ${s.quantity} × ${fmtCUP(s.unitValue)}.`, source: 'gasto',
        sourceRef: `${s.concept} · gasto del ${s.date}`,
      }],
    }
    void persist(ref, `Referencia «${ref.name}» creada desde la sugerencia de Queen.`)
  }

  return (
    <div>
      <TabHeader icon="receipt" title="Elaboración" desc="Productos, rentabilidad, paquetes y precios de la cocina" badge="Paquetes y precios" />

      {/* La barra de subpestañas se pinta SIEMPRE, como en el original. */}
      <div className="view-chips" role="tablist" aria-label="Secciones de Elaboración">
        <button type="button" className={`view-chip ${sub === 'productos' ? 'active' : ''}`} onClick={() => setSub('productos')}>Productos <span className="chip">{fmtInt(catalog.totalProductos)}</span></button>
        <button type="button" className={`view-chip ${sub === 'rentabilidad' ? 'active' : ''}`} onClick={() => setSub('rentabilidad')}>Rentabilidad {perdidaCount > 0 ? <span className="chip danger">{fmtInt(perdidaCount)}</span> : null}</button>
        <button type="button" className={`view-chip ${sub === 'barra' ? 'active' : ''}`} onClick={() => setSub('barra')}>Barra · ml</button>
        <button type="button" className={`view-chip ${sub === 'paquetes' ? 'active' : ''}`} onClick={() => setSub('paquetes')}>Paquetes y rendimientos <span className="chip">{fmtInt(refsView.packages.length)}</span></button>
        <button type="button" className={`view-chip ${sub === 'precios' ? 'active' : ''}`} onClick={() => setSub('precios')}>Precios {preciosBadge > 0 ? <span className="chip warn">{fmtInt(preciosBadge)}</span> : null}</button>
        <button type="button" className={`view-chip ${sub === 'historial' ? 'active' : ''}`} onClick={() => setSub('historial')}>Historial <span className="chip">{fmtInt(archivadas)}</span></button>
      </div>

      {error ? <div className="error-box" style={{ marginBottom: 12 }}>{error}</div> : null}
      {ok ? <p className="small" style={{ marginTop: 0 }}><Icon name="check" size={14} /> {ok}</p> : null}

      {sub === 'productos' ? (
        <>
          <div className="view-chips sub" role="tablist" aria-label="Área">
            {AREAS.map((a) => (
              <button key={a.id} type="button" className={`view-chip ${area === a.id ? 'active' : ''}`} onClick={() => setArea(a.id)}>{a.label}</button>
            ))}
          </div>
          <p className="small muted">
            Borde de estado según el análisis de precios de Queen: verde gana, amarillo margen bajo la meta, rojo pérdida.
            En el original el borde rojo también marca «sin ficha de costo»; las fichas no viajan en el respaldo, así que
            aquí el estado sale solo de precio y costo del IPV.
          </p>
          <div className="list">
            {catalog.products.filter((p) => (AREAS.find((a) => a.id === area)?.depts ?? []).includes(p.dept)).map((p) => {
              const sug = sugByKey.get(p.productKey)
              const estado = !sug || sug.status === 'sin-datos' ? 'sin-datos' : sug.status
              return (
                <div className={`row prod-row estado-${estado}`} key={p.productKey}>
                  <span>
                    <strong>{p.name}</strong>
                    <span className="small muted"> · {p.menuFamily} · existencia {fmtInt(p.currentStock)} {p.um}</span>
                  </span>
                  <span className="mono">
                    {p.precioVentaVigente != null ? fmtCUP(p.precioVentaVigente) : '—'}
                    {p.margenPct != null ? <span className="small muted"> · margen {p.margenPct} %</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {sub === 'rentabilidad' ? <Rentabilidad catalog={catalog} suggestions={suggestions} /> : null}
      {sub === 'barra' ? <BarraMl catalog={catalog} /> : null}

      {sub === 'paquetes' ? (
        <Paquetes
          refsView={refsView}
          comparisons={comparisons}
          isAdmin={isAdmin}
          onConfirmDerived={confirmDerived}
          onConfirmSuggestion={confirmSuggestion}
          onSaveManual={(ref) => void persist(ref, `Referencia «${ref.name}» guardada.`)}
          onRemove={(id, name) => void remove(id, name)}
        />
      ) : null}

      {sub === 'precios' ? (
        <Card>
          <h3>Precios y sugerencias de Queen</h3>
          <p className="small muted">
            Metas: elaborados {suggestions.targets.elaborados} % · bebidas {suggestions.targets.bebidas} % de margen, con
            gasto general del {suggestions.overheadPct} %. La sugerencia mantiene la ganancia histórica de cada producto.
            Queen sugiere: <strong>nunca cambia un precio sola</strong>.
          </p>
          <div className="stats">
            <div className="stat"><span className="label">Margen elaborados</span><span className="value">{suggestions.averages.elaborados != null ? `${suggestions.averages.elaborados} %` : '—'}</span></div>
            <div className="stat"><span className="label">Margen bebidas</span><span className="value">{suggestions.averages.bebidas != null ? `${suggestions.averages.bebidas} %` : '—'}</span></div>
            <div className="stat"><span className="label">Margen general</span><span className="value">{suggestions.averages.general != null ? `${suggestions.averages.general} %` : '—'}</span></div>
            <div className="stat"><span className="label">En pérdida</span><span className="value">{fmtInt(suggestions.counts.perdida)}</span></div>
            <div className="stat"><span className="label">En riesgo</span><span className="value">{fmtInt(suggestions.counts.riesgo)}</span></div>
            <div className="stat"><span className="label">Sin datos</span><span className="value">{fmtInt(suggestions.sinDatos)}</span></div>
          </div>
          <div className="list">
            {suggestions.items.map((i) => (
              <div className="row" key={i.productKey}>
                <span>
                  <strong>{i.name}</strong> <span className="small muted">· {i.dept}</span><br />
                  <span className="small muted">
                    {i.status === 'sin-datos'
                      ? 'Sin precio o sin costo vigente: no se sugiere nada.'
                      : `Venta ${fmtCUP(i.salePrice ?? 0)} · costo ${fmtCUP(i.costPrice ?? 0)} · margen ${i.marginPct} % (meta ${i.targetPct} %) · equilibrio ${fmtCUP(i.breakEvenPrice ?? 0)}`}
                  </span>
                </span>
                {i.suggestedPrice != null ? (
                  <span className="mono">Sugerido: <strong>{fmtCUP(i.suggestedPrice)}</strong><br /><span className="small muted">{i.status}</span></span>
                ) : <span className="chip">Sin datos</span>}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {sub === 'historial' ? (
        <Card>
          <h3>Historial</h3>
          <p className="small muted">
            En el sistema principal aquí viven las fichas de costo archivadas ({fmtInt(archivadas)} en esta copia: las fichas
            no viajan en el respaldo). Lo que sí viaja y queda registrado: el historial de precios de cada producto en su
            ficha de Productos, y el historial de precios de las referencias de paquetes en su subpestaña.
          </p>
          {refsView.history.length > 0 ? (
            <div className="list">
              {refsView.history.slice(0, 15).map((h) => (
                <div className="row" key={h.id}>
                  <span><strong>{h.packageName}</strong><br /><span className="small muted">{fmtDate(h.recordedOn)} · {h.source === 'gasto' ? 'Aprendido de Gastos' : 'Manual'}{h.place ? ` · ${h.place}` : ''}</span></span>
                  <span className="mono">{fmtCUP(h.packageCost)}{h.changeAmount != null && h.changeBasis !== 'ninguna' ? <span className="small muted"> · {h.changeAmount > 0 ? 'subió' : h.changeAmount < 0 ? 'bajó' : 'igual'} {fmtCUP(Math.abs(h.changeAmount))}</span> : null}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">Sin movimientos de precios de referencias todavía.</p>}
        </Card>
      ) : null}
    </div>
  )
}

function Rentabilidad({ catalog, suggestions }: { catalog: ReturnType<typeof buildProductsCatalog>; suggestions: ReturnType<typeof buildPriceSuggestions> }) {
  const [vista, setVista] = useState<'alertas' | 'ranking'>('alertas')
  const perdida = suggestions.items.filter((i) => i.status === 'perdida')
  const riesgo = suggestions.items.filter((i) => i.status === 'riesgo')
  const stockByKey = useMemo(() => new Map(catalog.products.map((p) => [p.productKey, p])), [catalog])
  const perdidaEstimada = perdida.reduce((s, i) => {
    const p = stockByKey.get(i.productKey)
    return s + ((i.costPrice ?? 0) - (i.salePrice ?? 0)) * Math.max(1, p?.currentStock ?? 0)
  }, 0)
  const ranking = useMemo(
    () => [...catalog.products].filter((p) => p.gananciaHistorica !== 0).sort((a, b) => b.gananciaHistorica - a.gananciaHistorica).slice(0, 10),
    [catalog],
  )
  return (
    <>
      {perdida.length > 0 ? (
        <div className="hero-alert">
          <strong>{fmtInt(perdida.length)} producto{perdida.length === 1 ? '' : 's'} se vende{perdida.length === 1 ? '' : 'n'} por debajo del costo</strong>
          <span>Pérdida estimada por ronda de existencia: {fmtCUP(Math.round(perdidaEstimada))}. Queen sugiere el precio en la subpestaña Precios; no lo cambia sola.</span>
        </div>
      ) : (
        <p className="small"><Icon name="check" size={15} /> Ningún producto con precio y costo vigentes se vende por debajo del costo.</p>
      )}
      <div className="view-chips sub" role="tablist" aria-label="Vista de rentabilidad">
        <button type="button" className={`view-chip ${vista === 'alertas' ? 'active' : ''}`} onClick={() => setVista('alertas')}>Alertas</button>
        <button type="button" className={`view-chip ${vista === 'ranking' ? 'active' : ''}`} onClick={() => setVista('ranking')}>Ranking</button>
      </div>
      {vista === 'alertas' ? (
        <Card>
          <h3>Alertas de margen</h3>
          {perdida.length === 0 && riesgo.length === 0 ? <p className="muted">Sin alertas de pérdida ni de riesgo con los datos actuales.</p> : (
            <div className="list">
              {[...perdida, ...riesgo].map((i) => (
                <div className="row" key={i.productKey}>
                  <span><strong>{i.name}</strong> <span className="small muted">· {i.dept}</span><br /><span className="small muted">Venta {fmtCUP(i.salePrice ?? 0)} · costo {fmtCUP(i.costPrice ?? 0)} · margen {i.marginPct} %</span></span>
                  <span className={`chip ${i.status === 'perdida' ? 'danger' : 'warn'}`}>{i.status === 'perdida' ? 'Pérdida' : 'Riesgo'}</span>
                </div>
              ))}
            </div>
          )}
          <p className="small muted">Las vistas Comparar, Precios y Mermas del original trabajan sobre las fichas de costo y los registros de merma de su base, que no viajan en el respaldo.</p>
        </Card>
      ) : (
        <ChartCard title="Ranking por ganancia histórica" sub="Toca una columna para ver su detalle">
          <ColumnChart
            data={ranking.map((p) => ({ label: p.name, ganancia: p.gananciaHistorica }))}
            series={[{ key: 'ganancia', label: 'Ganancia histórica', color: 'var(--chart-green)' }]}
            ariaLabel="Ganancia histórica por producto"
            angled
          />
        </ChartCard>
      )}
    </>
  )
}

function BarraMl({ catalog }: { catalog: ReturnType<typeof buildProductsCatalog> }) {
  const cantina = catalog.products.filter((p) => p.dept === 'Cantina')
  return (
    <Card>
      <h3>Barra · ml</h3>
      <p className="small muted">
        En el sistema principal, Barra · ml guarda por botella sus mililitros y los ingredientes que la componen
        (esa configuración vive en su base y no viaja en el respaldo). Aquí ves los productos de Cantina del catálogo
        con su existencia y precio, listos para cuando esa configuración se traiga.
      </p>
      {cantina.length === 0 ? (
        <EmptyState icon="flask" title="Sin productos de Cantina" text="Cuando el IPV traiga productos de Cantina aparecerán aquí." />
      ) : (
        <div className="list">
          {cantina.map((p) => (
            <div className="row" key={p.productKey}>
              <span><strong>{p.name}</strong><br /><span className="small muted">{p.menuFamily} · existencia {fmtInt(p.currentStock)} {p.um}</span></span>
              <span className="mono">{p.precioVentaVigente != null ? fmtCUP(p.precioVentaVigente) : '—'}</span>
            </div>
          ))}
        </div>
      )}
      <ChartCard title="Existencia en Cantina" sub="Toca una barra para ver su detalle">
        <RowChart data={cantina.filter((p) => p.currentStock > 0).map((p) => ({ label: p.name, value: p.currentStock }))} ariaLabel="Existencia en Cantina" />
      </ChartCard>
    </Card>
  )
}

function Paquetes({
  refsView, comparisons, isAdmin, onConfirmDerived, onConfirmSuggestion, onSaveManual, onRemove,
}: {
  refsView: ReturnType<typeof derivePackageReferences>
  comparisons: ReturnType<typeof expenseComparisons>
  isAdmin: boolean
  onConfirmDerived: (p: DerivedPackage) => void
  onConfirmSuggestion: (s: PackageSuggestion, units: number, unitLabel: string) => void
  onSaveManual: (ref: PackageReference) => void
  onRemove: (id: string, name: string) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [sugUnits, setSugUnits] = useState<Record<string, string>>({})
  const [sugLabel, setSugLabel] = useState<Record<string, string>>({})

  return (
    <>
      <Card>
        <h3>Referencias de compra</h3>
        <p className="small muted">
          Cómo se compra cada insumo y cuánto rinde: el precio por unidad (y por subunidad —«Usar por anillo»—) se
          DERIVA del paquete, nunca se escribe a mano. Queen compara cada gasto contra el costo justo de la referencia
          y aprende los precios nuevos desde Gastos; las referencias aprendidas se guardan solo cuando las confirmas.
        </p>
        {refsView.packages.length === 0 ? (
          <EmptyState icon="package" title="Sin referencias todavía" text="Añade la primera con «+ Añadir referencia» o espera a que Queen detecte una compra con rendimiento en Gastos." />
        ) : (
          <div className="list">
            {refsView.packages.map((p) => {
              const derived = packageDerivedCosts(p.packageCost ?? 0, p.unitsPerPackage, p.subUnitsPerUnit)
              return (
                <div className="pkg-block" key={p.id}>
                  <div className="row">
                    <span>
                      <strong>{p.name}</strong>{p.variety ? <span className="muted"> · {p.variety}</span> : null}
                      {!p.stored ? <span className="chip warn">Aprendida de Gastos · sin guardar</span> : null}
                      {p.stored && p.aprendida ? <span className="chip">Precio aprendido de Gastos</span> : null}
                      <br />
                      <span className="small muted">
                        {p.packageLabel}: {fmtInt(p.unitsPerPackage)} {p.unitLabel} · última vez {p.lastRecordedOn ? fmtDate(p.lastRecordedOn) : '—'}
                        {p.supplier ? ` · ${p.supplier}` : ''}
                      </span>
                    </span>
                    <span className="mono">
                      {p.packageCost != null ? fmtCUP(p.packageCost) : '—'}
                      {' '}{trendChip(p)}
                    </span>
                  </div>
                  <table className="kv">
                    <tbody>
                      <tr><td>Costo por {p.unitLabel || 'unidad'}</td><td>{p.costPerUnit != null ? fmtCUP(Math.round(p.costPerUnit * 100) / 100) : '—'}</td></tr>
                      {p.subUnitsPerUnit > 0 ? (
                        <tr>
                          <td>Costo por {p.subUnitLabel || 'subunidad'} (Usar por {p.subUnitLabel || 'subunidad'})</td>
                          <td>{derived.subUnitCost != null ? `${fmtCUP(Math.round(derived.subUnitCost * 100) / 100)} · ${fmtInt(derived.totalSubUnits ?? 0)} por ${p.packageLabel}` : '—'}</td>
                        </tr>
                      ) : null}
                      <tr><td>Costo justo (promedio de {fmtInt(p.historyCount)} observaciones)</td><td>{p.fairUnitCost != null ? `${fmtCUP(p.fairUnitCost)} por ${p.unitLabel}` : '—'}{p.minUnitCost != null && p.maxUnitCost != null ? <span className="muted"> · entre {fmtCUP(p.minUnitCost)} y {fmtCUP(p.maxUnitCost)}</span> : null}</td></tr>
                      {p.previousCost != null ? <tr><td>Precio anterior del mismo formato</td><td>{fmtCUP(p.previousCost)}</td></tr> : null}
                    </tbody>
                  </table>
                  {isAdmin ? (
                    <div className="btn-row">
                      {!p.stored ? <button type="button" className="btn primary" onClick={() => onConfirmDerived(p)}>Guardar referencia</button> : null}
                      {p.stored ? <button type="button" className="btn danger" onClick={() => onRemove(p.id, p.name)}>Borrar</button> : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        {isAdmin ? (
          <button type="button" className="btn accent" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cerrar el formulario' : '+ Añadir referencia'}</button>
        ) : (
          <p className="small muted">Tu rol es de solo lectura: las referencias las añade el administrador.</p>
        )}
        {showForm && isAdmin ? <ManualReferenceForm onSave={(ref) => { onSaveManual(ref); setShowForm(false) }} /> : null}
      </Card>

      {refsView.suggestions.length > 0 ? (
        <Card>
          <h3><Icon name="sparkle" size={18} /> Queen sugiere estas referencias</h3>
          <p className="small muted">Compras por formato (ristra, caja, saco…) sin rendimiento legible en el gasto. Pon cuántas unidades trae y se crea la referencia con ese precio.</p>
          <div className="list">
            {refsView.suggestions.map((s) => (
              <div className="pkg-block" key={s.conceptKey}>
                <div className="row">
                  <span><strong>{s.suggestedName}</strong><br /><span className="small muted">Gasto «{s.concept}» del {fmtDate(s.date)} · {fmtInt(s.quantity)} × {fmtCUP(s.unitValue)} · formato: {s.packageLabel}</span></span>
                  <span className="mono">{fmtCUP(s.total)}</span>
                </div>
                {isAdmin ? (
                  <div className="form-inline">
                    <div className="field">
                      <label htmlFor={`sug-u-${s.conceptKey}`}>¿Cuántas unidades trae?</label>
                      <input id={`sug-u-${s.conceptKey}`} inputMode="decimal" value={sugUnits[s.conceptKey] ?? ''} onChange={(e) => setSugUnits((m) => ({ ...m, [s.conceptKey]: e.target.value }))} placeholder="Ej.: 20" />
                    </div>
                    <div className="field">
                      <label htmlFor={`sug-l-${s.conceptKey}`}>Unidad</label>
                      <input id={`sug-l-${s.conceptKey}`} value={sugLabel[s.conceptKey] ?? ''} onChange={(e) => setSugLabel((m) => ({ ...m, [s.conceptKey]: e.target.value }))} placeholder="Ej.: cabezas" />
                    </div>
                    <button
                      type="button" className="btn primary"
                      disabled={!(Number(sugUnits[s.conceptKey]) > 0) || !(sugLabel[s.conceptKey] ?? '').trim()}
                      onClick={() => onConfirmSuggestion(s, Number(sugUnits[s.conceptKey]), (sugLabel[s.conceptKey] ?? '').trim())}
                    >Crear referencia</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {comparisons.length > 0 ? (
        <Card>
          <h3>Queen compara los gastos con las referencias</h3>
          <div className="list">
            {comparisons.slice(0, 12).map((c) => (
              <div className="row" key={c.expenseId}>
                <span><strong>{c.concept}</strong><br /><span className="small muted">{fmtDate(c.date)} · referencia {c.referenceName} ({c.refBasis}: {fmtCUP(c.refPackageCost)})</span></span>
                <span className={`chip ${c.verdict === 'en-linea' ? 'ok' : c.verdict === 'mas-caro' ? 'warn' : ''}`}>
                  {c.verdict === 'en-linea' ? 'En línea' : c.verdict === 'mas-caro' ? `${c.diffPct} % más caro` : `${c.diffPct} % más barato`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  )
}

function ManualReferenceForm({ onSave }: { onSave: (ref: PackageReference) => void }) {
  const [name, setName] = useState('')
  const [variety, setVariety] = useState('')
  const [packageLabel, setPackageLabel] = useState('paquete')
  const [unitLabel, setUnitLabel] = useState('')
  const [units, setUnits] = useState('')
  const [subLabel, setSubLabel] = useState('')
  const [subUnits, setSubUnits] = useState('')
  const [cost, setCost] = useState('')
  const [place, setPlace] = useState('')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const unitsN = Number(units)
    const costN = Number(cost)
    if (!name.trim()) { setFormError('Pon el nombre del insumo (ej.: Ajo, Langosta, Arroz).'); return }
    if (!(unitsN > 0)) { setFormError('Pon cuántas unidades trae el paquete (el rendimiento).'); return }
    if (!(costN > 0)) { setFormError('Pon el precio actual del paquete.'); return }
    const now = Date.now()
    onSave({
      id: `ref-${now}`,
      name: name.trim(), variety: variety.trim(), packageLabel: packageLabel.trim() || 'paquete',
      unitLabel: unitLabel.trim() || 'unidades', unitsPerPackage: unitsN,
      subUnitLabel: subLabel.trim(), subUnitsPerUnit: Number(subUnits) || 0,
      supplier: supplier.trim(), note: note.trim(),
      observations: [{
        id: `obs-${now}`, recordedOn: todayISO(), packageCost: costN,
        unitsPerPackage: unitsN, subUnitsPerUnit: Number(subUnits) || 0,
        place: place.trim(), presentation: packageLabel.trim() || 'paquete',
        note: note.trim(), source: 'manual', sourceRef: '',
      }],
    })
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      {formError ? <div className="error-box" style={{ marginBottom: 10 }}>{formError}</div> : null}
      <div className="form-grid">
        <div className="field"><label htmlFor="ref-name">Insumo</label><input id="ref-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Ajo" /></div>
        <div className="field"><label htmlFor="ref-variety">Variedad (opcional)</label><input id="ref-variety" value={variety} onChange={(e) => setVariety(e.target.value)} placeholder="Ej.: morado" /></div>
        <div className="field"><label htmlFor="ref-label">Se compra por</label><input id="ref-label" value={packageLabel} onChange={(e) => setPackageLabel(e.target.value)} placeholder="ristra, caja, saco…" /></div>
        <div className="field"><label htmlFor="ref-units">Unidades por paquete</label><input id="ref-units" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="Ej.: 20" /></div>
        <div className="field"><label htmlFor="ref-unitlabel">La unidad es</label><input id="ref-unitlabel" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="cabezas, colas, kg…" /></div>
        <div className="field"><label htmlFor="ref-cost">Precio del paquete (CUP)</label><input id="ref-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Ej.: 1000" /></div>
        <div className="field"><label htmlFor="ref-subunits">Subunidades por unidad (opcional)</label><input id="ref-subunits" inputMode="decimal" value={subUnits} onChange={(e) => setSubUnits(e.target.value)} placeholder="Ej.: 12" /></div>
        <div className="field"><label htmlFor="ref-sublabel">La subunidad es</label><input id="ref-sublabel" value={subLabel} onChange={(e) => setSubLabel(e.target.value)} placeholder="anillos, dientes…" /></div>
        <div className="field"><label htmlFor="ref-place">Lugar / presentación</label><input id="ref-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Ej.: mercado, por libras" /></div>
        <div className="field"><label htmlFor="ref-supplier">Proveedor (opcional)</label><input id="ref-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
        <div className="field"><label htmlFor="ref-note">Nota (opcional)</label><input id="ref-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <button type="submit" className="btn primary block">Guardar referencia</button>
      <p className="small muted">El costo por unidad y por subunidad se calcula solo desde el paquete: no se escribe a mano.</p>
    </form>
  )
}
