// Declaraciones de tipos para el núcleo de Productos / Elaboración /
// Almacén (productosCore.mjs): libro de existencias, catálogo maestro,
// sugerencias de precio de Queen, almacén y referencias de paquetes.
import type { DayData, Expense, PackageObservation, PackageReference } from '../types'

export declare function normalizeLoose(s: string): string
export declare function productKeyOf(dept: string, name: string, um: string): string
export declare function menuDeptOf(dept: string): string
export declare function autoMenuFamily(dept: string, name: string): string

export interface BookHistoryRow {
  date: string
  conFila: boolean
  saldoInicial: number
  ipvSaldoInicial: number | null
  aperturaEsperada: number | null
  entradas: number
  entradasIpv: number
  disponible: number
  ipvDisponible: number | null
  bajas: number
  traslados: number
  bajasIpv: number
  trasladosIpv: number
  bajasManual: number
  trasladosManual: number
  adjustments: InventoryAdjustment[]
  aLaVenta: number
  ipvALaVenta: number | null
  ventas: number
  saldoFinal: number
  ipvSaldoFinal: number | null
  ipvFuente: string | null
  diferencia: number | null
}

export interface BookProduct {
  key: string
  dept: string
  name: string
  um: string
  firstSeen: string | null
  lastSeen: string | null
  history: BookHistoryRow[]
  currentStock: number
  lastIpvSaldoFinal: number | null
  lastDiferencia: number | null
  hasDescuadre: boolean
  hasInitialSet: boolean
  faltaSaldoInicial: boolean
}

/** Ajuste manual del libro (forma del servidor original). */
export interface InventoryAdjustment {
  id: string
  productKey: string
  dept: string
  productName: string
  um: string
  date: string
  kind: 'inicial' | 'baja' | 'traslado'
  quantity: number
  note: string
}

export interface InventoryDescuadre {
  productKey: string
  dept: string
  name: string
  um: string
  date: string
  diferencia: number
  esperado: number | null
  contado: number | null
  texto: string
}

export interface InventoryBook {
  products: BookProduct[]
  descuadres: InventoryDescuadre[]
  latestDate: string | null
  totalProductos: number
  conExistencia: number
}

export declare function buildInventoryBook(days: DayData[], adjustments?: InventoryAdjustment[]): InventoryBook

export interface EntryHistoryRow {
  date: string
  cantidad: number
  importe: number
  costoEntrada: number
  costoAnterior: number | null
  costoPromedio: number
  distinto: boolean
}

export interface PriceHistoryEvent {
  date: string
  oldPrice: number | null
  newPrice: number
  source: string
  note: string
}

export interface PriceCheck {
  date: string
  unidades: number
  importeVenta: number
  precioUnico: number
  esperadoUnico: number
  diferencia: number
  estado: 'ok' | 'explicada' | 'sin-explicar'
  texto: string
  unidadesPrecioViejo: number | null
  unidadesPrecioNuevo: number | null
  precioViejo: number | null
  precioNuevo: number | null
}

export interface CatalogProduct extends BookProduct {
  productKey: string
  unidadesVendidas: number
  ventaHistorica: number
  gananciaHistorica: number
  diasConVenta: number
  promedioVentaDiaria: number
  coberturaDias: number | null
  stockStatus: 'sin-ritmo' | 'normal' | 'bajo' | 'critico' | 'agotado'
  precioVentaVigente: number | null
  precioVentaFuente: string | null
  precioCambioHoy: string | null
  costoPromedio: number | null
  costoUltimaEntrada: number | null
  precioCompraVigente: number | null
  gananciaUnidad: number | null
  margenPct: number | null
  valorCosto: number | null
  valorVenta: number | null
  primeraVez: string | null
  primeraEntrada: string | null
  ultimaEntrada: string | null
  entradasHistorial: EntryHistoryRow[]
  precioHistorial: PriceHistoryEvent[]
  cambiosPrecio: number
  cambiosCosto: number
  priceChecks: PriceCheck[]
  ultimoPriceCheck: PriceCheck | null
  menuFamily: string
}

export interface ProductsCatalog extends InventoryBook {
  products: CatalogProduct[]
  sinExplicar: Array<{ productKey: string; dept: string; name: string; um: string; date: string; texto: string; diferencia: number }>
}

export declare function buildProductsCatalog(days: DayData[]): ProductsCatalog

export interface DetectedPriceChange {
  productKey: string
  dept: string
  name: string
  um: string
  date: string
  kind: 'venta' | 'compra'
  source: 'ipv-consecutivo' | 'ipv-entrada'
  oldPrice: number | null
  newPrice: number
}

export declare function detectPriceChanges(days: DayData[]): DetectedPriceChange[]

export const PRICE_TARGET_ELABORADOS_PCT: number
export const PRICE_TARGET_BEBIDAS_PCT: number
export const PRICE_DEFAULT_OVERHEAD_PCT: number
export declare function priceCategoryOf(dept: string): 'bebidas' | 'elaborados'

export interface PriceSuggestionHistory {
  entradasRegistradas: number
  costoPromedioHistorico: number | null
  preciosVentaRegistrados: number
  ventaPromedioHistorica: number | null
  margenHistoricoPct: number | null
  diasConVenta: number
  precioSugeridoHistorico: number | null
}

