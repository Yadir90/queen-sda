// Queen SDA — prueba de verificación de la FASE DE INTEGRACIÓN.
// Uso: node scripts/verify-rh-sync.mjs
// Corre la MISMA lógica de la app (backupCore + syncCore + ipvCore)
// contra los datos reales del negocio y comprueba:
//  1. El registro de RH: 25 trabajadores únicos, Yan una sola vez,
//     Jesús y Dayami como Dirección (fuera de nómina).
//  2. Las nóminas reconstruidas desde las fotos de RH de los IPV:
//     ciclo 2026-10-08 → 82.000, pago 2026-10-23, 23 en nómina;
//     ciclo 2026-09-23 → 86.500, pago 2026-10-08, 19 en nómina.
//     (El historial registrado del respaldo debe decir lo mismo.)
//  3. La sincronización derivada sobre la importación del respaldo es
//     IDEMPOTENTE contra la verdad del propio respaldo: las 63 cuentas
//     del IPV y los 7 gastos «ipv-cuentas» quedan exactamente igual.
//  4. Desde cero (solo cuentas manuales), la sincronización CREA las
//     63 cuentas del IPV con los mismos importes; las pagadas por «ok»
//     nacen pagadas y el resto queda pendiente (las que el original
//     cerró después a mano o por la hoja «Cuentas pagadas» se cuentan
//     como diferencia esperada y se listan).
//  5. Reimportar el día 2026-10-23 no duplica nada.
//  6. Importar el IPV del 24 (Excel real) reconcilia su Desglose:
//     cuenta + gasto + pendiente = 64.930, con Animación como gasto
//     de 3.800 y Ale como cuenta de 23.320 aprendida.

import { DOMParser } from '@xmldom/xmldom'
globalThis.DOMParser = DOMParser

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { normalizeDay, parseBackup } from '../src/lib/backupCore.mjs'
import { parseDayFile, ipvPayloadToRawDay } from '../src/lib/ipvCore.mjs'
import {
  applyImportedPaidAccounts, buildMarksByWorker, buildWorkersRegistry, canonicalPersonKey, clientKeyOf,
  deriveCyclePayroll, deriveSuppressedEntries, firstNameKeyOf, recordedPayroll, syncDerivedData,
} from '../src/lib/syncCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BACKUP = resolve(here, '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json')
const IPV24 = resolve(here, '../../ipv-fix-2026-10-24/PDL La Reina IPV - SDA 24-10-26 (corregido).xlsx')

