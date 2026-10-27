// Queen SDA — VÍA REAL DE LA APP (defecto del 26-oct: el Informe de
// Economía y la presentación generados por la app VIVA en modo
// Supabase salieron con «Gastos del mes: 0 CUP» y resultado 704.596,
// contra la conclusión DOC-9 de la auditoría, que montaba la foto
// directamente). Esta batería monta el estado EXACTAMENTE como lo
// arma sbFetchStoredData desde las tablas (payload → normalizador,
// sin sync: la lectura de la app no sincroniza) en dos formas:
//
//   A. SEMILLA VIEJA (solo days/receivables/transfer_movements, el
//      generador original): control NEGATIVO — tiene que reproducir
//      el fallo vivo cifra a cifra (gastos 0, resultado 704.596).
//      Si no lo reproduce, la batería no está montando la vía real.
//   B. SEMILLA COMPLETA (el generador corregido: + expenses, workers,
//      payroll_history y app_settings «core»): el Informe, el informe
//      por período (quincenas), la factura de gastos y el boletín
//      tienen que enseñar las cifras verificadas.
//
// Uso: node scripts/verify-via-real.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  normalizeDay, normalizeExpense, normalizePayroll, normalizeReceivable, normalizeWorkerRecord, parseBackup,
} from '../src/lib/backupCore.mjs'
import {
  buildWorkersRegistry, canonicalPersonKey, clientKeyOf, deriveSuppressedEntries, firstNameKeyOf,
} from '../src/lib/syncCore.mjs'
import {
  buildBackupExport, buildDailyBulletin, buildEntradasInvoiceData, buildExtrasInvoiceData,
  buildGastosInvoiceData, buildInformeData, buildMenuData, buildNominaDocumento,
  buildPeriodInformeData, buildPptxBlob,
} from '../src/lib/documentosCore.mjs'
import { inflateRawSync } from 'node:zlib'

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

// Arma el StoredData como rawFetchStoredData: filas → payload →
// normalizador; trabajadores por buildWorkersRegistry; ajustes desde
// la fila «core». SIN syncDerivedData (la lectura no sincroniza).
function assemble(fullSeed) {
  const days = photo.days.map((d) => normalizeDay(d))
  const receivables = photo.receivables.map((r) => normalizeReceivable(r))
  const expenses = fullSeed ? photo.expenses.map((e) => normalizeExpense(e)) : []
  const rawWorkers = fullSeed ? photo.workers.map((w) => normalizeWorkerRecord(w)) : []
  const payrollHistory = fullSeed ? photo.payrollHistory.map((p) => normalizePayroll(p)) : []
  const anchorDate = parsed.anchorDate ?? '2026-09-23'
  const workers = buildWorkersRegistry(rawWorkers, days, payrollHistory, anchorDate)
  const learnedKinds = fullSeed ? parsed.learnedKinds : {}
  const cuentasOverrides = fullSeed ? parsed.cuentasOverrides : {}
  const suppressedEntries = fullSeed
    ? deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, { learnedKinds, overrides: cuentasOverrides, knownPersons: knownPersonsOf() })
    : []
  return {
    days, receivables, localPayments: [], expenses, workers, payrollHistory,
    transferMovements: parsed.transferMovements, extraIncomes: [],
    anchorDate, aliases: {}, learnedKinds, cuentasOverrides, suppressedEntries,
    unpaidWorkers: [], payrollAdjustments: {}, monthlyArchives: [], bulletins: [],
  }
}

section('A · Semilla vieja (3 tablas) — control negativo: reproduce el fallo vivo')
const dataA = assemble(false)
const infA = buildInformeData(dataA, '2026-10', '2026-10-26')
check('gastos del Informe (fue 0 en producción)', infA.eco.gastos, 0)
check('resultado del Informe (fue 704.596 en producción)', infA.eco.resultado, 704596)
check('ventas del Informe (esto sí llegaba bien)', infA.eco.ventas, 2786190)

section('B · Semilla completa (generador corregido) — el Informe por la vía real')
const dataB = assemble(true)
const infB = buildInformeData(dataB, '2026-10', '2026-10-26')
check('gastos del mes', infB.eco.gastos, 275505)
check('resultado documental (neta − gastos + extras)', infB.eco.resultado, 429091)
check('ganancia neta', infB.eco.neta, 696096)
check('ingresos extras', infB.eco.ingresosExtras, 8500)
check('billar del mes', infB.eco.billar.venta, 18700)
check('ventas del mes', infB.eco.ventas, 2786190)

