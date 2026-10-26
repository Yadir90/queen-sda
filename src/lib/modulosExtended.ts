// Queen SDA — módulos extendidos de la oleada 2: almacén MANUAL e
// Inventario de bienes, con la misma vía de datos que workers-extended.
//
// Fuente real (generada por la coordinación desde la BD del servidor
// original, supabase/modulos-extended-import.sql):
//   app_settings 'almacen-extended' = { entries, meta }
//     entries: movimientos de warehouse_entries del original
//       (acciones listWarehouseEntries / addWarehouseEntry /
//        updateWarehouseEntry / deleteWarehouseEntry de actions.ts)
//     meta: warehouse_product_meta_v1 (código de barras y ficha de
//       imagen/búsqueda por producto)
//   app_settings 'venue-inventory' = { items }
//     items: bienes de venue_inventory_items del original
//       (acciones listVenueInventory / addVenueInventoryItem /
//        updateVenueInventoryItem de actions.ts; la baja del
//        original, deactivateVenueInventoryItem, aquí se hace
//        editando el estado a «Baja» y no hay deleteVenueInventoryItem
//        como acción separada)
// Persistencia de los cambios del administrador: se reescribe la
// MISMA clave de app_settings completa (patrón workers-extended en
// supabaseBackend.ts); en modo local, la misma estructura vive en el
// StoredData del dispositivo (backend.ts). Nada se inventa: los
// campos que el dato no trae quedan vacíos o null.

import type { VenueInventoryItem, WarehouseEntry, WarehouseProductMeta } from '../types'

/** Clave normalizada de producto del original (warehouseProductKey):
 *  sin acentos, minúsculas, espacios colapsados. Es la clave de meta. */
export function warehouseProductKey(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ')
}

type Raw = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const num = (v: unknown): number => numOrNull(v) ?? 0

/** Entrada cruda (snake_case del servidor/SQL o camelCase guardada
 *  por esta copia) → WarehouseEntry del clon. */
export function warehouseEntryFromRaw(r: Raw): WarehouseEntry {
  return {
    id: num(r.id),
    date: str(r.date),
    product: str(r.product),
    quantity: num(r.quantity),
    note: str(r.note),
    kind: r.kind === 'rebaja' ? 'rebaja' : 'entrada',
    purpose: str(r.purpose),
    createdAt: numOrNull(r.created_at ?? r.createdAt),
    updatedAt: numOrNull(r.updated_at ?? r.updatedAt),
  }
}

export function warehouseMetaFromRaw(raw: unknown): Record<string, WarehouseProductMeta> {
  const out: Record<string, WarehouseProductMeta> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = (v && typeof v === 'object' ? v : {}) as Raw
    out[key] = {
      product: str(m.product),
      barcode: str(m.barcode),
      imageStatus: str(m.imageStatus),
      sourceUrl: str(m.sourceUrl),
      productSourceUrl: str(m.productSourceUrl),
      brand: str(m.brand),
      category: str(m.category),
      description: str(m.description),
      aliases: Array.isArray(m.aliases) ? m.aliases.map(str) : [],
      lookupStatus: str(m.lookupStatus),
      updatedAt: str(m.updatedAt),
    }
  }
  return out
}

/** Bien crudo (snake_case del servidor/SQL o camelCase del clon) →
 *  VenueInventoryItem. photoUrl del original NO viaja en el dato
 *  cargado: la foto se busca en la media por nombre (slug). */
export function venueItemFromRaw(r: Raw): VenueInventoryItem {
  return {
    id: num(r.id),
    inventoryId: str(r.inventory_id ?? r.inventoryId),
    acquisitionDate: (r.acquisition_date ?? r.acquisitionDate) ? str(r.acquisition_date ?? r.acquisitionDate).slice(0, 10) : null,
    article: str(r.article),
    unitCost: numOrNull(r.unit_cost ?? r.unitCost),
    quantity: num(r.quantity),
    department: str(r.department),
    currentStatus: str(r.current_status ?? r.currentStatus),
    classification: str(r.classification),
    model: str(r.model),
    manufacturer: str(r.manufacturer),
    observations: str(r.observations),
    source: str(r.source),
  }
}

export interface WarehouseBalance {
  key: string
  product: string
  quantity: number
  entradas: number
  rebajas: number
  meta: WarehouseProductMeta | null
}

/** Existencias calculadas por producto DESDE los movimientos
 *  (totals del AlmacenTab del original): entrada suma, rebaja resta;
 *  orden alfabético en español, como el original. */
export function buildWarehouseBalances(entries: WarehouseEntry[], meta: Record<string, WarehouseProductMeta>): WarehouseBalance[] {
  const byKey = new Map<string, WarehouseBalance>()
  for (const e of entries) {
    const key = warehouseProductKey(e.product)
    let b = byKey.get(key)
    if (!b) {
      b = { key, product: e.product, quantity: 0, entradas: 0, rebajas: 0, meta: meta[key] ?? null }
      byKey.set(key, b)
    }
    if (e.kind === 'rebaja') { b.quantity -= e.quantity; b.rebajas += e.quantity }
    else { b.quantity += e.quantity; b.entradas += e.quantity }
    if (!b.meta && meta[key]) b.meta = meta[key]
  }
  return [...byKey.values()]
    .map((b) => ({ ...b, quantity: Math.abs(b.quantity) < 0.000001 ? 0 : b.quantity }))
    .sort((a, b) => a.product.localeCompare(b.product, 'es', { sensitivity: 'base', numeric: true }))
}

/** Siguiente id de movimiento/bien: max + 1 (los ids del original
 *  son consecutivos del servidor; aquí se continúa la serie real). */
export function nextNumericId(ids: number[]): number {
  return ids.reduce((m, n) => (Number.isFinite(n) && n > m ? n : m), 0) + 1
}

/** Siguiente ID Inventario («IN0007»…) continuando la serie real. */
export function nextInventoryId(items: VenueInventoryItem[]): string {
  let max = 0
  for (const it of items) {
    const m = /^IN(\d+)$/i.exec(it.inventoryId.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `IN${String(max + 1).padStart(4, '0')}`
}
