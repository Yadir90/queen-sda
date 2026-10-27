// Queen SDA — PUERTA DE DESPLIEGUE (orden del dueño, 26-oct 19:08):
// «cuando lo despleguemos, imagina que me esconda o no ponga una
// cuenta — no puede suceder, todo tiene que cuadrar».
//
// Reconciliación contra la foto verificada (backup-sda-2026-10-26.json,
// sha256 34a94be1…): cada cuenta de las 119 (nombre, grupo, saldo),
// cada gasto de los 51, extras, pagos con su corte de fecha,
// transferencias y nómina — oráculo = lo que el ORIGINAL guardó en su
// propio respaldo; clon = parseBackup → syncDerivedData →
// monthEconomy, el camino de producción. Diferencia aceptable: CERO.
// Si una sola cuenta o cifra difiere, la batería FALLA y el paquete
// no puede declararse final.
//
// La sync se corre en las DOS condiciones: con el aprendizaje de la
// foto (vía de importación por la app) y SIN él (condición de la
// semilla SQL de producción, la que se tragó dos gastos el 26-oct).
// Uso: node scripts/verify-cuadre.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import {
  buildWorkersRegistry, canonicalPersonKey, clientKeyOf, deriveSuppressedEntries, firstNameKeyOf, syncDerivedData,
} from '../src/lib/syncCore.mjs'
import { monthEconomy, transferSummary } from '../src/lib/economiaCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BACKUP = resolve(here, '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-26.json')
const raw = JSON.parse(readFileSync(BACKUP, 'utf8'))
const photo = raw.data
const parsed = parseBackup(raw)

let failed = 0
function check(label, got, want) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ${JSON.stringify(want)}, obtenido ${JSON.stringify(got)}`)
}
function section(t) { console.log(`\n— ${t} —`) }

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

function buildState(withLearning) {
  const workers = buildWorkersRegistry(parsed.workers, parsed.days, parsed.payrollHistory, parsed.anchorDate ?? undefined)
  const learnedKinds = withLearning ? parsed.learnedKinds : {}
  const cuentasOverrides = withLearning ? parsed.cuentasOverrides : {}
  const suppressedEntries = deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, {
    learnedKinds, overrides: cuentasOverrides, knownPersons: knownPersonsOf(),
  })
  return {
    days: parsed.days,
    receivables: parsed.receivables.map((r) => ({ ...r, payments: [...r.payments] })),
    localPayments: [],
    expenses: parsed.expenses.map((e) => ({ ...e })),
    workers,
    aliases: {},
    learnedKinds,
    cuentasOverrides,
    suppressedEntries,
    payrollHistory: parsed.payrollHistory,
    transferMovements: parsed.transferMovements,
    anchorDate: parsed.anchorDate,
  }
}

const CASA = new Set(['jesus', 'dayami', 'alejandro'])
function grupoDe(rec) {
  if (rec.registro === 'aparte' || CASA.has(canonicalPersonKey(rec.clientKey ?? '', rec.client ?? ''))) return 'aparte'
  if (rec.category === 'cliente') return 'clientes'
  if (rec.category === 'trabajador') return 'trabajadores'
  return 'administrativos'
}
const saldoDe = (rec) => Number(rec.saldo ?? rec.amount ?? 0)

// ---------- CUENTAS: las 119, una a una ----------
section('Cuentas por cobrar — foto del original vs clon (parse + sync)')
const oracle = new Map(photo.receivables.map((r) => [String(r.id), r]))
check('cuentas en la foto', oracle.size, 119)
for (const withLearning of [true, false]) {
  const tag = withLearning ? 'con aprendizaje' : 'SIN aprendizaje (condición producción)'
  const state = buildState(withLearning)
  const synced = syncDerivedData({ ...state, accountSyncDates: [] })
  const cloneRecs = synced.receivables ?? state.receivables
  const clone = new Map(cloneRecs.map((r) => [String(r.id), r]))
  check(`cuentas del clon (${tag})`, clone.size, oracle.size)
  const diffs = []
  for (const [id, o] of oracle) {
    const c = clone.get(id)
    if (!c) { diffs.push(`#${id} ${o.client}: AUSENTE en el clon`); continue }
    if (c.client !== o.client) diffs.push(`#${id}: nombre «${c.client}» ≠ «${o.client}»`)
    if ((c.category ?? '') !== (o.category ?? '')) diffs.push(`#${id} ${o.client}: categoría ${c.category} ≠ ${o.category}`)
    if ((c.registro ?? 'general') !== (o.registro ?? 'general')) diffs.push(`#${id} ${o.client}: registro ${c.registro} ≠ ${o.registro}`)
    const cSaldo = Number(c.saldoBase ?? c.saldo ?? 0)
    if (cSaldo !== saldoDe(o)) diffs.push(`#${id} ${o.client}: saldo ${cSaldo} ≠ ${saldoDe(o)}`)
    if ((c.status ?? '') !== (o.status ?? '')) diffs.push(`#${id} ${o.client}: estado ${c.status} ≠ ${o.status}`)
  }
  for (const [id, c] of clone) if (!oracle.has(id)) diffs.push(`#${id} ${c.client}: SOBRA en el clon (no está en la foto)`)
  check(`diferencias cuenta a cuenta (${tag})`, diffs.length, 0)
  for (const d of diffs.slice(0, 20)) console.log('   · ' + d)
  // Totales por grupo (solo pendientes a saldo, como el original).
  for (const g of ['clientes', 'trabajadores', 'administrativos', 'aparte']) {
    const sum = (map, saldoFn) => [...map.values()].filter((r) => grupoDe(r) === g && (r.status ?? 'pendiente') === 'pendiente').reduce((s, r) => s + saldoFn(r), 0)
    const oSum = sum(oracle, saldoDe)
    const cSum = sum(clone, (r) => Number(r.saldoBase ?? r.saldo ?? 0))
    check(`total ${g} (${tag})`, cSum, oSum)
  }
  const calle = [...clone.values()].filter((r) => grupoDe(r) === 'clientes' && (r.status ?? 'pendiente') === 'pendiente').reduce((s, r) => s + Number(r.saldoBase ?? r.saldo ?? 0), 0)
  const calleO = [...oracle.values()].filter((r) => grupoDe(r) === 'clientes' && (r.status ?? 'pendiente') === 'pendiente').reduce((s, r) => s + saldoDe(r), 0)
  check(`dinero en la calle = solo clientes (${tag})`, calle, calleO)
}

