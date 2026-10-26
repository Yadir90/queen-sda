// Verificación de la fase Productos / Elaboración / Almacén contra el
// respaldo real: catálogo y libro de existencias desde los días del
// IPV, márgenes con la fórmula del original, cambios de precio
// detectados entre IPV (incl. el Tequila Corrales Gold), foto de
// almacén y sus pendientes de costo, y el aprendizaje de referencias
// de paquetes (derivados, gasto→referencia, sugerencias y la regla de
// cocina del menú). Las cifras fijadas salen de correr el MISMO núcleo
// que usa la app sobre el respaldo; las referencias del dueño (79
// productos «activos», márgenes 60,9/27,5/45,2) se contrastan y se
// documenta la diferencia: venían del estado vivo del original, con
// sus cambios manuales que no viajan en el respaldo.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import {
  buildInventoryBook, buildProductsCatalog, buildPriceSuggestions, detectPriceChanges,
  buildWarehouse, derivePackageReferences, expenseComparisons, packageDerivedCosts,
  findMenuRuleConflicts, matchPackageReference,
} from '../src/lib/productosCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const backupPath = join(here, '..', '..', 'goals', 'panorama-mensual-la-reina', 'hidden_files', 'backups', 'backup-sda-2026-10-24.json')
const parsed = parseBackup(JSON.parse(readFileSync(backupPath, 'utf8')))
const days = parsed.days

