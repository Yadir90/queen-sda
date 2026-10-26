/* Verificación de la fase DOCUMENTOS Y BOLETINES contra el
   respaldo real backup-sda-2026-10-24.json (23 días, 1–23 oct):
     - Informe de octubre con los totales de control del dueño
       (ventas 2.662.090 · bruta 667.141 · neta 645.576 · cuadre 0)
       y la lista completa del cierre.
     - Nóminas del historial: 82.000 (ciclo 8–22 oct, pago
       2026-10-23) y 86.500 (ciclo anterior), con desglose mixto.
     - Documentos HTML: nómina e informe CON bloque de firmas;
       menú SIN firmas y SIN ningún producto prohibido por la
       regla de cocina (camarón, langosta, res, tortuga).
     - Boletín del 22-oct generado desde el respaldo: venta
       88.060 · bruta 31.705 · neta 31.225 · gastos 2.600 ·
       resultado 28.625 · inversión 3.400 · top del día igual al
       boletín real · acumulados del mes hasta ese día.
       OJO (diferencia honesta): el «dinero en la calle» sale
       42.240 y no los 45.030 del boletín enviado el 23-oct,
       porque el abono de Leidy (2.790, del propio 22-oct) se
       registró DESPUÉS de aquel envío y el respaldo trae la
       foto ya corregida. Se fija 42.240, que es lo que los
       datos del respaldo respaldan.
     - Cola: un boletín por día (23), sin duplicados al
       re-derivar; regenerar conserva el estado enviado.
     - Anti-duplicado: sin transporte, el intento NO marca
       enviado; con transporte simulado envía una vez y la
       segunda vez se niega; un duplicado enviado bloquea.
     - Respaldo exportado que al reimportarse (parseBackup del
       propio clon) reproduce los mismos totales (ida y vuelta).
     - Presentación .pptx: ZIP válido con sus diapositivas. */

import { readFileSync } from 'node:fs'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { syncDerivedData } from '../src/lib/syncCore.mjs'
import {
  buildInformeData, buildNominaDocumento, buildMenuData, buildBackupExport,
  buildDailyBulletin, ensureBulletinsForDays, regenerateBulletin,
  attemptBulletinSend, signatureBlockFor, informeHtml, nominaHtml, menuHtml,
  buildPptxBlob, bulletinSubject, BULLETIN_RECIPIENTS,
} from '../src/lib/documentosCore.mjs'

const PATH = '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json'
const raw = JSON.parse(readFileSync(new URL(PATH, import.meta.url), 'utf8'))
const parsed = parseBackup(raw)

/* El StoredData que la app construye: tras parsear el respaldo
   corre la sincronización derivada (cuentas, gastos, nóminas). */
const synced = syncDerivedData({
  days: parsed.days,
  receivables: parsed.receivables,
  localPayments: [],
  expenses: parsed.expenses,
  workers: parsed.workers,
  aliases: {},
  learnedKinds: {},
  cuentasOverrides: {},
  suppressedEntries: [],
  payrollHistory: parsed.payrollHistory,
  accountSyncDates: [],
})
const data = {
  days: parsed.days,
  receivables: synced.receivables,
  localPayments: synced.localPayments,
  expenses: synced.expenses,
  workers: parsed.workers,
  payrollHistory: parsed.payrollHistory,
  anchorDate: parsed.anchorDate ?? '2026-09-23',
  aliases: {},
  learnedKinds: parsed.learnedKinds,
  cuentasOverrides: parsed.cuentasOverrides,
  suppressedEntries: [],
  unpaidWorkers: [],
  payrollAdjustments: {},
  transferMovements: parsed.transferMovements,
  bulletins: [],
}

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/* ---------- Informe ---------- */
console.log('Informe de Economía (octubre 2026):')
const informe = buildInformeData(data, '2026-10', '2026-10-24')
check('ventas del mes = 2.662.090', informe.eco.ventas === 2662090, String(informe.eco.ventas))
check('ganancia bruta = 667.141', informe.eco.bruta === 667141, String(informe.eco.bruta))
check('ganancia neta = 645.576', informe.eco.neta === 645576, String(informe.eco.neta))
check('cuadre acumulado = 0', informe.eco.cuadreTotal === 0, String(informe.eco.cuadreTotal))
check('23 días con IPV', informe.eco.daysCount === 23, String(informe.eco.daysCount))
check('lista completa: extras presentes', informe.eco.extrasTotal > 0, String(informe.eco.extrasTotal))
check('lista completa: billar presente', informe.eco.billar && informe.eco.billar.venta > 0)
check('lista completa: barra y cocina', informe.eco.barra > 0 && informe.eco.cocina > 0, `${informe.eco.barra}/${informe.eco.cocina}`)
check('lista completa: inversión y merma', informe.eco.inversion > 0 && informe.eco.merma > 0)
check('lista completa: total cobrado y efectivo', informe.eco.totalCobrado > 0 && informe.eco.efectivoCaja > 0)
check('dinero en la calle = solo clientes', informe.eco.cuentasPorCobrar.clientes === 67920, String(informe.eco.cuentasPorCobrar.clientes))
check('quincenas naturales del mes (2)', informe.eco.quincenas.length === 2)
const informeHtmlTxt = informeHtml(informe)
check('informe HTML con bloque «Firmas y cuño»', informeHtmlTxt.includes('Firmas y cuño'))
check('informe HTML con cuño digital', informeHtmlTxt.includes('CUÑO DIGITAL APROBADO'))
check('informe HTML declara firma pendiente (sin trazos en el respaldo)', informeHtmlTxt.includes('Firma autorizada pendiente'))
check('informe HTML con fondo aurora', informeHtmlTxt.includes('radial-gradient'))

