import { useMemo, useState } from 'react'
import type { StoredData } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import {
  buildProductsCatalog, buildPriceSuggestions,
  type PriceSuggestionItem, type PriceSuggestions,
} from '../lib/productosCore.mjs'
import { fmtCUP } from '../lib/utils'
import '../components/sectionsMirror.css'

/* Laboratorio — PORT del LaboratorioTab del original
   (App.tsx:20277-20291): <section class="lab-shell"> con su
   TabHeader y, dentro de .lab-stack, EN ESTE ORDEN:
   1) LabPriceTable («Tabla de precios por producto»),
   2) SimulationLab («Simulación de prueba»),
   3) IpvLabPanel («IPV de prueba · cuadrarlo a 0 aquí dentro»).
   Las clases .lab-* son las de theme.css del original, portadas
   tal cual a components/sectionsMirror.css.
   Diferencias de arquitectura (documentadas, no disimuladas):
   - Los datos de la tabla salen del núcleo local del clon
     (buildPriceSuggestions sobre el catálogo de los IPV), no del
     endpoint getPriceSuggestions del artefacto; el item del clon
     no trae suggestedProfitCup ni targetMarginPct del servidor:
     la ganancia histórica se deriva de sus promedios registrados
     (ventaPromedioHistorica − costoPromedioHistorico).
   - SimulationLab del original lee los factores históricos por
     categoría del servidor (catFactor); el núcleo del clon no los
     expone, así que la explicación usa la rama de respaldo del
     propio original (meta de margen + gastos generales).
   - IpvLabPanel depende del parser xlsx + ipvRoundTrip + la cola
     de correo del artefacto, que no existen en el clon: el panel
     se muestra con su título y su explicación literal y declara
     que subir el IPV de prueba no se ofrece aquí, para que ningún
     archivo de prueba entre entre los datos reales. */

const LAB_AREA_ORDER = ['Cocina', 'Pizzas', 'Coctelería', 'Bebidas']

function labAreaOf(item: PriceSuggestionItem): string {
  const dept = item.dept.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  if (dept.includes('pizza')) return 'Pizzas'
  if (dept.includes('cantina') || dept.includes('coct')) return 'Coctelería'
  if (item.category === 'bebidas' || dept.includes('bebida') || dept.includes('alcohol')) return 'Bebidas'
  if (dept.includes('elabor') || dept.includes('cocina')) return 'Cocina'
  return item.dept.trim() || 'Otras áreas'
}

const fmt1 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('es-CU')

