/* Verificación del Menú del día (D-R6-02) contra el respaldo real
   backup-sda-2026-10-26.json (la misma semilla de la sonda):
     - Catálogo del menú = catálogo de Productos MENOS los que
       violan la regla de cocina (nunca camarón/langosta/res/
       tortuga), con familia automática del original (Cristal →
       Cervezas) y perfil compartido aplicado (familia aprendida,
       ojo, archivo).
     - Documento generado = productos con existencia a su precio
       vigente; precedencia al abrir: día guardado → base →
       generado; disponibilidad por fecha entra/sale sin tocar el
       catálogo.
     - Persistencia ida y vuelta (día, base, disponibilidad,
       perfil) con normalización; editar el precio del menú NO
       muta el precio real del catálogo.
     - buildMenuDocData ≡ grupos visibles de la vista previa y
       menuHtml lleva subtítulo y pie solo cuando el documento los
       trae, sin firmas (el menú va excluido de firma y cuño). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { buildProductsCatalog, findMenuRuleConflicts } from '../src/lib/productosCore.mjs'
import {
  applyMenuAvailability, applyMenuProfile, applyResetMenu, applySaveMenu,
  buildAutoMenuDoc, buildMenuCatalog, buildMenuDocData, buildMenuHistory,
  groupMenuItems, menuDocToStored, menuHistoryCount, normalizeMenuState,
  resolveMenuDoc, visibleMenuItems,
} from '../src/lib/menuCore.mjs'
import { menuHtml } from '../src/lib/documentosCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const backupPath = join(here, '..', '..', 'goals', 'panorama-mensual-la-reina', 'hidden_files', 'backups', 'backup-sda-2026-10-26.json')
const parsed = parseBackup(JSON.parse(readFileSync(backupPath, 'utf8')))
const data = { days: parsed.days, inventoryAdjustments: parsed.inventoryAdjustments ?? [] }
const DATE = '2026-10-26'

let ok = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name} ${detail}`) }
}

/* ---------- Catálogo del menú y regla de cocina ---------- */
console.log('Catálogo del menú:')
const rawCatalog = buildProductsCatalog(data.days, data.inventoryAdjustments)
const conflicts = findMenuRuleConflicts(rawCatalog.products.map((p) => p.name))
const conflictNames = new Set(conflicts.map((c) => c.name))
const menuCatalog = buildMenuCatalog(data, {})
check('el respaldo trae productos que violan la regla de cocina (la prueba muerde)',
  conflictNames.size > 0, `conflictos=${conflictNames.size}`)
check('ningún producto en conflicto entra en el catálogo del menú',
  menuCatalog.products.every((p) => !conflictNames.has(p.name)),
  [...conflictNames].filter((n) => menuCatalog.products.some((p) => p.name === n)).join(', '))
check('el catálogo del menú = catálogo de Productos − conflictos',
  menuCatalog.totalProductos === rawCatalog.products.filter((p) => !conflictNames.has(p.name)).length,
  `${menuCatalog.totalProductos} vs ${rawCatalog.totalProductos}`)
check('con existencia coincide con el catálogo filtrado',
  menuCatalog.conExistencia === menuCatalog.products.filter((p) => p.currentStock > 0.001).length)
const cristal = menuCatalog.products.find((p) => /cristal/i.test(p.name))
check('familia automática del original: Cristal → Cervezas',
  Boolean(cristal) && cristal.menuFamilyAuto === 'Cervezas' && cristal.menuFamilySource === 'automatica',
  cristal ? `${cristal.name}: ${cristal.menuFamilyAuto}/${cristal.menuFamilySource}` : 'sin Cristal')

/* ---------- Documento generado y precedencia ---------- */
console.log('Documento y precedencia (día → base → generado):')
const EMPTY = normalizeMenuState(null)
const auto = buildAutoMenuDoc(menuCatalog.products)
check('el documento generado trae solo productos con existencia, todos incluidos',
  auto.items.length === menuCatalog.conExistencia && auto.items.every((i) => i.included),
  `items=${auto.items.length} conExistencia=${menuCatalog.conExistencia}`)
