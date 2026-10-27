/* Queen SDA — núcleo del Menú del día (D-R6-02).
 *
 * Puerto de la lógica del MenuTab del SDA original (client/src/
 * App.tsx: helpers de menú ~17908 y MenuTab ~18408, y las acciones
 * getMenu/saveMenu/resetMenu/setMenuAvailability/
 * updateProductCatalogProfile de su servidor): taxonomía de
 * secciones y familias, catálogo ligero del menú con el perfil
 * compartido del producto (familia aprendida, descripción, archivo
 * y ojo de visibilidad), documento editable del día con su base,
 * disponibilidad por fecha e Historial de no disponibles.
 *
 * El menú es una SALIDA (presentación para el cliente), nunca una
 * fuente: editarlo no toca precios reales, existencias ni saldos.
 * El estado (documentos por día, base, disponibilidad y perfiles)
 * vive en StoredData.menuState y se persiste con la capa de datos
 * vigente (local: backend.saveMenuState; Supabase: app_settings
 * 'menu-state'). La regla de cocina del dueño manda como en
 * buildMenuData: camarón, langosta, res y tortuga nunca entran ni
 * en el catálogo del menú (findMenuRuleConflicts de productosCore).
 */
import { buildProductsCatalog, findMenuRuleConflicts, menuDeptOf } from './productosCore.mjs'

/* ============ Taxonomía (puerto literal de los helpers del original) ============ */

export const MENU_DEPT_ORDER = ['Elaboración', 'Pizzas', 'Cantina', 'Bebidas alcohólicas', 'Bebidas no alcohólicas']
export const MENU_FAMILIES = {
  'Elaboración': ['Entrantes y picaderas', 'Arroces', 'Platos fuertes', 'Pescados y mariscos', 'Acompañamientos', 'Postres', 'Por clasificar'],
  'Pizzas': ['Pizzas', 'Por clasificar'],
  'Cantina': ['Cócteles clásicos', 'De la casa', 'Por clasificar'],
  'Bebidas alcohólicas': ['Cervezas', 'Rones', 'Whisky', 'Vodka y licores blancos', 'Vinos', 'Cremas y licores dulces', 'Por clasificar'],
  'Bebidas no alcohólicas': ['Aguas', 'Refrescos', 'Jugos y batidos', 'Maltas y energizantes', 'Por clasificar'],
}

/** Sección canónica del menú (original: canonicalMenuSection). */
export function canonicalMenuSection(section) {
  return menuDeptOf(section ?? '')
}

export function menuSectionLabel(section) {
  const c = canonicalMenuSection(section)
  if (c === 'Elaboración') return 'Cocina (Elaboración)'
  if (c === 'Pizzas') return 'Pizzería (Pizzas)'
  if (c === 'Cantina') return 'Coctelería (Cantina)'
  return c
}

export function menuFamiliesFor(section) {
  return MENU_FAMILIES[canonicalMenuSection(section)] ?? ['Por clasificar']
}

function menuDeptIndex(section) {
  const i = MENU_DEPT_ORDER.indexOf(canonicalMenuSection(section))
  return i >= 0 ? i : MENU_DEPT_ORDER.length
}
function menuFamilyIndex(section, family) {
  const list = menuFamiliesFor(section)
  const i = list.indexOf(family)
  return i >= 0 ? i : list.length
}
export function compareMenuItems(a, b) {
  return (
    menuDeptIndex(a.section) - menuDeptIndex(b.section) ||
    canonicalMenuSection(a.section).localeCompare(canonicalMenuSection(b.section), 'es') ||
    menuFamilyIndex(a.section, a.family ?? 'Por clasificar') - menuFamilyIndex(b.section, b.family ?? 'Por clasificar') ||
    (a.family ?? 'Por clasificar').localeCompare(b.family ?? 'Por clasificar', 'es') ||
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  )
}
export function sortMenuItems(items) {
  return [...items].sort(compareMenuItems)
}
export function groupMenuItems(items) {
  const sorted = sortMenuItems(items)
  const groups = []
  for (const item of sorted) {
    const section = canonicalMenuSection(item.section)
    let g = groups.find((x) => x.section === section)
    if (!g) { g = { section, families: [] }; groups.push(g) }
    const family = item.family?.trim() || 'Por clasificar'
    let f = g.families.find((x) => x.family === family)
    if (!f) { f = { family, items: [] }; g.families.push(f) }
    f.items.push(item)
  }
  return groups
}
export function productInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