section('B · Quincenas del informe por período — suman su titular')
const per = buildPeriodInformeData(dataB, '2026-10-01', '2026-10-31', 'octubre de 2026', '2026-10-26')
const qs = per.eco.quincenas ?? []
check('quincenas presentes', qs.length, 2)
check('Σ ventas de quincenas', qs.reduce((s, q) => s + q.ventas, 0), 2786190)
check('Σ neta de quincenas', qs.reduce((s, q) => s + q.neta, 0), 696096)
check('Σ gastos de quincenas (fue 0 en el PPTX vivo)', qs.reduce((s, q) => s + q.gastos, 0), 275505)
check('resultado del período (documental)', per.eco.resultado, 429091)

section('B · Factura de gastos y boletín por la vía real')
const fac = buildGastosInvoiceData(dataB, '2026-10')
check('filas de la factura de gastos', fac.rows.length, 51)
check('total de la factura de gastos', fac.total, 275505)
const bol = buildDailyBulletin(dataB, '2026-10-24')
check('boletín 24-oct: gastos del mes', bol.structured.mes.gastos, 275505)
check('boletín 24-oct: resultado del mes (documental)', bol.structured.mes.resultado, 429091)
check('boletín 24-oct: billar del mes', bol.structured.mes.billar, 18700)

section('C · Resto de documentos por la vía real (generalización del dueño, 19:33)')
const nom = buildNominaDocumento(dataB, '2026-10-08')
check('nómina ciclo 8-oct: total', nom?.total, 95000)
check('nómina ciclo 8-oct: empleados', nom?.employees.length, photo.payrollHistory.find((x) => x.cycleStart === '2026-10-08').employees.length)
const nom2 = buildNominaDocumento(dataB, '2026-09-23')
check('nómina ciclo 23-sep: total', nom2?.total, 86500)
check('nómina: efectivo + transferencia = total', (nom?.totalEfectivo ?? 0) + (nom?.totalTransferencia ?? 0), nom?.total)
const facE = buildEntradasInvoiceData(dataB, '2026-10')
check('factura de entradas: inversión del mes', facE.total, 1841620)
const facX = buildExtrasInvoiceData(dataB, '2026-10')
check('factura de otros ingresos: filas', facX.rows.length, 2)
check('factura de otros ingresos: total', facX.total, 8500)
const menu = buildMenuData(dataB, '2026-10-26')
check('menú: trae productos', (menu?.itemCount ?? 0) > 0, true)
const menuNames = (menu?.sections ?? []).flatMap((s) => s.families ?? []).flatMap((f) => f.items ?? []).map((i) => i.name ?? '')
check('menú: regla de cocina (sin camarón/langosta/res/tortuga)', menuNames.some((n) => /camar[oó]n|langosta|tortuga|^res\b|\bres\b/i.test(n)), false)
const pptx = buildPptxBlob(per)
const pptxBuf = Buffer.from(await pptx.arrayBuffer())
let pptxText = ''
for (let i = 0; i + 30 < pptxBuf.length; i++) {
  if (pptxBuf.readUInt32LE(i) !== 0x04034b50) continue
  const method = pptxBuf.readUInt16LE(i + 8); const csize = pptxBuf.readUInt32LE(i + 18)
  const nlen = pptxBuf.readUInt16LE(i + 26); const elen = pptxBuf.readUInt16LE(i + 28)
  const start = i + 30 + nlen + elen
  const chunk = pptxBuf.subarray(start, start + csize)
  try { pptxText += method === 8 ? inflateRawSync(chunk).toString('utf8') : chunk.toString('utf8') } catch { /* entrada no texto */ }
  i = start + csize - 1
}
check('presentación: el XML de diapositivas trae los gastos reales', pptxText.includes('275.505'), true)
check('presentación: el XML trae el resultado documental', pptxText.includes('429.091'), true)
const reexport = buildBackupExport(dataB, '2026-10-26T23:45:00')
const reparsed = parseBackup(reexport)
check('respaldo ida-y-vuelta: cuentas conservadas', reparsed.receivables.length, 119)
check('respaldo ida-y-vuelta: gastos conservados', reparsed.expenses.reduce((s, e) => s + (e.total || 0), 0), 275505)
check('respaldo ida-y-vuelta: días conservados', reparsed.days.length, 24)
check('respaldo ida-y-vuelta: nómina conservada', reparsed.payrollHistory.reduce((s, r) => s + (r.total || 0), 0), 181500)

console.log(failed === 0
  ? '\nVÍA REAL VERIFICADA — la semilla completa alimenta la app: el Informe enseña los gastos reales.'
  : `\nVÍA REAL ROTA — ${failed} diferencia(s): el paquete NO puede declararse final.`)
process.exit(failed === 0 ? 0 : 1)
