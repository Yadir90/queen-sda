/* Salidas de almacén → Gastos (regla del dueño, 2026-10-20, puerto del
   servidor original actions.ts:6823-6960): «Las cosas de almacén cuando
   se les dé salida, automáticamente, si tienen precio de costo, pasan a
   gastos». La salida es la rebaja manual de Almacén. El precio de costo
   es el vigente del catálogo (precioCompraVigente de productosCore),
   resuelto por identidad fuerte primero —el código de barras de la
   ficha de almacén— y después por nombre exacto (nombre oficial o
   alias aprendidos de la ficha). Si el nombre coincide con productos
   de costos distintos, el precio es ambiguo y NO se crea gasto:
   adivinar una cifra de dinero rompería la confianza en los totales.
   El gasto queda enlazado (origin='almacen', sourceKey='almacen:<id>')
   y sigue a la rebaja: editarla lo actualiza, borrarla lo elimina.
   Sin precio de costo no hay gasto: la rebaja queda solo como registro
   físico. El gasto enlazado no se edita ni se borra a mano en Gastos. */

import type { Expense, StoredData, WarehouseEntry } from '../types'
import { fmtDecEs } from './utils.ts'
import { buildProductsCatalog } from './productosCore.mjs'
import { warehouseProductKey } from './modulosExtended.ts'

export const WAREHOUSE_EXPENSE_ORIGIN = 'almacen'
export const warehouseExpenseSourceKey = (entryId: number): string => `almacen:${entryId}`

const normalizeBarcode = (value: string): string => value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 64)

const GENERAL_DEPT = 'General / todo el negocio'

/** deptForCuentasConcept del original, verbatim. */
export function deptForCuentasConcept(concept: string, rawName: string): string {
  const n = warehouseProductKey(`${concept} ${rawName}`)
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(n))
  if (has('papel', 'sanitario', 'higienico', 'servilleta', 'detergente', 'jabon', 'cloro', 'lejia', 'desinfectante', 'limpieza', 'escoba', 'trapeador', 'fregona', 'ambientador', 'insecticida', 'toalla', 'bolsa', 'rollo')) return GENERAL_DEPT
  if (has('cerveza', 'ron', 'whisky', 'vodka', 'vino', 'licor', 'ginebra', 'tequila', 'crema', 'sidra', 'espumoso', 'cervezas', 'rones')) return 'Bebidas alcohólicas'
  if (has('refresco', 'jugo', 'agua', 'malta', 'energizante', 'soda', 'limonada', 'batido')) return 'Bebidas no alcohólicas'
  if (has('pizza', 'pizzas')) return 'Pizzas'
  if (has('mojito', 'daiquiri', 'coctel', 'cantina', 'cubalibre')) return 'Cantina'
  if (has('aceite', 'platano', 'arroz', 'harina', 'pollo', 'carne', 'cerdo', 'pescado', 'camaron', 'langosta', 'huevo', 'leche', 'queso', 'pan', 'verdura', 'vianda', 'papa', 'boniato', 'yuca', 'sal', 'azucar', 'frijol', 'pasta', 'salsa', 'condimento', 'marisco', 'mariscos', 'atun', 'jamon', 'salchicha')) return 'Elaboración'
  return GENERAL_DEPT
}

/** Precio de costo vigente de un producto de almacén, o null si el
 *  sistema no lo conoce de forma inequívoca (buildWarehouseCostIndex +
 *  warehouseCostPriceFor del original, sobre el catálogo del clon). */
export function warehouseCostFor(data: StoredData, productName: string): number | null {
  const catalog = buildProductsCatalog(data.days, data.inventoryAdjustments)
  const costsByName = new Map<string, Set<number>>()
  const addName = (name: string, cost: number | null) => {
    if (cost == null || !(cost > 0)) return
    const key = warehouseProductKey(name)
    if (!key) return
    const set = costsByName.get(key) ?? new Set<number>()
    set.add(Math.round(cost * 100) / 100)
    costsByName.set(key, set)
  }
  for (const product of catalog.products) addName(product.name, product.precioCompraVigente)
  const byName = new Map<string, number | null>()
  for (const [key, set] of costsByName) byName.set(key, set.size === 1 ? [...set][0]! : null)
  const byBarcode = new Map<string, number>()
  for (const [key, meta] of Object.entries(data.warehouseMeta ?? {})) {
    if (!meta.barcode) continue
    const cost = byName.get(key)
    if (cost != null && cost > 0) byBarcode.set(normalizeBarcode(meta.barcode), cost)
  }

  const key = warehouseProductKey(productName)
  if (!key) return null
  const row = (data.warehouseMeta ?? {})[key]
  const barcode = row?.barcode ? normalizeBarcode(row.barcode) : ''
  if (barcode) {
    const byCode = byBarcode.get(barcode)
    if (byCode != null && byCode > 0) return byCode
  }
  const names = new Set<string>([key])
  for (const alias of row?.aliases ?? []) names.add(warehouseProductKey(alias))
  for (const [otherKey, other] of Object.entries(data.warehouseMeta ?? {})) {
    if ((other.aliases ?? []).some((alias) => warehouseProductKey(alias) === key)) names.add(otherKey)
  }
  const costs = new Set<number>()
  for (const name of names) {
    const cost = byName.get(name)
    if (cost != null && cost > 0) costs.add(cost)
  }
  return costs.size === 1 ? [...costs][0]! : null
}

