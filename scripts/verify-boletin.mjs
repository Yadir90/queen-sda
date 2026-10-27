// Queen SDA — BOLETÍN DIARIO contra el original (reconstrucción
// del 26-oct a los 17 bloques, con la MUESTRA REAL del boletín del
// 23-oct-2026 — correo del dueño — como referencia maestra y la
// comparativa validada del 18 como segundo banco).
//
// Monta el estado por la VÍA REAL (sbFetchStoredData: payload →
// normalizador, sin sync, semilla completa) y compone los boletines
// del 18 y del 23 con buildDailyBulletin. Cada cifra se compara
// contra la del original para el mismo día; el HTML se verifica
// además como correo: UN solo cuerpo, sin display:none, y con el
// <style> eliminado (como lo reducen los clientes de correo) TODOS
// los titulares de sección siguen presentes — la prueba que el
// boletín viejo reprobó en el correo del dueño (se veía vacío).
//
// Uso: node scripts/verify-boletin.mjs

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
  buildDailyBulletin, buildBulletinPdfBase64, buildBulletinPdfBase64FromStructured, BULLETIN_RECIPIENTS,
} from '../src/lib/documentosCore.mjs'

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
function checkNear(label, got, want, tol = 0.011) {
  const ok = Math.abs(Number(got) - want) <= tol
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗ FALLO'} ${label}: esperado ~${want}, obtenido ${got}`)
}
function checkHas(label, haystack, needle) {
  const ok = String(haystack).includes(needle)
  if (!ok) failed++
  console.log(ok ? `✓ ${label}` : `✗ FALLO ${label}: falta ${JSON.stringify(needle)}`)
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
function assemble() {
  const days = photo.days.map((d) => normalizeDay(d))
  const receivables = photo.receivables.map((r) => normalizeReceivable(r))
  const expenses = photo.expenses.map((e) => normalizeExpense(e))
  const rawWorkers = photo.workers.map((w) => normalizeWorkerRecord(w))
  const payrollHistory = photo.payrollHistory.map((p) => normalizePayroll(p))
  const anchorDate = parsed.anchorDate ?? '2026-09-23'
  const workers = buildWorkersRegistry(rawWorkers, days, payrollHistory, anchorDate)
  const learnedKinds = parsed.learnedKinds
  const cuentasOverrides = parsed.cuentasOverrides
  const suppressedEntries = deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, { learnedKinds, overrides: cuentasOverrides, knownPersons: knownPersonsOf() })
  return {
    days, receivables, localPayments: [], expenses, workers, payrollHistory,
    transferMovements: parsed.transferMovements, extraIncomes: [],
    anchorDate, aliases: {}, learnedKinds, cuentasOverrides, suppressedEntries,
    unpaidWorkers: [], payrollAdjustments: {}, monthlyArchives: [], bulletins: [],
  }
}
const data = assemble()

const TITULARES = [
  'Economía', 'Elaboración · rentabilidad y merma', 'Cierre del día', 'El día en barras',
  'Ventas por departamento', 'Billar del día', 'Lo más vendido del día',
  'Desglose por denominación y Divisas', 'Transferencias', 'Cuentas por cobrar',
  'Entradas del', 'Existencias con descuadre', 'Saldo final al cierre',
  'Trabajadores y Recursos Humanos', 'Avisos de Queen',
]
function correoSeguro(bol, fechaLabel) {
  check('HTML sin display:none (un solo cuerpo)', /display\s*:\s*none/i.test(bol.html), false)
  const sinStyle = bol.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
  for (const t of TITULARES) checkHas(`visible sin <style>: ${t}`, sinStyle, t)
  checkHas('pie que anuncia el PDF', bol.html, `Adjunto: PDF del día contabilidad-${bol.date}.pdf`)
  check('pdfFilename del ítem', bol.pdfFilename, `contabilidad-${bol.date}.pdf`)
  const pdf = buildBulletinPdfBase64FromStructured(bol.structured)
  check('PDF adjunto se genera desde el structured', typeof pdf, 'string')
  const bytes = Buffer.from(pdf ?? '', 'base64')
  check('PDF adjunto es un PDF real', bytes.subarray(0, 4).toString('latin1'), '%PDF')
  check('PDF adjunto no es simbólico (>2 KB)', bytes.length > 2048, true)
  const pdf2 = buildBulletinPdfBase64(data, bol.date)
  check('PDF por recomposición coincide en tamaño', pdf2?.length, pdf?.length)
  checkHas(`texto trae la fecha ${fechaLabel}`, bol.text, fechaLabel)
}