/** fmtFull del original (fmtDayLong): «viernes, 24 de octubre de 2026». */
export function fmtMenuDayLong(iso) {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(iso ?? '')
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d))
}

/* ============ Estado persistente del menú ============ */

export const EMPTY_MENU_PROFILE = { family: '', description: '', archived: false, menuHidden: false }
export const EMPTY_MENU_STATE = { base: null, days: {}, availability: {}, profiles: {} }

/** Normaliza un estado leído de la capa de datos (defensivo: lo que
 *  no tenga la forma esperada se descarta, nunca se inventa). */
export function normalizeMenuState(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MENU_STATE, days: {}, availability: {}, profiles: {} }
  const docOk = (d) => (d && typeof d === 'object' && Array.isArray(d.items)
    ? {
        items: d.items.filter((i) => i && typeof i.name === 'string').map((i) => ({
          key: String(i.key ?? i.productKey ?? i.name),
          productKey: i.productKey ?? null,
          section: String(i.section ?? 'Menú'),
          family: String(i.family ?? 'Por clasificar'),
          name: String(i.name),
          price: typeof i.price === 'number' && Number.isFinite(i.price) ? i.price : null,
          description: String(i.description ?? ''),
          included: i.included !== false,
        })),
        footerText: String(d.footerText ?? 'La Reina Restaurante-Bar'),
        subtitle: String(d.subtitle ?? ''),
      }
    : null)
  const days = {}
  if (raw.days && typeof raw.days === 'object') {
    for (const [k, v] of Object.entries(raw.days)) { const d = docOk(v); if (d) days[k] = d }
  }
  const availability = {}
  if (raw.availability && typeof raw.availability === 'object') {
    for (const [k, v] of Object.entries(raw.availability)) {
      if (v && typeof v === 'object') {
        availability[k] = Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === 'boolean'))
      }
    }
  }
  const profiles = {}
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles)) {
      if (v && typeof v === 'object') {
        profiles[k] = {
          family: String(v.family ?? ''),
          description: String(v.description ?? ''),
          archived: Boolean(v.archived),
          menuHidden: Boolean(v.menuHidden),
        }
      }
    }
  }
  return { base: docOk(raw.base), days, availability, profiles }
}

/* ============ Catálogo ligero del menú (original: computeMenuCatalog) ============ */

/**
 * Catálogo del menú desde los datos cargados: el mismo catálogo de
 * Productos (buildProductsCatalog con los ajustes de existencias),
 * reducido a lo que el Menú pinta y edita, con el perfil compartido
 * aplicado (familia aprendida/descripción/archivo/ojo). Los
 * productos que violan la regla de cocina quedan FUERA del
 * catálogo: en el menú del original nunca aparecen en ninguna
 * superficie (ni editor, ni Historial, ni vista previa).
 */
export function buildMenuCatalog(data, profiles = {}) {
  const catalog = buildProductsCatalog(data?.days ?? [], data?.inventoryAdjustments ?? [])
  const conflicts = new Set(findMenuRuleConflicts(catalog.products.map((p) => p.name)).map((c) => c.name))
  const products = []
  for (const p of catalog.products) {
    if (conflicts.has(p.name)) continue
    const profile = profiles[p.productKey] ?? EMPTY_MENU_PROFILE
    const familyAuto = p.menuFamily
    const familyLearned = profile.family?.trim() ? profile.family.trim() : null
    products.push({
      productKey: p.productKey,
      name: p.name,
      dept: p.dept,
      um: p.um,
      currentStock: p.currentStock,
      precioVentaVigente: p.precioVentaVigente,
      precioCompraVigente: p.precioCompraVigente,
      menuFamily: familyLearned ?? familyAuto,
      menuFamilyAuto: familyAuto,
      menuFamilyLearned: familyLearned,
      menuFamilySource: familyLearned ? 'aprendida' : familyAuto !== 'Por clasificar' ? 'automatica' : 'por-clasificar',
      menuDescription: profile.description ?? '',
      catalogArchived: Boolean(profile.archived),
      menuHidden: Boolean(profile.menuHidden),
      photoUrl: null,
    })
  }
  return {
    products,
    latestDate: catalog.latestDate,
    totalProductos: products.length,
    conExistencia: products.filter((p) => p.currentStock > 0.001).length,
  }
}

