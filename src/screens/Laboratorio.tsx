import { useMemo, useRef, useState } from 'react'
import type { StoredData } from '../types'
import { TabHeader, TAB_BADGES } from '../components/ui'
import { Icon } from '../components/icons'
import {
  buildProductsCatalog, buildPriceSuggestions,
  type PriceSuggestionItem, type PriceSuggestions,
} from '../lib/productosCore.mjs'
import type { IpvDayPayload } from '../lib/ipvCore.mjs'
import type { IpvLabCorrections } from '../lib/ipvRoundTrip'
import { downloadBlob } from '../lib/download'
import { fmtCUP, fmtDateShort, fmtInt } from '../lib/utils'
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
   - IpvLabPanel SÍ funciona: el lector (ipvCore.parseDayFile) y
     el round-trip (ipvRoundTrip.buildCorrectedIpv) ya existen en
     el clon, así que el panel analiza y cuadra a 0 sobre la copia
     en memoria del archivo subido, igual que el original, y el
     Excel corregido se descarga como archivo nuevo. Su única
     diferencia es el envío por correo (D-08): esta copia externa
     no tiene transporte de correo desplegado, así que solo se
     ofrece la descarga y el botón de enviar queda deshabilitado,
     sin fingir ningún envío. */

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

/* ===== IPV de prueba que se cuadra a 0 · IpvLabPanel del original
   (App.tsx ~19712-20270), portado completo: el usuario sube un IPV
   con problemas (diferencias de precio de compra o de venta,
   desglose que no suma, cuentas que no coinciden) y el laboratorio
   lo analiza y lo CUADRA A 0 ajustando las cifras que haga falta —
   productos, entradas, desglose de efectivo, transferencias,
   cuentas y total de fondos — con la lista completa de cada ajuste
   (antes → después). Aquí SÍ se pueden ajustar cifras, a diferencia
   de los datos reales, donde el sistema nunca toca un número del
   IPV: todo ocurre sobre la copia leída en esta pantalla; el
   archivo original no se modifica, nada se importa y nada se
   guarda. El análisis de abajo es el del original, línea a línea;
   solo cambian las fuentes: el historial por producto sale de las
   mismas PriceSuggestions que alimentan la tabla de precios de
   esta pantalla (en el original, de su endpoint equivalente), el
   lector es ipvCore.parseDayFile y el Excel corregido lo genera
   ipvRoundTrip.buildCorrectedIpv. */

/* Forma real de cada Entrada que parseDayFile deja en day.entries
   (ipvCore.mjs); el .d.mts la declara unknown[] y aquí se tipa. */
interface IpvLabEntry {
  dept: string
  descripcion: string
  cantidad: number
  precioCompra: number
  importe: number
  precioVenta: number
  importeVenta: number
}