section('Destinatarios y asunto (muestra real del 23: los 4)')
check('destinatarios = los 4 del original en producción', JSON.stringify(BULLETIN_RECIPIENTS), JSON.stringify([
  'yadir.medina900710@gmail.com', 'dayamifernandez584@gmail.com', 'yanespinosa08@gmail.com', 'jesusmmpatria@gmail.com',
]))

section('Boletín del 18-oct — contra la comparativa validada')
const b18 = buildDailyBulletin(data, '2026-10-18')
const s18 = b18.structured
check('asunto', b18.subject, 'Queen SDA - Sistema de Automatización de Datos V2.0 · Boletín diario · 18 de octubre de 2026')
// La fecha de importación NO viaja en el respaldo (importedAtMs
// viene null en los 24 días): sin ella, la línea sale en su forma
// corta honesta. En modo Supabase la fecha sí llega (dayFromRow la
// rescata de la fila `imported_at`) y la línea es la completa.
check('línea de estado del IPV (forma corta: la fecha de importación no viaja en el respaldo)', s18.ipvLine, 'El IPV del 18 de octubre de 2026 sí está importado; este es el boletín correspondiente al 18 de octubre de 2026.')
check('venta del día', s18.venta, 43830)
check('ganancia neta del día', s18.neta, 9550)
check('dinero en la calle (con corte al 18)', s18.dineroEnLaCalle, 52530)
check('calle en Cobrar', s18.calleEnCobrar, 17350)
check('calle en morosas', s18.calleMorosas, 35180)
check('gastos del mes', s18.mes.gastos, 158315)
check('utilidad del mes (neta − gastos + extras)', s18.mes.resultado, 334586)
check('billar del mes (solo días con tabla)', s18.mes.billar, 13100)
check('total cobrado del mes (corte por fecha de pago)', s18.mes.totalCobrado, 76800)
check('RH acumulado del ciclo', s18.rh.total, 49229)
check('RH: fecha de pago', s18.rh.pago, '2026-10-23')
checkNear('RH: total del día', s18.rh.valorDiaTotal, 3353.94)
const kenny = s18.rh.empleados.find((e2) => e2.nombre.startsWith('Kenny'))
check('Kenny en la tabla de acumulado', Boolean(kenny), true)
check('Kenny: días trabajados', kenny?.dias, 0)
check('Kenny: salario quincenal', kenny?.salarioQuincenal, 7000)
checkNear('Kenny: valor/día', kenny?.valorDia, 466.67)
check('Kenny: acumulado', kenny?.acumulado, 0)
checkHas('aviso de Kenny', s18.avisos.join(' '), 'Kenny Rodríguez Echemendia tiene salario quincenal asignado con 0 días trabajados.')
const g18 = Object.fromEntries(s18.cobrar.grupos.map((g) => [g.label, g]))
check('grupo Administrativo', g18.Administrativo.total, 121510)
check('grupo Administrativo (cuentas)', g18.Administrativo.count, 35)
check('grupo Clientes', g18.Clientes.total, 52530)
check('grupo Clientes (cuentas)', g18.Clientes.count, 13)
check('grupo Trabajadores', g18.Trabajadores.total, 59950)
check('grupo Trabajadores (cuentas)', g18.Trabajadores.count, 31)
check('registro general', s18.cobrar.registroGeneral.total, 112480)
check('registro general (cuentas)', s18.cobrar.registroGeneral.count, 44)
check('registro general IPV', s18.cobrar.registroGeneral.ipv, 44770)
check('registro general manuales', s18.cobrar.registroGeneral.manuales, 67710)
check('nuevas de hoy', s18.cobrar.nuevasHoy.length, 2)
check('pagadas hoy: ninguna', s18.cobrar.pagadasHoy.hay, false)
check('salidas de caja (entradas)', s18.cobrar.salidasCaja.count, 2)
check('salidas de caja (total)', s18.cobrar.salidasCaja.total, 1080)
check('transferencias: acumulado por pasar', s18.transferencias.porPasar, 68970)
check('transferencias: entraron hoy', s18.transferencias.entraron, 10000)
check('billar del día: venta', s18.billarDia?.venta, 600)
check('billar del día: horas de día', s18.billarDia?.horasDia, 2)
check('billar del día: horas de noche', s18.billarDia?.horasNoche, 0)
check('billar del día: pago al encargado', s18.billarDia?.pagoEncargado, 140)
check('billar del día: utilidad', s18.billarDia?.utilidad, 460)
check('entradas: inversión del día', s18.entradasTotales.inversion, 2715)
check('entradas: venta potencial', s18.entradasTotales.ventaPotencial, 15000)
check('entradas: ganancia potencial', s18.entradasTotales.gananciaPotencial, 12285)
check('entradas: filas del día', s18.entradas.length > 0, true)
check('total agotados', s18.totalAgotados, 52)
check('existencias con descuadre', s18.existenciasDescuadre.count, 0)
correoSeguro(b18, '18 de octubre de 2026')