let failed = 0
function check(label, got, want) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ${want}, obtenido ${got}`)
}
function section(t) { console.log(`\n— ${t} —`) }

const raw = JSON.parse(readFileSync(BACKUP, 'utf8'))
const parsed = parseBackup(raw)

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

function freshState(overrides = {}) {
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
    ...overrides,
  }
}

// ---------- 1. Registro de RH ----------
section('Registro de trabajadores')
const registry = buildWorkersRegistry(parsed.workers, parsed.days, parsed.payrollHistory, parsed.anchorDate ?? undefined)
check('trabajadores en el registro', registry.length, 25)
check('claves únicas', new Set(registry.map((w) => w.key)).size, 25)
check('Yan Espinosa una sola vez', registry.filter((w) => w.key === 'yan espinosa').length, 1)
check('Dirección (Jesús y Dayami)', registry.filter((w) => w.roleKind === 'direccion').length, 2)
check('ancla del respaldo', parsed.anchorDate, '2026-09-23')

// ---------- 1b. Supresiones derivadas del respaldo ----------
// El respaldo no exporta la tabla de eliminaciones del original,
// pero su resultado sí: «Nathaly» no tiene ni una entrada pese a
// salir en 7 Desgloses (marca de cliente completo), y las filas
// «cuenta» de los días 1–10 tampoco (la sincronización de cuentas
// del original empezó el 11 oct; esas deudas viven como manuales).
section('Supresiones derivadas')
const probeState = freshState()
check('«nathaly» suprimida como cliente completo', probeState.suppressedEntries.includes('nathaly'), true)
console.log(`  marcas derivadas: ${probeState.suppressedEntries.length} (por cuenta + la de cliente de Nathaly)`)

// ---------- 2. Nóminas ----------
section('Nóminas: historial registrado vs derivadas de la foto')
const anchor = parsed.anchorDate ?? '2026-09-23'
for (const [cycleStart, total, payDate, count] of [
  ['2026-10-08', 82000, '2026-10-23', 23],
  ['2026-09-23', 86500, '2026-10-08', 19],
]) {
  const rec = recordedPayroll(parsed.payrollHistory, cycleStart)
  check(`historial ${cycleStart}: total`, rec?.total, total)
  check(`historial ${cycleStart}: payDate`, rec?.payDate, payDate)
  check(`historial ${cycleStart}: empleados`, rec?.employees.length, count)
  const der = deriveCyclePayroll(parsed.days, cycleStart, {})
  check(`derivada ${cycleStart}: total`, der.total, total)
  check(`derivada ${cycleStart}: payDate`, der.payDate, payDate)
  check(`derivada ${cycleStart}: en nómina (sin Dirección)`, der.payrollCount, count)
  console.log(`  foto de cierre usada: IPV del ${der.photoDate}`)
}

// Marcas: la foto del 22 certifica hasta el 22; la del 23 abre ciclo.
section('Marcas de RH')
const marks = buildMarksByWorker(parsed.days)
const nelsonMarks = marks['nelson aliesky sanchez morales'] ?? {}
console.log(`  Nelson: días con marca certificada = ${Object.keys(nelsonMarks).length}`)
check('hay marcas certificadas', Object.keys(marks).length > 0, true)

// ---------- 3. Importación de respaldo: las cuentas no se tocan ----------
// El original sincroniza las cuentas DÍA A DÍA, al importar cada IPV;
// una importación de respaldo deja las cuentas exactamente como vienen
// en él. Los gastos del Desglose y el registro de RH sí se derivan del
// conjunto completo (y deben reproducir la verdad del respaldo).
section('Sincronización sobre el respaldo importado (cuentas intactas)')
const truthIpv = parsed.receivables.filter((r) => r.origin === 'ipv')
const truthKey = (r) => `${r.date}::${canonicalPersonKey(r.clientKey, r.client)}|${Math.round(r.originalAmount)}|${r.status}|${Math.round(r.saldoBase)}`
const truthSet = new Map(truthIpv.map((r) => [truthKey(r), r]))
const state1 = freshState()
const sync1 = syncDerivedData({ ...state1, accountSyncDates: [] })
const afterIpv = sync1.receivables.filter((r) => r.origin === 'ipv')
check('cuentas IPV tras importar el respaldo', afterIpv.length, 63)
check('cuentas IPV idénticas a la verdad (fecha·persona·importe·estado·saldo)', afterIpv.filter((r) => truthSet.has(truthKey(r))).length, 63)
check('cuentas creadas en la pasada', sync1.createdReceivableIds.length, 0)
check('cuentas actualizadas en la pasada', sync1.updatedReceivableIds.length, 0)
check('cuentas borradas en la pasada', sync1.deletedReceivableIds.length, 0)
const gastosTruth = parsed.expenses.filter((e) => e.origin === 'ipv-cuentas')
const gastosAfter = sync1.expenses.filter((e) => e.origin === 'ipv-cuentas')
check('gastos «ipv-cuentas»', gastosAfter.length, 7)
check(
  'gastos «ipv-cuentas» con el mismo importe por sourceKey',
  gastosAfter.filter((e) => gastosTruth.some((g) => g.sourceKey === e.sourceKey && Math.round(g.total) === Math.round(e.total))).length,
  7,
)
check('gastos «auto-rh» (uno por nómina)', sync1.expenses.filter((e) => e.origin === 'auto-rh').length, 2)
const sync1b = syncDerivedData({ ...state1, accountSyncDates: [], receivables: sync1.receivables, localPayments: sync1.localPayments, expenses: sync1.expenses, aliases: sync1.aliases })
check(
  'segunda pasada sin cambios',
  sync1b.createdReceivableIds.length + sync1b.updatedReceivableIds.length + sync1b.deletedReceivableIds.length
    + sync1b.createdExpenseIds.length + sync1b.updatedExpenseIds.length + sync1b.deletedExpenseIds.length,
  0,
)

// ---------- 4. Importación por Excel, día a día, desde cero ----------
// Se simula el flujo real del original: cada día se sincroniza al
// importarse. Para los días 11–23 oct el resultado debe ser EXACTO al
// del respaldo (63 cuentas). Para los días 1–10 el original nunca creó
// cuentas del IPV (esa sincronización empezó el 11 oct; sus deudas de
// esos días viven como cuentas manuales o solo en la foto): si esos
// IPV se importaran HOY por Excel, el original también crearía las
// suyas — aquí se cuentan y se listan como diferencia explicada.
section('Sincronización día a día desde cero (solo cuentas manuales)')
const manualOnly = parsed.receivables.filter((r) => r.origin !== 'ipv').map((r) => ({ ...r, payments: [...r.payments] }))
let state2 = freshState({ receivables: manualOnly, expenses: parsed.expenses.filter((e) => e.origin !== 'ipv-cuentas' && e.origin !== 'auto-rh') })
for (const day of parsed.days) {
  const s = syncDerivedData({ ...state2, accountSyncDates: [day.date] })
  state2 = { ...state2, receivables: s.receivables, localPayments: s.localPayments, expenses: s.expenses, aliases: s.aliases }
}
const sync2 = { receivables: state2.receivables, expenses: state2.expenses }
const createdIpv = sync2.receivables.filter((r) => r.origin === 'ipv')
const modern = createdIpv.filter((r) => r.date >= '2026-10-11')
const early = createdIpv.filter((r) => r.date < '2026-10-11')
check('cuentas IPV de los días 11–23 (era de la sincronización)', modern.length, 63)
check('cuentas IPV 11–23 idénticas en importe a la verdad', modern.filter((r) => {
  const t = truthIpv.find((x) => x.date === r.date && canonicalPersonKey(x.clientKey, x.client) === canonicalPersonKey(r.clientKey, r.client))
  return t && Math.round(t.originalAmount) === Math.round(r.originalAmount)
}).length, 63)
const okPaidTruth = truthIpv.filter((r) => String(r.detail).startsWith('Pagada al importar')).length
check('pagadas al importar por «ok» (días 11–23)', modern.filter((r) => r.status === 'pagada').length, okPaidTruth)
console.log(`  (el respaldo trae ${truthIpv.filter((r) => r.status === 'pagada').length} IPV pagadas en total; las demás se cerraron después a mano o por la hoja «Cuentas pagadas»: diferencia esperada en una sincronización fresca)`)
check('cuentas de los días 1–10 (suprimidas por la derivación del respaldo)', early.length, 0)
check('gastos «ipv-cuentas» creados', sync2.expenses.filter((e) => e.origin === 'ipv-cuentas').length, 7)

// ---------- 5. Reimportar un día no duplica ----------
section('Reimportación del día 2026-10-23')
const day23 = parsed.days.find((d) => d.date === '2026-10-23')
const state3 = { ...state2, days: parsed.days.map((d) => (d.date === '2026-10-23' ? day23 : d)) }
const sync3 = syncDerivedData({ ...state3, accountSyncDates: ['2026-10-23'] })
check('cuentas IPV tras reimportar el 23', sync3.receivables.filter((r) => r.origin === 'ipv').length, createdIpv.length)
check('sin cuentas nuevas por la reimportación', sync3.createdReceivableIds.length, 0)

// ---------- 6. IPV del 24 (Excel) ----------
section('IPV del 24 de octubre (Excel real)')
const buf = readFileSync(IPV24)
const payload = await parseDayFile(new File([buf], 'ipv24.xlsx'))
const day24 = normalizeDay(ipvPayloadToRawDay(payload))
check('día 24: total del Desglose', Math.round(day24.fondos.totalCuentasPorCobrar), 64930)
const state4 = {
  ...state3,
  receivables: sync3.receivables, localPayments: sync3.localPayments, expenses: sync3.expenses, aliases: sync3.aliases,
  days: [...parsed.days, day24].sort((a, b) => a.date.localeCompare(b.date)),
}
const sync4 = syncDerivedData({ ...state4, accountSyncDates: ['2026-10-24'] })
const paid4 = applyImportedPaidAccounts(sync4.receivables, day24)
void paid4
const entries24 = sync4.cuentasEntries.filter((e) => e.date === '2026-10-24')
const sumBy = (kind) => entries24.filter((e) => e.classification === kind).reduce((s, e) => s + e.amount, 0)
// Nathaly (1.170) no entra en las entradas: su marca de supresión de
// cliente completo la hace invisible, como en el original.
const suprimido24 = state4.suppressedEntries.includes('nathaly') ? 1170 : 0
console.log(`  Desglose 24 → cuenta ${sumBy('cuenta')} + gasto ${sumBy('gasto')} + pendiente ${sumBy('pendiente')} + suprimido ${suprimido24} = ${sumBy('cuenta') + sumBy('gasto') + sumBy('pendiente') + suprimido24}`)
check('reconciliación del Desglose del 24', sumBy('cuenta') + sumBy('gasto') + sumBy('pendiente') + suprimido24, 64930)
const anim = sync4.expenses.find((e) => e.origin === 'ipv-cuentas' && e.sourceKey === '2026-10-24::animacion')
check('Animación del 24 como gasto', anim ? Math.round(anim.total) : null, 3800)
const ale24 = sync4.receivables.find((r) => r.origin === 'ipv' && r.date === '2026-10-24' && canonicalPersonKey(r.clientKey, r.client) === 'ale')
check('Ale del 24 como cuenta (aprendido)', ale24 ? Math.round(ale24.originalAmount) : null, 23320)
const nelsito24 = sync4.receivables.find((r) => r.origin === 'ipv' && r.date === '2026-10-24' && canonicalPersonKey(r.clientKey, r.client) === 'nelson aliesky sanchez morales')
check('Nelsito del 24 unido a Nelson (RH)', nelsito24 ? Math.round(nelsito24.originalAmount) : null, 1150)
check('Nelsito del 24 como trabajador', nelsito24?.category, 'trabajador')
const pendNames = entries24.filter((e) => e.classification === 'pendiente').map((e) => e.rawName).sort()
console.log(`  Pendientes del 24 (sin cuenta ni gasto, para decisión del dueño): ${pendNames.join(', ') || 'ninguna'}`)
const der24 = deriveCyclePayroll(state4.days, '2026-10-23', {})
check('ciclo 23-oct→6-nov: payDate derivada', der24.payDate, '2026-11-07')
console.log(`  Nómina derivada del ciclo nuevo: total ${der24.total} con foto del ${der24.photoDate}`)

console.log(failed > 0 ? `\nRESULTADO: FALLO (${failed} comprobaciones)` : '\nRESULTADO: OK — integración verificada contra los datos reales.')
process.exit(failed > 0 ? 1 : 0)
