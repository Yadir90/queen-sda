// Queen SDA — verificación de la FASE ECONOMÍA + TRANSFERENCIAS.
// Uso: node scripts/verify-economia.mjs
// Corre la MISMA lógica de la app (backupCore + syncCore + economiaCore)
// contra el respaldo real del negocio y comprueba:
//
//  TRANSFERENCIAS (historial de la tarjeta que viaja en el respaldo):
//   · 20 movimientos importados tal cual (importes, detalles y marcas
//     intactos; los dos abonos manuales anulados por el propio
//     original llegan con importe 0 y superseded=true).
//   · El saldo derivado de los movimientos efectivos reproduce el
//     campo balance del transferState del respaldo: 32.625 CUP.
//     NOTA: la cadena viva del original cerró en 7.200 la tarde del
//     23 oct (antes del IPV de ese día); el respaldo es la foto del
//     25 oct 03:45 y manda: ya incluye el abono del IPV del 23
//     (40.700) y trae los manuales anulados — por eso cierra en
//     32.625. El 7.200 se documenta, no se recompone.
//   · Pasado al banco 107.625 (89.027 + 7.943 + 10.655), total recibido
//     140.820, del IPV 137.730, salido 108.195 — todos contra los
//     agregados que el propio transferState declara.
//   · Conciliaciones del 22 y 23 oct: diferencia 0 con la clave del
//     dueño (SMS = IPV del día + pagos de cuentas + otras entradas).
//   · Marca «No es de La Reina»: reversible y fuera del saldo.
//
//  ECONOMÍA (octubre 2026, días 1–23 del respaldo):
//   · Ventas 2.662.090, bruta 667.141, neta 645.576; gastos tras la
//     sync: 51 registros / 262.505 (el crudo también es 51 / 262.505:
//     la sync espejo no crea ni borra gastos sobre el respaldo ya
//     conciliado — correspondencia documentada abajo).
//   · Ingresos extras 8.500 (2), billar 17.500 / utilidad 13.700
//     (SOLO días con la tabla por turnos guardada: los IPV viejos
//     traen en «juegos» la fila TOTAL acumulada — 26.900 en octubre
//     — y sumarla inflaba el mes; corrección de la auditoría de
//     documentos del 2026-10-26 contra la comparativa validada),
//     barra 2.255.690, cocina 406.400, inversión 1.696.425, merma
//     21.565, total cobrado 121.710, efectivo en caja al cierre del
//     23 506.860, zelle 0, consumo de la casa 171.080, resultado
//     391.571, resultado en efectivo 211.991.
//   · Quincenas de CONTABILIDAD (naturales): 1–15 ventas 1.601.500 /
//     bruta 420.891 / neta 418.916; 16–fin ventas 1.060.590; la suma
//     de ambas = ventas del mes. (Distintas de los ciclos de RH.)
//   · Fondo de ventas del mes (10 %): 266.209.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import {
  buildWorkersRegistry, canonicalPersonKey, clientKeyOf, deriveSuppressedEntries, firstNameKeyOf, syncDerivedData,
} from '../src/lib/syncCore.mjs'
import { conciliationForDay, isEffectiveMovement, monthEconomy, transferSummary } from '../src/lib/economiaCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BACKUP = resolve(here, '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json')