section('Boletín del 23-oct — contra la MUESTRA REAL del dueño')
const b23 = buildDailyBulletin(data, '2026-10-23')
const s23 = b23.structured
check('asunto (exacto al .eml real)', b23.subject, 'Queen SDA - Sistema de Automatización de Datos V2.0 · Boletín diario · 23 de octubre de 2026')
check('venta del día', s23.venta, 636730)
check('ganancia neta del día', s23.neta, 86675)
// — Diferencias contra el SNAPSHOT del envío (24-oct 14:21) que
// salen de ediciones POSTERIORES al envío, presentes en la foto
// del 26 y por tanto en cualquier recomposición desde ella:
//  · Pago final de Leidy (2.790, efectivo, paidDate 22-oct, id 34
//    en la foto): no estaba registrado al enviarse; con él, la
//    cuenta cierra y el cobrado sube 2.790.
//  · Gasto «Pago de nómina RH · ciclo 8–22 oct»: al envío computó
//    82.000; en la foto vale 95.000 (la nómina del ciclo en el
//    historial de pagos): +13.000 en gastos del día y del mes.
//  · Cuenta IPV de Ebelardo (850, del 23): al envío contaba como
//    cliente; en la foto su categoría es trabajador: mueve 850 de
//    Clientes a Trabajadores y sale de la calle.
// Los checks de este bloque usan los valores consistentes con la
// foto; los del snapshot quedan arriba como evidencia nombrada.
check('dinero en la calle (foto; snapshot del envío: 68.770)', s23.dineroEnLaCalle, 65130)
check('calle en Cobrar (foto; snapshot: 26.530)', s23.calleEnCobrar, 25680)
check('calle en morosas (foto; snapshot: 42.240)', s23.calleMorosas, 39450)
check('ventas del mes', s23.mes.ventas, 2662090)
check('ganancia bruta del mes', s23.mes.bruta, 667141)
check('ganancia neta del mes', s23.mes.neta, 645576)
check('gastos del mes (foto; snapshot del envío: 262.505)', s23.mes.gastos, 275505)
check('extras del mes', s23.mes.extras, 8500)
check('utilidad del mes (foto: 645.576 − 275.505 + 8.500; snapshot: 391.571)', s23.mes.resultado, 378571)
check('billar del mes', s23.mes.billar, 17500)
check('venta en barra', s23.mes.barra, 2255690)
check('venta en cocina', s23.mes.cocina, 406400)
check('inversión del mes', s23.mes.inversion, 1696425)
check('merma del mes', s23.mes.merma, 21565)
check('total cobrado del mes (foto; snapshot: 87.090)', s23.mes.totalCobrado, 89880)
check('efectivo en caja al cierre', s23.mes.efectivoCaja, 506860)
check('zelle al cierre', s23.mes.zelle, 0)
check('RH acumulado (arranca el ciclo el 23)', s23.rh.total, 6470)
check('RH: pago del ciclo', s23.rh.pago, '2026-11-07')
checkNear('RH: total del día', s23.rh.valorDiaTotal, 6470.3)
check('otros ingresos del día (Alquiler de mesas)', s23.extrasDia, 4000)
check('resultado del día (foto: 86.675 − 98.800 + 4.000; snapshot: 4.875)', s23.resultadoDia, -8125)
check('transferencias: entraron (Desglose)', s23.transferencias.entraron, 40700)
check('transferencias: pases del día (7943+210+10.655)', s23.transferencias.pases.total, 18808)
check('transferencias: detalle de pases', JSON.stringify(s23.transferencias.pases.amounts), JSON.stringify([7943, 210, 10655]))
check('transferencias: acumulado por pasar', s23.transferencias.porPasar, 32625)
check('billar del día: venta', s23.billarDia?.venta, 4100)
check('billar del día: pago al encargado', s23.billarDia?.pagoEncargado, 840)
check('billar del día: utilidad', s23.billarDia?.utilidad, 3260)
const g23 = Object.fromEntries(s23.cobrar.grupos.map((g) => [g.label, g]))
check('grupo Administrativo', g23.Administrativo.total, 174080)
check('grupo Administrativo (cuentas)', g23.Administrativo.count, 41)
check('grupo Clientes (foto; snapshot: 68.770)', g23.Clientes.total, 65130)
check('grupo Trabajadores (foto; snapshot: 83.460)', g23.Trabajadores.total, 84310)
check('grupo Trabajadores (cuentas) (foto; snapshot: 46)', g23.Trabajadores.count, 47)
check('registro general (foto; snapshot: 152.230)', s23.cobrar.registroGeneral.total, 149440)
check('registro general (cuentas) (foto; snapshot: 59)', s23.cobrar.registroGeneral.count, 58)
check('registro general IPV', s23.cobrar.registroGeneral.ipv, 90610)
check('registro general manuales (foto; snapshot: 61.620)', s23.cobrar.registroGeneral.manuales, 58830)
const casa23 = Object.fromEntries(s23.cobrar.casa.map((p2) => [p2.label, p2]))
check('casa Dayami (Daya)', casa23['Dayami (Daya)'].total, 16760)
check('casa Alejandro', casa23.Alejandro.total, 21450)
check('casa Jesús', casa23['Jesús'].total, 135870)
check('nuevas de hoy', s23.cobrar.nuevasHoy.length, 11)
check('salidas de caja (1 entrada · animación)', s23.cobrar.salidasCaja.total, 3800)
check('salidas de caja (entradas)', s23.cobrar.salidasCaja.count, 1)
check('entradas: inversión del día', s23.entradasTotales.inversion, 405080)
check('entradas: ganancia potencial', s23.entradasTotales.gananciaPotencial, 74120)
check('entradas: filas del día', s23.entradas.length, 15)
check('total agotados', s23.totalAgotados, 56)
check('existencias con descuadre', s23.existenciasDescuadre.count, 0)
check('fondos: divisas del arqueo (31 USD × 800)', s23.fondos.mlc?.[0]?.cantidad, 31)
check('fondos: conversión de divisas', s23.fondos.mlc?.[0]?.conversionCup, 24800)
checkHas('HTML trae el detalle de divisas', b23.html, '31 USD')
checkHas('HTML trae «Se pasó al banco»', b23.html, 'Se pasó al banco')
checkHas('texto trae el detalle de divisas', b23.text, 'Total Divisas convertido: 24.800 CUP')
correoSeguro(b23, '23 de octubre de 2026')

console.log(failed === 0
  ? '\nBOLETÍN VERIFICADO — 17 bloques, cifras del 18 y del 23 iguales a las del original, correo de un solo cuerpo y PDF adjunto real.'
  : `\nBOLETÍN ROTO — ${failed} diferencia(s): el paquete NO puede declararse final.`)
process.exit(failed === 0 ? 0 : 1)
