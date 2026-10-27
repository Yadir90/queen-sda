import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { ElaborationIngredient, ElaborationRecipe, ElaborationStore, PackageReference, StoredData } from '../types'
import { Card, EmptyState, InfoHelp, TabHeader } from '../components/ui'
import { Icon } from '../components/icons'
import { ChartCard, ColumnChart, RowChart } from '../components/charts'
import {
  buildProductsCatalog, buildPriceSuggestions, derivePackageReferences, expenseComparisons,
  packageDerivedCosts,
  type DerivedPackage, type PackageSuggestion,
} from '../lib/productosCore.mjs'
import {
  ELABORATION_SETTINGS_FALLBACK, EMPTY_INGREDIENT, charcoalHourCost, computeProfitability,
  cookingHourCost, costSheetExport, defaultElaborationStore, dishWasteSuggestion, electricHourCost,
  ingredientInsights, ingredientLineCost, laborWorkersFromDays, recipeStatus, recipeTotals,
  type ElaborationSettingsShape, type LaborWorker, type RecipeTotals,
} from '../lib/elaboracionCore.mjs'
import { canonicalPersonKey } from '../lib/syncCore.mjs'
import { buildAllCostSheetsXlsx, buildCostSheetXlsx, type CostSheetExport } from '../lib/ipvRoundTrip'
import { downloadBlob } from '../lib/download'
import { fmtCUP, fmtDate, fmtInt, todayISO } from '../lib/utils'
import { MediaImage } from '../components/MediaImage'
import { productMediaKey } from '../lib/media'
import { saveElaborationStore, savePackageReference, deletePackageReference, supabaseConfigured } from '../lib/backend'
import { sbDeletePackageReference, sbSaveElaborationStore, sbSavePackageReference } from '../lib/supabaseBackend'
import '../components/sectionsMirror.css'

/* Elaboración del externo, con las subpestañas del original SIEMPRE
   visibles (Productos · Rentabilidad · Barra · ml · Paquetes y
   rendimientos · Precios · Historial), también con una ficha abierta.
   LA FICHA DE COSTO (puerto del flujo del original, 26-oct): tocar un
   producto abre su ficha — receta e ingredientes, mano de obra del RH
   del último IPV, cocción al costo promedio ponderado de los Ajustes
   globales, costo por ración, margen y precio sugerido — con las
   fórmulas LITERALES del original en lib/elaboracionCore.mjs.
   Honestidad de datos: las fichas viven en la base del sistema
   principal y NO viajan en el respaldo; aquí nacen vacías y se
   crean/continúan en esta copia (almacén propio 'elaboracion'), y los
   ingredientes se precian con lo que sí viaja (catálogo del IPV,
   gastos, referencias de paquetes e historial propio de fichas).
   El semáforo se lee en la ETIQUETA de la tarjeta (verde/amarillo/
   rojo/sin color): el borde es siempre neutro, regla del dueño del
   2026-10-17 escrita en el theme.css del original. */

const SB_MODE = supabaseConfigured()

type Sub = 'productos' | 'rentabilidad' | 'barra' | 'paquetes' | 'precios' | 'historial'
type AnalysisMode = 'alerts' | 'ranking' | 'compare' | 'ingredients' | 'waste'

/* Áreas del original (ELABORATION_AREAS, App.tsx:19131) con su
   clasificación por departamento (elaborationAreaOf). */
const AREAS: Array<{ id: string; label: string; description: string; depts: string[] }> = [
  { id: 'kitchen', label: 'Cocina', description: 'Platos y elaboraciones de cocina', depts: ['Elaboración'] },
  { id: 'pizzas', label: 'Pizzas', description: 'Pizzas y preparaciones de esa área', depts: ['Pizzas'] },
  { id: 'cocktails', label: 'Coctelería', description: 'Cócteles y tragos preparados', depts: ['Cantina'] },
]

interface ElabProduct {
  productKey: string
  name: string
  dept: string
  um: string
  currentStock: number
  salePrice: number | null
  manual: boolean
}

interface RecipeDraft {
  productKey: string
  currency: string
  servings: number
  unitsPerServing: number
  wastePct: number
  salePrice: number
  laborWorkerKey: string
  laborMinutes: number
  workdayHours: number
  cookingHours: number
  ingredients: ElaborationIngredient[]
}

/* fmt del original: redondea a entero y agrupa en es-ES (su fmtNum).
   D-R5-05: vía fmtInt (agrupación manual; el Intl de Android no separa
   las 4 cifras). */
const fmt = (v: number) => fmtInt(v)

function trendChip(p: DerivedPackage) {
  if (p.trend === 'subio') return <span className="chip warn">Subió {p.changePct != null ? `${Math.round(p.changePct * 10) / 10} %` : ''}</span>
  if (p.trend === 'bajo') return <span className="chip ok">Bajó {p.changePct != null ? `${Math.round(p.changePct * 10) / 10} %` : ''}</span>
  if (p.trend === 'igual') return <span className="chip">Sin cambio</span>
  return <span className="chip">Sin historial previo</span>
}

/* NumberInput del original: cero = campo vacío; acepta coma o punto
   como separador decimal (como se escribe aquí); mientras se edita se
   conserva lo tecleado; sin teclado numérico forzado (preferencia del
   dueño). La ayuda va detrás del ⓘ, nunca visible en el formulario. */