/* ============ Documento del menú (original: MenuDoc del cliente) ============ */

export function menuItemPrice(item) {
  const n = Number(String(item?.priceText ?? '').replace(',', '.'))
  return String(item?.priceText ?? '').trim() && Number.isFinite(n) && n > 0 ? n : null
}

const editableItem = (i) => ({
  ...i,
  priceText: i.price != null ? String(Math.round(i.price)) : '',
})

/** Documento generado desde Productos (original: autoDoc del cliente). */
export function buildAutoMenuDoc(catalogProducts) {
  const products = (catalogProducts ?? []).filter((p) => p.currentStock > 0.001 && !p.catalogArchived)
  return {
    items: sortMenuItems(products.map((p) => ({
      key: p.productKey,
      productKey: p.productKey,
      section: canonicalMenuSection(p.dept),
      family: p.menuFamily,
      name: p.name,
      price: p.precioVentaVigente,
      description: p.menuDescription,
      included: true,
      priceText: p.precioVentaVigente != null ? String(Math.round(p.precioVentaVigente)) : '',
    }))),
    footerText: 'La Reina Restaurante-Bar',
    subtitle: '',
  }
}

/**
 * Resolución del documento en pantalla (original: el efecto que
 * combina getMenu con el catálogo): manda el menú guardado del
 * día; si no hay, la base; si tampoco, el generado desde
 * Productos. Sobre eso se aplican las decisiones de disponibilidad
 * de la fecha (lo sin existencia sale, lo forzado entra ya
 * clasificado y en orden alfabético).
 * Devuelve { doc (editable, con priceText), source, sourceLabel }.
 */
export function resolveMenuDoc(state, date, catalogProducts) {
  const st = normalizeMenuState(state)
  const catalog = catalogProducts ?? []
  const catalogByKey = new Map(catalog.map((p) => [p.productKey, p]))
  const autoDoc = buildAutoMenuDoc(catalog)
  const day = st.days[date] ?? null
  const base = st.base ?? null
  const stored = day ?? base
  const availability = st.availability[date] ?? {}
  let items
  let source
  let sourceLabel
  if (stored) {
    items = stored.items.map((i) => {
      const p = i.productKey ? catalogByKey.get(i.productKey) : undefined
      const storedFamily = i.family?.trim()
      return {
        ...editableItem(i),
        section: p ? canonicalMenuSection(p.dept) : canonicalMenuSection(i.section),
        family: p?.menuFamilySource === 'aprendida' ? p.menuFamily : storedFamily && storedFamily !== 'Por clasificar' ? storedFamily : p?.menuFamily ?? storedFamily ?? 'Por clasificar',
        description: i.description || p?.menuDescription || '',
        priceText: i.price != null ? String(Math.round(i.price)) : '',
      }
    })
    source = day ? 'day' : 'base'
    sourceLabel = day ? 'Menú guardado para este día' : 'Desde tu menú base guardado'
  } else {
    items = autoDoc.items.map((i) => ({ ...i }))
    source = 'generated'
    sourceLabel = 'Generado desde Productos (existencia y precio vigente)'
  }
  const itemIdxByKey = new Map()
  items.forEach((it, ix) => { if (it.productKey && !itemIdxByKey.has(it.productKey)) itemIdxByKey.set(it.productKey, ix) })
  for (const p of catalog) {
    const forced = availability[p.productKey]
    const idx = itemIdxByKey.get(p.productKey) ?? -1
    const availableByStock = p.currentStock > 0.001 && !p.catalogArchived
    if (idx < 0) {
      if (forced === true || (forced !== false && availableByStock)) {
        items.push({
          key: p.productKey,
          productKey: p.productKey,
          section: canonicalMenuSection(p.dept),
          family: p.menuFamily,
          name: p.name,
          price: p.precioVentaVigente,
          description: p.menuDescription,
          included: true,
          priceText: p.precioVentaVigente != null ? String(Math.round(p.precioVentaVigente)) : '',
        })
      }
      continue
    }
    if (forced !== undefined) items[idx] = { ...items[idx], included: forced }
    else if (!availableByStock) items[idx] = { ...items[idx], included: false }
  }
  return {
    doc: {
      items: sortMenuItems(items),
      footerText: stored?.footerText || 'La Reina Restaurante-Bar',
      subtitle: stored?.subtitle || '',
    },
    source,
    sourceLabel,
  }
}