check('el precio generado es el precio de venta vigente del catálogo',
  auto.items.every((i) => {
    const p = menuCatalog.products.find((x) => x.productKey === i.productKey)
    return p && i.price === p.precioVentaVigente
  }))
const r0 = resolveMenuDoc(EMPTY, DATE, menuCatalog.products)
check('sin estado: manda el generado desde Productos',
  r0.source === 'generated' && r0.sourceLabel === 'Generado desde Productos (existencia y precio vigente)' && r0.doc.items.length === auto.items.length)

const docEdit = { ...r0.doc, subtitle: 'Cocina criolla y coctelería', footerText: 'La Reina Restaurante-Bar · Júcaro' }
docEdit.items = docEdit.items.map((i, ix) => (ix === 0 ? { ...i, priceText: '999' } : i))
const withBase = applySaveMenu(EMPTY, DATE, 'base', docEdit)
const rBase = resolveMenuDoc(withBase, DATE, menuCatalog.products)
check('con base guardada: manda la base, con sus textos',
  rBase.source === 'base' && rBase.sourceLabel === 'Desde tu menú base guardado'
  && rBase.doc.subtitle === 'Cocina criolla y coctelería' && rBase.doc.footerText === 'La Reina Restaurante-Bar · Júcaro')
check('el precio editado SOLO en el menú (999) viaja en el documento…',
  menuItemPriceOf(rBase.doc) === 999)
function menuItemPriceOf(doc) {
  const first = doc.items.find((i) => i.included)
  return first ? Number(first.priceText) : null
}
const withDay = applySaveMenu(withBase, DATE, 'day', docEdit)
const rDay = resolveMenuDoc(withDay, DATE, menuCatalog.products)
check('con día guardado: el día manda sobre la base',
  rDay.source === 'day' && rDay.sourceLabel === 'Menú guardado para este día')
check('…y el precio real del catálogo NO se tocó',
  menuCatalog.products.find((p) => p.productKey === rDay.doc.items.find((i) => i.included)?.productKey)?.precioVentaVigente !== 999)

/* ---------- Disponibilidad por fecha ---------- */
console.log('Disponibilidad por fecha:')
const sinStock = menuCatalog.products.find((p) => p.currentStock <= 0.001 && !p.catalogArchived)
const conStock = menuCatalog.products.find((p) => p.currentStock > 0.001)
check('hay productos sin y con existencia para la prueba', Boolean(sinStock) && Boolean(conStock))
const stForzado = applyMenuAvailability(EMPTY, DATE, sinStock.productKey, true)
const rForzado = resolveMenuDoc(stForzado, DATE, menuCatalog.products)
check('forzado disponible: entra en el documento, incluido y clasificado',
  rForzado.doc.items.some((i) => i.productKey === sinStock.productKey && i.included))
const stQuitado = applyMenuAvailability(EMPTY, DATE, conStock.productKey, false)
const rQuitado = resolveMenuDoc(stQuitado, DATE, menuCatalog.products)
check('quitado de hoy: queda en el documento pero no incluido (va al Historial)',
  rQuitado.doc.items.some((i) => i.productKey === conStock.productKey && !i.included))

/* ---------- Perfil compartido: familia aprendida, ojo, archivo ---------- */
console.log('Perfil compartido:')
const stFam = applyMenuProfile(EMPTY, cristal.productKey, { family: 'Rones' })
const catFam = buildMenuCatalog(data, stFam.profiles)
const cristalAprendida = catFam.products.find((p) => p.productKey === cristal.productKey)
check('familia cambiada una vez = aprendida en el catálogo',
  cristalAprendida.menuFamily === 'Rones' && cristalAprendida.menuFamilySource === 'aprendida')
const stOjo = applyMenuProfile(EMPTY, conStock.productKey, { menuHidden: true })
const catOjo = buildMenuCatalog(data, stOjo.profiles)
const docOjo = resolveMenuDoc(stOjo, DATE, catOjo.products).doc
const byKeyOjo = new Map(catOjo.products.map((p) => [p.productKey, p]))
check('ojo cerrado: el plato sigue en el documento pero sale de los visibles',
  docOjo.items.some((i) => i.productKey === conStock.productKey)
  && !visibleMenuItems(docOjo, byKeyOjo).some((i) => i.productKey === conStock.productKey))