// ---------- GASTOS: los 51, con las dos regresiones nombradas ----------
section('Gastos — los 51 de la foto, en ambas condiciones de sync')
const gOracleTotal = photo.expenses.reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0)
check('gastos en la foto (conteo)', photo.expenses.length, 51)
check('gastos en la foto (total)', gOracleTotal, 275505)
for (const withLearning of [true, false]) {
  const tag = withLearning ? 'con aprendizaje' : 'SIN aprendizaje (condición producción)'
  const state = buildState(withLearning)
  const synced = syncDerivedData({ ...state, accountSyncDates: [] })
  const exps = synced.expenses ?? state.expenses
  const total = exps.reduce((s, e) => s + Number(e.amount ?? e.total ?? 0), 0)
  check(`gastos del clon (${tag})`, exps.length, 51)
  check(`total de gastos del clon (${tag})`, total, 275505)
  const conceptos = exps.map((e) => String(e.concept ?? e.concepto ?? '').toUpperCase())
  check(`regresión SAZON 160 presente (${tag})`, conceptos.some((c) => c.includes('SAZON')) && exps.some((e) => String(e.concept ?? e.concepto ?? '').toUpperCase().includes('SAZON') && Number(e.amount ?? e.total) === 160), true)
  check(`regresión MANTENIMIENTO MALECON 1.250 presente (${tag})`, exps.some((e) => String(e.concept ?? e.concepto ?? '').toUpperCase().includes('MALECON') && Number(e.amount ?? e.total) === 1250), true)
}