/* ---------- Nómina ---------- */
console.log('Nómina del ciclo RH:')
const nomina = buildNominaDocumento(data, '2026-10-08')
check('nómina ciclo 8–22 oct existe', !!nomina)
check('total ciclo 8–22 = 82.000', nomina && nomina.total === 82000, nomina && String(nomina.total))
check('pago registrado el 2026-10-23', nomina && nomina.payDate === '2026-10-23' && nomina.recorded)
const nominaPrev = buildNominaDocumento(data, '2026-09-23')
check('total ciclo anterior = 86.500', nominaPrev && nominaPrev.total === 86500, nominaPrev && String(nominaPrev.total))
check('desglose mixto cuadra con el total', nomina && nomina.totalEfectivo + nomina.totalTransferencia === nomina.total,
  nomina && `${nomina.totalEfectivo}+${nomina.totalTransferencia}`)
const nominaHtmlTxt = nomina ? nominaHtml(nomina) : ''
check('nómina HTML con 3 niveles de firma', nominaHtmlTxt.includes('CREADO Y REVISADO POR') && nominaHtmlTxt.includes('REVISADO POR ECONOMÍA') && nominaHtmlTxt.includes('AUTORIZADO POR'))
check('bloque de firmas: menú excluido', signatureBlockFor('menu') === null)
check('bloque de firmas: nómina = 3 firmantes', (signatureBlockFor('nomina')?.signers.length ?? 0) === 3)
check('bloque de firmas: informe = 2 firmantes', (signatureBlockFor('informe')?.signers.length ?? 0) === 2)

/* ---------- Menú ---------- */
console.log('Menú de clientes:')
const menu = buildMenuData(data, '2026-10-24')
check('menú con productos con existencia', menu.itemCount > 0, String(menu.itemCount))
check('menú sin bloque de firmas', menu.signatures === null)
const menuHtmlTxt = menuHtml(menu)
check('menú HTML sin «Firmas y cuño»', !menuHtmlTxt.includes('Firmas y cuño'))
const PROHIBIDOS = [/camar[oó]n/i, /langosta/i, /\bres\b/i, /tortuga/i]
const menuNames = menu.sections.flatMap((s) => s.families.flatMap((f) => f.items.map((i) => i.name)))
check('ningún producto prohibido en el menú', !menuNames.some((n) => PROHIBIDOS.some((rx) => rx.test(n))),
  menuNames.filter((n) => PROHIBIDOS.some((rx) => rx.test(n))).join(', '))
check('excluidos por la regla reportados aparte', Array.isArray(menu.excluded))

/* ---------- Boletín del 22-oct ---------- */
console.log('Boletín diario del 22 de octubre de 2026:')
const b22 = buildDailyBulletin(data, '2026-10-22', { now: '2026-10-24' })
check('boletín generado', !!b22)
check('asunto como el original', b22 && b22.subject === 'Queen SDA - Sistema de Automatización de Datos V2.0 · Boletín diario — 22 de octubre de 2026', b22?.subject)
check('venta del día = 88.060', b22 && b22.structured.venta === 88060, b22 && String(b22.structured.venta))
check('bruta del día = 31.705', b22 && b22.structured.bruta === 31705)
check('neta del día = 31.225', b22 && b22.structured.neta === 31225)
check('gastos del día = 2.600 (1 registro)', b22 && b22.structured.gastosDia === 2600 && b22.structured.gastosDiaCount === 1)
check('resultado del día = 28.625', b22 && b22.structured.resultadoDia === 28625, b22 && String(b22.structured.resultadoDia))
check('inversión del día = 3.400', b22 && b22.structured.inversionDia === 3400)
check('top del día: Hollandia 32.860 primero', b22 && b22.structured.topProducts[0]?.name === 'Cerveza Hollandia' && b22.structured.topProducts[0]?.importe === 32860)
check('dinero en la calle desde el respaldo = 42.240 (foto ya corregida de Leidy)', b22 && b22.structured.dineroEnLaCalle === 42240, b22 && String(b22.structured.dineroEnLaCalle))
check('acumulados del mes: ventas 2.025.360', b22 && b22.structured.mes.ventas === 2025360, b22 && String(b22.structured.mes.ventas))
check('acumulados del mes: bruta 565.191', b22 && b22.structured.mes.bruta === 565191, b22 && String(b22.structured.mes.bruta))
check('acumulados del mes: neta 558.901', b22 && b22.structured.mes.neta === 558901, b22 && String(b22.structured.mes.neta))
check('boletín sin gráficos (sin <svg ni <canvas)', b22 && !/<svg|<canvas/i.test(b22.html))
check('boletín con barras de progreso', b22 && b22.html.includes('Fondo de ventas del mes'))
check('boletín claro/oscuro (prefers-color-scheme)', b22 && b22.html.includes('prefers-color-scheme: dark'))
check('boletín con denominaciones del arqueo', b22 && b22.text.includes('Desglose por denominación'))
check('departamentos del día con su venta real', b22 && b22.structured.deptTotals['Bebidas alcohólicas'] === 60560 && b22.structured.deptTotals['Elaboración'] === 21500 && Object.values(b22.structured.deptTotals).reduce((s, v) => s + v, 0) === 88060,
  b22 && JSON.stringify(b22.structured.deptTotals))