function NumberInput(props: { label: string; help: string; placeholder?: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? (Number.isFinite(props.value) && props.value !== 0 ? String(props.value) : '')
  return (
    <label className="elab-field">
      <span className="elab-field-label">{props.label} <InfoHelp label={`Ayuda: ${props.label}`}>{props.help}</InfoHelp></span>
      <input
        type="text" enterKeyHint="done" autoComplete="off" value={shown} placeholder={props.placeholder}
        onFocus={(event) => { setRaw(shown); event.currentTarget.select() }}
        onBlur={() => setRaw(null)}
        onChange={(event) => {
          const text = event.target.value
          if (!/^-?[0-9.,]*$/.test(text)) return
          setRaw(text)
          const trimmed = text.trim()
          if (trimmed === '') { props.onChange(0); return }
          if (trimmed === '-' || trimmed === '.' || trimmed === ',') return
          const parsed = Number(trimmed.replace(',', '.'))
          if (Number.isFinite(parsed)) props.onChange(parsed)
        }}
      />
    </label>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="small muted" style={{ margin: 0 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontWeight: strong ? 700 : 600, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

/* Pastel de margen del original (CostMarginPie): costo contra
   ganancia por ración, tocable por concepto. */
function CostMarginPie({ cost, salePrice, currency }: { cost: number; salePrice: number; currency: string }) {
  const [focus, setFocus] = useState<'cost' | 'profit'>('profit')
  const safePrice = Math.max(0, salePrice)
  const costShare = safePrice > 0 ? Math.max(0, Math.min(100, cost / safePrice * 100)) : 0
  const profit = safePrice - cost
  const profitShare = safePrice > 0 ? Math.max(0, 100 - costShare) : 0
  const lossPct = safePrice > 0 && profit < 0 ? Math.abs(profit) / safePrice * 100 : 0
  const selectedValue = focus === 'cost' ? cost : profit
  const selectedPct = focus === 'cost' ? costShare : profit >= 0 ? profitShare : lossPct
  const formatMoney = (value: number) => `${fmt(value)} ${currency}`
  const pieStyle = { '--elaboration-cost-share': `${costShare}%` } as CSSProperties
  return (
    <div className="elaboration-margin-chart">
      <div className="elaboration-margin-copy">
        <span>Análisis visual por ración</span>
        <h4>Margen del producto</h4>
        <p>El pastel se actualiza mientras completas la ficha. Toca cada concepto para ver su importe.</p>
        {safePrice <= 0 && <small>Introduce un precio de venta mayor que cero para completar el gráfico.</small>}
      </div>
      <div className="elaboration-pie-stage">
        <div className={`elaboration-margin-pie${profit < 0 ? ' is-loss' : ''}`} style={pieStyle} role="img" aria-label={safePrice > 0 ? `Costo ${fmt(costShare)} por ciento; ganancia ${fmt(profitShare)} por ciento` : 'Gráfico pendiente del precio de venta'}>
          <div><strong>{fmt(selectedPct)}%</strong><span>{focus === 'cost' ? 'costo' : profit >= 0 ? 'margen' : 'pérdida'}</span></div>
        </div>
        <div className="elaboration-pie-legend" aria-label="Detalle del gráfico">
          <button type="button" className={focus === 'cost' ? 'is-active' : ''} onClick={() => setFocus('cost')}><i className="is-cost" /><span>Costo</span><strong>{formatMoney(cost)}</strong></button>
          <button type="button" className={focus === 'profit' ? 'is-active' : ''} onClick={() => setFocus('profit')}><i className={profit >= 0 ? 'is-profit' : 'is-loss'} /><span>{profit >= 0 ? 'Ganancia' : 'Pérdida'}</span><strong>{formatMoney(Math.abs(profit))}</strong></button>
        </div>
      </div>
      <p className="elaboration-margin-readout" role="status"><span>{focus === 'cost' ? 'Costo de producir una ración' : profit >= 0 ? 'Ganancia estimada por ración' : 'Pérdida estimada por ración'}</span><strong>{formatMoney(Math.abs(selectedValue))}</strong></p>
    </div>
  )
}

export default function Elaboracion({ data, isAdmin, onChanged }: { data: StoredData; isAdmin: boolean; onChanged: () => void }) {
  const [sub, setSub] = useState<Sub>('productos')
  const [area, setArea] = useState('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const store: ElaborationStore = data.elaboration ?? defaultElaborationStore()
  const settings: ElaborationSettingsShape = { ...ELABORATION_SETTINGS_FALLBACK, ...(store.settings ?? {}) }
  const hourCost = cookingHourCost(settings)
  const charcoalCost = charcoalHourCost(settings)
  const electricCost = electricHourCost(settings)

  const catalog = useMemo(() => buildProductsCatalog(data.days, data.inventoryAdjustments), [data.days, data.inventoryAdjustments])
  const suggestions = useMemo(() => buildPriceSuggestions(catalog), [catalog])
  const refsView = useMemo(() => derivePackageReferences(data.packageReferences, data.expenses), [data.packageReferences, data.expenses])
  const comparisons = useMemo(() => expenseComparisons(data.expenses, refsView.packages), [data.expenses, refsView])
  const laborWorkers: LaborWorker[] = useMemo(() => laborWorkersFromDays(data.days, canonicalPersonKey), [data.days])

  /* Productos de Elaboración: catálogo (Cocina/Pizzas/Cantina) +
     manuales, menos los eliminados de este apartado. */
  const removedKeys = useMemo(() => new Set(store.removedProducts.map((r) => r.productKey)), [store.removedProducts])
  const products: ElabProduct[] = useMemo(() => {
    const fromCatalog: ElabProduct[] = catalog.products
      .filter((p) => AREAS.some((a) => a.depts.includes(p.dept)))
      .map((p) => ({ productKey: p.productKey, name: p.name, dept: p.dept, um: p.um, currentStock: p.currentStock, salePrice: p.precioVentaVigente ?? null, manual: false }))
    const manuals: ElabProduct[] = store.manualProducts.map((m) => ({ productKey: m.productKey, name: m.name, dept: m.dept, um: 'u', currentStock: 0, salePrice: null, manual: true }))
    const seen = new Set(fromCatalog.map((p) => p.productKey))
    return [...fromCatalog, ...manuals.filter((m) => !seen.has(m.productKey))].filter((p) => !removedKeys.has(p.productKey))
  }, [catalog, store.manualProducts, removedKeys])

  const activeRecipes = useMemo(() => store.recipes.filter((r) => !r.archived), [store.recipes])
  const archivedRecipes = useMemo(() => store.recipes.filter((r) => r.archived), [store.recipes])
  const profitability = useMemo(
    () => computeProfitability(activeRecipes, products, settings, hourCost),
    [activeRecipes, products, settings, hourCost],
  )
  const profitabilityByKey = useMemo(() => new Map(profitability.items.map((i) => [i.product.productKey, i])), [profitability])
  const alertSummary = useMemo(() => ({
    ...profitability.summary,
    withoutRecipe: Math.max(0, products.length - profitability.items.length),
  }), [products.length, profitability])
  const insights = useMemo(() => ingredientInsights(store.ingredientHistory), [store.ingredientHistory])

  const persistStore = async (next: ElaborationStore, msg?: string) => {
    setError(null)
    try {
      if (SB_MODE) await sbSaveElaborationStore(next)
      else saveElaborationStore(next)
      if (msg) setOk(msg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar en Elaboración.')
    }
  }

  const persistRef = async (ref: PackageReference, msg: string) => {
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
  const removeRef = async (id: string, name: string) => {
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
    void persistRef(ref, `Referencia «${p.name}» guardada. En adelante Queen la usa para comparar cada gasto.`)
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
    void persistRef(ref, `Referencia «${ref.name}» creada desde la sugerencia de Queen.`)
  }

  /* ---------- Ficha abierta ---------- */
  const [selected, setSelected] = useState<ElabProduct | null>(null)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [message, setMessage] = useState('')
  const [suggestionNote, setSuggestionNote] = useState('')
  const [cloneSourceKey, setCloneSourceKey] = useState('')
  const [cloneMsg, setCloneMsg] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<ElabProduct | null>(null)
  const [removeMsg, setRemoveMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportingAll, setExportingAll] = useState(false)
  const [exportAllMsg, setExportAllMsg] = useState('')
  const [wasteDraft, setWasteDraft] = useState({ preparedServings: 0, baseAmount: 0, actualWasteAmount: 0, reason: '', note: '' })
  const [wasteMessage, setWasteMessage] = useState('')
  /* Estos tres estados vivían tras el return anticipado de la ficha
     abierta: al abrir una ficha, React ejecutaba menos hooks que en
     el render anterior y la pantalla se caía («la ficha no abre»,
     defecto del dueño, 26-oct). Todos los hooks van antes de
     cualquier return condicional. */
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('alerts')
  const [compareLeft, setCompareLeft] = useState('')
  const [compareRight, setCompareRight] = useState('')

  const openProduct = (product: ElabProduct) => {
    const saved = store.recipes.find((r) => r.productKey === product.productKey)
    const cookWorkerKey = laborWorkers.find((w) => w.occupation.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').includes('cocin'))?.workerKey ?? ''
    setSelected(product)
    setDraft(saved ? {
      productKey: product.productKey,
      currency: saved.currency,
      servings: saved.servings,
      unitsPerServing: saved.unitsPerServing,
      wastePct: saved.wastePct,
      salePrice: saved.salePrice,
      laborWorkerKey: saved.laborWorkerKey || cookWorkerKey,
      laborMinutes: saved.laborMinutes,
      workdayHours: saved.workdayHours,
      cookingHours: saved.cookingHours,
      ingredients: saved.ingredients.length ? saved.ingredients.map((i) => ({ ...i })) : [{ ...EMPTY_INGREDIENT }],
    } : {
      productKey: product.productKey,
      currency: 'CUP',
      servings: 1,
      unitsPerServing: 1,
      wastePct: dishWasteSuggestion(product.name)?.suggested ?? settings.defaultWastePct,
      salePrice: product.salePrice ?? 0,
      laborWorkerKey: cookWorkerKey,
      laborMinutes: 0,
      workdayHours: 12,
      cookingHours: 0,
      ingredients: [{ ...EMPTY_INGREDIENT }],
    })
    setMessage('')
    setSuggestionNote('')
    setCloneSourceKey('')
    setCloneMsg('')
    setWasteDraft({ preparedServings: 0, baseAmount: 0, actualWasteAmount: 0, reason: '', note: '' })
    setWasteMessage('')
  }

  const closeFicha = () => { setSelected(null); setDraft(null); setMessage('') }
  const goToSection = (next: Sub) => { closeFicha(); setSub(next) }

  const laborWorker = draft ? (laborWorkers.find((w) => w.workerKey === draft.laborWorkerKey) ?? null) : null
  const totals: RecipeTotals = draft
    ? recipeTotals(draft, laborWorker, hourCost, settings)
    : { ingredients: 0, ingredientsWithWaste: 0, labor: 0, cooking: 0, direct: 0, overhead: 0, withWaste: 0, perServing: 0, perUnit: 0, profit: 0, margin: 0, tolerance: 0, suggested: 0 }
  const draftStatus = !draft || draft.salePrice <= 0 || totals.perServing <= 0
    ? 'incomplete'
    : recipeStatus(draft.salePrice, totals.perServing, totals.profit, totals.margin, settings.defaultTargetMarginPct)
  const validToSave = Boolean(draft) && draft!.currency.trim().length > 0 && draft!.servings > 0 && draft!.unitsPerServing > 0
    && (!draft!.laborWorkerKey || (laborWorker != null && draft!.workdayHours > 0))
    && draft!.ingredients.length > 0 && draft!.ingredients.some((i) => i.amountUsed > 0)
    && draft!.ingredients.every((i) => i.ingredient.trim() && i.purchasedAmount > 0 && i.purchasePrice >= 0 && i.amountUsed >= 0)
  const saveBlockReason = !draft || validToSave ? '' : !draft.currency.trim()
    ? 'Escribe la moneda de la ficha; la sugerencia habitual es CUP.'
    : !draft.ingredients.some((i) => i.amountUsed > 0)
      ? 'Para guardar, indica una cantidad usada mayor que cero en al menos un ingrediente.'
      : draft.ingredients.some((i) => !i.ingredient.trim() || i.purchasedAmount <= 0)
        ? 'Completa el nombre y el rendimiento por precio de cada ingrediente.'
        : draft.laborWorkerKey && (!laborWorker || draft.workdayHours <= 0)
          ? 'Revisa la persona de RH y escribe las horas de su jornada, o usa «Sin mano de obra».'
          : 'Revisa que raciones y unidades por ración sean mayores que cero.'

  const saveFicha = () => {
    if (!draft || !selected || !validToSave) return
    const existing = store.recipes.find((r) => r.productKey === selected.productKey)
    const recipe: ElaborationRecipe = {
      id: existing?.id ?? `ficha-${selected.productKey}`,
      productKey: selected.productKey,
      productName: selected.name,
      dept: selected.dept,
      manual: selected.manual,
      currency: draft.currency.trim() || 'CUP',
      servings: draft.servings,
      unitsPerServing: draft.unitsPerServing,
      wastePct: draft.wastePct,
      salePrice: draft.salePrice,
      laborWorkerKey: draft.laborWorkerKey,
      laborWorkerName: laborWorker?.name ?? existing?.laborWorkerName ?? '',
      laborDailySalarySnapshot: laborWorker?.dailySalary ?? existing?.laborDailySalarySnapshot ?? 0,
      laborMinutes: draft.laborMinutes,
      workdayHours: draft.workdayHours,
      cookingHours: draft.cookingHours,
      ingredients: draft.ingredients.filter((i) => i.ingredient.trim()),
      updatedAt: new Date().toISOString(),
      archived: false,
      restorable: true,
    }
    const recipes = existing
      ? store.recipes.map((r) => (r.productKey === selected.productKey ? recipe : r))
      : [...store.recipes, recipe]
    // Historial de precios de ingredientes: cada guardado conserva el
    // costo unitario de cada ingrediente con precio (como el original).
    const historyEntries = recipe.ingredients
      .filter((i) => i.purchasedAmount > 0)
      .map((i, idx) => ({
        id: `ing-${Date.now()}-${idx}`,
        ingredient: i.ingredient,
        unit: i.unit,
        unitCost: i.purchasePrice / i.purchasedAmount,
        productName: selected.name,
        recordedOn: todayISO(),
      }))
    const next: ElaborationStore = {
      ...store,
      recipes,
      removedProducts: store.removedProducts.filter((r) => r.productKey !== selected.productKey),
      ingredientHistory: [...store.ingredientHistory, ...historyEntries],
    }
    void persistStore(next)
    setMessage('Ficha guardada.')
  }

  const removeProduct = (product: ElabProduct) => {
    const recipes = store.recipes.map((r) => (r.productKey === product.productKey && !r.archived ? { ...r, archived: true, restorable: true } : r))
    const next: ElaborationStore = {
      ...store,
      recipes,
      removedProducts: [...store.removedProducts.filter((r) => r.productKey !== product.productKey), { productKey: product.productKey, productName: product.name, dept: product.dept, manual: product.manual }],
    }
    setConfirmRemove(null)
    if (selected?.productKey === product.productKey) { setSelected(null); setDraft(null); setMessage('') }
    void persistStore(next)
    setRemoveMsg(product.manual
      ? `«${product.name}» salió de la lista de Elaboración. Su ficha no se borró: quedó archivada en el Historial y puedes reactivarlo cuando quieras.`
      : `«${product.name}» salió de Elaboración. Sigue en la pestaña Productos y su ficha quedó archivada en el Historial: puedes restaurarlo en «Eliminados de Elaboración».`)
  }

  const restoreProduct = (productKey: string) => {
    const entry = store.removedProducts.find((r) => r.productKey === productKey)
    const recipes = store.recipes.map((r) => (r.productKey === productKey ? { ...r, archived: false } : r))
    void persistStore({ ...store, recipes, removedProducts: store.removedProducts.filter((r) => r.productKey !== productKey) })
    if (entry) setRemoveMsg(`«${entry.productName}» volvió a Elaboración con su ficha.`)
  }

  /* Producto manual: nace solo en Elaboración y abre su ficha. */
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualDept, setManualDept] = useState<'Elaboración' | 'Pizzas' | 'Cantina'>('Elaboración')
  const addManual = (ev: FormEvent) => {
    ev.preventDefault()
    const name = manualName.trim()
    if (!name) return
    const productKey = `manual:${canonicalPersonKey(name)}`
    if (products.some((p) => p.productKey === productKey)) { setError(`«${name}» ya está en Elaboración.`); return }
    const next: ElaborationStore = {
      ...store,
      manualProducts: [...store.manualProducts.filter((m) => m.productKey !== productKey), { productKey, name, dept: manualDept }],
      removedProducts: store.removedProducts.filter((r) => r.productKey !== productKey),
    }
    void persistStore(next)
    setManualName('')
    setShowManualForm(false)
    setSub('productos')
    openProduct({ productKey, name, dept: manualDept, um: 'u', currentStock: 0, salePrice: null, manual: true })
  }

  /* Ajustes globales: borrador propio, guardado aparte (como el
     original: viven en su panel y mandan sobre todas las fichas). */
  const [settingsDraft, setSettingsDraft] = useState<ElaborationSettingsShape>(settings)
  const [settingsMsg, setSettingsMsg] = useState('')
  const settingsInitRef = useRef(false)
  useEffect(() => {
    if (!settingsInitRef.current) { settingsInitRef.current = true; setSettingsDraft(settings) }
    // Solo la primera vez: no pisar lo que el dueño está editando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const saveSettings = () => {
    void persistStore({ ...store, settings: settingsDraft })
    setSettingsMsg(`Ajustes guardados. Costo promedio de cocción: ${fmt(cookingHourCost(settingsDraft))} CUP por hora (carbón ${fmt(charcoalHourCost(settingsDraft))}, electricidad ${fmt(electricHourCost(settingsDraft))}).`)
  }

  /* Clonar una ficha como base del borrador abierto. */
  const applyClone = () => {
    if (!draft) return
    const source = activeRecipes.find((r) => r.productKey === cloneSourceKey)
    if (!source) return
    setDraft({
      ...draft,
      currency: source.currency,
      servings: source.servings,
      unitsPerServing: source.unitsPerServing,
      wastePct: source.wastePct,
      salePrice: draft.salePrice > 0 ? draft.salePrice : source.salePrice,
      laborWorkerKey: source.laborWorkerKey || draft.laborWorkerKey,
      laborMinutes: source.laborMinutes,
      workdayHours: source.workdayHours,
      cookingHours: source.cookingHours,
      ingredients: source.ingredients.length ? source.ingredients.map((i) => ({ ...i })) : draft.ingredients,
    })
    setCloneMsg(`Base aplicada desde «${source.productName}»: ingredientes, raciones, merma, cocción y mano de obra copiados a este borrador.`)
  }

  /* Sugerir con Queen (determinista, con lo que viaja): precios de
     ingredientes desde el historial de fichas, las referencias de
     paquetes y el costo vigente del catálogo del IPV. Nada se pide a
     un servidor de IA: cada precio trae su fuente en la nota. */
  const suggestWithQueen = () => {
    if (!draft || !selected) return
    const byCanon = (name: string) => canonicalPersonKey(name)
    const merged = draft.ingredients.filter((i) => i.ingredient.trim()).map((item) => {
      const key = byCanon(item.ingredient)
      const hist = [...store.ingredientHistory].reverse().find((h) => byCanon(h.ingredient) === key)
      if (hist) return { ...item, purchasePrice: hist.unitCost * (item.purchasedAmount > 0 ? item.purchasedAmount : 1), purchasedAmount: item.purchasedAmount > 0 ? item.purchasedAmount : 1, note: `Queen · historial de fichas: ${fmt(hist.unitCost)} por ${hist.unit || 'unidad'} (${fmtDate(hist.recordedOn)})` }
      const pkg = refsView.packages.find((d) => byCanon(d.name) === key)
      const latestEntry = pkg ? [...pkg.entries].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn))[0] : undefined
      if (pkg && latestEntry && latestEntry.unitCost > 0) return { ...item, purchasePrice: latestEntry.unitCost, purchasedAmount: 1, unit: pkg.unitLabel || item.unit, note: `Queen · referencia de paquete guardada: ${fmt(latestEntry.unitCost)} por ${pkg.unitLabel || 'unidad'}` }
      const cat = catalog.products.find((p) => byCanon(p.name) === key)
      if (cat && cat.precioCompraVigente != null) return { ...item, purchasePrice: cat.precioCompraVigente, purchasedAmount: 1, unit: cat.um || item.unit, note: `Queen · costo vigente del catálogo del IPV: ${fmt(cat.precioCompraVigente)} por ${cat.um}` }
      return item
    })
    const suggestion = dishWasteSuggestion(selected.name)
    setDraft({ ...draft, ingredients: merged.length ? merged : draft.ingredients, wastePct: suggestion?.suggested ?? draft.wastePct })
    setSuggestionNote(`Queen revisó los ingredientes contra el historial de fichas, las referencias de paquetes y el catálogo del IPV.${suggestion ? ` Merma sugerida: ${fmt(suggestion.suggested)}% — tipo ${suggestion.category} (${fmt(suggestion.min)}–${fmt(suggestion.max)}%).` : ''} El colchón y el margen son Ajustes globales: no se cambian en esta ficha.`)
  }

  /* Exportaciones XLSX reales (ipvRoundTrip): la individual descarga
     la ficha abierta; «Descargar todo», un libro con todas las
     guardadas. El envío por correo del original no existe en esta
     copia (sin transporte): la entrega es la descarga, como en
     Documentos. */
  const exportCostSheet = async () => {
    if (!selected || !draft) return
    setExporting(true)
    setMessage('')
    try {
      const asRecipe: ElaborationRecipe = {
        id: '', productKey: selected.productKey, productName: selected.name, dept: selected.dept, manual: selected.manual,
        currency: draft.currency, servings: draft.servings, unitsPerServing: draft.unitsPerServing, wastePct: draft.wastePct,
        salePrice: draft.salePrice, laborWorkerKey: draft.laborWorkerKey, laborWorkerName: laborWorker?.name ?? '',
        laborDailySalarySnapshot: laborWorker?.dailySalary ?? 0, laborMinutes: draft.laborMinutes, workdayHours: draft.workdayHours,
        cookingHours: draft.cookingHours, ingredients: draft.ingredients, updatedAt: new Date().toISOString(), archived: false, restorable: true,
      }
      const blob = await buildCostSheetXlsx(costSheetExport(asRecipe, { totals, laborWorkerName: laborWorker?.name ?? '' }, settings, hourCost, todayISO()) as CostSheetExport)
      const slug = selected.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'producto'
      downloadBlob(blob, `ficha-de-costo-${slug}-${todayISO()}.xlsx`)
      setMessage('Ficha Excel lista: se descargó en este dispositivo.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo generar la ficha en Excel.')
    } finally {
      setExporting(false)
    }
  }

  const exportAllCostSheets = async () => {
    if (activeRecipes.length === 0) return
    setExportingAll(true)
    setExportAllMsg('')
    try {
      const sheets = activeRecipes.map((recipe) => {
        const worker = laborWorkers.find((w) => w.workerKey === recipe.laborWorkerKey) ?? null
        const t = recipeTotals(recipe, worker ? { ...worker, dailySalary: recipe.laborDailySalarySnapshot || worker.dailySalary } : (recipe.laborDailySalarySnapshot > 0 ? { workerKey: recipe.laborWorkerKey, name: recipe.laborWorkerName, occupation: '', dailySalary: recipe.laborDailySalarySnapshot, daysWorked: 0, sourceDate: '' } : null), hourCost, settings)
        return costSheetExport(recipe, { totals: t, laborWorkerName: recipe.laborWorkerName }, settings, hourCost, todayISO()) as CostSheetExport
      })
      const blob = await buildAllCostSheetsXlsx(sheets)
      downloadBlob(blob, `fichas-de-costo-la-reina-${todayISO()}.xlsx`)
      setExportAllMsg(`Excel listo con ${sheets.length} ficha(s), una hoja por producto.`)
    } catch (e) {
      setExportAllMsg(e instanceof Error ? e.message : 'No se pudo generar el Excel con todas las fichas.')
    } finally {
      setExportingAll(false)
    }
  }

  /* Registrar preparación y merma real (desde la ficha abierta). */
  const registerWaste = () => {
    if (!selected) return
    const actualWastePct = wasteDraft.baseAmount > 0 ? wasteDraft.actualWasteAmount / wasteDraft.baseAmount * 100 : 0
    const log = {
      id: `merma-${Date.now()}`,
      productKey: selected.productKey,
      productName: selected.name,
      preparedOn: todayISO(),
      preparedServings: wasteDraft.preparedServings,
      baseAmount: wasteDraft.baseAmount,
      actualWasteAmount: wasteDraft.actualWasteAmount,
      actualWastePct,
      estimatedWastePct: draft?.wastePct ?? 0,
      reason: wasteDraft.reason.trim(),
      note: wasteDraft.note.trim(),
    }
    void persistStore({ ...store, wasteLogs: [log, ...store.wasteLogs] })
    setWasteMessage(`Merma registrada: ${fmt(actualWastePct)}%.`)
    setWasteDraft({ preparedServings: 0, baseAmount: 0, actualWasteAmount: 0, reason: '', note: '' })
  }

  /* ---------- Paneles compartidos ---------- */
  const money = (value: number) => `${fmt(value)} ${draft?.currency.trim() || 'CUP'}`

  const globalSettingsPanel = (
    <details className="elab-settings">
      <summary><strong>Ajustes globales</strong><span>Margen, colchón, gastos y costos de cocción para todas las fichas</span></summary>
      <div className="elab-settings-body">
        <div className="elab-grid-3">
          <NumberInput label="Margen que quiero ganar %" help="Margen meta global: el semáforo marca «margen bajo» lo que quede por debajo, y el precio sugerido se calcula para alcanzarlo." value={settingsDraft.defaultTargetMarginPct} min={0} max={99} onChange={(value) => setSettingsDraft({ ...settingsDraft, defaultTargetMarginPct: value })} />
          <NumberInput label="Colchón por variación %" help="Reserva global que se suma al precio sugerido para protegerlo frente a subidas de precios o pequeñas diferencias de rendimiento." value={settingsDraft.defaultVariationBufferPct} min={0} max={500} onChange={(value) => setSettingsDraft({ ...settingsDraft, defaultVariationBufferPct: value })} />
          <NumberInput label="Gastos generales y fijos %" help="Porcentaje fijo sobre el costo de cada plato para cubrir los gastos del local que no son ingredientes ni mano de obra: el agua, el gas, la electricidad general, el alquiler, los impuestos y el desgaste de los equipos. Es el mismo para todos los platos y se define solo aquí, en Ajustes: en la ficha no se pide." value={settingsDraft.defaultOverheadPct} min={0} max={500} onChange={(value) => setSettingsDraft({ ...settingsDraft, defaultOverheadPct: value })} />
        </div>
        <div className="elab-grid-3">
          <NumberInput label="Precio del saco de carbón · CUP" help="Lo que cuesta un saco de carbón, en la moneda de las fichas." value={settingsDraft.charcoalSackPrice} min={0} onChange={(value) => setSettingsDraft({ ...settingsDraft, charcoalSackPrice: value })} />
          <NumberInput label="Horas que rinde un saco" help="Cuántas horas de fogón dura un saco de carbón." value={settingsDraft.hoursPerSack} min={0.01} onChange={(value) => setSettingsDraft({ ...settingsDraft, hoursPerSack: value })} />
          <NumberInput label="Potencia del fogón eléctrico · kW" help="Mírala en la chapa del fogón: 2000 W = 2 kW." value={settingsDraft.stovePowerKw} min={0} onChange={(value) => setSettingsDraft({ ...settingsDraft, stovePowerKw: value })} />
          <NumberInput label="Tarifa eléctrica · CUP por kWh" help="Lo que pagas por cada kWh de electricidad." value={settingsDraft.electricTariff} min={0} onChange={(value) => setSettingsDraft({ ...settingsDraft, electricTariff: value })} />
          <NumberInput label="% de uso de carbón" help="Parte del tiempo de cocción que se hace con carbón; el resto es electricidad. El costo promedio por hora mezcla ambas tarifas con estos pesos. Queda en 70 % —más carbón que electricidad— porque con los apagones frecuentes se cocina mucho más a carbón." value={settingsDraft.charcoalTimePct} min={0} max={100} onChange={(value) => setSettingsDraft({ ...settingsDraft, charcoalTimePct: value })} />
          <NumberInput label="Merma por defecto %" help="Merma inicial de las fichas nuevas solo cuando el tipo de plato no se reconoce por el nombre. Frituras, plancha, horneados, arroz y granos y ensaladas traen su % automático por tipo. La merma de cada plato se sigue editando en su propia ficha." value={settingsDraft.defaultWastePct} min={0} max={100} onChange={(value) => setSettingsDraft({ ...settingsDraft, defaultWastePct: value })} />
        </div>
        <p className="small muted">
          Con estos valores: carbón <strong>{fmt(charcoalHourCost(settingsDraft))} CUP por hora</strong> (saco ÷ horas que rinde),
          electricidad <strong>{fmt(electricHourCost(settingsDraft))} CUP por hora</strong> (potencia × tarifa), y el
          <strong> costo promedio ponderado es {fmt(cookingHourCost(settingsDraft))} CUP por hora</strong> ({fmt(settingsDraft.charcoalTimePct)} % carbón
          y {fmt(100 - settingsDraft.charcoalTimePct)} % electricidad). Cada ficha solo pone el tiempo de cocción: se multiplica por este promedio y se reparte entre las raciones.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveSettings} className="btn primary">Guardar ajustes globales</button>
          {settingsMsg && <span role="status" className="small">{settingsMsg}</span>}
        </div>
      </div>
    </details>
  )

  const removeConfirmPanel = confirmRemove ? (
    <div className="elab-confirm-remove" role="alertdialog" aria-label={`Confirmar eliminación de ${confirmRemove.name} de Elaboración`}>
      <p className="small"><strong>¿Eliminar «{confirmRemove.name}» de Elaboración?</strong></p>
      <p className="small muted" style={{ marginTop: 4 }}>{confirmRemove.manual
        ? 'Es un producto creado a mano y saldrá de la lista de Elaboración. Su ficha de costo NO se borra: quedará archivada en el Historial de este apartado y podrás reactivarlo cuando quieras.'
        : 'Solo sale de este apartado: el producto seguirá en la pestaña Productos y en el resto del sistema. Su ficha de costo NO se borra: quedará archivada en el Historial y podrás restaurarlo aquí mismo.'}</p>
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={() => setConfirmRemove(null)} className="btn">Cancelar</button>
        <button type="button" onClick={() => removeProduct(confirmRemove)} className="btn danger">Sí, eliminar</button>
      </div>
    </div>
  ) : null

  const sectionTabs = (
    <div className="elaboration-main-tabs" role="tablist" aria-label="Secciones de Elaboración">
      <button type="button" role="tab" aria-selected={sub === 'productos'} onClick={() => goToSection('productos')} className={sub === 'productos' ? 'is-active' : ''}><span>Productos</span><small>{fmtInt(products.length)}</small></button>
      <button type="button" role="tab" aria-selected={sub === 'rentabilidad'} onClick={() => goToSection('rentabilidad')} className={sub === 'rentabilidad' ? 'is-active' : ''}><span>Rentabilidad</span><small className={alertSummary.losses > 0 ? 'is-danger' : ''}>{fmtInt(alertSummary.losses)}</small></button>
      <button type="button" role="tab" aria-selected={sub === 'barra'} onClick={() => goToSection('barra')} className={sub === 'barra' ? 'is-active' : ''}><span>Barra · ml</span><small>{fmtInt(catalog.products.filter((x) => x.dept === 'Cantina').length)}</small></button>
      <button type="button" role="tab" aria-selected={sub === 'paquetes'} onClick={() => goToSection('paquetes')} className={sub === 'paquetes' ? 'is-active' : ''}><span>Paquetes y rendimientos</span><small>{fmtInt(refsView.packages.length)}</small></button>
      <button type="button" role="tab" aria-selected={sub === 'precios'} onClick={() => goToSection('precios')} className={sub === 'precios' ? 'is-active' : ''}><span>Precios</span><small className={(suggestions.counts.perdida + suggestions.counts.riesgo) > 0 ? 'is-danger' : ''}>{fmtInt(suggestions.counts.perdida + suggestions.counts.riesgo)}</small></button>
      <button type="button" role="tab" aria-selected={sub === 'historial'} onClick={() => goToSection('historial')} className={sub === 'historial' ? 'is-active' : ''}><span>Historial</span><small>{fmtInt(archivedRecipes.length)}</small></button>
    </div>
  )

  /* ---------- Vista: la ficha abierta ---------- */
  if (selected && draft) {
    const wasteSuggestion = dishWasteSuggestion(selected.name)
    const scenarios = [0, 10, 20].map((rise) => {
      const cost = totals.perServing * (1 + rise / 100)
      return { rise, cost, profit: draft.salePrice - cost, margin: draft.salePrice > 0 ? (draft.salePrice - cost) / draft.salePrice * 100 : 0 }
    })
    void scenarios
    const patchIngredient = (index: number, patch: Partial<ElaborationIngredient>) =>
      setDraft((current) => current ? ({ ...current, ingredients: current.ingredients.map((item, i) => (i === index ? { ...item, ...patch } : item)) }) : current)
    return (
      <section aria-label={`Ficha de costo de ${selected.name}`} className="elab-ficha">
        <TabHeader icon="receipt" title="Elaboración" desc="Productos, rentabilidad, paquetes y precios de la cocina" badge="Paquetes y precios" />
        <button type="button" onClick={closeFicha} className="elab-back">← Todos los productos</button>
        {sectionTabs}
        <div className="elab-ficha-head">
          <MediaImage kind="foto-producto" entityKey={productMediaKey(selected.dept, selected.name, selected.um)} alt="" className="elab-ficha-photo" fallback={<span className="elab-ficha-photo elab-photo-fallback" aria-hidden="true">{selected.name.slice(0, 1).toUpperCase()}</span>} />
          <div style={{ minWidth: 0 }}>
            <h2 className="elab-ficha-title">{selected.name}</h2>
            <p className="small muted" style={{ margin: 0 }}>{selected.dept} · Ficha de costo{selected.manual ? ' · Producto manual' : ''}</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => { setRemoveMsg(''); setConfirmRemove(selected) }} aria-label={`Eliminar ${selected.name} de Elaboración`} className="btn danger-outline">
            <Icon name="trash" size={14} /> Eliminar de Elaboración
          </button>
        </div>
        {removeConfirmPanel}
        {removeMsg && <p role="status" className="small elab-status-line">{removeMsg}</p>}

        {activeRecipes.some((r) => r.productKey !== selected.productKey) && (
          <div className="card elab-clone">
            <h3>Clonar una ficha parecida</h3>
            <p className="small muted">Copia ingredientes, raciones, merma, cocción y mano de obra de otra ficha como punto de partida de esta.</p>
            <div className="elab-clone-row">
              <select aria-label="Ficha a usar como base" value={cloneSourceKey} onChange={(e) => { setCloneSourceKey(e.target.value); setCloneMsg('') }}>
                <option value="">Seleccionar ficha…</option>
                {activeRecipes.filter((r) => r.productKey !== selected.productKey).map((r) => <option key={r.productKey} value={r.productKey}>{r.productName}</option>)}
              </select>
              <button type="button" onClick={applyClone} disabled={!cloneSourceKey} className="btn primary">Usar como base</button>
            </div>
            {cloneMsg && <p role="status" className="small" style={{ color: 'var(--success)', marginTop: 8 }}>{cloneMsg}</p>}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Datos de la receta</h3>
          <div className="elab-grid-4">
            <NumberInput label="Raciones por receta" help="Cantidad total de platos o vasos completos que produce esta preparación." placeholder="Sugerencia: 1" value={draft.servings} min={0.01} onChange={(value) => setDraft({ ...draft, servings: value })} />
            <NumberInput label="Unidades por ración · solo informativo" help="Dato informativo: cuántas piezas componen una ración (ejemplo: 10 tostones; para un cóctel completo usa 1). Sirve para ver el costo por unidad; el precio y el costo se calculan por ración, así que cambiarlo no altera el costo por ración." placeholder="Sugerencia: 1 plato, 10 tostones…" value={draft.unitsPerServing} min={0.01} onChange={(value) => setDraft({ ...draft, unitsPerServing: value })} />
            <div>
              <NumberInput label="Merma %" help="Porcentaje estimado que se pierde al limpiar, cortar, cocinar o manipular los ingredientes. Se coloca solo según el tipo de plato — frituras 15–20 %, carnes a la plancha 20–25 %, horneados 10–15 %, arroz y granos 0 %, ensaladas y vegetales crudos 5–10 % — y «Sugerir con Queen» respeta esa misma regla; siempre puedes corregirlo a mano." placeholder="Automática por tipo de plato" value={draft.wastePct} min={0} max={100} onChange={(value) => setDraft({ ...draft, wastePct: value })} />
              {wasteSuggestion && (
                <p className="small muted" style={{ marginTop: 6 }}>
                  Automática por tipo de plato: <strong>{wasteSuggestion.category}</strong>, típica {wasteSuggestion.min === wasteSuggestion.max ? `${fmt(wasteSuggestion.min)} %` : `${fmt(wasteSuggestion.min)}–${fmt(wasteSuggestion.max)} %`}.
                  {draft.wastePct !== wasteSuggestion.suggested && <button type="button" onClick={() => setDraft({ ...draft, wastePct: wasteSuggestion.suggested })} className="elab-link">Usar {fmt(wasteSuggestion.suggested)} %</button>}
                </p>
              )}
            </div>
            <label className="elab-field">
              <span className="elab-field-label">Moneda <InfoHelp label="Ayuda: Moneda">Moneda usada en todos los importes de esta ficha. Normalmente CUP.</InfoHelp></span>
              <input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} placeholder="Sugerencia: CUP" />
            </label>
          </div>
        </div>

        <div className="card">
          <div style={{ marginBottom: 12 }}>
            <h3>Mano de obra · RH</h3>
            <p className="small muted" style={{ marginTop: 4 }}>Toma el salario diario del último IPV y carga a esta receta solo el tiempo de preparación.</p>
          </div>
          <div className="elab-grid-3">
            <label className="elab-field">
              <span className="elab-field-label">Persona que elabora <InfoHelp label="Ayuda: Persona que elabora">Al abrir la ficha se coloca automáticamente el cocinero del RH del último IPV, sin importar su turno; puedes cambiarlo por otra persona o dejarlo vacío. El salario diario de quien esté seleccionado se prorratea por el tiempo de preparación.</InfoHelp></span>
              <select value={draft.laborWorkerKey} onChange={(e) => setDraft({ ...draft, laborWorkerKey: e.target.value })}>
                <option value="">Seleccionar persona (opcional)…</option>
                {laborWorkers.map((w) => <option key={w.workerKey} value={w.workerKey}>{w.name}{w.occupation ? ` · ${w.occupation}` : ''}</option>)}
              </select>
            </label>
            <NumberInput label="Tiempo de preparación · min" help="Minutos reales que la persona dedica a preparar esta receta completa." placeholder="Ej. 45" value={draft.laborMinutes} min={0} max={1440} onChange={(value) => setDraft({ ...draft, laborMinutes: value })} />
            <NumberInput label="Horas de la jornada" help="Duración de la jornada diaria usada para prorratear el salario de RH." placeholder="Sugerencia: 12" value={draft.workdayHours} min={0.01} max={24} onChange={(value) => setDraft({ ...draft, workdayHours: value })} />
          </div>
          {laborWorker ? (
            <div className="elab-metrics-strip">
              <Metric label="Salario diario RH" value={money(laborWorker.dailySalary)} />
              <Metric label="Días en el IPV" value={fmt(laborWorker.daysWorked)} />
              <Metric label="Fuente" value={laborWorker.sourceDate ? `IPV del ${fmtDate(laborWorker.sourceDate)}` : 'Último IPV'} />
              <Metric label="Costo en esta receta" value={money(totals.labor)} strong />
            </div>
          ) : <p className="small muted" style={{ marginTop: 12 }}>Elige la persona y el tiempo si quieres incluir su salario en el costo.</p>}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Cocción</h3>
          <div className="elab-grid-2">
            <NumberInput label="Tiempo de cocción · horas" help="Tiempo total de fogón para preparar la receta completa. Como se trabaja por ración, su costo se reparte solo entre las raciones: el costo por ración ya lo trae dividido." placeholder="Ej. 1" value={draft.cookingHours} min={0} max={10000} onChange={(value) => setDraft({ ...draft, cookingHours: value })} />
            <div className="elab-hour-cost">
              <p className="small muted" style={{ margin: 0 }}>Costo promedio por hora <InfoHelp label="Ayuda: Costo promedio de cocción">Es una media ponderada de las dos fuentes: {fmt(settings.charcoalTimePct)} % carbón a {money(charcoalCost)} la hora y {fmt(100 - settings.charcoalTimePct)} % electricidad a {money(electricCost)} la hora. El carbón pesa más porque, con los apagones frecuentes, se cocina más con carbón que con electricidad. Las tarifas y el % de uso viven en los Ajustes globales.</InfoHelp></p>
              <p className="elab-hour-cost-value">{money(hourCost)} <span>· {fmt(settings.charcoalTimePct)} % carbón / {fmt(100 - settings.charcoalTimePct)} % electricidad</span></p>
            </div>
          </div>
          <div className="elab-metrics-strip">
            <Metric label="Costo de cocción · receta completa" value={money(totals.cooking)} />
            <Metric label="Cocción por ración" value={money(draft.servings > 0 ? totals.cooking / draft.servings : 0)} />
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Se cobra al costo promedio ponderado de los Ajustes globales, igual para todos los platos.</p>
        </div>

        {globalSettingsPanel}

        <div className="card">
          <div className="elab-ingredients-head">
            <div style={{ minWidth: 0 }}>
              <h3>Ingredientes</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Cálculo aproximado: confirma cantidades y precios antes de guardar.</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={suggestWithQueen} className="btn deep">Sugerir con Queen</button>
              <button type="button" onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { ...EMPTY_INGREDIENT }] })} className="btn">+ Añadir</button>
            </div>
          </div>
          {suggestionNote && <p role="status" className="small elab-note">{suggestionNote}</p>}
          <datalist id="elaboration-unit-options">
            <option value="g" /><option value="kg" /><option value="lb" /><option value="ml" /><option value="L" /><option value="unidad" /><option value="oz" /><option value="cucharada" /><option value="cucharadita" /><option value="taza" />
          </datalist>
          <datalist id="elaboration-ingredient-names">
            {[...new Set([...store.ingredientHistory.map((h) => h.ingredient), ...catalog.products.map((p) => p.name)])].map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="elab-ingredients">
            {draft.ingredients.map((item, index) => {
              const lineCost = ingredientLineCost(item)
              return (
                <div key={index} className="elab-ingredient">
                  <div className="elab-ingredient-top">
                    <input aria-label={`Ingrediente ${index + 1}`} list="elaboration-ingredient-names" value={item.ingredient} placeholder="Ingrediente" onChange={(e) => patchIngredient(index, { ingredient: e.target.value })} />
                    <button type="button" aria-label={`Quitar ingrediente ${index + 1}`} className="elab-ingredient-remove" onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((_, i) => i !== index) })}><Icon name="trash" size={15} /></button>
                  </div>
                  <div className="elab-ingredient-grid">
                    <NumberInput label="Cantidad usada" help="Cantidad de este ingrediente que entra en la receta completa (todas las raciones)." value={item.amountUsed} min={0} onChange={(value) => patchIngredient(index, { amountUsed: value })} />
                    <label className="elab-field"><span className="elab-field-label">Unidad</span><input aria-label="Unidad del ingrediente" list="elaboration-unit-options" value={item.unit} onChange={(e) => patchIngredient(index, { unit: e.target.value })} /></label>
                    <NumberInput label="Precio de compra" help="Lo que costó comprar el ingrediente, por el rendimiento indicado." value={item.purchasePrice} min={0} onChange={(value) => patchIngredient(index, { purchasePrice: value })} />
                    <NumberInput label="Rendimiento" help="Cantidad que rindió esa compra, en la misma unidad (ej.: compraste 1 kg por 500: precio 500, rendimiento 1, unidad kg)." value={item.purchasedAmount} min={0} onChange={(value) => patchIngredient(index, { purchasedAmount: value })} />
                  </div>
                  <div className="elab-ingredient-foot">
                    <input aria-label="Observaciones del ingrediente" value={item.note} placeholder="Observaciones (opcional)" onChange={(e) => patchIngredient(index, { note: e.target.value })} />
                    <strong>{money(lineCost)}</strong>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className={`card elaboration-cost-panel is-${draftStatus}`}>
          <h3 style={{ marginBottom: 4 }}>Costo y precio</h3>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Queen calcula estos importes automáticamente y solo con respaldo: las cantidades y precios de esta ficha, el salario diario del RH del último IPV y el costo promedio ponderado de cocción de los Ajustes ({fmt(settings.charcoalTimePct)} % carbón y {fmt(100 - settings.charcoalTimePct)} % electricidad, por los apagones). Son valores aproximados —lo más exactos posible con la evidencia guardada—, no cifras contables cerradas. Lo que no tiene respaldo no se inventa: cuenta como cero y la ficha avisa qué falta.
          </p>
          <p className={`elaboration-draft-status is-${draftStatus}`} role="status">
            {draftStatus === 'loss' ? <>Esta ficha está <strong>en pérdida</strong>: pierde {money(Math.abs(totals.profit))} por ración — borde rojo.</>
              : draftStatus === 'low' ? <>Margen <strong>demasiado bajo</strong>: {fmt(totals.margin)} % frente a la meta de {fmt(settings.defaultTargetMarginPct)} % — borde amarillo.</>
              : draftStatus === 'healthy' ? <>Con <strong>ganancia</strong>: margen de {fmt(totals.margin)} %, sobre la meta de {fmt(settings.defaultTargetMarginPct)} % — borde verde.</>
              : <>Faltan datos (precio de venta o costo por ración) para saber si esta ficha gana o pierde.</>}
          </p>
          <div className="elab-metrics-grid">
            <Metric label="Ingredientes" value={money(totals.ingredients)} />
            <Metric label="Ingredientes con merma" value={money(totals.ingredientsWithWaste)} />
            <Metric label="Mano de obra" value={money(totals.labor)} />
            <Metric label="Cocción" value={money(totals.cooking)} />
            <Metric label="Gastos generales y fijos" value={money(totals.overhead)} />
            <Metric label="Costo total de la receta" value={money(totals.withWaste)} />
            <Metric label="Costo por ración · precio mínimo para no perder" value={money(totals.perServing)} strong />
            <Metric label="Costo por unidad" value={money(totals.perUnit)} />
          </div>
          <div className="elab-grid-2" style={{ marginTop: 4 }}>
            <NumberInput label="Precio de venta" help="Precio actual o propuesto de una ración terminada." placeholder={selected.salePrice != null ? `Sugerido por Productos: ${fmt(selected.salePrice)}` : 'Escribe el precio por ración'} value={draft.salePrice} min={0} onChange={(value) => setDraft({ ...draft, salePrice: value })} />
            <div className="elab-hour-cost">
              <p className="small muted" style={{ margin: 0 }}>Aplicados desde los Ajustes globales · iguales para todos los platos</p>
              <p className="small" style={{ marginTop: 4 }}>Margen que quiero ganar: <strong>{fmt(settings.defaultTargetMarginPct)} %</strong> · Colchón por variación: <strong>{fmt(settings.defaultVariationBufferPct)} %</strong> · Gastos generales: <strong>{fmt(settings.defaultOverheadPct)} %</strong></p>
              <p className="small muted" style={{ marginTop: 4 }}>El precio sugerido ya los incluye. Para cambiarlos, abre «Ajustes globales» en esta misma pestaña; no se editan por plato.</p>
            </div>
          </div>
          <div className="elab-cost-bar" aria-label={`Costo ${fmt(totals.perServing)} y ganancia ${fmt(Math.max(0, totals.profit))}`}>
            <div className="elab-cost-bar-cost" style={{ width: `${draft.salePrice > 0 ? Math.min(100, totals.perServing / draft.salePrice * 100) : 0}%` }} />
            <div className="elab-cost-bar-profit" />
          </div>
          <div className="elab-metrics-grid-4">
            <Metric label="Ganancia por ración" value={money(totals.profit)} strong />
            <Metric label="Margen" value={`${fmt(totals.margin)} %`} />
            <Metric label={totals.profit >= 0 ? 'Gana' : 'Pierde'} value={money(Math.abs(totals.profit))} />
            <Metric label="Subida de costos que aguanta" value={`${fmt(totals.tolerance)} %`} />
          </div>
          <CostMarginPie cost={totals.perServing} salePrice={draft.salePrice} currency={draft.currency.trim() || 'CUP'} />
          <div className="elab-suggested">
            <div>
              <p className="small muted" style={{ margin: 0 }}>Precio sugerido · múltiplo de 5</p>
              <p className="elab-suggested-value">{money(totals.suggested)}</p>
            </div>
            <button type="button" onClick={() => setDraft({ ...draft, salePrice: totals.suggested })} disabled={totals.suggested <= 0} className="btn primary">Usar sugerencia</button>
          </div>
        </div>

        <div className="card">
          <div className="elab-ingredients-head">
            <div style={{ minWidth: 0 }}>
              <h3>Registrar preparación y merma real</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Anota cuánto se perdió y por qué para comparar con la merma estimada de {fmt(draft.wastePct)}%.</p>
            </div>
            <InfoHelp label="Ayuda: merma real">Usa la misma unidad en «Cantidad base» y «Cantidad perdida». Ejemplo: de 10 kg preparados se perdieron 0,8 kg por corte incorrecto. El sistema calcula 8% de merma real.</InfoHelp>
          </div>
          <div className="elab-grid-4">
            <NumberInput label="Raciones preparadas" help="Cuántas raciones salieron de esta preparación." value={wasteDraft.preparedServings} min={0} onChange={(value) => setWasteDraft({ ...wasteDraft, preparedServings: value })} />
            <NumberInput label="Cantidad base" help="Cantidad total preparada, en la unidad que uses para medir la pérdida." value={wasteDraft.baseAmount} min={0} onChange={(value) => setWasteDraft({ ...wasteDraft, baseAmount: value })} />
            <NumberInput label="Cantidad perdida" help="Cuánto se perdió de esa cantidad base (misma unidad)." value={wasteDraft.actualWasteAmount} min={0} onChange={(value) => setWasteDraft({ ...wasteDraft, actualWasteAmount: value })} />
            <label className="elab-field"><span className="elab-field-label">Motivo</span><input value={wasteDraft.reason} onChange={(e) => setWasteDraft({ ...wasteDraft, reason: e.target.value })} placeholder="Quemado, corte incorrecto, deterioro…" /></label>
          </div>
          <label className="elab-field" style={{ marginTop: 10 }}><span className="elab-field-label">Nota (opcional)</span><input value={wasteDraft.note} onChange={(e) => setWasteDraft({ ...wasteDraft, note: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {wasteMessage && <span role="status" className="small">{wasteMessage}</span>}
            <button type="button" className="btn primary" disabled={!isAdmin || wasteDraft.baseAmount <= 0} onClick={registerWaste}>Registrar preparación</button>
          </div>
        </div>

        <details className="elab-help">
          <summary>Cómo se calcula esta ficha</summary>
          <ol>
            <li>En «Ingredientes» escribe cada producto con su cantidad usada, el precio de compra y el rendimiento de esa compra: el costo de cada línea es cantidad usada × precio ÷ rendimiento.</li>
            <li>La merma se aplica sobre los ingredientes; en «Mano de obra» elige quién lo elabora y los minutos de preparación; el salario diario sale del RH del último IPV.</li>
            <li>En «Cocción» escribe el tiempo de cocción: el sistema lo multiplica por el costo promedio ponderado por hora de los Ajustes (70 % carbón y 30 % electricidad, porque con los apagones se cocina más a carbón) y lo reparte entre las raciones. El margen que quieres ganar, el colchón y los gastos generales y fijos (agua, gas, electricidad general, alquiler…) también vienen de los Ajustes globales, iguales para todos los platos; en la ficha no se piden.</li>
            <li>Revisa costo, ganancia, escenarios y el precio sugerido antes de guardar. El costo por ración es tu precio mínimo para no perder.</li>
          </ol>
        </details>

        {message && <p role="status" className="small" style={{ color: 'var(--success)' }}>{message}</p>}
        {error && <div className="error-box">{error}</div>}
        {saveBlockReason && <p role="status" className="small elab-note">{saveBlockReason}</p>}
        <div className="elaboration-form-actions" aria-label="Acciones de la ficha de costo">
          <button type="button" onClick={saveFicha} disabled={!validToSave || !isAdmin} aria-label="Guardar ficha de costo" className="elaboration-save-action">Guardar ficha</button>
          <button type="button" onClick={() => void exportCostSheet()} disabled={!validToSave || exporting} aria-label="Descargar ficha Excel" className="elaboration-email-action"><Icon name="download" size={16} />{exporting ? 'Preparando Excel…' : 'Descargar Excel'}</button>
        </div>
      </section>
    )
  }

  /* ---------- Vista: listas (sin ficha abierta) ---------- */
  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.dept.toLowerCase().includes(q)
  })
  const areaCounts = (id: string) => products.filter((p) => (AREAS.find((a) => a.id === id)?.depts ?? []).includes(p.dept)).length
  const visibleAreaGroups = AREAS
    .filter((a) => area === 'all' || area === a.id)
    .map((a) => ({ ...a, products: filtered.filter((p) => a.depts.includes(p.dept)) }))
    .filter((g) => g.products.length > 0)
  const visibleProfitability = profitability.items.filter((item) => {
    const needle = search.trim().toLocaleLowerCase('es')
    return !needle || `${item.product.name} ${item.product.dept} ${item.status}`.toLocaleLowerCase('es').includes(needle)
  })
  const rankedProfitability = profitability.items.filter((i) => i.margin != null)

  return (
    <div>
      <TabHeader icon="receipt" title="Elaboración" desc="Productos, rentabilidad, paquetes y precios de la cocina" badge="Paquetes y precios" />
      <div className="elab-list-head">
        <div>
          <h2 className="elab-list-title">Elaboración</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Elige un producto para crear o continuar su ficha de costo.</p>
        </div>
        <span className="small muted">
          {sub === 'productos' ? `${fmtInt(products.length)} elaboraciones`
            : sub === 'rentabilidad' ? `${fmtInt(alertSummary.losses)} con pérdida`
            : sub === 'barra' ? `${fmtInt(catalog.products.filter((x) => x.dept === 'Cantina').length)} insumos de barra`
            : sub === 'paquetes' ? `${fmtInt(refsView.packages.length)} referencias de paquetes`
            : sub === 'precios' ? `${fmtInt(suggestions.items.length)} productos analizados`
            : `${fmtInt(archivedRecipes.length)} fichas archivadas`}
        </span>
        {activeRecipes.length > 0 && (
          <button type="button" onClick={() => void exportAllCostSheets()} disabled={exportingAll} aria-label="Descargar todas las fichas de costo en un Excel" className="btn primary">
            <Icon name="download" size={16} />{exportingAll ? 'Preparando Excel…' : `Descargar todo (${fmtInt(activeRecipes.length)})`}
          </button>
        )}
      </div>
      {exportAllMsg && <p role="status" className="small elab-note">{exportAllMsg}</p>}
      {sectionTabs}
      {globalSettingsPanel}
      {error ? <div className="error-box" style={{ marginBottom: 12 }}>{error}</div> : null}
      {ok ? <p className="small" style={{ marginTop: 0 }}><Icon name="check" size={14} /> {ok}</p> : null}

      {sub === 'productos' && (
        <>
          {removeConfirmPanel}
          {removeMsg && <p role="status" className="small elab-note">{removeMsg}</p>}
          <div className="elab-manual-row">
            <p className="small muted" style={{ minWidth: 0, flex: 1 }}>¿Falta un producto? Créalo a mano y abre su ficha sin esperar a que venga en un IPV. Solo existirá en Elaboración.</p>
            {isAdmin && <button type="button" onClick={() => setShowManualForm((v) => !v)} aria-expanded={showManualForm} className="btn primary">+ Añadir producto</button>}
          </div>
          {showManualForm && isAdmin && (
            <form onSubmit={addManual} className="card" style={{ marginBottom: 14 }}>
              <h3>Producto nuevo en Elaboración</h3>
              <div className="elab-grid-2" style={{ marginTop: 10 }}>
                <label className="elab-field"><span className="elab-field-label">Nombre del producto</span>
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Ej. Pizza familiar especial" maxLength={200} /></label>
                <label className="elab-field"><span className="elab-field-label">Área</span>
                  <select value={manualDept} onChange={(e) => setManualDept(e.target.value as 'Elaboración' | 'Pizzas' | 'Cantina')}>
                    <option value="Elaboración">Cocina</option><option value="Pizzas">Pizzas</option><option value="Cantina">Coctelería</option>
                  </select></label>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => setShowManualForm(false)} className="btn">Cancelar</button>
                <button type="submit" disabled={!manualName.trim()} className="btn primary">Crear y abrir ficha</button>
              </div>
            </form>
          )}
          <div className="elaboration-area-panel">
            <div className="elaboration-area-heading">
              <div><h3>Área</h3><p>Agrupa y encuentra cada ficha sin mezclar las elaboraciones.</p></div>
              <span>{fmtInt(filtered.length)} visible{filtered.length === 1 ? '' : 's'}</span>
            </div>
            <div className="elaboration-area-tabs" role="tablist" aria-label="Áreas de fichas de costo">
              <button type="button" role="tab" aria-selected={area === 'all'} onClick={() => setArea('all')} className={area === 'all' ? 'is-active' : ''}><strong>Todas</strong><span>{fmtInt(products.length)}</span></button>
              {AREAS.map((a) => (
                <button key={a.id} type="button" role="tab" aria-selected={area === a.id} className={area === a.id ? 'is-active' : ''} onClick={() => setArea(a.id)}><strong>{a.label}</strong><span>{fmtInt(areaCounts(a.id))}</span></button>
              ))}
            </div>
          </div>
          <label className="elaboration-search">
            <span className="sr-only">Buscar producto para elaborar</span>
            <Icon name="search" size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por producto o área…" />
          </label>
          <p className="small muted">
            Borde <span className="font-bold" style={{ color: 'var(--success, #16875d)', fontWeight: 700 }}>verde</span>: su ficha deja ganancia · Borde <span className="font-bold" style={{ color: 'var(--gold, #b8860b)', fontWeight: 700 }}>amarillo</span>: margen demasiado bajo, bajo la meta · Borde <span style={{ color: 'var(--danger)', fontWeight: 700 }}>rojo</span>: su ficha causa pérdida o aún no tiene ficha de costo · Sin color: ficha guardada, pero faltan datos (precio de venta o costo) para calcularlo.
          </p>
          {filtered.length === 0 ? (
            <div className="elaboration-empty">
              <h3 className="font-bold">Sin productos elaborados</h3>
              <p className="small muted" style={{ marginTop: 4 }}>{products.length ? 'No hay coincidencias en esta área. Prueba otra pestaña o cambia la búsqueda.' : 'Importa un IPV con productos de cocina, pizzas o coctelería, o crea el primero con «Añadir producto».'}</p>
            </div>
          ) : (
            <div className="elaboration-product-groups">
              {visibleAreaGroups.map((group) => (
                <section key={group.id} aria-labelledby={`elaboration-area-${group.id}`} className="elaboration-product-group">
                  <div className="elaboration-group-heading">
                    <div><h3 id={`elaboration-area-${group.id}`}>{group.label}</h3><p>{group.description}</p></div>
                    <span>{fmtInt(group.products.length)}</span>
                  </div>
                  <div className="elaboration-product-grid">
                    {group.products.map((product) => {
                      const profitItem = profitabilityByKey.get(product.productKey)
                      const cardState = !profitItem ? 'no-recipe' : profitItem.status === 'loss' ? 'is-loss' : profitItem.status === 'low' ? 'is-low' : profitItem.status === 'healthy' ? 'is-healthy' : 'is-incomplete'
                      const stateLabel = !profitItem ? 'Crear ficha' : profitItem.status === 'loss' ? `En pérdida${profitItem.margin != null ? ` · ${fmt(profitItem.margin)} %` : ''}` : profitItem.status === 'low' ? `Margen bajo${profitItem.margin != null ? ` · ${fmt(profitItem.margin)} %` : ''}` : profitItem.status === 'healthy' ? `Con ganancia${profitItem.margin != null ? ` · ${fmt(profitItem.margin)} %` : ''}` : 'Faltan datos'
                      return (
                        <div key={product.productKey} className="elaboration-product-card-wrap">
                          <button type="button" onClick={() => openProduct(product)} className={`elaboration-product-card ${cardState}`} aria-label={`${product.name}: ${stateLabel}`}>
                            <MediaImage
                              kind="foto-producto" entityKey={productMediaKey(product.dept, product.name, product.um)} alt=""
                              className="elaboration-product-thumb"
                              fallback={<span className="elaboration-product-placeholder" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span>}
                            />
                            <span className="elaboration-product-copy">
                              <strong>{product.name}</strong>
                              <span>{product.dept}{product.manual ? ' · Manual' : ''}</span>
                              <small>{product.manual ? 'Creado a mano en Elaboración' : `Existencia ${fmt(product.currentStock)}`}</small>
                            </span>
                            <span className={`elaboration-recipe-state ${cardState}`}>{stateLabel}</span>
                          </button>
                          {isAdmin && (
                            <button type="button" onClick={() => { setRemoveMsg(''); setConfirmRemove(product) }} aria-label={`Eliminar ${product.name} de Elaboración`} className="elaboration-product-delete"><Icon name="trash" size={15} /></button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
          {store.removedProducts.length > 0 && (
            <details className="card">
              <summary className="elab-details-summary">Eliminados de Elaboración ({fmtInt(store.removedProducts.length)})</summary>
              <p className="small muted" style={{ marginTop: 8 }}>Salieron solo de la lista de Elaboración. Los del catálogo siguen en la pestaña Productos; la ficha de costo de cada uno quedó archivada en el Historial, sin borrarse. Restaura el que quieras y vuelve tal cual estaba.</p>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {store.removedProducts.map((entry) => (
                  <div key={entry.productKey} className="elab-removed-row">
                    <span style={{ minWidth: 0, flex: 1 }}><strong className="elab-removed-name">{entry.productName}</strong><span className="small muted">{entry.dept}</span></span>
                    <button type="button" onClick={() => restoreProduct(entry.productKey)} aria-label={`Restaurar ${entry.productName} en Elaboración`} className="btn primary small-btn">Restaurar</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {sub === 'rentabilidad' && (
        <>
          <div className="elaboration-analysis-tabs" role="tablist" aria-label="Análisis de Elaboración">
            <button type="button" role="tab" aria-selected={analysisMode === 'alerts'} onClick={() => setAnalysisMode('alerts')} className={analysisMode === 'alerts' ? 'is-active' : ''}>Alertas</button>
            <button type="button" role="tab" aria-selected={analysisMode === 'ranking'} onClick={() => setAnalysisMode('ranking')} className={analysisMode === 'ranking' ? 'is-active' : ''}>Ranking</button>
            <button type="button" role="tab" aria-selected={analysisMode === 'compare'} onClick={() => setAnalysisMode('compare')} className={analysisMode === 'compare' ? 'is-active' : ''}>Comparar</button>
            <button type="button" role="tab" aria-selected={analysisMode === 'ingredients'} onClick={() => setAnalysisMode('ingredients')} className={analysisMode === 'ingredients' ? 'is-active' : ''}>Precios</button>
            <button type="button" role="tab" aria-selected={analysisMode === 'waste'} onClick={() => setAnalysisMode('waste')} className={analysisMode === 'waste' ? 'is-active' : ''}>Mermas</button>
          </div>

          {analysisMode === 'alerts' && (
            <>
              <div className={`elaboration-profit-hero${alertSummary.losses > 0 ? ' has-loss' : ''}`}>
                <div className="elaboration-profit-hero-copy">
                  <span className="elaboration-profit-mark" aria-hidden="true"><Icon name={alertSummary.losses > 0 ? 'alert' : 'check'} size={22} /></span>
                  <div>
                    <h3>{alertSummary.losses > 0 ? `${fmtInt(alertSummary.losses)} producto${alertSummary.losses === 1 ? '' : 's'} se vende${alertSummary.losses === 1 ? '' : 'n'} por debajo del costo` : 'No hay pérdidas detectadas'}</h3>
                    <p>{alertSummary.losses > 0 ? `Si vendes una ración de cada uno, la pérdida estimada suma ${fmt(alertSummary.lossPerRound)} CUP.` : 'Las fichas completas con precio de venta vigente cubren su costo estimado.'}</p>
                  </div>
                </div>
                <InfoHelp label="Cómo se calcula la rentabilidad">Compara el <strong>precio de venta vigente de Productos</strong> con el costo por ración guardado en cada ficha: ingredientes, merma, mano de obra, cocción y gastos generales. El costo por ración es el precio mínimo para no perder. Son valores aproximados y cambian cuando actualizas el precio o la ficha.</InfoHelp>
              </div>
              <div className="elaboration-profit-stats" aria-label="Resumen de rentabilidad">
                <Metric label="Con pérdida" value={String(alertSummary.losses)} strong />
                <Metric label="Bajo la meta" value={String(alertSummary.low)} />
                <Metric label="Rentables" value={String(alertSummary.healthy)} />
                <Metric label="Por completar" value={String(alertSummary.incomplete + alertSummary.withoutRecipe)} />
              </div>
              <label className="elaboration-search">
                <span className="sr-only">Buscar en rentabilidad</span>
                <Icon name="search" size={18} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto o área…" />
              </label>
              {profitability.items.length === 0 ? (
                <div className="elaboration-empty"><h3 className="font-bold">Aún no hay fichas para analizar</h3><p className="small muted" style={{ marginTop: 4 }}>Crea y guarda una ficha de costo. Cuando tenga costo por ración y precio de venta vigente, aparecerá aquí.</p><button type="button" onClick={() => setSub('productos')} className="btn primary" style={{ marginTop: 12 }}>Ir a productos</button></div>
              ) : visibleProfitability.length === 0 ? (
                <div className="elaboration-empty"><h3 className="font-bold">Sin coincidencias</h3><p className="small muted" style={{ marginTop: 4 }}>Cambia la búsqueda para ver otros productos.</p></div>
              ) : (
                <div className="elaboration-profit-list">
                  {visibleProfitability.map((item) => {
                    const statusLabel = item.status === 'loss' ? 'Pérdida' : item.status === 'low' ? 'Bajo la meta' : item.status === 'healthy' ? 'Rentable' : 'Faltan datos'
                    const currency = item.recipe.currency.trim() || 'CUP'
                    return (
                      <article key={item.product.productKey} className={`elaboration-profit-card is-${item.status}`}>
                        <div className="elaboration-profit-product">
                          <MediaImage kind="foto-producto" entityKey={productMediaKey(item.product.dept, item.product.name, 'u')} alt="" className="elaboration-product-thumb" fallback={<span className="elaboration-product-placeholder" aria-hidden="true">{item.product.name.slice(0, 1).toUpperCase()}</span>} />
                          <div>
                            <div className="elaboration-profit-title"><h3>{item.product.name}</h3><span>{statusLabel}</span></div>
                            <p>{item.product.dept} · Actualizada {fmtDate(item.recipe.updatedAt.slice(0, 10))}</p>
                          </div>
                        </div>
                        <div className="elaboration-profit-values">
                          <div><span>Venta vigente</span><strong>{item.currentSale != null && item.currentSale > 0 ? `${fmt(item.currentSale)} ${currency}` : 'Sin precio'}</strong></div>
                          <div><span>Costo por ración</span><strong>{item.costPerServing > 0 ? `${fmt(item.costPerServing)} ${currency}` : 'Sin costo'}</strong></div>
                          <div><span>{item.status === 'loss' ? 'Pierde por ración' : 'Resultado por ración'}</span><strong>{item.profit != null ? `${fmt(Math.abs(item.profit))} ${currency}` : '—'}</strong></div>
                          <div><span>Margen actual</span><strong>{item.margin != null ? `${fmt(item.margin)} %` : '—'}</strong></div>
                        </div>
                        <div className="elaboration-profit-foot">
                          <p>{item.status === 'loss' ? `Para no perder, el precio debe superar ${fmt(item.costPerServing)} ${currency}.` : item.status === 'low' ? `Cubre el costo, pero no alcanza la meta global de ${fmt(item.targetMarginPct)}%.` : item.status === 'healthy' ? `Supera la meta global de margen de ${fmt(item.targetMarginPct)}%.` : 'Completa el precio vigente y los costos de la ficha para calcular.'}{item.targetPrice > 0 && item.status !== 'healthy' ? ` Precio sugerido con margen y colchón globales: ${fmt(item.targetPrice)} ${currency}.` : ''}</p>
                          <button type="button" onClick={() => openProduct(products.find((p) => p.productKey === item.product.productKey) ?? { productKey: item.product.productKey, name: item.product.name, dept: item.product.dept, um: 'u', currentStock: 0, salePrice: item.product.salePrice, manual: false })}>Revisar ficha</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
              {alertSummary.withoutRecipe > 0 && (
                <div className="elaboration-missing-recipes">
                  <div><strong>{fmtInt(alertSummary.withoutRecipe)} producto{alertSummary.withoutRecipe === 1 ? '' : 's'} sin ficha</strong><p>No se puede comprobar su rentabilidad hasta guardar ingredientes, rendimiento y costos.</p></div>
                  <button type="button" onClick={() => setSub('productos')}>Completar fichas</button>
                </div>
              )}
            </>
          )}

          {analysisMode === 'ranking' && (
            <>
              <div className="elaboration-section-intro">
                <div><h3>Ranking de rentabilidad</h3><p>Ordenado por margen actual, del plato más rentable al menos rentable.</p></div>
                <InfoHelp label="Cómo se ordena el ranking">El margen usa el precio de venta vigente y el costo por ración de la ficha guardada. Los productos sin datos suficientes no entran al ranking.</InfoHelp>
              </div>
              {rankedProfitability.length === 0 ? (
                <div className="elaboration-empty"><h3 className="font-bold">Sin datos para ordenar</h3><p className="small muted" style={{ marginTop: 4 }}>Guarda fichas con costo y precio de venta para crear el ranking.</p></div>
              ) : (
                <ol className="elaboration-ranking-list">
                  {rankedProfitability.map((item, index) => (
                    <li key={item.product.productKey}>
                      <span className="elaboration-rank-number">{index + 1}</span>
                      <div><strong>{item.product.name}</strong><small>{item.product.dept}</small></div>
                      <div><strong>{fmt(item.margin ?? 0)}%</strong><small>{item.profit != null ? `${item.profit >= 0 ? '+' : '−'}${fmt(Math.abs(item.profit))} ${item.recipe.currency || 'CUP'} por ración` : 'Sin resultado'}</small></div>
                      <button type="button" onClick={() => openProduct(products.find((p) => p.productKey === item.product.productKey) ?? { productKey: item.product.productKey, name: item.product.name, dept: item.product.dept, um: 'u', currentStock: 0, salePrice: item.product.salePrice, manual: false })}>Ver ficha</button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          {analysisMode === 'compare' && (
            <>
              <div className="elaboration-section-intro"><div><h3>Comparador de recetas</h3><p>Elige dos platos para contrastar costo, venta, ganancia, margen y precio sugerido.</p></div></div>
              <div className="elaboration-compare-pickers">
                <label><span>Primera receta</span><select value={compareLeft} onChange={(e) => setCompareLeft(e.target.value)}><option value="">Seleccionar…</option>{profitability.items.map((i) => <option key={i.product.productKey} value={i.product.productKey}>{i.product.name}</option>)}</select></label>
                <label><span>Segunda receta</span><select value={compareRight} onChange={(e) => setCompareRight(e.target.value)}><option value="">Seleccionar…</option>{profitability.items.filter((i) => i.product.productKey !== compareLeft).map((i) => <option key={i.product.productKey} value={i.product.productKey}>{i.product.name}</option>)}</select></label>
              </div>
              {(() => {
                const choices = [profitability.items.find((i) => i.product.productKey === compareLeft), profitability.items.find((i) => i.product.productKey === compareRight)]
                if (!choices[0] || !choices[1]) return <div className="elaboration-empty"><h3 className="font-bold">Selecciona dos recetas</h3><p className="small muted" style={{ marginTop: 4 }}>La comparación se muestra cuando ambos campos estén completos.</p></div>
                return (
                  <div className="elaboration-compare-grid">
                    {choices.map((item) => item ? (
                      <article key={item.product.productKey}>
                        <h3>{item.product.name}</h3><p>{item.product.dept}</p>
                        <dl>
                          <div><dt>Costo por ración</dt><dd>{fmt(item.costPerServing)} {item.recipe.currency || 'CUP'}</dd></div>
                          <div><dt>Venta vigente</dt><dd>{item.currentSale != null ? fmt(item.currentSale) : '—'} {item.recipe.currency || 'CUP'}</dd></div>
                          <div><dt>Ganancia</dt><dd>{item.profit != null ? fmt(item.profit) : '—'} {item.recipe.currency || 'CUP'}</dd></div>
                          <div><dt>Margen</dt><dd>{item.margin != null ? `${fmt(item.margin)}%` : '—'}</dd></div>
                          <div><dt>Precio sugerido</dt><dd>{fmt(item.targetPrice)} {item.recipe.currency || 'CUP'}</dd></div>
                          <div><dt>Merma estimada</dt><dd>{fmt(item.recipe.wastePct)}%</dd></div>
                        </dl>
                        <button type="button" onClick={() => openProduct(products.find((p) => p.productKey === item.product.productKey) ?? { productKey: item.product.productKey, name: item.product.name, dept: item.product.dept, um: 'u', currentStock: 0, salePrice: item.product.salePrice, manual: false })}>Revisar ficha</button>
                      </article>
                    ) : null)}
                  </div>
                )
              })()}
            </>
          )}

          {analysisMode === 'ingredients' && (
            <>
              <div className="elaboration-section-intro">
                <div><h3>Precios de ingredientes</h3><p>Cada vez que guardas una ficha, el sistema conserva el costo unitario y compara su evolución.</p></div>
                <InfoHelp label="Cómo funcionan las alternativas">Si un ingrediente sube 20% o más, se muestran candidatos usados en otras fichas con la misma unidad y menor costo. Son opciones para revisar: confirma que realmente puedan sustituirse antes de cambiar la receta.</InfoHelp>
              </div>
              {insights.length === 0 ? (
                <div className="elaboration-empty"><h3 className="font-bold">Aún no hay historial</h3><p className="small muted" style={{ marginTop: 4 }}>Se empezará a formar cuando guardes fichas con precios de ingredientes.</p></div>
              ) : (
                <div className="elaboration-ingredient-history">
                  {insights.map((item) => (
                    <article key={item.key} className={item.risePct != null && item.risePct >= 20 ? 'has-rise' : ''}>
                      <div><h3>{item.latest.ingredient}</h3><p>{item.latest.productName} · {fmtDate(item.latest.recordedOn)}</p></div>
                      <div className="elaboration-history-price">
                        <strong>{fmt(item.latest.unitCost)} CUP/{item.latest.unit || 'unidad'}</strong>
                        <span>{item.risePct == null ? 'Primer registro' : `${item.risePct >= 0 ? '+' : ''}${fmt(item.risePct)}% desde el precio anterior`}</span>
                      </div>
                      {item.risePct != null && item.risePct >= 20 && (
                        <div className="elaboration-substitute-alert">
                          <strong>Subida importante</strong>
                          <p>{item.alternatives.length ? `Candidatos más económicos en ${item.latest.unit || 'la misma unidad'}: ${item.alternatives.map((c) => `${c.latest.ingredient} (${fmt(c.latest.unitCost)} CUP)`).join(', ')}. Confirma que sean compatibles.` : 'No hay otra opción registrada con la misma unidad y menor costo.'}</p>
                        </div>
                      )}
                      <details>
                        <summary>Ver historial ({fmtInt(item.entries.length)})</summary>
                        <div>{item.entries.map((entry) => <p key={entry.id}><span>{fmtDate(entry.recordedOn)}</span><strong>{fmt(entry.unitCost)} CUP/{entry.unit || 'unidad'}</strong><small>{entry.productName}</small></p>)}</div>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {analysisMode === 'waste' && (
            <>
              <div className="elaboration-section-intro">
                <div><h3>Merma real vs. estimada</h3><p>Compara lo previsto en cada ficha con lo que realmente se perdió en las preparaciones registradas.</p></div>
                <InfoHelp label="Cómo registrar la merma real">Abre la ficha del producto y usa «Registrar preparación». Indica la cantidad base usada, cuánto se perdió y el motivo, por ejemplo quemado, corte incorrecto, deterioro o derrame.</InfoHelp>
              </div>
              {store.wasteLogs.length === 0 ? (
                <div className="elaboration-empty"><h3 className="font-bold">Sin preparaciones registradas</h3><p className="small muted" style={{ marginTop: 4 }}>Entra a una ficha guardada para anotar la merma real y su motivo.</p></div>
              ) : (
                <div className="elaboration-waste-list">
                  {store.wasteLogs.map((log) => (
                    <article key={log.id}>
                      <div><h3>{log.productName}</h3><p>{fmtDate(log.preparedOn)} · {fmt(log.preparedServings)} raciones</p></div>
                      <div><span>Estimada <strong>{fmt(log.estimatedWastePct)}%</strong></span><span>Real <strong>{fmt(log.actualWastePct)}%</strong></span></div>
                      <p><strong>Motivo:</strong> {log.reason}{log.note ? ` · ${log.note}` : ''}</p>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {sub === 'barra' && <BarraMl catalog={catalog} />}

      {sub === 'paquetes' && (
        <Paquetes
          refsView={refsView}
          comparisons={comparisons}
          isAdmin={isAdmin}
          onConfirmDerived={confirmDerived}
          onConfirmSuggestion={confirmSuggestion}
          onSaveManual={(ref) => void persistRef(ref, `Referencia «${ref.name}» guardada.`)}
          onRemove={(id, name) => void removeRef(id, name)}
        />
      )}

      {sub === 'precios' && (
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
      )}

      {sub === 'historial' && (
        <>
          <div className="elaboration-section-intro">
            <div><h3>Historial de fichas archivadas</h3><p>Las fichas de costo confirmadas no se borran: cuando un producto sale de la lista de Elaboración, su ficha queda guardada aquí, con sus ingredientes y precios.</p></div>
            <InfoHelp label="Cómo vuelve una ficha archivada">Abre la ficha para consultarla o corregirla: al guardar cambios, el producto vuelve a la lista activa. Con «Reactivar producto» regresa tal cual está, sin tocar la ficha.</InfoHelp>
          </div>
          {removeMsg && <p role="status" className="small elab-note">{removeMsg}</p>}
          {archivedRecipes.length === 0 ? (
            <div className="elaboration-empty"><h3 className="font-bold">Sin fichas archivadas</h3><p className="small muted" style={{ marginTop: 4 }}>Cuando quites de Elaboración un producto que ya tenga ficha confirmada, su ficha aparecerá aquí en vez de borrarse.</p></div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {archivedRecipes.map((recipe) => {
                const ingredientsCost = recipe.ingredients.reduce((sum, item) => sum + ingredientLineCost(item), 0)
                const laborCost = recipe.laborMinutes > 0 && recipe.workdayHours > 0 ? recipe.laborDailySalarySnapshot * recipe.laborMinutes / (recipe.workdayHours * 60) : 0
                const direct = ingredientsCost * (1 + recipe.wastePct / 100) + laborCost + recipe.cookingHours * hourCost
                const costPerServing = recipe.servings > 0 ? direct * (1 + settings.defaultOverheadPct / 100) / recipe.servings : 0
                const currency = recipe.currency.trim() || 'CUP'
                return (
                  <article key={recipe.id} className="card">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <h3>{recipe.productName}</h3>
                        <p className="small muted" style={{ marginTop: 2 }}>{recipe.dept}{recipe.manual ? ' · Creado a mano' : ''} · Ficha actualizada {fmtDate(recipe.updatedAt.slice(0, 10))}</p>
                      </div>
                      <span className="chip">Archivada</span>
                    </div>
                    <div className="elab-metrics-strip">
                      <Metric label="Costo por ración" value={costPerServing > 0 ? `${fmt(costPerServing)} ${currency}` : '—'} />
                      <Metric label="Venta en la ficha" value={recipe.salePrice > 0 ? `${fmt(recipe.salePrice)} ${currency}` : '—'} />
                      <Metric label="Ingredientes" value={String(recipe.ingredients.length)} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <button type="button" className="btn primary" onClick={() => openProduct({ productKey: recipe.productKey, name: recipe.productName, dept: recipe.dept, um: 'u', currentStock: 0, salePrice: recipe.salePrice > 0 ? recipe.salePrice : null, manual: recipe.manual })}>Ver ficha</button>
                      {recipe.restorable && store.removedProducts.some((r) => r.productKey === recipe.productKey)
                        ? <button type="button" className="btn" onClick={() => restoreProduct(recipe.productKey)}>Reactivar producto</button>
                        : recipe.restorable ? null : <span className="small muted">Su producto ya no está en el catálogo; la ficha se conserva como consulta.</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {refsView.history.length > 0 && (
            <Card>
              <h3>Historial de precios de referencias de paquetes</h3>
              <div className="list">
                {refsView.history.slice(0, 15).map((h) => (
                  <div className="row" key={h.id}>
                    <span><strong>{h.packageName}</strong><br /><span className="small muted">{fmtDate(h.recordedOn)} · {h.source === 'gasto' ? 'Aprendido de Gastos' : 'Manual'}{h.place ? ` · ${h.place}` : ''}</span></span>
                    <span className="mono">{fmtCUP(h.packageCost)}{h.changeAmount != null && h.changeBasis !== 'ninguna' ? <span className="small muted"> · {h.changeAmount > 0 ? 'subió' : h.changeAmount < 0 ? 'bajó' : 'igual'} {fmtCUP(Math.abs(h.changeAmount))}</span> : null}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
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
              <MediaImage kind="foto-producto" entityKey={productMediaKey(p.dept, p.name, p.um)} alt="" className="media-thumb elab-photo" />
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