/** Documento editable → documento guardable (original: toDoc). */
export function menuDocToStored(doc) {
  return {
    items: sortMenuItems((doc?.items ?? []).filter((i) => i.name.trim())).map((i) => ({
      key: i.key,
      productKey: i.productKey ?? null,
      section: canonicalMenuSection(i.section.trim() || 'Menú'),
      family: i.family?.trim() || 'Por clasificar',
      name: i.name.trim(),
      price: menuItemPrice(i),
      description: i.description.trim(),
      included: i.included,
    })),
    footerText: (doc?.footerText ?? '').trim(),
    subtitle: (doc?.subtitle ?? '').trim(),
  }
}

/* ============ Operaciones de persistencia (original: las 4 acciones) ============ */

/** saveMenu: guarda el documento como día o como base. Al guardar
 *  el día, sus decisiones sueltas de disponibilidad se limpian
 *  (el documento pasa a ser la fuente), como en el original. */
export function applySaveMenu(state, date, scope, editableDoc) {
  const st = normalizeMenuState(state)
  const stored = menuDocToStored(editableDoc)
  if (scope === 'base') return { ...st, base: stored }
  const availability = { ...st.availability }
  delete availability[date]
  return { ...st, days: { ...st.days, [date]: stored }, availability }
}

/** resetMenu (scope «both»): borra el menú del día y la base, y
 *  las decisiones de disponibilidad de la fecha. */
export function applyResetMenu(state, date) {
  const st = normalizeMenuState(state)
  const days = { ...st.days }
  delete days[date]
  const availability = { ...st.availability }
  delete availability[date]
  return { ...st, days, base: null, availability }
}

/** setMenuAvailability: decisión del Historial para una fecha. */
export function applyMenuAvailability(state, date, productKey, available) {
  const st = normalizeMenuState(state)
  return {
    ...st,
    availability: {
      ...st.availability,
      [date]: { ...(st.availability[date] ?? {}), [productKey]: available },
    },
  }
}

/** updateProductCatalogProfile (parcial del menú): familia
 *  aprendida, descripción breve, archivo y ojo de visibilidad del
 *  perfil compartido del producto. */
export function applyMenuProfile(state, productKey, patch) {
  const st = normalizeMenuState(state)
  const current = st.profiles[productKey] ?? { ...EMPTY_MENU_PROFILE }
  const next = { ...current }
  if (patch.family !== undefined) next.family = String(patch.family).trim()
  if (patch.description !== undefined) next.description = String(patch.description).trim()
  if (patch.archived !== undefined) next.archived = Boolean(patch.archived)
  if (patch.menuHidden !== undefined) next.menuHidden = Boolean(patch.menuHidden)
  return { ...st, profiles: { ...st.profiles, [productKey]: next } }
}

/* ============ Visibles, vista previa y documento ============ */

export function isMenuItemHidden(item, catalogByKey) {
  return Boolean(item.productKey && catalogByKey.get(item.productKey)?.menuHidden)
}

/** Ítems que salen en la vista previa y en el PDF: incluidos y no
 *  ocultos con el ojo (original: visibleItems). */
export function visibleMenuItems(doc, catalogByKey) {
  const ordered = sortMenuItems(doc?.items ?? [])
  return ordered.filter((i) => i.included && !isMenuItemHidden(i, catalogByKey))
}