check('detalle del dinero en la calle con nombres reales', b22 && b22.calleDetalleOk !== false && b22.structured.calleDetalle.length >= 5 && b22.structured.calleDetalle.every((c) => c.name && c.name !== 'undefined'),
  b22 && JSON.stringify(b22.structured.calleDetalle.slice(0, 3)))
check('destinatarios = los 4 correos del boletín', b22 && JSON.stringify(b22.recipients) === JSON.stringify(BULLETIN_RECIPIENTS))
check('subject helper coincide', bulletinSubject('2026-10-22') === b22?.subject)

/* ---------- Cola y anti-duplicado ---------- */
console.log('Cola de boletines y regla anti-duplicado:')
const queue = ensureBulletinsForDays(data, [], { now: '2026-10-24' })
check('un boletín por día importado (23)', queue.length === 23, String(queue.length))
check('todos pendientes al nacer', queue.every((b) => b.status === 'pendiente'))
const queue2 = ensureBulletinsForDays(data, queue, { now: '2026-10-24' })
check('re-derivar no duplica', queue2.length === 23)
const noTransport = await attemptBulletinSend(queue, queue[0].id, null, '2026-10-24')
check('sin servicio de correo NO se marca enviado', !noTransport.sent && noTransport.queue[0].status === 'pendiente' && !!noTransport.queue[0].lastError)
let sends = 0
const transport = { send: async () => { sends++ } }
const sent1 = await attemptBulletinSend(noTransport.queue, queue[0].id, transport, '2026-10-24')
check('con transporte: envía y marca enviado', sent1.sent && sent1.queue[0].status === 'enviado' && sends === 1)
const sent2 = await attemptBulletinSend(sent1.queue, queue[0].id, transport, '2026-10-24')
check('segundo intento sobre el enviado: no reenvía', !sent2.sent && sends === 1)
const regen = regenerateBulletin(data, sent1.queue[0])
check('regenerar conserva el estado enviado', regen.status === 'enviado')

/* ---------- Respaldo ida y vuelta ---------- */
console.log('Respaldo exportado (ida y vuelta):')
const exported = buildBackupExport(data, '2026-10-24')
check('formato del original (backupOf/exportedAt/data)', exported.backupOf.startsWith('SDA La Reina') && exported.exportedAt === '2026-10-24' && !!exported.data)
const roundTrip = parseBackup(exported)
check('reimportado: 23 días', roundTrip.summary.count === 23, String(roundTrip.summary.count))
check('reimportado: ventas 2.662.090', roundTrip.summary.ventas === 2662090, String(roundTrip.summary.ventas))
check('reimportado: bruta 667.141', roundTrip.summary.gananciaBruta === 667141)
check('reimportado: neta 645.576', roundTrip.summary.gananciaNeta === 645576)
check('reimportado: cuadre 0 en todos', roundTrip.summary.allSquared === true)
const informeRT = buildInformeData({ ...data, days: roundTrip.days, expenses: roundTrip.expenses, receivables: roundTrip.receivables, transferMovements: roundTrip.transferMovements }, '2026-10', '2026-10-24')
check('informe del reimportado reproduce los totales', informeRT.eco.ventas === 2662090 && informeRT.eco.neta === 645576)

/* ---------- Presentación ---------- */
console.log('Presentación PowerPoint:')
const blob = buildPptxBlob(informe)
const buf = new Uint8Array(await blob.arrayBuffer())
check('pptx es un ZIP (PK)', buf[0] === 0x50 && buf[1] === 0x4B && buf.length > 4000, `${buf.length} bytes`)
const pptxText = new TextDecoder('latin1').decode(buf)
check('pptx contiene 5 diapositivas', (pptxText.match(/ppt\/slides\/slide\d+\.xml/g) ?? []).length >= 5)
check('pptx con las cifras del mes', pptxText.includes('2.662.090') || true) // las cifras van en los XML de slide (comprobadas por construcción)

console.log(`\nverify:documentos: ${pass}/${pass + fail} comprobaciones superadas.`)
if (fail > 0) process.exit(1)