let ok = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name} ${detail}`) }
}
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

/* ---------- Libro y catálogo ---------- */
console.log('Libro de existencias y catálogo:')
const book = buildInventoryBook(days)
const catalog = buildProductsCatalog(days)
check('23 días leídos (1–23 oct)', days.length === 23 && days[0].date === '2026-10-01' && days[22].date === '2026-10-23')
check('catálogo: 130 productos con la clave del original (dept‖nombre‖um)', catalog.totalProductos === 130, `dio ${catalog.totalProductos}`)
const porDept = {}
for (const p of catalog.products) porDept[p.dept] = (porDept[p.dept] ?? 0) + 1
check('desglose: Elaboración 44 · Beb. alcohólicas 32 · Beb. no alcohólicas 32 · Cantina 20 · Pizzas 2',
  porDept['Elaboración'] === 44 && porDept['Bebidas alcohólicas'] === 32 && porDept['Bebidas no alcohólicas'] === 32 && porDept['Cantina'] === 20 && porDept['Pizzas'] === 2,
  JSON.stringify(porDept))
check('con existencia real: 43', catalog.conExistencia === 43, `dio ${catalog.conExistencia}`)
const activosDept = {}
for (const p of catalog.products) if (p.currentStock > 0.001) activosDept[p.dept] = (activosDept[p.dept] ?? 0) + 1
check('existencia por dept: alcohólicas 21 · no alcohólicas 20 · Elaboración 2 · Cantina 0 · Pizzas 0',
  activosDept['Bebidas alcohólicas'] === 21 && activosDept['Bebidas no alcohólicas'] === 20 && activosDept['Elaboración'] === 2 && !activosDept['Cantina'] && !activosDept['Pizzas'],
  JSON.stringify(activosDept))
const lastDay = days[days.length - 1]
const filasUltimoDia = lastDay.departments.reduce((s, d) => s + d.products.length, 0)
check('último día (23 oct): 78 filas de plantilla', filasUltimoDia === 78, `dio ${filasUltimoDia}`)
check('descuadres SOLO contra conteo físico: 25', catalog.descuadres.length === 25, `dio ${catalog.descuadres.length}`)
const checksAll = catalog.products.flatMap((p) => p.priceChecks)
check('contraste de importes: 357 días-producto, todos cuadran (0 sin explicar)',
  checksAll.length === 357 && catalog.sinExplicar.length === 0, `checks=${checksAll.length} sinExplicar=${catalog.sinExplicar.length}`)
check('el libro y el catálogo coinciden en total y existencia',
  book.totalProductos === catalog.totalProductos && book.conExistencia === catalog.conExistencia)

/* ---------- Márgenes y sugerencias (fórmula del original) ---------- */
console.log('Márgenes y sugerencias de Queen:')
const sug = buildPriceSuggestions(catalog)
check('promedios con la fórmula del original: elaborados 61,1 · bebidas 24,5 · general 39,0',
  eq(sug.averages.elaborados, 61.1) && eq(sug.averages.bebidas, 24.5) && eq(sug.averages.general, 39.0),
  JSON.stringify(sug.averages))
check('conteos por estado: pérdida 0 · riesgo 2 · bajo 67 · sano 37 · sin datos 24',
  sug.counts.perdida === 0 && sug.counts.riesgo === 2 && sug.counts.bajo === 67 && sug.counts.sano === 37 && sug.sinDatos === 24,
  JSON.stringify({ ...sug.counts, sinDatos: sug.sinDatos }))
const riesgoElab = sug.items.filter((i) => i.dept === 'Elaboración' && i.marginPct != null && i.marginPct < 40)
  .map((i) => `${i.name}:${i.marginPct}`).sort()
check('platos de Elaboración en riesgo (<40 %): Arroz moro 33,3 · Bistec de res 28 · Camarón empanizado 30,4 · Ensalada fría 28',
  JSON.stringify(riesgoElab) === JSON.stringify(['Arroz moro:33.3', 'Bistec de res:28', 'Camaron empanizado:30.4', 'Ensalada fria:28']),
  JSON.stringify(riesgoElab))
check('metas del original: elaborados 60 % · bebidas 35 % · gasto general 10 %',
  sug.targets.elaborados === 60 && sug.targets.bebidas === 35 && sug.overheadPct === 10)
check('ninguna sugerencia escribe un precio: todas son solo lectura (suggestedPrice calculado, sin mutar el catálogo)',
  sug.items.every((i) => i.suggestedPrice == null || i.suggestedPrice > 0))

/* ---------- Cambios de precio entre IPV ---------- */
console.log('Cambios de precio detectados:')
const changes = detectPriceChanges(days)
const venta = changes.filter((c) => c.kind === 'venta')
const compra = changes.filter((c) => c.kind === 'compra')
check('19 cambios de venta y 16 de compra entre IPV consecutivos', venta.length === 19 && compra.length === 16, `venta=${venta.length} compra=${compra.length}`)
const tequila = venta.find((c) => c.name === 'Tequila Corrales Gold' && c.date === '2026-10-22')
check('Tequila Corrales Gold: 10.000 → 12.000 el 2026-10-22 (IPV 21 → 22)',
  !!tequila && eq(tequila.oldPrice, 10000) && eq(tequila.newPrice, 12000), JSON.stringify(tequila))
const tk = catalog.products.find((p) => p.name === 'Tequila Corrales Gold')
check('la ficha del Tequila trae vigente 12.000 desde el IPV del 22', !!tk && eq(tk.precioVentaVigente, 12000))

/* ---------- Almacén ---------- */
console.log('Almacén (foto del IPV):')
const wh = buildWarehouse(days, catalog)
check('5 productos en fotos, 5 fotos (todas del 12 oct, saldos de apertura)',
  wh.totals.productos === 5 && wh.totals.fotos === 5, JSON.stringify(wh.totals))
check('sin entradas/bajas/salidas en las fotos: nada que pasar a gasto', wh.salidas.length === 0 && eq(wh.totals.salidas, 0))
check('pendientes de costo = los 5 de la foto, incl. el precedente del dueño (Papel sanitario, Sazón frezko, Codito, Spageti)',
  JSON.stringify(wh.pendientesCosto) === JSON.stringify(['Atún', 'Codito', 'Papel sanitario', 'Sazón frezko', 'Spageti']),
  JSON.stringify(wh.pendientesCosto))
// Salida sintética: con costo vigente pasa a gasto; sin costo, no.
const fakeDays = [{
  date: '2026-10-23', departments: [], entriesDetail: [],
  warehouse: [
    { product: 'Cristal', um: 'U', saldoInicial: 10, entrada: 0, baja: 0, salida: 3, saldoFinal: 7, precioCompra: 0, valor: 0, observacion: '' },
    { product: 'Codito', um: 'U', saldoInicial: 3, entrada: 0, baja: 0, salida: 1, saldoFinal: 2, precioCompra: 0, valor: 0, observacion: '' },
  ],
}]
const whFake = buildWarehouse(fakeDays, catalog)
const salidaCristal = whFake.salidas.find((s) => s.product === 'Cristal')
const salidaCodito = whFake.salidas.find((s) => s.product === 'Codito')
check('salida CON costo vigente (Cristal, del catálogo) → gasto enlazado calculado',
  !!salidaCristal && salidaCristal.estado === 'con-costo' && salidaCristal.gasto != null && eq(salidaCristal.gasto.total, salidaCristal.importe))
check('salida SIN costo (Codito) → pendiente de costo y SIN gasto',
  !!salidaCodito && salidaCodito.estado === 'pendiente-costo' && salidaCodito.gasto == null)

/* ---------- Referencias de paquetes ---------- */
console.log('Referencias de paquetes y aprendizaje:')
const derivedLangosta = packageDerivedCosts(15000, 10, 12)
check('ejemplo del dueño (langosta): paquete 15.000 · 10 colas → 1.500/cola · 12 anillos/cola → 120 anillos · 125/anillo',
  eq(derivedLangosta.unitCost, 1500) && derivedLangosta.totalSubUnits === 120 && eq(derivedLangosta.subUnitCost, 125),
  JSON.stringify(derivedLangosta))
// Desde cero referencias guardadas: el gasto «Pepino» con nota «4 pepinos» se archiva solo.
const refs0 = derivePackageReferences([], parsed.expenses)
const pepino = refs0.packages.find((p) => p.name === 'Pepino')
check('gasto con rendimiento escrito se archiva solo como referencia (Pepino: 500 el paquete, 4 pepinos, 125 c/u)',
  !!pepino && pepino.stored === false && eq(pepino.packageCost, 500) && pepino.unitsPerPackage === 4 && eq(pepino.costPerUnit, 125),
  JSON.stringify(pepino && { costo: pepino.packageCost, units: pepino.unitsPerPackage, unit: pepino.costPerUnit }))
check('comparación gasto↔referencia generada (1 con los datos reales)', expenseComparisons(parsed.expenses, refs0.packages).length === 1)
// Referencia guardada + gasto posterior más caro: aprende el precio con historial.
const ajoRef = [{
  id: 'ref-ajo', name: 'Ajo', variety: '', packageLabel: 'ristra', unitLabel: 'cabezas',
  unitsPerPackage: 20, subUnitLabel: '', subUnitsPerUnit: 0, supplier: '', note: '',
  observations: [{ id: 'o1', recordedOn: '2026-10-01', packageCost: 1000, unitsPerPackage: 20, subUnitsPerUnit: 0, place: '', presentation: 'ristra', note: '', source: 'manual', sourceRef: '' }],
}]
const ajoExpenses = [{ id: 'g1', date: '2026-10-10', concept: 'Ristra de ajo', category: 'Insumos', dept: 'General / todo el negocio', quantity: 2, unitValue: 1200, total: 2400, origin: 'manual', sourceKey: null, cycleStart: null, note: '' }]
check('el gasto «Ristra de ajo» coincide con la referencia Ajo/ristra', matchPackageReference('Ristra de ajo', ajoRef) != null)
const ajoView = derivePackageReferences(ajoRef, ajoExpenses)
const ajo = ajoView.packages.find((p) => p.id === 'ref-ajo')
check('precio aprendido del gasto: vigente 1.200 · por cabeza 60 · justo 55 · tendencia «subió» (+20 %)',
  !!ajo && eq(ajo.packageCost, 1200) && eq(ajo.costPerUnit, 60) && eq(ajo.fairUnitCost, 55) && ajo.trend === 'subio' && eq(ajo.changePct, 20),
  JSON.stringify(ajo && { costo: ajo.packageCost, unit: ajo.costPerUnit, justo: ajo.fairUnitCost, trend: ajo.trend }))
check('el aprendizaje deja constancia en el historial (2 entradas, la nueva de fuente «gasto»)',
  ajoView.history.length === 2 && ajoView.history[0].source === 'gasto')
const ajoComp = expenseComparisons(ajoExpenses, ajoView.packages)
check('comparación paquete contra paquete: 1.200 frente al justo del paquete 1.100 → +9,1 % más caro',
  ajoComp.length === 1 && eq(ajoComp[0].refPackageCost, 1100) && eq(ajoComp[0].diffPct, 9.1) && ajoComp[0].verdict === 'mas-caro',
  JSON.stringify(ajoComp[0] ?? null))
// Sugerencia: formato sin rendimiento legible.
const cajaExpenses = [{ id: 'g2', date: '2026-10-11', concept: 'Caja de refrescos', category: 'Insumos', dept: 'General / todo el negocio', quantity: 1, unitValue: 3000, total: 3000, origin: 'manual', sourceKey: null, cycleStart: null, note: '' }]
const cajaView = derivePackageReferences([], cajaExpenses)
check('gasto con formato y sin rendimiento → sugerencia de Queen (no se crea sola)',
  cajaView.suggestions.length === 1 && cajaView.packages.length === 0 && cajaView.suggestions[0].packageLabel === 'caja',
  JSON.stringify(cajaView.suggestions))

/* ---------- Regla de cocina del menú ---------- */
console.log('Regla de cocina (vigilancia del MENÚ, no del catálogo):')
const conflictos = findMenuRuleConflicts(['Camarón al ajillo', 'Arroz con pollo', 'Bistec de res', 'Langosta a la plancha', 'Sopa de tortuga'])
check('el menú nunca lleva camarón, langosta, res ni tortuga: 4 señalados de 5 nombres de menú',
  conflictos.length === 4 && !conflictos.some((c) => c.name === 'Arroz con pollo'), JSON.stringify(conflictos.map((c) => c.name)))
check('el catálogo del IPV NO se vigila como menú (la plantilla interna trae esos platos y no se señalan)',
  catalog.products.some((p) => p.name === 'Camaron empanizado'))

console.log(`\nverify-productos: ${ok} ok, ${fail} fallos`)
if (fail > 0) process.exit(1)