// ---------- MES: contra el archivo que el propio original guardó ----------
section('Octubre 2026 — monthEconomy del clon vs monthlyArchives del original')
const arch = (photo.monthlyArchives ?? []).find((a) => a.monthKey === '2026-10')
const state = buildState(true)
const synced = syncDerivedData({ ...state, accountSyncDates: [] })
const data = { ...state, ...synced, transferMovements: parsed.transferMovements }
const eco24 = monthEconomy(data, '2026-10', '2026-10-24')
check('ventas del mes', eco24.ventasTotal ?? eco24.ventas, 2786190)
check('ganancia bruta', eco24.bruta, arch.gananciaBruta)
check('ganancia neta', eco24.neta, arch.gananciaNeta)
check('gastos del mes (economía)', eco24.gastosTotal ?? eco24.gastos, arch.gastos)
check('ingresos extras', eco24.ingresosExtras, arch.ingresosExtras)
// OJO: monthEconomy.resultado es la composición de la PANTALLA del
// original (neta − gastos, SIN extras = 420.591); el archivo del
// original guarda la composición documental (CON extras = 429.091).
// Ambas se verifican: la de pantalla aquí, la documental en la
// batería de documentos contra el boletín.
check('resultado del mes (pantalla, sin extras)', eco24.resultado, arch.gananciaNeta - arch.gastos)
check('resultado documental (con extras) = archivo', eco24.resultado + eco24.ingresosExtras, arch.resultado)
check('billar del mes (validado: 18.700)', eco24.billar.venta, 18700)
// Corte al 18: monthEconomy es de mes completo sobre los datos que
// recibe — el corte lo hace el llamador recortando días y gastos.
const data18 = {
  ...data,
  days: data.days.filter((d) => d.date <= '2026-10-18'),
  expenses: (synced.expenses ?? state.expenses).filter((e) => e.date <= '2026-10-18'),
}
const eco18 = monthEconomy(data18, '2026-10', '2026-10-18')
check('total cobrado con corte al 18-oct (validado: 76.800)', eco18.totalCobrado, 76800)
check('billar con corte al 18-oct (validado: 13.100)', eco18.billar.venta, 13100)
check('gastos con corte al 18-oct (validado: 158.315)', eco18.gastosTotal ?? eco18.gastos, 158315)

// ---------- TRANSFERENCIAS ----------
section('Transferencias — saldo derivado contra transferState')
const ts = transferSummary(parsed.transferMovements)
check('movimientos (los del historial de ESTA foto)', parsed.transferMovements.length, (photo.transferState.history ?? []).length)
check('saldo derivado', ts.balance ?? ts.saldo, photo.transferState.balance)

// ---------- NÓMINA: payrollHistory partida por partida ----------
section('Nómina — ciclos del historial, empleado a empleado')
const cloneCycles = new Map((parsed.payrollHistory ?? []).map((c) => [`${c.cycleStart}..${c.cycleEnd}`, c]))
for (const oc of photo.payrollHistory ?? []) {
  const key = `${oc.cycleStart}..${oc.cycleEnd}`
  const cc = cloneCycles.get(key)
  check(`ciclo ${key} presente en el clon`, !!cc, true)
  if (!cc) continue
  const oTotal = (oc.employees ?? []).reduce((s, e) => s + Number(e.totalCobrar ?? 0), 0)
  const cTotal = (cc.employees ?? []).reduce((s, e) => s + Number(e.totalCobrar ?? 0), 0)
  check(`ciclo ${key}: empleados`, (cc.employees ?? []).length, (oc.employees ?? []).length)
  check(`ciclo ${key}: total`, cTotal, oTotal)
  const cByName = new Map((cc.employees ?? []).map((e) => [e.nombre, Number(e.totalCobrar ?? 0)]))
  const empDiffs = (oc.employees ?? []).filter((e) => cByName.get(e.nombre) !== Number(e.totalCobrar ?? 0)).map((e) => e.nombre)
  check(`ciclo ${key}: diferencias por empleado`, empDiffs.length, 0)
  for (const n of empDiffs.slice(0, 10)) console.log('   · ' + n)
}

console.log(failed === 0
  ? '\nCUADRE TOTAL — 0 diferencias: ninguna cuenta escondida, ningún centavo movido.'
  : `\nCUADRE ROTO — ${failed} diferencia(s): el paquete NO puede declararse final.`)
process.exit(failed === 0 ? 0 : 1)
