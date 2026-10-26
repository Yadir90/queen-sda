/* Búsqueda de un código de barras (puerto del lookupWarehouseBarcode
   del original): primero la ficha local (un producto ya registrado con
   ese código), después la caché de búsquedas (la ficha pendiente
   `__barcode__:<código>` de warehouse_product_meta_v1) y por último
   internet. El original busca en la web con su buscador + IA del
   servidor y solo acepta datos respaldados por una fuente real, cuya
   URL copia literalmente. Esta copia no tiene ese servidor: consulta
   OpenFoodFacts, la base abierta de productos por código de barras
   (sin clave, con CORS), y la URL de la fuente es la página del
   producto en esa base — nunca una URL inventada. Si la base no
   conoce el código, el resultado es «not-found», como en el original. */

import type { StoredData, WarehouseProductMeta } from '../types'
import { warehouseProductKey } from './modulosExtended'

export const normalizeBarcode = (value: string): string => value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 64)
export const pendingBarcodeKey = (barcode: string): string => `__barcode__:${barcode}`

export interface BarcodeLookupResult {
  status: 'local' | 'ready' | 'not-found' | 'error'
  product: string
  brand: string
  category: string
  description: string
  productSourceUrl: string
}

/** ¿Ya hay un producto registrado con este código? Devuelve su ficha. */
export function localBarcodeMatch(data: StoredData, barcode: string): { key: string; meta: WarehouseProductMeta } | null {
  const code = normalizeBarcode(barcode)
  for (const [key, meta] of Object.entries(data.warehouseMeta ?? {})) {
    if (key.startsWith('__barcode__:')) continue
    if (meta.barcode && normalizeBarcode(meta.barcode) === code) return { key, meta }
  }
  return null
}

interface OffProduct {
  product_name_es?: string
  product_name?: string
  brands?: string
  categories?: string
  generic_name_es?: string
  generic_name?: string
}

/** Consulta OpenFoodFacts por el código. Red caída o respuesta rara →
 *  'error' (el original distingue error de no-encontrado igual). */
export async function lookupBarcodeOnline(barcode: string): Promise<BarcodeLookupResult> {
  const code = normalizeBarcode(barcode)
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return { status: 'not-found', product: '', brand: '', category: '', description: '', productSourceUrl: '' }
    if (!res.ok) return { status: 'error', product: '', brand: '', category: '', description: '', productSourceUrl: '' }
    const json = (await res.json()) as { status?: number; product?: OffProduct }
    const p = json.product
    if (json.status !== 1 || !p) return { status: 'not-found', product: '', brand: '', category: '', description: '', productSourceUrl: '' }
    const name = (p.product_name_es || p.product_name || '').trim()
    if (!name) return { status: 'not-found', product: '', brand: '', category: '', description: '', productSourceUrl: '' }
    const categories = (p.categories ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    return {
      status: 'ready',
      product: name,
      brand: (p.brands ?? '').split(',')[0]?.trim() ?? '',
      category: categories.length ? categories[categories.length - 1]! : '',
      description: (p.generic_name_es || p.generic_name || '').trim(),
      productSourceUrl: `https://world.openfoodfacts.org/product/${code}`,
    }
  } catch {
    return { status: 'error', product: '', brand: '', category: '', description: '', productSourceUrl: '' }
  }
}

/** Flujo completo del original: local → caché pendiente → internet
 *  (guardando la caché pendiente en los metadatos que devuelve). */
export async function lookupWarehouseBarcode(
  data: StoredData,
  barcode: string,
): Promise<{ result: BarcodeLookupResult; metaPatch: Record<string, WarehouseProductMeta> | null }> {
  const code = normalizeBarcode(barcode)
  const local = localBarcodeMatch(data, code)
  if (local) {
    return {
      result: {
        status: 'local',
        product: local.meta.product || local.key,
        brand: local.meta.brand, category: local.meta.category,
        description: local.meta.description, productSourceUrl: local.meta.productSourceUrl,
      },
      metaPatch: null,
    }
  }
  const pendingKey = pendingBarcodeKey(code)
  const cached = (data.warehouseMeta ?? {})[pendingKey]
  if (cached && cached.lookupStatus && cached.lookupStatus !== 'none') {
    return {
      result: {
        status: cached.lookupStatus === 'ready' ? 'ready' : 'not-found',
        product: cached.product, brand: cached.brand, category: cached.category,
        description: cached.description, productSourceUrl: cached.productSourceUrl,
      },
      metaPatch: null,
    }
  }
  const online = await lookupBarcodeOnline(code)
  if (online.status === 'error') return { result: online, metaPatch: null }
  const meta: WarehouseProductMeta = {
    product: online.product,
    barcode: code,
    imageStatus: 'none',
    sourceUrl: '',
    productSourceUrl: online.productSourceUrl,
    brand: online.brand,
    category: online.category,
    description: online.description,
    aliases: [],
    lookupStatus: online.status === 'ready' ? 'ready' : 'not-found',
    updatedAt: new Date().toISOString(),
  }
  return { result: online, metaPatch: { [pendingKey]: meta } }
}

/** Ficha de producto al registrar un código desde el formulario: sigue
 *  la del original (registerWarehouseBarcode): la ficha del producto
 *  gana el código y, si la búsqueda pendiente trajo datos, la fuente. */
export function metaForRegisteredBarcode(
  data: StoredData,
  productName: string,
  barcode: string,
): Record<string, WarehouseProductMeta> {
  const code = normalizeBarcode(barcode)
  const key = warehouseProductKey(productName)
  const pending = (data.warehouseMeta ?? {})[pendingBarcodeKey(code)]
  const current = (data.warehouseMeta ?? {})[key]
  const next: WarehouseProductMeta = {
    product: productName,
    barcode: code,
    imageStatus: current?.imageStatus ?? 'none',
    sourceUrl: current?.sourceUrl ?? '',
    productSourceUrl: pending?.productSourceUrl ?? current?.productSourceUrl ?? '',
    brand: current?.brand || pending?.brand || '',
    category: current?.category || pending?.category || '',
    description: current?.description || pending?.description || '',
    aliases: current?.aliases ?? [],
    lookupStatus: 'ready',
    updatedAt: new Date().toISOString(),
  }
  return { ...(data.warehouseMeta ?? {}), [key]: next }
}