const stArch = applyMenuProfile(EMPTY, conStock.productKey, { archived: true })
const catArch = buildMenuCatalog(data, stArch.profiles)
check('archivado: sale del documento generado',
  !buildAutoMenuDoc(catArch.products).items.some((i) => i.productKey === conStock.productKey))
const histArch = buildMenuHistory(resolveMenuDoc(stArch, DATE, catArch.products).doc, catArch.products)
check('archivado: aparece en el Historial con su motivo literal',
  histArch.some((e) => e.product?.productKey === conStock.productKey && e.reason === 'Archivado a mano en Productos'))

/* ---------- Historial: conteo ≡ entradas ---------- */
const docGen = resolveMenuDoc(EMPTY, DATE, menuCatalog.products).doc
check('el conteo del Historial coincide con sus entradas',
  menuHistoryCount(docGen, menuCatalog.products) === buildMenuHistory(docGen, menuCatalog.products).length,
  `${menuHistoryCount(docGen, menuCatalog.products)} vs ${buildMenuHistory(docGen, menuCatalog.products).length}`)
check('el Historial trae los sin existencia con su motivo',
  buildMenuHistory(docGen, menuCatalog.products).some((e) => e.reason === 'Sin existencia hoy'))

/* ---------- Persistencia ida y vuelta y restablecer ---------- */
console.log('Persistencia:')
const persisted = JSON.parse(JSON.stringify(withDay))
const rPersisted = resolveMenuDoc(normalizeMenuState(persisted), DATE, menuCatalog.products)
check('ida y vuelta por JSON: el día guardado se resuelve igual',
  rPersisted.source === 'day' && rPersisted.doc.items.length === rDay.doc.items.length
  && rPersisted.doc.subtitle === rDay.doc.subtitle)
const storedDoc = menuDocToStored(docEdit)
check('el documento guardable canoniza la sección y conserva el precio del menú',
  storedDoc.items.every((i) => typeof i.section === 'string' && i.section.length > 0)
  && storedDoc.items.some((i) => i.price === 999))
const stReset = applyResetMenu(withDay, DATE)
const rReset = resolveMenuDoc(stReset, DATE, menuCatalog.products)
check('restablecer: borra día y base y vuelve el generado',
  rReset.source === 'generated' && stReset.base === null && !(DATE in stReset.days))

/* ---------- Documento (PDF): mismos grupos que la previa ---------- */
console.log('Documento del menú:')
const docData = buildMenuDocData(docGen, menuCatalog.products, DATE, 'domingo, 26 de octubre de 2026')
const byKey = new Map(menuCatalog.products.map((p) => [p.productKey, p]))
const groupsPrev = groupMenuItems(visibleMenuItems(docGen, byKey))
check('buildMenuDocData reproduce los grupos visibles de la vista previa',
  JSON.stringify(docData.sections) === JSON.stringify(groupsPrev.map((g) => ({
    section: g.section,
    families: g.families.map((f) => ({
      family: f.family,
      items: f.items.map((i) => ({ name: i.name, price: i.priceText ? Number(i.priceText) : null, description: i.description })),
    })),
  }))) && docData.itemCount === visibleMenuItems(docGen, byKey).length)
const docConTextos = { ...docData, subtitle: 'Cocina criolla y coctelería', footerText: 'La Reina Restaurante-Bar · Júcaro' }
const html = menuHtml(docConTextos)
check('el HTML del documento lleva el subtítulo y el pie del documento editado',
  html.includes('Cocina criolla y coctelería') && html.includes('La Reina Restaurante-Bar · Júcaro'))
check('el HTML del documento no lleva firmas ni cuño (el menú va excluido)',
  !/firma|cuño/i.test(html))
check('el HTML sin textos sale como siempre (sin línea de subtítulo inventada)',
  !menuHtml(docData).includes('Cocina criolla'))

console.log(`\nverify:menu — ${ok} ok, ${fail} fallos`)
if (fail) process.exit(1)