let failed = 0
function check(label, got, want) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ${want}, obtenido ${got}`)
}
function section(t) { console.log(`\n— ${t} —`) }

const raw = JSON.parse(readFileSync(BACKUP, 'utf8'))
const parsed = parseBackup(raw)
const ts = raw.data.transferState ?? {}

function knownPersonsOf() {
  const set = new Set()
  for (const r of parsed.receivables) {
    set.add(canonicalPersonKey(r.clientKey, r.client))
    if (r.origin === 'ipv') set.add(clientKeyOf(r.client))
  }
  for (const w of parsed.workers) {
    set.add(canonicalPersonKey(w.key, w.nombre))
    const first = firstNameKeyOf(w.nombre)
    if (first) set.add(first)
  }
  return set
}

const state = (() => {
  const workers = buildWorkersRegistry(parsed.workers, parsed.days, parsed.payrollHistory, parsed.anchorDate ?? undefined)
  const suppressedEntries = deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, {
    learnedKinds: parsed.learnedKinds, overrides: parsed.cuentasOverrides, knownPersons: knownPersonsOf(),
  })
  return {
    days: parsed.days,
    receivables: parsed.receivables.map((r) => ({ ...r, payments: [...r.payments] })),
    localPayments: [],
    expenses: parsed.expenses.map((e) => ({ ...e })),
    workers,
    aliases: {},
    learnedKinds: parsed.learnedKinds,
    cuentasOverrides: parsed.cuentasOverrides,
    suppressedEntries,
    payrollHistory: parsed.payrollHistory,
    transferMovements: parsed.transferMovements,
    anchorDate: parsed.anchorDate,
  }
})()
const synced = syncDerivedData({ ...state, accountSyncDates: [] })
const data = { ...state, ...synced, transferMovements: parsed.transferMovements }

// ---------- Transferencias ----------
section('Transferencias — importación desde el respaldo')
check('movimientos importados', parsed.transferMovements.length, 20)
check('transferState.balance declarado en el respaldo', ts.balance, 32625)
check('transferState.totalBankPassed declarado', ts.totalBankPassed, 107625)
check('pasados al banco (bankTransfers del respaldo)', (raw.data.bankTransfers ?? []).length, 5)

const summary = transferSummary(parsed.transferMovements)
check('saldo derivado = balance del transferState', summary.balance, ts.balance)
check('saldo derivado (cifra)', summary.balance, 32625)
check('pasado al banco derivado', summary.totalBankPassed, 107625)
check('total recibido', summary.totalReceived, 140820)
check('recibido del IPV', summary.totalIpvReceived, 137730)
check('total salido', summary.totalOut, 108195)
check('pagos de cuentas por transferencia', summary.totalPagoCuenta, 3090)
check('abonos manuales + extras efectivos', summary.totalManualExtra, 0)
check('anulados por el original (superseded)', summary.supersededCount, 2)
check('excluidos «No es de La Reina»', summary.excludedCount, 0)
check('último pase al banco', summary.lastBankPase?.amount, 10655)
check('último pase al banco (fecha)', summary.lastBankPase?.date, '2026-10-23')

const paseAmounts = parsed.transferMovements
  .filter((m) => m.source === 'pase' && m.paseKind === 'banco' && isEffectiveMovement(m))
  .map((m) => Math.abs(m.amount))
  .sort((a, b) => b - a)
check('pases al banco (89.027, 10.655, 7.943)', paseAmounts.join(','), '89027,10655,7943')

const manual4 = parsed.transferMovements.find((m) => m.manualId === 4)
const manual5 = parsed.transferMovements.find((m) => m.manualId === 5)
check('abono manual 4 (Yurien) presente', Boolean(manual4), true)
check('abono manual 4 anulado por el original', manual4?.superseded, true)
check('abono manual 4 con importe 0 (sin recomponer)', manual4?.amount, 0)
check('abono manual 4 conserva su detalle', manual4?.detail.includes('Yurien') ?? false, true)
check('abono manual 5 (conciliación) anulado', manual5?.superseded, true)
check('abono manual 5 con importe 0 (sin recomponer)', manual5?.amount, 0)
check('abono manual 5 conserva su detalle', manual5?.detail.includes('Conciliación') ?? false, true)

section('Transferencias — conciliación del dueño')
const c22 = conciliationForDay(data, '2026-10-22')
check('22 oct: entradas registradas', c22.registradas, 10790)
check('22 oct: IPV del día', c22.ipv, 8000)
check('22 oct: pagos de cuentas', c22.pagosCuenta, 2790)
check('22 oct: diferencia (cuadra)', c22.diferencia, 0)
const c23 = conciliationForDay(data, '2026-10-23')
check('23 oct: entradas registradas', c23.registradas, 40700)
check('23 oct: IPV del día', c23.ipv, 40700)
check('23 oct: diferencia (cuadra)', c23.diferencia, 0)

section('Transferencias — marca «No es de La Reina» reversible')
const pase5 = parsed.transferMovements.find((m) => m.paseId === 5)
const marcados = parsed.transferMovements.map((m) => (m.id === pase5.id ? { ...m, excluded: true } : m))
const sMarcado = transferSummary(marcados)
check('con el pase de 89.027 marcado: saldo', sMarcado.balance, 121652)
check('con el pase marcado: pasado al banco', sMarcado.totalBankPassed, 18598)
const desmarcados = marcados.map((m) => (m.id === pase5.id ? { ...m, excluded: false } : m))
check('al desmarcar: saldo vuelve', transferSummary(desmarcados).balance, 32625)
check('al desmarcar: pasado al banco vuelve', transferSummary(desmarcados).totalBankPassed, 107625)

// ---------- Economía ----------
section('Economía — octubre 2026 (días 1–23)')
const eco = monthEconomy(data, '2026-10', '2026-10-25')
check('días con IPV', eco.daysCount, 23)
check('venta bruta total', eco.ventas, 2662090)
check('ganancia bruta', eco.bruta, 667141)
check('ganancia neta', eco.neta, 645576)
check('gastos tras la sync (registros)', eco.gastosCount, 51)
check('gastos tras la sync (total)', eco.gastos, 262505)
check('gastos crudos del respaldo (registros)', parsed.expenses.length, 51)
check('gastos crudos del respaldo (total)', parsed.expenses.reduce((s, e) => s + e.total, 0), 262505)
const porOrigen = {}
for (const e of eco.expenses) porOrigen[e.origin] = (porOrigen[e.origin] ?? 0) + 1
check('gastos ipv-cuentas tras la sync', porOrigen['ipv-cuentas'] ?? 0, 7)
check('gastos auto-rh tras la sync', porOrigen['auto-rh'] ?? 0, 2)
check('gastos manuales tras la sync', porOrigen.manual ?? 0, 42)
check('ingresos extras', eco.ingresosExtras, 8500)
check('ingresos extras (registros)', eco.ingresosExtrasCount, 2)
check('billar: venta (solo días con tabla guardada)', eco.billar.venta, 17500)
check('billar: utilidad (solo días con tabla guardada)', eco.billar.utilidad, 13700)
check('venta en barra', eco.barra, 2255690)
check('venta en cocina', eco.cocina, 406400)
check('barra + cocina = ventas', eco.barra + eco.cocina, eco.ventas)
check('inversión (entradas a precio de compra)', eco.inversion, 1696425)
check('merma', eco.merma, 21565)
check('total cobrado del mes', eco.totalCobrado, 121710)
check('efectivo en caja al cierre (último día)', eco.efectivoCaja, 506860)
check('último día del mes con IPV', eco.lastDay, '2026-10-23')
check('zelle al cierre', eco.zelleCierre, 0)
check('consumo de la casa', eco.consumo.total, 171080)
check('consumo Jesús', eco.consumo.jesus, 132870)
check('consumo Dayami', eco.consumo.dayami, 16760)
check('consumo Alejandro', eco.consumo.alejandro, 21450)
check('resultado (neta − gastos + extras)', eco.resultado, 391571)
check('resultado en efectivo', eco.resultadoEfectivo, 211991)
check('fondo de ventas del mes (10 %)', eco.reservas.fondoVentasMes, 266209)

section('Economía — quincenas de contabilidad (naturales del mes)')
const [q1, q2] = eco.quincenas
check('Q1 (1–15): ventas', q1.ventas, 1601500)
check('Q1 (1–15): bruta', q1.bruta, 420891)
check('Q1 (1–15): neta', q1.neta, 418916)
check('Q2 (16–fin): ventas', q2.ventas, 1060590)
check('Q1 + Q2 = ventas del mes', q1.ventas + q2.ventas, eco.ventas)

console.log('\nNota del saldo: la cadena viva del sistema original cerró en 7.200 la tarde del 23 oct')
console.log('(antes del IPV de ese día y con los abonos manuales aún vivos). El respaldo — foto del')
console.log('25 oct 03:45 — ya incluye el abono del IPV del 23 (40.700) y trae los dos abonos')
console.log('manuales anulados por el propio original con importe 0; su transferState cierra en')
console.log('32.625 y eso es lo que esta copia reproduce, sin recomponer ningún asiento.')

console.log(failed === 0 ? '\nTODO CORRECTO — Economía y Transferencias verificados contra el respaldo real.' : `\n${failed} COMPROBACIÓN(ES) FALLARON.`)
process.exit(failed === 0 ? 0 : 1)