function LabPriceTable({ suggestions }: { suggestions: PriceSuggestions }) {
  const [category, setCategory] = useState('todas')
  const [productKey, setProductKey] = useState('')
  const [marginInput, setMarginInput] = useState<number | null>(null)

  const data = suggestions
  if (data.items.length === 0) {
    return (
      <div className="lab-card">
        <h3 className="font-bold">Sin productos para la tabla</h3>
        <p className="small muted" style={{ marginTop: 4 }}>Cuando un producto tenga costo y precio de venta vigentes, aparecerá en el desplegable de esta tabla.</p>
      </div>
    )
  }
  const countByArea = new Map<string, number>()
  for (const entry of data.items) countByArea.set(labAreaOf(entry), (countByArea.get(labAreaOf(entry)) ?? 0) + 1)
  const areaNames = [...countByArea.keys()].sort((a, b) => {
    const ia = LAB_AREA_ORDER.indexOf(a)
    const ib = LAB_AREA_ORDER.indexOf(b)
    return (ia < 0 ? LAB_AREA_ORDER.length : ia) - (ib < 0 ? LAB_AREA_ORDER.length : ib) || a.localeCompare(b, 'es')
  })
  const filtered = (category === 'todas' ? [...data.items] : data.items.filter((entry) => labAreaOf(entry) === category))
    .filter((entry) => entry.salePrice != null && entry.costPrice != null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const item = filtered.find((entry) => entry.productKey === productKey) ?? filtered[0]
  if (!item) {
    return (
      <div className="lab-card">
        <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="chart" size={18} /></span> Tabla de precios por producto</h3>
        <p className="small muted" style={{ marginTop: 4 }}>Ningún producto de esta categoría tiene costo y precio de venta vigentes a la vez.</p>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="lab-cat">Categoría</label>
            <select id="lab-cat" className="lab-select" aria-label="Filtrar productos por categoría" value={category} onChange={(e) => { setCategory(e.target.value); setProductKey(''); setMarginInput(null) }}>
              <option value="todas">Todas las categorías ({data.items.length})</option>
              {areaNames.map((name) => <option key={name} value={name}>{name} ({countByArea.get(name) ?? 0})</option>)}
            </select>
          </div>
        </div>
      </div>
    )
  }
  const up10 = (value: number) => Math.ceil(value / 10) * 10
  const impliedPct = item.suggestedPrice != null && item.suggestedPrice > 0 && item.costPrice != null
    ? Math.round(((item.suggestedPrice - item.costPrice) / item.suggestedPrice) * 1000) / 10
    : item.targetPct
  const targetPct = marginInput ?? impliedPct
  const suggested = marginInput == null
    ? (item.suggestedPrice ?? 0)
    : targetPct < 100 && item.costPrice != null
      ? up10(item.costPrice * (1 + data.overheadPct / 100) / (1 - targetPct / 100))
      : 0
  const marginAtSuggested = suggested > 0 && item.costPrice != null ? ((suggested - item.costPrice) / suggested) * 100 : 0
  const estado = item.status === 'perdida'
    ? { texto: 'En pérdida', color: 'var(--danger)', cls: 'lab-badge-bad' }
    : item.status === 'sano'
      ? { texto: 'Buen margen', color: 'var(--success, #16875d)', cls: 'lab-badge-good' }
      : { texto: 'Margen muy pequeño', color: 'var(--gold)', cls: 'lab-badge-warn' }
  const profitCup = item.history?.ventaPromedioHistorica != null && item.history?.costoPromedioHistorico != null
    ? item.history.ventaPromedioHistorica - item.history.costoPromedioHistorico
    : null

  return (
    <div className="lab-card">
      <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="chart" size={18} /></span> Tabla de precios por producto</h3>
      <p className="small muted" style={{ marginTop: 4 }}>Elige un producto y Queen te enseña su costo, su precio de hoy y el que sugiere. La etiqueta de color dice cómo está el margen hoy: verde si es bueno, amarillo si es muy pequeño y rojo si causa pérdida.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="lab-cat">Categoría</label>
          <select id="lab-cat" className="lab-select" aria-label="Filtrar productos por categoría" value={category} onChange={(e) => { setCategory(e.target.value); setProductKey(''); setMarginInput(null) }}>
            <option value="todas">Todas las categorías ({data.items.length})</option>
            {areaNames.map((name) => <option key={name} value={name}>{name} ({countByArea.get(name) ?? 0})</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lab-prod">Producto</label>
          <select id="lab-prod" className="lab-select" aria-label="Elegir producto" value={item.productKey} onChange={(e) => { setProductKey(e.target.value); setMarginInput(null) }}>
            {filtered.map((entry) => <option key={entry.productKey} value={entry.productKey}>{entry.name}</option>)}
          </select>
        </div>
      </div>

      <div className="lab-price-simple" style={{ marginTop: 16 }} role="status" aria-label={`Estado del margen de ${item.name}: ${estado.texto}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 700, margin: 0 }}>{item.name}</p>
            <p className="small muted" style={{ margin: '2px 0 0' }}>{labAreaOf(item)} · {item.dept}</p>
          </div>
          <span className={`lab-badge ${estado.cls}`}>{estado.texto} · margen {fmt1(item.marginPct)} %</span>
        </div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <p className="small muted" style={{ margin: 0 }}>Precio de costo</p>
            <p style={{ fontWeight: 600, margin: '2px 0 0' }}>{fmtCUP(item.costPrice ?? 0)} CUP</p>
          </div>
          <div>
            <p className="small muted" style={{ margin: 0 }}>Precio de venta actual</p>
            <p style={{ fontWeight: 600, margin: '2px 0 0' }}>{fmtCUP(item.salePrice ?? 0)} CUP <span className="small muted">· margen {fmt1(item.marginPct)} %</span></p>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>% de ganancia</p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input
              type="text" inputMode="decimal" min={0} max={99} step="0.5"
              aria-label="% de ganancia para el precio sugerido"
              value={targetPct}
              onChange={(e) => { const v = Number(e.target.value); setMarginInput(Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : 0) }}
              className="lab-mini-input"
              style={{ width: 96 }}
            />
            <span aria-hidden="true">%</span>
          </span>
          <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
            {item.suggestionBasis === 'historico'
              ? <>Queen sugiere manteniendo la ganancia histórica promedio de este producto{profitCup != null ? <>: <strong>{fmtCUP(profitCup)} CUP</strong> por unidad, de sus promedios de compra y venta registrados</> : ''}. El % es el que ese sugerido implica; cámbialo y se recalcula con ese margen.</>
              : <>La meta de {item.category === 'bebidas' ? 'bebidas' : 'elaborados'} que propone Queen (este producto aún no tiene historial para promediar); cámbiala y el precio sugerido se recalcula.</>}
            {' '}El margen actual del producto es {fmt1(item.marginPct)} %.
          </span>
        </div>
        <div className="lab-price-suggested" style={{ marginTop: 16 }}>
          <p className="small" style={{ fontWeight: 600, margin: 0 }}><Icon name="sparkle" size={14} /> Precio que sugiere Queen</p>
          <p className="lab-price-suggested-value" style={{ color: estado.color }}>{fmtCUP(suggested)} CUP</p>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Con ese precio el margen sería {fmt1(marginAtSuggested)} %. Hoy se vende a {fmtCUP(item.salePrice ?? 0)} CUP.</p>
        </div>
      </div>

      <div className="lab-explain" style={{ marginTop: 10 }}>
        <p className="lab-explain-text small muted" style={{ margin: 0 }}>
          {item.suggestionBasis === 'historico'
            ? <>Por qué Queen sugiere {fmtCUP(suggested)} CUP: la ganancia histórica promedio de este producto es <strong>{fmtCUP(profitCup ?? 0)} CUP</strong> por unidad — venta promedio {fmtCUP(item.history?.ventaPromedioHistorica ?? item.salePrice ?? 0)} CUP menos costo promedio {fmtCUP(item.history?.costoPromedioHistorico ?? item.costPrice ?? 0)} CUP, de su registro real — y Queen la mantiene sobre el costo, redondeado hacia arriba a la decena.</>
            : <>Por qué Queen sugiere {fmtCUP(suggested)} CUP: costo {fmtCUP(item.costPrice ?? 0)} CUP + gastos generales {fmt1(data.overheadPct)} % = mínimo sin pérdida {fmtCUP(item.breakEvenPrice ?? 0)} CUP; ese mínimo se reparte con el % de ganancia de la tabla y se redondea hacia arriba a la decena. Este producto aún no tiene historial para promediar su ganancia.</>}
          {' '}Es una sugerencia del laboratorio: no cambia ningún precio real.
        </p>
      </div>

      {item.history ? (
        <div className="lab-inset" style={{ marginTop: 12 }} aria-label={`Sugerencia de Queen según el historial de ${item.name}`}>
          <p className="small" style={{ fontWeight: 600, margin: 0 }}><Icon name="sparkle" size={14} /> Queen según su historial</p>
          {item.history.costoPromedioHistorico != null || item.history.ventaPromedioHistorica != null ? (
            <>
              <div className="grid-3" style={{ marginTop: 8 }}>
                <div>
                  <p className="small muted" style={{ margin: 0 }}>Costo de compra promedio histórico</p>
                  <p style={{ fontWeight: 600, margin: '2px 0 0' }}>{item.history.costoPromedioHistorico != null ? `${fmtCUP(item.history.costoPromedioHistorico)} CUP` : '—'}</p>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>Promedio ponderado de {item.history.entradasRegistradas} entrada{item.history.entradasRegistradas === 1 ? '' : 's'} registrada{item.history.entradasRegistradas === 1 ? '' : 's'} en los IPV</p>
                </div>
                <div>
                  <p className="small muted" style={{ margin: 0 }}>Precio de venta promedio histórico</p>
                  <p style={{ fontWeight: 600, margin: '2px 0 0' }}>{item.history.ventaPromedioHistorica != null ? `${fmtCUP(item.history.ventaPromedioHistorica)} CUP` : '—'}</p>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>Promedio de {item.history.preciosVentaRegistrados} precio{item.history.preciosVentaRegistrados === 1 ? '' : 's'} de venta registrado{item.history.preciosVentaRegistrados === 1 ? '' : 's'}</p>
                </div>
                <div>
                  <p className="small muted" style={{ margin: 0 }}>Margen histórico real</p>
                  <p style={{ fontWeight: 600, margin: '2px 0 0' }}>{item.history.margenHistoricoPct != null ? `${fmt1(item.history.margenHistoricoPct)} %` : '—'}</p>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>Ganancia ÷ venta de todos los IPV, en {item.history.diasConVenta} día{item.history.diasConVenta === 1 ? '' : 's'} con venta</p>
                </div>
              </div>
              {item.history.precioSugeridoHistorico != null && item.history.margenHistoricoPct != null ? (
                <p className="small" style={{ marginTop: 10 }}>
                  Sugerencia según historial: <strong>{fmtCUP(item.history.precioSugeridoHistorico)} CUP</strong> — con el costo de hoy y los gastos generales, ese precio mantiene el margen que este producto ha dejado de promedio ({fmt1(item.history.margenHistoricoPct)} %).{' '}
                  <button type="button" className="btn" onClick={() => setMarginInput(Math.round(item.history!.margenHistoricoPct! * 10) / 10)} aria-label={`Usar el margen histórico de ${item.name} en la tabla`}>Usar ese margen en la tabla</button>
                </p>
              ) : (
                <p className="small muted" style={{ marginTop: 10 }}>Con los promedios de arriba aún no sale una sugerencia histórica: hace falta el margen real que el producto dejó en los IPV.</p>
              )}
              <p className="small muted" style={{ marginTop: 6 }}>Todo sale del registro histórico que el producto ya tiene en el sistema (entradas y precios de los IPV importados y cambios guardados): Queen lo promedia y sugiere en base a eso, sin inventar ningún número.</p>
            </>
          ) : (
            <p className="small muted" style={{ marginTop: 6 }}>Este producto todavía no tiene historial de precios registrado en el sistema, así que Queen no promedia ni sugiere nada desde el historial: en cuanto tenga entradas y precios en los IPV, aquí aparecerán sus promedios y la sugerencia en base a ellos.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function SimulationLab({ suggestions }: { suggestions: PriceSuggestions }) {
  const [cost, setCost] = useState(0)
  const [price, setPrice] = useState(0)
  const margin = price > 0 ? ((price - cost) / price) * 100 : null
  const profit = price - cost
  const up10 = (value: number) => Math.ceil(value / 10) * 10
  const queenSuggests = (cat: 'elaborados' | 'bebidas'): number | null => {
    if (!(cost > 0)) return null
    const target = cat === 'bebidas' ? suggestions.targets.bebidas : suggestions.targets.elaborados
    return target < 100 ? up10(cost * (1 + suggestions.overheadPct / 100) / (1 - target / 100)) : null
  }
  const suggestElab = queenSuggests('elaborados')
  const suggestBeb = queenSuggests('bebidas')
  const marginAtSuggest = (s: number | null) => (s != null && s > 0 ? ((s - cost) / s) * 100 : null)
  const queenNote = (suggestElab != null || suggestBeb != null) ? (
    <p className="lab-queen-note small" style={{ marginTop: 8, textAlign: 'left' }}>
      <strong><Icon name="sparkle" size={14} /> Queen sugiere</strong>
      {suggestElab != null ? <> · <strong>{fmtCUP(suggestElab)} CUP</strong> en elaborados{marginAtSuggest(suggestElab) != null ? <> (margen {fmt1(marginAtSuggest(suggestElab))} %)</> : null}</> : null}
      {suggestBeb != null ? <> · <strong>{fmtCUP(suggestBeb)} CUP</strong> en bebidas{marginAtSuggest(suggestBeb) != null ? <> (margen {fmt1(marginAtSuggest(suggestBeb))} %)</> : null}</> : null}
    </p>
  ) : null
  const queenWhy = cost > 0 ? (
    <p className="small muted" style={{ marginTop: 8, textAlign: 'left' }}>
      Por qué: Queen aplica a tu compra la meta de margen de cada categoría con los gastos generales — elaborados: meta {fmt1(suggestions.targets.elaborados)} % · bebidas: meta {fmt1(suggestions.targets.bebidas)} % — y redondea hacia arriba a la decena.
      {price > 0 && margin != null ? ` Tu precio de venta de prueba es ${fmtCUP(price)} CUP (margen ${fmt1(margin)} %).` : ''}
    </p>
  ) : null

  return (
    <div className="lab-card">
      <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="sparkle" size={18} /></span> Simulación de prueba</h3>
      <p className="small muted" style={{ marginTop: 4 }}>Pon el precio de compra y el de venta y te calculo el margen. Es solo una prueba: no toca ningún dato real.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="lab-sim-compra">Precio de compra · CUP</label>
          <input id="lab-sim-compra" type="number" min={0} step="any" placeholder="0" value={cost || ''} onChange={(e) => setCost(Number(e.target.value) || 0)} />
          <span className="small muted">Lo que cuesta comprar el producto, en CUP. Solo para esta simulación.</span>
        </div>
        <div className="field">
          <label htmlFor="lab-sim-venta">Precio de venta · CUP</label>
          <input id="lab-sim-venta" type="number" min={0} step="any" placeholder="0" value={price || ''} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
          <span className="small muted">El precio al que se vendería el producto, en CUP. Solo para esta simulación.</span>
        </div>
      </div>
      {margin != null ? (
        <div className="lab-inset lab-result" style={{ marginTop: 16 }} aria-live="polite" aria-label="Resultado de la simulación">
          <p className="small muted" style={{ margin: 0 }}>Margen</p>
          <p className="lab-result-value" style={margin < 0 ? { color: 'var(--danger)' } : undefined}>{fmt1(margin)} %</p>
          <p className="small" style={{ marginTop: 4 }}>
            {profit >= 0
              ? <>Ganancia de <strong>{fmtCUP(profit)} CUP</strong> por unidad</>
              : <>Pérdida de <strong>{fmtCUP(Math.abs(profit))} CUP</strong> por unidad</>}
          </p>
          {queenNote}
          {queenWhy}
        </div>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 12 }}>Escribe el precio de venta para ver el % de margen.</p>
          {queenNote}
          {queenWhy}
        </>
      )}
    </div>
  )
}

export default function Laboratorio({ data }: { data: StoredData }) {
  const catalog = useMemo(() => buildProductsCatalog(data.days), [data.days])
  const suggestions = useMemo(() => buildPriceSuggestions(catalog), [catalog])

  return (
    <section aria-label="Laboratorio" className="lab-shell">
      <TabHeader
        icon="flask"
        title="Laboratorio"
        desc="Espacio de pruebas aislado: simula precios y cuadra IPV de prueba sin tocar los datos reales."
        badge={TAB_BADGES.laboratorio}
      />
      <div className="lab-stack">
        <LabPriceTable suggestions={suggestions} />
        <SimulationLab suggestions={suggestions} />

        <div className="lab-card">
          <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="doc" size={18} /></span> IPV de prueba · cuadrarlo a 0 aquí dentro</h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            Sube un IPV con problemas —diferencias de precio de compra o de venta, un Desglose que no suma, cuentas que no coinciden— y el laboratorio lo revisa completo y <strong>lo cuadra a 0 ajustando las cifras que haga falta</strong>: importes y precios de productos y entradas, total de cuentas, ventas del Desglose y total de fondos. Aquí dentro sí se ajustan cifras; en los datos reales el sistema nunca toca un número del IPV. Todo pasa sobre la copia leída en esta pantalla: <strong>el archivo original no se modifica, nada se importa y nada se guarda</strong>. Al final puedes descargar el resultado como un Excel nuevo, ya corregido y cuadrado a 0, o enviarlo adjunto al correo configurado.
          </p>
          <p className="small muted">
            En esta copia externa ese panel todavía no se ofrece: el lector de IPV de prueba, el generador del Excel corregido y la cola de correo del sistema principal no están desplegados aquí, y subir el archivo por la vía normal podría colar un IPV de prueba entre los datos reales. No se simula: cuando esas piezas estén, este panel funcionará como el del original.
          </p>
        </div>
      </div>
    </section>
  )
}
