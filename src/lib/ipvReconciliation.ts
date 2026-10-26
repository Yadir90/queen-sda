/* Reconciliación SDA → IPV (IPV de vuelta): puerto fiel de la acción
   getIpvReconciliation del servidor original (actions.ts:15714).
   Devuelve SOLO filas que el libro original no contiene, sin
   reescribir una celda del IPV: RH que el sistema conoce y el IPV no
   trae, ingresos del sistema ausentes, gastos no-IPV sin coincidencia
   exacta en la tabla de gastos del IPV, saldos de almacén acumulados
   hasta la fecha ausentes de la hoja, y cuentas pagadas ese día que
   el IPV no trae ya (con la tolerancia de una letra del original).
   El archivo actualizado lo construye buildUpdatedIpv
   (ipvRoundTrip.ts) EN EL CLIENTE con estas adiciones.

   Mapeos a los datos de esta copia (declarados):
   - El «día crudo» es el payload del archivo (ipvPayloadToRawDay /
     parseDayFile): la foto exacta del IPV, como en el original.
   - Trabajadores: data.workers (sin archivados: se excluyen los de
     contrato cancelado según workersExtended) contra day.rh.
   - Ingresos del sistema: esta copia no tiene registro propio de
     ingresos extras fuera del IPV (Extras es lectura de los días);
     la sección queda con su lógica completa y fuente vacía — si un
     día existiera ese registro, se alimenta por `sdaIncomes`.
   - Gastos: data.expenses con origin que no empieza por «ipv».
   - Almacén manual: data.warehouseEntries (saldos acumulados ≤
     fecha); el código de barras sale de warehouseMeta (los
     movimientos de esta copia no lo guardan).
   - Cuentas pagadas: pagos de data.receivables con paidDate = fecha
     (clave origen:id contra los respaldos), cuentas saldadas ese día
     sin fila de pago (respaldo manual e IPV, como el original) y
     data.localPayments no cubiertos.
   - Correcciones de nombre: alias de almacén de warehouseMeta (los
     perfiles/alias de producto del servidor no viajan en el respaldo).
   - Códigos de barras: catálogo derivado de los días (barcode desde
     warehouseMeta si existe) + saldos de almacén, como el original. */

import type { StoredData } from '../types'
import type { IpvAddition, IpvNameCorrection, IpvProductBarcode } from './ipvRoundTrip'
import { buildProductsCatalog, menuDeptOf, normalizeLoose, warehouseProductKey } from './productosCore.mjs'
import { canonicalPersonKey, firstNameKeyOf } from './syncCore.mjs'

export interface RawDayForReconciliation {
  rh?: Array<{ nombre: string }>
  ingresosEntradaMesas?: Array<{ concepto: string; importe: number }>
  departments?: Array<{ name: string; venta: number }>
  gastosIpv?: Array<{ concept: string; quantity: number; total: number }>
  warehouse?: Array<{ product: string; saldoFinal: number }>
  cuentasPagadas?: Array<{ client: string; amount: number }>
}

export interface IpvReconciliationResult {
  date: string
  sourcePreserved: true
  additions: IpvAddition[]
  counts: { rh: number; cocteleria: number; pizzeria: number; entradasMesas: number; almacen: number; gastos: number; cuentasPagadas: number }
  productBarcodes: IpvProductBarcode[]
  nameCorrections: IpvNameCorrection[]
  templateFingerprint: string
}

export interface SdaIncomeLike {
  date: string
  concept: string
  note: string
  amount: number
  paymentMethod: string
  origin: string
}

/* Copia literal de syncCore.mjs (no exportada allí): dos claves están a
   una edición de distancia (una sustitución o un carácter de más/menos). */
function oneEditApart(a: string, b: string): boolean {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false
  if (a === b) return true
  if (a.length === b.length) {
    let differences = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++differences > 1) return false
    }
    return differences === 1
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue }
    if (skipped) return false
    skipped = true
    j++
  }
  return true
}

