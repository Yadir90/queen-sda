/* verify:reglas — PRUEBA NUMÉRICA de las reglas y fórmulas del sistema
   contra la foto real del respaldo (backup-sda-2026-10-26.json: 24 días,
   ventas 2.786.190, bruta 718.191, neta 696.096, cuadre 0, nóminas
   95.000 y 86.500, 119 cuentas, 51 gastos). Nada de presencia: cada
   regla se ejecuta sobre el núcleo del clon y su salida se compara
   con la cifra de control o con la fórmula escrita. El inventario
   completo vive en REGLAS-Y-FORMULAS.md. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seedPath = join(root, '..', 'goals', 'panorama-mensual-la-reina', 'hidden_files', 'backups', 'backup-sda-2026-10-26.json')
const backup = JSON.parse(readFileSync(seedPath, 'utf8'))
const { parseBackup } = await import(join(root, 'src/lib/backupCore.mjs'))
/* La foto cruda pasa por el mismo normalizador que usa la app al
   importar el respaldo (saldoBase, pagos y movimientos derivados). */
const data = parseBackup(backup)
const TODAY = '2026-10-26'

let ok = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail += 1; console.log(`  FALLO  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005

const { monthEconomy, conciliationForDay, BANK_COMMISSION } = await import(join(root, 'src/lib/economiaCore.mjs'))
const documentos = await import(join(root, 'src/lib/documentosCore.mjs'))
const elaboracion = await import(join(root, 'src/lib/elaboracionCore.mjs'))
const queen = await import(join(root, 'src/lib/queenCore.mjs'))
const productos = await import(join(root, 'src/lib/productosCore.mjs'))
const utils = await import(join(root, 'src/lib/utils.ts'))
const { warehouseCostFor, warehouseExpenseValues, reconcileWarehouseExpenses, deptForCuentasConcept } = await import(join(root, 'src/lib/warehouseExpenses.ts'))

console.log('verify:reglas — foto del respaldo y reglas con nombre')

/* 1 · Foto de control del respaldo */
check('24 días importados', data.days.length === 24, `${data.days.length}`)
check('ventas del período = 2.786.190', eq(data.days.reduce((s, d) => s + d.ventasDia, 0), 2786190))
check('cuadre total = 0 y ningún día descuadrado', eq(data.days.reduce((s, d) => s + d.cuadre, 0), 0) && data.days.every((d) => eq(d.cuadre, 0)))
check('119 cuentas por cobrar', data.receivables.length === 119, `${data.receivables.length}`)
check('51 gastos', data.expenses.length === 51, `${data.expenses.length}`)

/* 2 · Economía del mes (totales de Economía e Inicio) */
const eco = monthEconomy(data, '2026-10', TODAY)
check('venta bruta total = 2.786.190', eq(eco.ventas, 2786190), `${eco.ventas}`)
check('ganancia bruta = 718.191', eq(eco.bruta, 718191), `${eco.bruta}`)
check('ganancia neta = 696.096', eq(eco.neta, 696096), `${eco.neta}`)
check('resultado = neta − gastos + ingresos extras', eq(eco.resultado, eco.neta - eco.gastos + eco.ingresosExtras), `resultado ${eco.resultado} · gastos ${eco.gastos} · extras ${eco.ingresosExtras}`)
check('ingresos extras = Σ extras de los IPV (sin registrados en la foto)', eq(eco.ingresosExtras, data.days.reduce((s, d) => s + (d.extras ?? []).reduce((t, x) => t + x.importe, 0), 0)))
check('reserva del 10 % de Economía = 10 % de las ventas', eq(eco.reservas.fondoVentasMes, eco.ventas * 0.1), `${eco.reservas.fondoVentasMes}`)
check('rentabilidad por área: margen = ganancia/ventas × 100', eco.rentabilidad.every((r) => r.ventas > 0 ? eq(r.margen, (r.ganancia / r.ventas) * 100) : r.margen === null))

/* 3 · Comisión bancaria FIJA de 210 (nunca porcentaje) */
check('BANK_COMMISSION = 210 fijo', BANK_COMMISSION === 210)

/* 4 · Conciliación SMS ↔ IPV: diferencia = registradas − (IPV + pagos de cuentas + otras) */
{
  let identityOk = true
  let conciliated = 0
  for (const d of data.days) {
    const c = conciliationForDay(data, d.date)
    if (c.diferencia == null) continue
    if (!eq(c.diferencia, c.registradas - ((c.ipv ?? 0) + c.pagosCuenta + c.otras))) identityOk = false
    if (eq(c.diferencia, 0)) conciliated += 1
  }
  check('conciliación: la fórmula se cumple en todos los días con IPV', identityOk)
  console.log(`       (${conciliated} de ${data.days.length} días concilian a 0 con lo registrado en la tarjeta)`)
}

/* 5 · Nómina por ciclo RH (ancla 2026-09-23, 15 días, pago el día 16) */
{
  const n1 = documentos.buildNominaDocumento(data, '2026-09-23')
  const n2 = documentos.buildNominaDocumento(data, '2026-10-08')
  check('nómina ciclo 23 sep–7 oct = 86.500', !!n1 && eq(n1.total, 86500), n1 ? `${n1.total}` : 'sin documento')
  check('nómina ciclo 8–22 oct = 95.000', !!n2 && eq(n2.total, 95000), n2 ? `${n2.total}` : 'sin documento')
  check('pago el día 16 del ciclo (inicio + 15 días)', !!n2 && n2.payDate === '2026-10-23', n2 ? n2.payDate : '')
  check('el documento suma lo de sus empleados (salario leído del RH del ciclo)', !!n2 && eq(n2.employees.reduce((s, e) => s + e.total, 0), n2.total) && n2.employees.length > 0, n2 ? `${n2.employees.length} empleados` : '')
}

/* 6 · Dinero en la calle = SOLO clientes; desglose que cuadra */
{
  const c = eco.cuentasPorCobrar
  check('dinero en la calle = cuentas de clientes', eq(c.dineroEnLaCalle, c.clientes), `${c.dineroEnLaCalle}`)
  check('total por cobrar = clientes + trabajadores + administrativos', eq(c.total, c.clientes + c.trabajadores + c.administrativos), `${c.total}`)
}

/* 7 · Vigencia de cuentas: clientes 7 días naturales; trabajadores 15 hábiles */
{
  const cli = { category: 'cliente', date: '2026-10-02', status: 'pendiente', amount: 100 }
  const tra = { category: 'trabajador', date: '2026-10-02', status: 'pendiente', amount: 100 }
  check('cliente: vence a los 7 días naturales (2 oct → 9 oct)', utils.dueDate(cli) === '2026-10-09', utils.dueDate(cli))
  check('trabajador: vence a los 15 días HÁBILES (2 oct → 23 oct)', utils.dueDate(tra) === '2026-10-23', utils.dueDate(tra))
  check('vencida = morosa: el día del vencimiento aún no, al siguiente sí',
    !utils.isMorosa(cli, 100, '2026-10-09') && utils.isMorosa(cli, 100, '2026-10-10'))
  check('marca manual de morosa manda sobre el plazo', utils.isMorosa({ ...cli, date: '2026-10-25', isMorosa: true }, 100, '2026-10-26'))
  check('cuenta pagada nunca es morosa', !utils.isMorosa({ ...cli, status: 'pagada' }, 0, '2026-10-26'))
}

/* 7b · La foto de morosas de Economía usa los MISMOS plazos hábiles:
   un trabajador nacido el 2-oct NO es moroso el 20-oct (con 15 días
   naturales lo sería desde el 18) y SÍ el 26-oct (venció el 23). */
{
  const sint = {
    ...data,
    receivables: [{
      id: 'test-trab', client: 'Prueba', clientKey: 'prueba', category: 'trabajador',
      date: '2026-10-02', amount: 1000, originalAmount: 1000, saldoBase: 1000,
      status: 'pendiente', closeKind: null, payments: [], detail: '', origin: 'manual',
    }],
    localPayments: [],
  }
  const eco20 = monthEconomy(sint, '2026-10', '2026-10-20')
  const eco26 = monthEconomy(sint, '2026-10', '2026-10-26')
  check('Economía: trabajador del 2-oct no moroso el 20-oct (plazo hábil)', eco20.cuentasPorCobrar.morosasCount === 0, `${eco20.cuentasPorCobrar.morosasCount}`)
  check('Economía: trabajador del 2-oct moroso el 26-oct (venció el 23 hábil)', eco26.cuentasPorCobrar.morosasCount === 1, `${eco26.cuentasPorCobrar.morosasCount}`)
}

/* 8 · Informe del período ≡ informe del mes en el rango del mes completo */
{
  const mes = documentos.buildInformeData(data, '2026-10', TODAY)
  const per = documentos.buildPeriodInformeData(data, '2026-10-01', '2026-10-31', 'Octubre de 2026', TODAY)
  const fields = ['ventas', 'bruta', 'neta', 'gastosTotal', 'extrasTotal', 'resultado', 'barra', 'cocina', 'inversion', 'merma', 'totalCobrado', 'cuadreTotal']
  const diffs = fields.filter((f) => !eq(mes.eco[f], per.eco[f]))
  check('buildPeriodInformeData(mes completo) = buildInformeData en 12 cifras', diffs.length === 0, diffs.length ? `difieren: ${diffs.join(', ')}` : 'idénticas')
  check('billar del período = billar del mes', eq(mes.eco.billar.venta, per.eco.billar.venta))
}

/* 9 · Ficha de costo (caso calculado a mano desde las fórmulas) */
{
  const s = elaboracion.ELABORATION_SETTINGS_FALLBACK
  check('costo hora de carbón = 1500/40 = 37,5', eq(elaboracion.charcoalHourCost(s), 37.5))
  check('costo hora eléctrica = 2 kW × 10 = 20', eq(elaboracion.electricHourCost(s), 20))
  const hourCost = elaboracion.cookingHourCost(s)
  check('costo hora de cocción = 70 % carbón + 30 % eléctrica = 32,25', eq(hourCost, 32.25), `${hourCost}`)
  const totals = elaboracion.recipeTotals(
    {
      ingredients: [
        { amountUsed: 500, purchasePrice: 200, purchasedAmount: 1000 },
        { amountUsed: 500, purchasePrice: 200, purchasedAmount: 1000 },
      ],
      wastePct: 10, laborMinutes: 60, workdayHours: 8, cookingHours: 2, servings: 5, unitsPerServing: 1, salePrice: 150,
    },
    { name: 'Cocinero', dailySalary: 480 },
    hourCost,
    s,
  )
  check('ingredientes = 200 (500×200/1000 × 2)', eq(totals.ingredients, 200))
  check('con merma 10 % = 220', eq(totals.ingredientsWithWaste, 220))
  check('mano de obra = 480 × 60/(8×60) = 60', eq(totals.labor, 60))
  check('cocción = 2 × 32,25 = 64,5', eq(totals.cooking, 64.5))
  check('costo por ración = (220+60+64,5) × 1,10 / 5 = 75,79', eq(totals.perServing, 75.79), `${totals.perServing}`)
  check('margen a 150 = (150 − 75,79)/150 = 49,47 %', eq(totals.margin, (150 - 75.79) / 150 * 100), `${totals.margin}`)
  check('precio sugerido = techo a múltiplo de 5 de 75,79/0,4 × 1,15 = 220', totals.suggested === 220, `${totals.suggested}`)
  check('semáforo: margen 49,47 < meta 60 → low (amarillo)', elaboracion.recipeStatus(150, totals.perServing, totals.profit, totals.margin, 60) === 'low')
  check('semáforo: precio 70 < costo → loss (rojo)', elaboracion.recipeStatus(70, totals.perServing, 70 - totals.perServing, null, 60) === 'loss')
  check('semáforo: precio 200, margen 62,1 ≥ 60 → healthy (verde)', elaboracion.recipeStatus(200, totals.perServing, 200 - totals.perServing, (200 - totals.perServing) / 200 * 100, 60) === 'healthy')
  check('semáforo: sin precio → incomplete', elaboracion.recipeStatus(null, totals.perServing, null, null, 60) === 'incomplete')
}

/* 10 · Queen: etapas y umbrales del Reactor Evolutivo */
{
  check('etapas: Embrión 0 · Infante 25 · Joven 50 · Adulto 75 · Maduro 90',
    JSON.stringify(queen.QUEEN_STAGES.map((x) => x.minScore)) === '[0,25,50,75,90]'
    && queen.QUEEN_STAGES.map((x) => x.id).join(',') === 'celula,infante,juvenil,adulto,maduro')
  const evo = queen.buildQueenEvolution(data, TODAY)
  const band = queen.QUEEN_STAGES.filter((x) => (evo.score ?? -1) >= x.minScore).pop()
  check('el índice cae dentro de la banda de su etapa', evo.score != null && !!band && band.id === evo.stage.id, `índice ${evo.score} · etapa ${evo.stage?.id}`)
}

/* 11 · Productos: margen unitario del catálogo */
{
  const catalog = productos.buildProductsCatalog(data.days)
  const withBoth = catalog.products.filter((p) => p.precioVentaVigente != null && p.precioCompraVigente != null && p.precioVentaVigente > 0)
  check('margen unitario = (venta − compra)/venta × 100 en todo el catálogo',
    withBoth.length > 0 && withBoth.every((p) => eq(p.margenPct, ((p.precioVentaVigente - p.precioCompraVigente) / p.precioVentaVigente) * 100)),
    `${withBoth.length} productos con ambos precios`)
}

/* 12 · Rebaja de almacén → gasto enlazado */
{
  const catalog = productos.buildProductsCatalog(data.days)
  const prod = catalog.products.find((p) => p.precioCompraVigente != null && p.precioCompraVigente > 0)
  check('hay producto con costo vigente para la prueba', !!prod, prod ? prod.name : '')
  if (prod) {
    const cost = warehouseCostFor(data, prod.name)
    check('el costo se resuelve por nombre exacto al del catálogo', cost != null && eq(cost, prod.precioCompraVigente), `${cost}`)
    const entry = { id: 777001, date: '2026-10-20', product: prod.name, quantity: 3, note: '', kind: 'rebaja', purpose: 'Cocina del día', createdAt: 0, updatedAt: 0 }
    const values = warehouseExpenseValues(entry, cost)
    check('gasto enlazado: total = redondeo(3 × costo)', !!values && values.total === Math.round(3 * cost), values ? `${values.total}` : '')
    check('gasto enlazado: categoría «Salida de almacén», origin almacen, sourceKey almacen:<id>',
      !!values && values.category === 'Salida de almacén' && values.origin === 'almacen' && values.sourceKey === 'almacen:777001')
    check('sin costo conocido no hay gasto (null)', warehouseExpenseValues(entry, null) === null)
    check('una entrada nunca genera gasto', warehouseExpenseValues({ ...entry, kind: 'entrada' }, cost) === null)
    check('deptForCuentasConcept: cerveza → Bebidas alcohólicas; detergente → General',
      deptForCuentasConcept('Cerveza cristal', 'Cerveza cristal') === 'Bebidas alcohólicas'
      && deptForCuentasConcept('Detergente', 'Detergente') === 'General / todo el negocio')
    const rec = reconcileWarehouseExpenses(data, [entry])
    const linked = rec.expenses.find((e) => e.sourceKey === 'almacen:777001')
    check('la reconciliación crea el gasto enlazado una sola vez', !!linked && rec.ops.length === 1)
    const rec2 = reconcileWarehouseExpenses({ ...data, expenses: rec.expenses }, [entry])
    check('la reconciliación es idempotente (segunda pasada sin operaciones)', rec2.ops.length === 0, `${rec2.ops.length}`)
    const rec3 = reconcileWarehouseExpenses({ ...data, expenses: rec.expenses }, [])
    check('al borrar la rebaja, el gasto enlazado se elimina', rec3.ops.length === 1 && rec3.ops[0].expense === null && !rec3.expenses.some((e) => e.sourceKey === 'almacen:777001'))
  }
}

console.log(`\nverify:reglas — ${ok} ok, ${fail} fallos`)
process.exit(fail ? 1 : 0)