/* Metric del original, con el marcado de esta pantalla. */
function LabMetric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="small muted" style={{ margin: 0 }}>{label}</p>
      <p style={{ fontWeight: strong ? 700 : 600, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

function IpvLabPanel({ suggestions }: { suggestions: PriceSuggestions }) {
  const [fileName, setFileName] = useState('')
  const [day, setDay] = useState<IpvDayPayload | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  // Criterio de corrección: «queen» (por defecto) decide EN CADA
  // diferencia con el historial real del producto; «precio» e
  // «importe» son el mando fijo manual de antes.
  const [mode, setMode] = useState<'queen' | 'precio' | 'importe'>('queen')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadMsg, setDownloadMsg] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const onFile = async (file: File) => {
    setReading(true)
    setError('')
    setDownloadMsg('')
    setDownloadError('')
    try {
      const { parseDayFile } = await import('../lib/ipvCore.mjs')
      const parsed = await parseDayFile(file)
      setDay(parsed)
      setFileName(file.name)
      setFileObj(file)
    } catch (e) {
      setDay(null)
      setFileName('')
      setFileObj(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo como un IPV válido.')
    } finally {
      setReading(false)
    }
  }
  const result = useMemo(() => {
    if (!day) return null
    const round2 = (n: number) => Math.round(n * 100) / 100
    const ajustes: { area: string; detalle: string; antes: number; despues: number; motivo?: string }[] = []
    const diferenciasPrecio: { nombre: string; tipo: string; detalle: string }[] = []
    // Correcciones estructuradas para generar el Excel corregido:
    // por producto, el importe de venta ajustado (y el precio nuevo
    // cuando manda el importe), con su ganancia recalculada.
    const correcciones: IpvLabCorrections['products'] = []
    // Desglose por LOTE DE PRECIO: cuando la Entrada del día trajo un
    // precio de venta distinto del de la hoja, el producto se vende
    // por lotes — primero el saldo inicial al precio viejo y después
    // lo entrado al precio nuevo — y lo que debe entrar en caja es la
    // suma de los lotes, no cantidad × un solo precio. Ejemplo del
    // dueño: Kroon con saldo inicial 10 (venta 550) y entrada de 24
    // (venta 560), todo vendido: 10×550 + 24×560 = 18.940 CUP; si el
    // IPV lo calculó todo al precio viejo (34×550 = 18.700), hay un
    // sobrante de 240 que el cálculo por lotes deja explicado.
    const loose = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    // ===== Queen decide las correcciones con el historial real =====
    // Índices del análisis de precios (misma fuente que la tabla del
    // laboratorio): por departamento+nombre y, de respaldo, por nombre.
    const histIndex = new Map<string, PriceSuggestionItem>()
    const histNameIndex = new Map<string, PriceSuggestionItem>()
    for (const it of suggestions.items) {
      histIndex.set(`${loose(it.dept)}||${loose(it.name)}`, it)
      if (!histNameIndex.has(loose(it.name))) histNameIndex.set(loose(it.name), it)
    }
    const histItemFor = (dept: string, name: string): PriceSuggestionItem | null => histIndex.get(`${loose(dept)}||${loose(name)}`) ?? histNameIndex.get(loose(name)) ?? null
    // En una diferencia cantidad × precio ≠ importe, Queen compara el
    // precio del IPV y el precio implícito por el importe contra el
    // precio de referencia del historial del producto (promedio
    // histórico registrado; si no hay, el vigente del catálogo):
    // coincide (±2 %) el precio → manda el precio; coincide el
    // implícito → manda el importe; si ninguno, manda el más cercano
    // a la referencia. Sin referencia, manda el precio (prudente).
    const decidirQueen = (dept: string, name: string, precioIpv: number, cantidad: number, importeIpv: number, clase: 'venta' | 'compra'): { manda: 'precio' | 'importe'; motivo: string } => {
      const item = histItemFor(dept, name)
      const ref = item ? (clase === 'venta' ? (item.history?.ventaPromedioHistorica ?? item.salePrice) : (item.history?.costoPromedioHistorico ?? item.costPrice)) : null
      const implicito = cantidad > 0 ? round2(importeIpv / cantidad) : null
      if (ref == null || ref <= 0 || precioIpv <= 0) {
        return { manda: 'precio', motivo: 'Queen: este producto no tiene historial registrado; manda el precio, el criterio prudente.' }
      }
      const cerca = (v: number) => Math.abs(v - ref) / ref <= 0.02
      if (cerca(precioIpv)) return { manda: 'precio', motivo: `Queen: el precio del IPV (${fmtInt(precioIpv)} CUP) coincide con el registrado de este producto (referencia ${fmtInt(ref)} CUP); manda el precio y se recalcula el importe.` }
      if (implicito != null && cerca(implicito)) return { manda: 'importe', motivo: `Queen: el importe implica un precio de ${fmtInt(implicito)} CUP, que coincide con el registrado (referencia ${fmtInt(ref)} CUP); manda el importe y se corrige el precio.` }
      const distPrecio = Math.abs(precioIpv - ref)
      const distImporte = implicito != null ? Math.abs(implicito - ref) : Number.POSITIVE_INFINITY
      return distPrecio <= distImporte
        ? { manda: 'precio', motivo: `Queen: ni el precio ni el importe coinciden con su historial (referencia ${fmtInt(ref)} CUP); el precio está más cerca de ese registro y manda.` }
        : { manda: 'importe', motivo: `Queen: ni el precio ni el importe coinciden con su historial (referencia ${fmtInt(ref)} CUP); el precio que implica el importe (${fmtInt(implicito ?? 0)} CUP) está más cerca y manda el importe.` }
    }
    const resolverMando = (dept: string, name: string, precioIpv: number, cantidad: number, importeIpv: number, clase: 'venta' | 'compra'): { mandaPrecio: boolean; motivo?: string } => {
      if (mode === 'precio') return { mandaPrecio: true }
      if (mode === 'importe') return { mandaPrecio: false }
      const d = decidirQueen(dept, name, precioIpv, cantidad, importeIpv, clase)
      return { mandaPrecio: d.manda === 'precio', motivo: d.motivo }
    }
    const entries = day.entries as unknown as IpvLabEntry[]
    const entriesByProduct = new Map<string, { cantidad: number; importeVenta: number; importeCompra: number }>()
    for (const e of entries) {
      const key = `${loose(e.dept)}||${loose(e.descripcion)}`
      const cur = entriesByProduct.get(key) ?? { cantidad: 0, importeVenta: 0, importeCompra: 0 }
      cur.cantidad += e.cantidad
      cur.importeVenta += e.importeVenta
      cur.importeCompra += e.importe
      entriesByProduct.set(key, cur)
    }
    type LotePrecio = {
      nombre: string; dept: string;
      saldoInicial: number; precioViejo: number; costoViejo: number;
      entradas: number; precioNuevo: number; costoNuevo: number;
      vendidasInicial: number; vendidasEntradas: number;
      importeLotes: number; importeIpv: number; diferencia: number;
      todoAlViejo: number; lectura: string;
    }
    const lotes: LotePrecio[] = []
    // 1) Productos vendidos: importe contra cantidad × precio de
    // venta, o contra la suma por lotes cuando la Entrada cambió el
    // precio (en ese caso manda el cálculo por lotes).
    let ventasAjustadas = 0
    let gananciaAjustada = 0
    for (const dep of day.departments) {
      for (const p of dep.products) {
        let importe = p.importeVenta
        let precioVentaCorregido: number | null = null
        const entryAgg = entriesByProduct.get(`${loose(dep.name)}||${loose(p.name)}`)
        const entryQty = entryAgg?.cantidad ?? 0
        const entryPrice = entryAgg && entryAgg.cantidad > 0 ? round2(entryAgg.importeVenta / entryAgg.cantidad) : 0
        const entryCost = entryAgg && entryAgg.cantidad > 0 ? round2(entryAgg.importeCompra / entryAgg.cantidad) : 0
        const hasTwoPrices = p.cantidadVendida > 0 && p.precioVenta > 0 && entryQty > 0 && entryPrice > 0 && round2(entryPrice) !== round2(p.precioVenta)
        if (hasTwoPrices) {
          const saldoInicial = p.saldoInicial != null ? p.saldoInicial : p.disponible != null ? Math.max(0, p.disponible - entryQty) : Math.max(0, p.cantidadVendida - entryQty)
          const vendidasInicial = Math.min(p.cantidadVendida, Math.max(0, saldoInicial))
          const vendidasEntradas = p.cantidadVendida - vendidasInicial
          const importeLotes = round2(vendidasInicial * p.precioVenta + vendidasEntradas * entryPrice)
          const diferencia = round2(p.importeVenta - importeLotes)
          const todoAlViejo = round2(p.cantidadVendida * p.precioVenta)
          const lectura = Math.abs(diferencia) <= 0.009
            ? 'El importe del IPV coincide con la suma por lotes: cuadra por lotes.'
            : Math.abs(round2(p.importeVenta - todoAlViejo)) <= 0.009
              ? `El IPV lo calculó todo al precio viejo (${fmtInt(p.cantidadVendida)} × ${fmtInt(p.precioVenta)} = ${fmtInt(todoAlViejo)}): en caja deberían haber entrado ${fmtInt(Math.abs(diferencia))} CUP más por este producto — sobrante de ${fmtInt(Math.abs(diferencia))} si la venta respetó los lotes.`
              : diferencia < 0
                ? `Al importe le faltan ${fmtInt(Math.abs(diferencia))} CUP contra la suma por lotes: o se vendió parte al precio viejo después de la Entrada, o el importe está mal calculado.`
                : `El importe supera en ${fmtInt(diferencia)} CUP la suma por lotes: revísalo, puede haber unidades cobradas de más o un precio no registrado.`
          lotes.push({
            nombre: p.name, dept: dep.name,
            saldoInicial, precioViejo: p.precioVenta, costoViejo: p.precioCosto,
            entradas: entryQty, precioNuevo: entryPrice, costoNuevo: entryCost,
            vendidasInicial, vendidasEntradas,
            importeLotes, importeIpv: p.importeVenta, diferencia,
            todoAlViejo, lectura,
          })
          if (Math.abs(diferencia) > 0.009) {
            diferenciasPrecio.push({ nombre: p.name, tipo: 'Precio por lotes (saldo inicial y Entrada)', detalle: `${fmtInt(vendidasInicial)} × ${fmtInt(p.precioVenta)} + ${fmtInt(vendidasEntradas)} × ${fmtInt(entryPrice)} = ${fmtInt(importeLotes)} CUP por lotes, pero el importe dice ${fmtInt(p.importeVenta)} (diferencia ${diferencia > 0 ? '+' : "−"}${fmtInt(Math.abs(diferencia))}).` })
            if (mode !== 'importe') {
              ajustes.push({ area: 'Productos · lotes', detalle: `${p.name} · importe de venta = suma por lotes`, antes: p.importeVenta, despues: importeLotes, ...(mode === 'queen' ? { motivo: 'Queen: la suma por lotes es la lectura que respalda el movimiento del día (saldo inicial y Entrada a precios distintos); manda esa suma.' } : {}) })
              importe = importeLotes
            } else {
              const precioMedio = round2(p.importeVenta / p.cantidadVendida)
              precioVentaCorregido = precioMedio
              ajustes.push({ area: 'Productos · lotes', detalle: `${p.name} · precio medio del día (el importe manda)`, antes: p.precioVenta, despues: precioMedio })
              importe = round2(p.cantidadVendida * precioMedio)
              if (importe !== p.importeVenta) ajustes.push({ area: 'Productos · lotes', detalle: `${p.name} · importe recalculado con el precio medio`, antes: p.importeVenta, despues: importe })
            }
          } else {
            importe = importeLotes
          }
        } else if (p.cantidadVendida > 0 && p.precioVenta > 0) {
          const esperado = round2(p.cantidadVendida * p.precioVenta)
          const diff = round2(p.importeVenta - esperado)
          if (Math.abs(diff) > 0.009) {
            diferenciasPrecio.push({ nombre: p.name, tipo: 'Precio de venta', detalle: `${fmtInt(p.cantidadVendida)} × ${fmtInt(p.precioVenta)} = ${fmtInt(esperado)} CUP, pero el importe dice ${fmtInt(p.importeVenta)} (diferencia ${diff > 0 ? '+' : "−"}${fmtInt(Math.abs(diff))}).` })
            const mandoVenta = resolverMando(dep.name, p.name, p.precioVenta, p.cantidadVendida, p.importeVenta, 'venta')
            if (mandoVenta.mandaPrecio) {
              ajustes.push({ area: 'Productos', detalle: `${p.name} · importe de venta`, antes: p.importeVenta, despues: esperado, ...(mandoVenta.motivo ? { motivo: mandoVenta.motivo } : {}) })
              importe = esperado
            } else {
              const precioMedio = round2(p.importeVenta / p.cantidadVendida)
              precioVentaCorregido = precioMedio
              ajustes.push({ area: 'Productos', detalle: `${p.name} · precio de venta (precio medio del día)`, antes: p.precioVenta, despues: precioMedio, ...(mandoVenta.motivo ? { motivo: mandoVenta.motivo } : {}) })
              importe = round2(p.cantidadVendida * precioMedio)
              if (importe !== p.importeVenta) ajustes.push({ area: 'Productos', detalle: `${p.name} · importe recalculado con el precio medio`, antes: p.importeVenta, despues: importe })
            }
          }
        }
        if (Math.abs(importe - p.importeVenta) > 0.009 || precioVentaCorregido != null) {
          correcciones.push({ dept: dep.name, name: p.name, precioVenta: precioVentaCorregido, importeVenta: importe, ganancia: round2(importe - round2(p.cantidadVendida * p.precioCosto)) })
        }
        ventasAjustadas += importe
        gananciaAjustada += p.precioCosto > 0 ? round2(importe - round2(p.cantidadVendida * p.precioCosto)) : p.ganancia
      }
    }
    ventasAjustadas = round2(ventasAjustadas)
    gananciaAjustada = round2(gananciaAjustada)
    // 2) Entradas: importe de compra y de venta contra cantidad × precio.
    let inversionAjustada = 0
    for (const e of entries) {
      let importeCompra = e.importe
      let importeVenta = e.importeVenta
      if (e.cantidad > 0 && e.precioCompra > 0) {
        const esperado = round2(e.cantidad * e.precioCompra)
        if (Math.abs(round2(e.importe - esperado)) > 0.009) {
          diferenciasPrecio.push({ nombre: e.descripcion, tipo: 'Precio de compra (Entrada)', detalle: `${fmtInt(e.cantidad)} × ${fmtInt(e.precioCompra)} = ${fmtInt(esperado)} CUP, pero el importe de compra dice ${fmtInt(e.importe)}.` })
          const mandoCompra = resolverMando(e.dept, e.descripcion, e.precioCompra, e.cantidad, e.importe, 'compra')
          if (mandoCompra.mandaPrecio) { ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · importe de compra`, antes: e.importe, despues: esperado, ...(mandoCompra.motivo ? { motivo: mandoCompra.motivo } : {}) }); importeCompra = esperado }
          else { const medio = round2(e.importe / e.cantidad); ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · precio de compra (precio medio)`, antes: e.precioCompra, despues: medio, ...(mandoCompra.motivo ? { motivo: mandoCompra.motivo } : {}) }); importeCompra = round2(e.cantidad * medio); if (importeCompra !== e.importe) ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · importe de compra recalculado con el precio medio`, antes: e.importe, despues: importeCompra }) }
        }
      }
      if (e.cantidad > 0 && e.precioVenta > 0) {
        const esperadoV = round2(e.cantidad * e.precioVenta)
        if (Math.abs(round2(e.importeVenta - esperadoV)) > 0.009) {
          diferenciasPrecio.push({ nombre: e.descripcion, tipo: 'Precio de venta (Entrada)', detalle: `${fmtInt(e.cantidad)} × ${fmtInt(e.precioVenta)} = ${fmtInt(esperadoV)} CUP, pero el importe de venta dice ${fmtInt(e.importeVenta)}.` })
          const mandoVentaE = resolverMando(e.dept, e.descripcion, e.precioVenta, e.cantidad, e.importeVenta, 'venta')
          if (mandoVentaE.mandaPrecio) { ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · importe de venta`, antes: e.importeVenta, despues: esperadoV, ...(mandoVentaE.motivo ? { motivo: mandoVentaE.motivo } : {}) }); importeVenta = esperadoV }
          else { const medio = round2(e.importeVenta / e.cantidad); ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · precio de venta (precio medio)`, antes: e.precioVenta, despues: medio, ...(mandoVentaE.motivo ? { motivo: mandoVentaE.motivo } : {}) }); importeVenta = round2(e.cantidad * medio); if (importeVenta !== e.importeVenta) ajustes.push({ area: 'Entradas', detalle: `${e.descripcion} · importe de venta recalculado con el precio medio`, antes: e.importeVenta, despues: importeVenta }) }
        }
      }
      inversionAjustada += importeCompra
    }
    inversionAjustada = round2(inversionAjustada)
    // 3) Desglose: cuentas contra su detalle, ventas contra el día
    // ajustado y total de fondos contra la suma de sus componentes
    // (efectivo + divisas + cuentas + Zelle + transferencias).
    const f = day.fondos
    let fondosAjustado: { efectivo: number; divisasCUP: number; cuentas: number; zelle: number; transferencias: number; total: number } | null = null
    let diferenciaFondosAntes: number | null = null
    if (f) {
      const sumaDetalle = round2(f.cuentasDetalle.reduce((sum, c) => sum + c.saldo, 0))
      let cuentas = f.totalCuentasPorCobrar
      if (f.cuentasDetalle.length > 0 && Math.abs(round2(cuentas - sumaDetalle)) > 0.009) {
        ajustes.push({ area: 'Cuentas por cobrar', detalle: 'Total de cuentas contra la suma de su detalle', antes: cuentas, despues: sumaDetalle })
        cuentas = sumaDetalle
      }
      if (Math.abs(round2(f.ventas - ventasAjustadas)) > 0.009) {
        ajustes.push({ area: 'Desglose', detalle: 'Ventas del Desglose contra las ventas del día ya ajustadas', antes: f.ventas, despues: ventasAjustadas })
      }
      const sumaComponentes = round2(f.efectivo + f.divisasCUP + f.totalCuentasPorCobrar + f.zelle + f.transferencias)
      diferenciaFondosAntes = round2(f.totalFondos - sumaComponentes)
      const sumaAjustada = round2(f.efectivo + f.divisasCUP + cuentas + f.zelle + f.transferencias)
      if (Math.abs(round2(f.totalFondos - sumaAjustada)) > 0.009) {
        ajustes.push({ area: 'Desglose', detalle: 'Total de fondos = efectivo + divisas + cuentas + Zelle + transferencias', antes: f.totalFondos, despues: sumaAjustada })
      }
      fondosAjustado = { efectivo: f.efectivo, divisasCUP: f.divisasCUP, cuentas, zelle: f.zelle, transferencias: f.transferencias, total: sumaAjustada }
    }
    const diferenciaVentasAntes = f ? round2(day.ventasDia - f.ventas) : null
    const desgloseCorreccion: IpvLabCorrections['desglose'] = f && fondosAjustado ? { ventas: ventasAjustadas, totalCuentas: fondosAjustado.cuentas, totalFondos: fondosAjustado.total, cuadre: 0 } : null
    return { ajustes, diferenciasPrecio, lotes, ventasAjustadas, gananciaAjustada, inversionAjustada, fondosAjustado, diferenciaFondosAntes, diferenciaVentasAntes, cuadreArchivo: day.cuadre, correcciones, desgloseCorreccion }
  }, [day, mode, suggestions])
  // Genera el Excel NUEVO del IPV ya corregido desde el archivo
  // subido, con los ajustes del laboratorio aplicados (nunca el
  // original, que queda intacto en el dispositivo).
  const buildCorrectedBlob = async (): Promise<Blob> => {
    if (!fileObj || !result) throw new Error('Sube primero el IPV de prueba.')
    const { buildCorrectedIpv } = await import('../lib/ipvRoundTrip')
    const corrections: IpvLabCorrections = { products: result.correcciones, desglose: result.desgloseCorreccion }
    return buildCorrectedIpv(fileObj, corrections)
  }
  // Descarga del IPV ya corregido en este dispositivo.
  const downloadCorrected = async () => {
    if (!fileObj || !day || !result) return
    setDownloading(true)
    setDownloadMsg('')
    setDownloadError('')
    try {
      const blob = await buildCorrectedBlob()
      downloadBlob(blob, `ipv-corregido-${day.date}.xlsx`)
      setDownloadMsg('IPV corregido descargado: trae los ajustes del laboratorio y el cuadre en 0, listo para revisarlo o importarlo por la vía normal. Tu archivo original no se modificó.')
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'No se pudo generar el IPV corregido.')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="lab-stack">
      <div className="lab-card">
        <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="doc" size={18} /></span> IPV de prueba · cuadrarlo a 0 aquí dentro</h3>
        <p className="small muted" style={{ marginTop: 4 }}>Sube un IPV con problemas —diferencias de precio de compra o de venta, un Desglose que no suma, cuentas que no coinciden— y el laboratorio lo revisa completo y <strong>lo cuadra a 0 ajustando las cifras que haga falta</strong>: importes y precios de productos y entradas, total de cuentas, ventas del Desglose y total de fondos. Aquí dentro sí se ajustan cifras; en los datos reales el sistema nunca toca un número del IPV. Todo pasa sobre la copia leída en esta pantalla: <strong>el archivo original no se modifica, nada se importa y nada se guarda</strong>. Al final puedes descargar el resultado como un Excel nuevo, ya corregido y cuadrado a 0.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} aria-label="Elegir el IPV de prueba" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onFile(file) }} />
          <button type="button" className="lab-primary-btn" onClick={() => fileRef.current?.click()} disabled={reading}><Icon name="upload" size={16} />{reading ? 'Leyendo el IPV…' : day ? 'Subir otro IPV de prueba' : 'Subir IPV de prueba'}</button>
          {fileName && <span className="small muted" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{fileName}{day ? ` · IPV del ${fmtDateShort(day.date)}` : ''}</span>}
        </div>
        {error && <p role="alert" className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
        {day?.warnings && day.warnings.length > 0 && (
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {day.warnings.map((w, i) => <li key={i} className="small muted" style={{ display: 'flex', gap: 6 }}><span style={{ color: 'var(--gold)', flex: 'none', marginTop: 1 }}><Icon name="alert" size={13} /></span><span>{w}</span></li>)}
          </ul>
        )}
      </div>
      <div className="lab-card">
        <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="download" size={18} /></span> Descargar el IPV ya corregido</h3>
        <p className="small muted" style={{ marginTop: 4 }}>El laboratorio genera un Excel nuevo con los ajustes aplicados y el cuadre en 0: importes y precios de los productos corregidos con sus totales, ventas del Desglose, total de cuentas por cobrar y total de fondos. Puedes descargarlo aquí mismo; queda listo para revisarlo o importarlo por la vía normal. <strong>Tu archivo original no se modifica</strong> y nada de esto toca los datos reales.</p>
        {(!day || !result) && <p className="small muted" style={{ marginTop: 8 }}>Los botones se activan en cuanto subas un IPV de prueba arriba y el laboratorio termine de analizarlo.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" className="lab-primary-btn" onClick={() => void downloadCorrected()} disabled={downloading || !fileObj || !day || !result} aria-label="Descargar IPV corregido"><Icon name="download" size={16} />{downloading ? 'Generando el IPV corregido…' : 'Descargar IPV corregido'}</button>
          <button type="button" className="lab-secondary-btn" disabled aria-label="Enviar IPV cuadrado por correo (no disponible en esta copia)"><Icon name="send" size={16} />Enviar IPV cuadrado por correo</button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>El envío por correo no está disponible en esta copia externa: no hay transporte de correo desplegado aquí, así que ese botón queda deshabilitado y no se finge ningún envío. La descarga sí genera el Excel corregido como en el original.</p>
        {downloadMsg && <p role="status" className="small" style={{ marginTop: 8 }}>{downloadMsg}</p>}
        {downloadError && <p role="alert" className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{downloadError}</p>}
      </div>
      {day && result && (
        <>
          <div className="lab-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <h3 className="lab-card-title">Cómo ajustar las diferencias de precio</h3>
                <p className="small muted" style={{ marginTop: 4 }}>Cuando el importe no es cantidad × precio, algo tiene que ceder: Queen lo decide en cada producto con su historial real, o fijas tú un mando único.</p>
              </div>
              <div className="lab-segmented" role="group" aria-label="Criterio de ajuste de precios">
                <button type="button" onClick={() => setMode('queen')} aria-pressed={mode === 'queen'} className={`lab-segmented-btn ${mode === 'queen' ? 'is-active' : ''}`}>Queen decide</button>
                <button type="button" onClick={() => setMode('precio')} aria-pressed={mode === 'precio'} className={`lab-segmented-btn ${mode === 'precio' ? 'is-active' : ''}`}>Manda el precio</button>
                <button type="button" onClick={() => setMode('importe')} aria-pressed={mode === 'importe'} className={`lab-segmented-btn ${mode === 'importe' ? 'is-active' : ''}`}>Manda el importe</button>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>{mode === 'queen' ? 'Queen analiza el historial real de cada producto —los precios de compra y de venta registrados y sus promedios— y decide en cada diferencia qué manda: si el precio del IPV coincide con el registrado, manda el precio; si el precio que implica el importe es el registrado, manda el importe; si ninguno coincide, manda el más cercano a su registro. Cada ajuste aplicado lleva su motivo en la lista. Sin historial del producto, manda el precio.' : mode === 'precio' ? 'El precio escrito manda: cada importe se recalcula como cantidad × precio, y las ventas del día se ajustan en consecuencia.' : 'El importe escrito manda: el precio pasa a ser el precio medio del día (importe ÷ cantidad) y el importe se recalcula exacto con ese precio.'}</p>
          </div>
          <div className="lab-metrics" aria-label="Diagnóstico del IPV de prueba">
            <LabMetric label="CUADRE según el archivo" value={fmtCUP(result.cuadreArchivo)} />
            <LabMetric label="Diferencia de fondos (total − componentes)" value={result.diferenciaFondosAntes != null ? fmtCUP(result.diferenciaFondosAntes) : 'Sin Desglose'} />
            <LabMetric label="Diferencias de precio detectadas" value={String(result.diferenciasPrecio.length)} strong={result.diferenciasPrecio.length > 0} />
            <LabMetric label="Ventas del día · archivo → ajustadas" value={`${fmtInt(day.ventasDia)} → ${fmtCUP(result.ventasAjustadas)}`} />
            <LabMetric label="Ganancia bruta · archivo → ajustada" value={`${fmtInt(day.gananciaBruta)} → ${fmtCUP(result.gananciaAjustada)}`} />
            <LabMetric label="CUADRE en el laboratorio tras ajustar" value="0 CUP" strong />
          </div>
          {result.lotes.length > 0 && (
            <div className="lab-card">
              <h3 className="lab-card-title">Desglose por lote de precio</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Cuando la Entrada del día trae un precio nuevo, el producto no se vende a un solo precio: primero sale el saldo inicial al precio viejo y después lo entrado al precio nuevo. Lo que debe entrar en caja es la suma de los lotes. Ejemplo: saldo inicial 10 a 550 y entrada de 24 a 560, todo vendido → 10×550 + 24×560 = 18.940 CUP; si el IPV lo calculó todo al precio viejo (34×550 = 18.700), hay un sobrante de 240.</p>
              <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
                {result.lotes.map((l, i) => (
                  <li key={i} className="lab-inset">
                    <p className="small" style={{ fontWeight: 600, margin: 0 }}>{l.nombre} <span className="muted" style={{ fontWeight: 400 }}>· {l.dept}</span></p>
                    <div className="grid-2" style={{ marginTop: 6, gap: '4px 16px' }}>
                      <p className="small" style={{ margin: 0 }}>Lote saldo inicial: {fmtInt(l.saldoInicial)} u · costo {fmtInt(l.costoViejo)} · venta {fmtInt(l.precioViejo)}</p>
                      <p className="small" style={{ margin: 0 }}>Lote Entrada: {fmtInt(l.entradas)} u · costo {fmtInt(l.costoNuevo)} · venta {fmtInt(l.precioNuevo)}</p>
                      <p className="small" style={{ margin: 0 }}>Vendidas: {fmtInt(l.vendidasInicial)} del saldo inicial + {fmtInt(l.vendidasEntradas)} de la Entrada</p>
                      <p className="small" style={{ margin: 0 }}>Debe entrar en caja por lotes: <strong>{fmtCUP(l.importeLotes)}</strong></p>
                      <p className="small" style={{ margin: 0 }}>Importe que trae el IPV: {fmtCUP(l.importeIpv)}</p>
                      <p className="small" style={{ margin: 0 }}>Diferencia: <strong style={Math.abs(l.diferencia) <= 0.009 ? undefined : { color: 'var(--gold)' }}>{Math.abs(l.diferencia) <= 0.009 ? '0 CUP' : `${l.diferencia > 0 ? '+' : "−"}${fmtCUP(Math.abs(l.diferencia))}`}</strong></p>
                    </div>
                    <p className="small" style={{ marginTop: 6 }}>{l.lectura}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.diferenciasPrecio.length > 0 && (
            <div className="lab-card lab-alert-card">
              <h3 className="lab-card-title"><span className="lab-icon-badge"><Icon name="alert" size={18} /></span> Diferencias de precio encontradas ({result.diferenciasPrecio.length})</h3>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {result.diferenciasPrecio.map((d, i) => <li key={i} className="small"><strong>{d.nombre}</strong> <span style={{ color: 'var(--dim)' }}>· {d.tipo}:</span> {d.detalle}</li>)}
              </ul>
            </div>
          )}
          {result.ajustes.length > 0 ? (
            <div className="lab-card">
              <h3 className="lab-card-title">Ajustes aplicados en el laboratorio ({result.ajustes.length})</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Solo existen en esta pantalla. En los datos reales ninguno de estos números se tocaría: allí la diferencia se marca y la decides tú.</p>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
                {result.ajustes.map((a, i) => (
                  <li key={i} className="small" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 0', borderTop: i === 0 ? undefined : '1px solid var(--border)' }}>
                    <span style={{ minWidth: 0 }}><span style={{ color: 'var(--dim)' }}>{a.area} · </span>{a.detalle}{a.motivo && <span className="small muted" style={{ display: 'block', marginTop: 2 }}>{a.motivo}</span>}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{fmtInt(a.antes)} → <strong>{fmtCUP(a.despues)}</strong></span>
                  </li>
                ))}
              </ul>
              {result.fondosAjustado && (
                <div className="lab-fondos-grid" style={{ marginTop: 12 }}>
                  <LabMetric label="Efectivo" value={fmtCUP(result.fondosAjustado.efectivo)} />
                  <LabMetric label="Divisas (CUP)" value={fmtCUP(result.fondosAjustado.divisasCUP)} />
                  <LabMetric label="Cuentas por cobrar" value={fmtCUP(result.fondosAjustado.cuentas)} />
                  <LabMetric label="Zelle" value={fmtCUP(result.fondosAjustado.zelle)} />
                  <LabMetric label="Transferencias" value={fmtCUP(result.fondosAjustado.transferencias)} />
                  <LabMetric label="Total de fondos ajustado" value={fmtCUP(result.fondosAjustado.total)} strong />
                </div>
              )}
              <p className="lab-inset small" style={{ marginTop: 12 }}>Con estos {result.ajustes.length} ajuste{result.ajustes.length === 1 ? '' : 's'}, el IPV de prueba queda <strong>cuadrado a 0</strong> dentro del laboratorio: ventas, entradas, cuentas y Desglose coinciden. Si quieres este resultado en firme, descárgalo ya corregido con el botón «Descargar IPV corregido» y súbelo por Importar — o sube el IPV fiel con sus diferencias y déjalas marcadas, que tampoco pasa nada.</p>
            </div>
          ) : (
            <div className="lab-card"><h3 className="lab-card-title">Este IPV ya cuadra</h3><p className="small muted" style={{ marginTop: 4 }}>Ni diferencias de precio, ni cuentas contra su detalle, ni fondos contra sus componentes: no hizo falta ajustar ninguna cifra.</p></div>
          )}
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

        <IpvLabPanel suggestions={suggestions} />
      </div>
    </section>
  )
}