export function buildIpvReconciliation(data: StoredData, date: string, rawDay: RawDayForReconciliation, sdaIncomes: SdaIncomeLike[] = []): IpvReconciliationResult {
  const additions: IpvAddition[] = []

  // RH: trabajadores del sistema que la hoja RH del IPV no trae.
  const rhNames = new Set((rawDay.rh ?? []).map((row) => normalizeLoose(row.nombre)))
  const cancelledKeys = new Set(
    data.workersExtended.filter((w) => w.contratoCanceladoEl).map((w) => w.workerKey),
  )
  for (const worker of data.workers) {
    if (cancelledKeys.has(worker.key) || rhNames.has(normalizeLoose(worker.nombre ?? ''))) continue
    additions.push({
      section: 'RH',
      category: worker.ocupacion || 'Sin ocupación',
      concept: worker.nombre ?? '',
      quantity: null,
      amount: null,
      detail: `CI: ${worker.carnet ?? ''} · Cuenta: ${worker.cuentaBancaria ?? ''} · Móvil: ${worker.movil ?? ''}`,
    })
  }

  // Ingresos del sistema (coctelería/pizzería/entradas y mesas) que el
  // IPV no trae ya, con la deduplicación exacta del original.
  const dayIncomes = new Set((rawDay.ingresosEntradaMesas ?? []).map((row) => `${normalizeLoose(row.concepto)}::${Math.round(row.importe)}`))
  const cantinaTotal = Math.round(rawDay.departments?.find((d) => menuDeptOf(d.name) === 'Cantina')?.venta ?? 0)
  const pizzasTotal = Math.round(rawDay.departments?.find((d) => menuDeptOf(d.name) === 'Pizzas')?.venta ?? 0)
  for (const income of sdaIncomes.filter((row) => row.date === date)) {
    if (income.origin === 'ipv-ventas-aparte') continue
    if (income.origin === 'ipv-entrada-mesas' && dayIncomes.has(`${normalizeLoose(income.concept)}::${Math.round(income.amount)}`)) continue
    const text = normalizeLoose(`${income.concept} ${income.note}`)
    const section: 'Coctelería' | 'Pizzería' | 'Entradas y mesas' = text.includes('coct') || text.includes('cantina') ? 'Coctelería' : text.includes('pizza') ? 'Pizzería' : 'Entradas y mesas'
    if (section === 'Coctelería' && Math.round(income.amount) === cantinaTotal) continue
    if (section === 'Pizzería' && Math.round(income.amount) === pizzasTotal) continue
    additions.push({
      section,
      category: income.concept,
      concept: income.concept,
      quantity: null,
      amount: income.amount,
      detail: `${income.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo'}${income.note ? ` · ${income.note}` : ''}`,
    })
  }

  // Gastos del sistema que no nacieron del IPV y no coinciden con una
  // línea de su tabla de gastos (coincidencia exacta primero, luego
  // compatible por nombre+importe; cada línea del IPV se reclama una vez).
  const ipvExpenseLines = (rawDay.gastosIpv ?? []).map((entry, index) => ({
    index,
    name: normalizeLoose(entry.concept),
    quantity: Number(entry.quantity),
    amount: Math.round(entry.total),
  }))
  const claimedIpvExpenseLines = new Set<number>()
  for (const expense of data.expenses.filter((row) => row.date === date)) {
    if (expense.origin.startsWith('ipv')) continue
    const name = normalizeLoose(expense.concept)
    const amount = Math.round(expense.total)
    const exact = ipvExpenseLines.find((line) => !claimedIpvExpenseLines.has(line.index) && line.name === name && line.amount === amount && Math.abs(line.quantity - expense.quantity) <= 0.000001)
    const compatible = exact ?? ipvExpenseLines.find((line) => !claimedIpvExpenseLines.has(line.index) && line.name === name && line.amount === amount)
    if (compatible) {
      claimedIpvExpenseLines.add(compatible.index)
      continue
    }
    additions.push({
      section: 'Gastos',
      category: expense.category || 'Otros',
      concept: expense.concept,
      quantity: expense.quantity,
      amount: expense.total,
      detail: `${expense.dept || 'General / todo el negocio'}${expense.note ? ` · ${expense.note}` : ''}`,
    })
  }

  // Almacén: saldo acumulado hasta la fecha (no solo el día), una fila
  // por producto; si ya está en la hoja del IPV, el archivo manda.
  const warehouseBalances = new Map<string, { product: string; quantity: number; barcode: string }>()
  for (const movement of data.warehouseEntries) {
    if (movement.date > date) continue
    const key = warehouseProductKey(movement.product)
    const current = warehouseBalances.get(key) ?? { product: movement.product, quantity: 0, barcode: data.warehouseMeta[key]?.barcode ?? '' }
    current.product = movement.product || current.product
    current.barcode = current.barcode || (data.warehouseMeta[key]?.barcode ?? '')
    current.quantity += movement.kind === 'rebaja' ? -movement.quantity : movement.quantity
    warehouseBalances.set(key, current)
  }
  const warehouseAliasToOfficial = new Map<string, string>()
  for (const [key, row] of Object.entries(data.warehouseMeta)) for (const alias of row.aliases ?? []) warehouseAliasToOfficial.set(warehouseProductKey(alias), key)
  const warehouseInIpv = new Map((rawDay.warehouse ?? []).map((row) => [warehouseAliasToOfficial.get(warehouseProductKey(row.product)) ?? warehouseProductKey(row.product), row.saldoFinal]))
  const warehouseBalanceRows: Array<[string, { product: string; quantity: number; barcode: string }]> = []
  for (const row of [...warehouseBalances.values()].sort((a, b) => a.product.localeCompare(b.product, 'es'))) {
    if (Math.abs(row.quantity) <= 0.000001) continue
    const key = warehouseProductKey(row.product)
    warehouseBalanceRows.push([key, row])
    // Si la fila ya existe en el IPV, el último archivo importado manda:
    // no se reescribe ni se duplica. (Los códigos de barras de abajo sí
    // salen de TODOS los saldos, como en el original.)
    if (warehouseInIpv.get(key) != null) continue
    additions.push({ section: 'Almacén', category: 'Existencia al cierre', concept: row.product, quantity: row.quantity, amount: null, detail: `Saldo registrado en SDA al ${date}` })
  }

  // Cuentas pagadas ese día que el IPV no trae ya (con la tolerancia de
  // una letra en el primer nombre del original).
  const paidAlreadyInIpv = (client: string, amount: number): boolean => {
    const key = canonicalPersonKey(null, client)
    const first = firstNameKeyOf(client)
    return (rawDay.cuentasPagadas ?? []).some((row) => {
      if (Math.round(Number(row.amount) || 0) !== Math.round(amount)) return false
      const rowKey = canonicalPersonKey(null, row.client)
      const rowFirst = firstNameKeyOf(row.client)
      return rowKey === key || (first.length >= 5 && rowFirst.length >= 5 && oneEditApart(first, rowFirst))
    })
  }
  const paidAccountKeys = new Set<string>()
  for (const receivable of data.receivables) {
    const origin = receivable.origin === 'ipv' ? 'ipv' : 'manual'
    for (const payment of receivable.payments) {
      if (payment.paidDate !== date) continue
      paidAccountKeys.add(`${origin}:${receivable.id}`)
      const client = receivable.client || 'Cliente sin nombre'
      if (paidAlreadyInIpv(client, payment.amount)) continue
      additions.push({
        section: 'Cuentas pagadas',
        category: client,
        concept: 'Pago de cuenta',
        quantity: null,
        amount: payment.amount,
        detail: payment.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo',
      })
    }
  }
  for (const account of data.receivables) {
    const origin = account.origin === 'ipv' ? 'ipv' : 'manual'
    if (paidAccountKeys.has(`${origin}:${account.id}`)) continue
    if (account.paidDate !== date) continue
    const client = account.client || 'Cliente sin nombre'
    const amount = Number(account.originalAmount ?? account.amount) || 0
    if (paidAlreadyInIpv(client, amount)) continue
    additions.push({ section: 'Cuentas pagadas', category: client, concept: 'Pago de cuenta', quantity: null, amount, detail: account.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo' })
  }
  for (const local of data.localPayments) {
    if (local.date !== date) continue
    const receivable = data.receivables.find((r) => r.id === local.receivableId)
    const origin = receivable?.origin === 'ipv' ? 'ipv' : 'manual'
    if (paidAccountKeys.has(`${origin}:${local.receivableId}`)) continue
    const client = receivable?.client || 'Cliente sin nombre'
    if (paidAlreadyInIpv(client, local.amount)) continue
    additions.push({ section: 'Cuentas pagadas', category: client, concept: 'Pago de cuenta', quantity: null, amount: local.amount, detail: local.method === 'transferencia' ? 'Transferencia' : 'Efectivo' })
  }

  const count = (section: IpvAddition['section']) => additions.filter((row) => row.section === section).length
  const catalog = buildProductsCatalog(data.days, data.inventoryAdjustments)
  return {
    date,
    sourcePreserved: true,
    additions,
    counts: {
      rh: count('RH'),
      cocteleria: count('Coctelería'),
      pizzeria: count('Pizzería'),
      entradasMesas: count('Entradas y mesas'),
      almacen: count('Almacén'),
      gastos: count('Gastos'),
      cuentasPagadas: count('Cuentas pagadas'),
    },
    nameCorrections: [
      ...Object.values(data.warehouseMeta).flatMap((row) => (row.aliases ?? []).map((alias) => ({ fromName: alias, toName: row.product, dept: 'Almacén' }))),
    ],
    templateFingerprint: `SDA2-${date}-${crypto.randomUUID()}`,
    productBarcodes: [
      ...catalog.products.map((product) => ({
        productKey: product.productKey,
        name: product.name,
        dept: product.dept,
        um: product.um,
        barcode: data.warehouseMeta[warehouseProductKey(product.name)]?.barcode ?? '',
      })),
      ...warehouseBalanceRows.map(([key, row]) => ({
        productKey: `almacen:${key}`,
        name: row.product,
        dept: 'Almacén',
        um: '',
        barcode: row.barcode,
      })),
    ],
  }
}