/* D-R5-05: agrupación manual vía fmtDecEs (el Intl es-ES de Android no
   separa los importes de 4 cifras). */
const fmtQty = (n: number) => fmtDecEs(n, 3)
const fmtMoney = (n: number) => fmtDecEs(n, 2)

export type WarehouseExpenseValues = Omit<Expense, 'id'>

/** Los valores del gasto enlazado de una rebaja (syncWarehouseWithdrawalExpense):
 *  null cuando la rebaja no debe tener gasto (no es rebaja, cantidad 0 o
 *  sin precio de costo inequívoco). */
export function warehouseExpenseValues(entry: WarehouseEntry, cost: number | null): WarehouseExpenseValues | null {
  if (entry.kind !== 'rebaja') return null
  const quantity = Number(entry.quantity) || 0
  if (!(quantity > 0)) return null
  const product = String(entry.product ?? '').trim()
  if (!product) return null
  if (cost == null || !(cost > 0)) return null
  const total = Math.round(quantity * cost)
  if (!(total > 0)) return null
  const purpose = String(entry.purpose ?? '').trim()
  return {
    date: entry.date,
    concept: product,
    quantity: 1,
    unitValue: total,
    total,
    category: 'Salida de almacén',
    dept: deptForCuentasConcept(product, product),
    note: `Salida de almacén automática · ${fmtQty(quantity)} × ${fmtMoney(cost)} CUP (precio de costo vigente)${purpose ? ` · Para: ${purpose}` : ''}`,
    origin: WAREHOUSE_EXPENSE_ORIGIN,
    sourceKey: warehouseExpenseSourceKey(entry.id),
    cycleStart: null,
  }
}

const sameValues = (e: Expense, v: WarehouseExpenseValues): boolean =>
  e.date === v.date && e.concept === v.concept && e.quantity === v.quantity
  && e.unitValue === v.unitValue && e.total === v.total && e.category === v.category
  && e.dept === v.dept && e.note === v.note && e.origin === v.origin && e.sourceKey === v.sourceKey

/** Reconciliación completa e idempotente: devuelve la lista de gastos
 *  que debe existir tras aplicar `entries` (modo local) y las operaciones
 *  por sourceKey para el modo Supabase (solo las que cambian). */
export function reconcileWarehouseExpenses(
  data: StoredData,
  entries: WarehouseEntry[],
): { expenses: Expense[]; ops: Array<{ sourceKey: string; expense: Expense | null }> } {
  const rebajas = entries.filter((e) => e.kind === 'rebaja')
  const liveKeys = new Set(rebajas.map((e) => warehouseExpenseSourceKey(e.id)))
  const expenses: Expense[] = []
  const ops: Array<{ sourceKey: string; expense: Expense | null }> = []
  const handled = new Set<string>()
  for (const e of data.expenses) {
    if (e.origin !== WAREHOUSE_EXPENSE_ORIGIN || !e.sourceKey) { expenses.push(e); continue }
    if (!liveKeys.has(e.sourceKey)) { ops.push({ sourceKey: e.sourceKey, expense: null }); continue }
    handled.add(e.sourceKey)
    const entry = rebajas.find((r) => warehouseExpenseSourceKey(r.id) === e.sourceKey)!
    const values = warehouseExpenseValues(entry, warehouseCostFor(data, entry.product))
    if (!values) { ops.push({ sourceKey: e.sourceKey, expense: null }); continue }
    if (sameValues(e, values)) { expenses.push(e); continue }
    const updated: Expense = { ...values, id: e.id }
    expenses.push(updated)
    ops.push({ sourceKey: e.sourceKey, expense: updated })
  }
  for (const entry of rebajas) {
    const sourceKey = warehouseExpenseSourceKey(entry.id)
    if (handled.has(sourceKey)) continue
    const values = warehouseExpenseValues(entry, warehouseCostFor(data, entry.product))
    if (!values) continue
    const created: Expense = { ...values, id: `gasto-almacen-${entry.id}` }
    expenses.push(created)
    ops.push({ sourceKey, expense: created })
  }
  return { expenses, ops }
}