export interface PriceSuggestionItem {
  productKey: string
  name: string
  dept: string
  um: string
  category: 'bebidas' | 'elaborados'
  salePrice: number | null
  costPrice: number | null
  marginPct: number | null
  targetPct: number
  status: 'perdida' | 'riesgo' | 'bajo' | 'sano' | 'sin-datos'
  breakEvenPrice: number | null
  suggestedPrice: number | null
  suggestionBasis: 'historico' | 'meta' | null
  history: PriceSuggestionHistory | null
}

export interface PriceSuggestions {
  targets: { elaborados: number; bebidas: number }
  overheadPct: number
  averages: { elaborados: number | null; bebidas: number | null; general: number | null }
  sinDatos: number
  counts: { perdida: number; riesgo: number; bajo: number; sano: number }
  items: PriceSuggestionItem[]
}

export declare function buildPriceSuggestions(catalog: ProductsCatalog, overheadPct?: number): PriceSuggestions

export declare function warehouseProductKey(product: string): string

export interface WarehouseBalance {
  key: string
  product: string
  um: string
  saldo: number
  lastDate: string | null
  entradas: number
  bajas: number
  salidas: number
  fotos: number
  costoVigente: number | null
  sinCosto: boolean
}

export interface WarehouseSalida {
  date: string
  product: string
  um: string
  cantidad: number
  precioCompraFoto: number
  costoVigente: number | null
  fuenteCosto: 'catalogo' | 'foto-ipv' | 'ambiguo' | 'sin-costo'
  importe: number | null
  estado: 'con-costo' | 'pendiente-costo'
  gasto: { origin: string; sourceKey: string; date: string; concept: string; quantity: number; unitValue: number; total: number } | null
}

export interface WarehouseView {
  rows: Array<{ date: string; product: string; um: string; saldoInicial: number; entrada: number; baja: number; salida: number; saldoFinal: number; precioCompra: number; valor: number; observacion: string }>
  balances: WarehouseBalance[]
  salidas: WarehouseSalida[]
  pendientesCosto: string[]
  totals: { productos: number; fotos: number; entradas: number; bajas: number; salidas: number; importeSalidasConCosto: number }
}

export declare function buildWarehouse(days: DayData[], catalog: ProductsCatalog): WarehouseView

export declare function findMenuRuleConflicts(menuItemNames: string[]): Array<{ name: string; motivo: string }>

export declare function packageDerivedCosts(
  packageCost: number,
  unitsPerPackage: number,
  subUnitsPerUnit: number,
): { unitCost: number; totalSubUnits: number | null; subUnitCost: number | null }

export declare function detectPackageLabel(concept: string): string | null
export declare function matchPackageReference<T extends { name: string; packageLabel?: string; variety?: string }>(concept: string, refs: T[]): T | null
export declare function parseYieldFromText(text: string): { units: number; unitLabel: string } | null

export interface DerivedPackageEntry {
  id: string
  packageId: string
  packageName: string
  recordedOn: string
  packageCost: number
  unitsPerPackage: number
  subUnitsPerUnit: number
  unitCost: number
  subUnitCost: number | null
  note: string
  source: 'manual' | 'gasto'
  sourceRef: string
  place: string
  presentation: string
}

export interface DerivedPackageHistoryEntry extends DerivedPackageEntry {
  prevCost: number | null
  changeAmount: number | null
  changePct: number | null
  changeBasis: 'paquete' | 'unidad' | 'ninguna'
}

export interface DerivedPackage {
  id: string
  stored: boolean
  aprendida: boolean
  name: string
  variety: string
  packageLabel: string
  unitLabel: string
  unitsPerPackage: number
  packageCost: number | null
  subUnitLabel: string
  subUnitsPerUnit: number
  supplier: string
  note: string
  lastSource: 'manual' | 'gasto'
  costPerUnit: number | null
  totalSubUnitsPerPackage: number | null
  costPerSubUnit: number | null
  previousCost: number | null
  changeAmount: number | null
  changePct: number | null
  trend: 'sin-historial' | 'subio' | 'bajo' | 'igual'
  historyCount: number
  lastRecordedOn: string | null
  fairUnitCost: number | null
  fairPackageCost: number | null
  minUnitCost: number | null
  maxUnitCost: number | null
  entries: DerivedPackageEntry[]
}

export interface PackageSuggestion {
  conceptKey: string
  concept: string
  date: string
  quantity: number
  unitValue: number
  total: number
  packageLabel: string
  suggestedName: string
}

export interface PackageReferencesView {
  packages: DerivedPackage[]
  history: DerivedPackageHistoryEntry[]
  suggestions: PackageSuggestion[]
}

export declare function derivePackageReferences(
  storedRefs: PackageReference[],
  expenses: Expense[],
): PackageReferencesView

export interface ExpenseComparison {
  expenseId: string
  date: string
  concept: string
  quantity: number
  unitValue: number
  total: number
  referenceId: string
  referenceName: string
  refPackageCost: number
  refBasis: string
  diffPct: number
  verdict: 'en-linea' | 'mas-caro' | 'mas-barato'
}

export declare function expenseComparisons(expenses: Expense[], packages: DerivedPackage[]): ExpenseComparison[]

export type { PackageObservation }