/**
 * Datos del documento del menú (la misma forma que buildMenuData
 * de documentosCore, pero desde el DOCUMENTO editado y solo con
 * los ítems visibles): la vista previa de la pestaña y el
 * documento que se genera salen de esta misma lista.
 */
export function buildMenuDocData(doc, catalogProducts, date, fmtDateLabel) {
  const catalogByKey = new Map((catalogProducts ?? []).map((p) => [p.productKey, p]))
  const visible = visibleMenuItems(doc, catalogByKey)
  const groups = groupMenuItems(visible)
  return {
    kind: 'menu',
    title: 'Menú del día',
    dateLabel: fmtDateLabel ?? '',
    subtitle: (doc?.subtitle ?? '').trim(),
    footerText: (doc?.footerText ?? '').trim() || 'La Reina Restaurante-Bar',
    sections: groups.map((g) => ({
      section: g.section,
      families: g.families.map((f) => ({
        family: f.family,
        items: f.items.map((i) => ({ name: i.name, price: menuItemPrice(i), description: i.description })),
      })),
    })),
    itemCount: visible.length,
    excluded: [],
    signatures: null,
  }
}

/* ============ Historial de no disponibles (original: historyEntries) ============ */

export function menuHistoryCount(doc, catalogProducts) {
  if (!doc) return 0
  const itemByKey = new Map((doc.items ?? []).filter((i) => i.productKey).map((i) => [i.productKey, i]))
  let n = 0
  for (const p of catalogProducts ?? []) {
    const item = itemByKey.get(p.productKey) ?? null
    const availableToday = Boolean(item?.included && !p.menuHidden)
    const sinExistencia = p.currentStock <= 0.001
    if (!sinExistencia && !p.catalogArchived && availableToday) continue
    if (!sinExistencia && !p.catalogArchived && !item) continue
    n++
  }
  for (const item of doc.items ?? []) {
    if (item.productKey || item.included) continue
    n++
  }
  return n
}

export function buildMenuHistory(doc, catalogProducts, search = '') {
  if (!doc) return []
  const itemByKey = new Map((doc.items ?? []).filter((i) => i.productKey).map((i) => [i.productKey, i]))
  const entries = []
  for (const p of catalogProducts ?? []) {
    const item = itemByKey.get(p.productKey) ?? null
    const availableToday = Boolean(item?.included && !p.menuHidden)
    const sinExistencia = p.currentStock <= 0.001
    if (!sinExistencia && !p.catalogArchived && availableToday) continue
    if (!sinExistencia && !p.catalogArchived && !item) continue
    entries.push({
      key: p.productKey,
      product: p,
      item,
      name: item?.name ?? p.name,
      section: canonicalMenuSection(p.dept),
      family: item?.family?.trim() && item.family !== 'Por clasificar' ? item.family : p.menuFamily,
      price: item ? menuItemPrice(item) ?? p.precioVentaVigente : p.precioVentaVigente,
      description: item?.description || p.menuDescription,
      availableToday,
      menuHidden: p.menuHidden,
      reason: p.catalogArchived ? 'Archivado a mano en Productos' : sinExistencia ? 'Sin existencia hoy' : p.menuHidden ? 'Oculto en el menú (ojo cerrado): no sale ni en la vista ni en el PDF' : 'Retirado del menú de este día',
    })
  }
  for (const item of doc.items ?? []) {
    if (item.productKey || item.included) continue
    entries.push({
      key: item.key,
      product: null,
      item,
      name: item.name,
      section: canonicalMenuSection(item.section),
      family: item.family?.trim() || 'Por clasificar',
      price: menuItemPrice(item),
      description: item.description,
      availableToday: false,
      menuHidden: false,
      reason: 'Plato manual retirado del menú de este día',
    })
  }
  const q = String(search ?? '').trim().toLowerCase()
  const filtered = q ? entries.filter((e) => `${e.name} ${menuSectionLabel(e.section)} ${e.family} ${e.description} ${e.reason}`.toLowerCase().includes(q)) : entries
  return filtered.sort((a, b) => compareMenuItems({ section: a.section, family: a.family, name: a.name }, { section: b.section, family: b.family, name: b.name }))
}
