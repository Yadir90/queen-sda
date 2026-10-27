/* ============================================================
   Queen SDA — Documentos y boletines (puerto del original).

   Puerto de:
     - client/src/docStyle.ts  (DOC_STYLE y DOC_AURORA: paleta,
       franja y fondo aurora de documentos, PDF, PPTX y correos).
     - client/src/export.ts    (nómina, informe, menú, PPTX y el
       bloque de firmas y cuño «Firmas y cuño»).
     - server/src/actions.ts   (buildDailyBulletin: boletín
       diario sin gráficos, con acumulados del mes, HTML de
       correo con cabecera aurora claro/oscuro y texto plano).
     - server/src/actions.ts   (buildExportReport: la lista
       completa del cierre del mes).

   Diferencias de tubería (honestas):
     - En el original el PDF se genera en el servidor y llega al
       dueño por «Archivo listo»; aquí los documentos se generan
       EN EL NAVEGADOR desde los mismos datos ya cargados y se
       descargan en el momento (igual en contenido y estilo).
     - Las firmas: el original pega los trazos de firma y la
       foto del cuño guardados en su base. Esos trazos NO viajan
       en el respaldo, así que el bloque de firmas lleva los
       nombres y roles reales con la marca «Firma autorizada
       pendiente» y «Cuño no disponible en este dispositivo.» —
       exactamente los textos que usa el original cuando un
       trazo o el cuño no están en el dispositivo. Nada se finge.
     - Envío de boletines: el propio runtime original no envía
       correos por sí solo (los entrega a un servicio de correo
       conectado). En el clon NO hay servicio de correo
       configurado: el boletín queda en cola «pendiente», listo
       para descargar; marcarlo enviado exige un envío real a
       través de un transporte inyectado (attemptBulletinSend)
       y la comprobación anti-duplicado va inmediatamente
       antes de enviar, como manda la regla del dueño.
   ============================================================ */

import {
  monthEconomy, monthKeyOf, transferSummary,
} from './economiaCore.mjs'
import {
  buildProductsCatalog, buildInventoryBook, findMenuRuleConflicts, menuDeptOf,
} from './productosCore.mjs'
import {
  deriveCyclePayroll, recordedPayroll, fmtFechaLarga, cycleIndexFor, cycleWindow,
  buildMarksByWorker, canonicalPersonKey, clientKeyOf, diasEsperadosCiclo,
  excusadosCeroDias, rhBulletinValues, cycleForDate, addDaysISO, diffDays,
} from './syncCore.mjs'

/* ============ Estilo de documentos (original: docStyle.ts) ============ */

export const DOC_STYLE = {
  deep: '#0B3D2E',
  emerald: '#16A34A',
  accent: '#0E9F6E',
  turquoise: '#0EA5BD',
  gold: '#C9A227',
  ink: '#14231C',
  dim: '#57705F',
  bg: '#F2F7F4',
  border: '#DDE8E1',
  auroraBlue: '#3B82F6',
  auroraViolet: '#8B5CF6',
  menuDeep: '#084C5C',
  headerTitle: '#0E9F6E',
  kpiValue: '#0B3D2E',
  checkCircleBg: '#0E9F6E',
  checkMark: '#FFFFFF',
  systemName: 'Queen SDA - Sistema de Automatización de Datos V2.0',
  business: 'La Reina Restaurante - Bar',
}

export const DOC_AURORA = {
  css: 'radial-gradient(720px 420px at 12% -8%, rgba(14,165,189,.40), transparent 62%), radial-gradient(680px 460px at 88% -6%, rgba(22,163,74,.34), transparent 60%), radial-gradient(620px 520px at 82% 116%, rgba(59,130,246,.30), transparent 64%), radial-gradient(560px 480px at 8% 112%, rgba(139,92,246,.26), transparent 62%), radial-gradient(900px 620px at 50% 55%, rgba(14,159,110,.14), transparent 66%), linear-gradient(180deg, #F5FBF8, #EAF4EF)',
  cssDark: 'radial-gradient(720px 420px at 12% -8%, rgba(14,165,189,.34), transparent 62%), radial-gradient(680px 460px at 88% -6%, rgba(22,163,74,.30), transparent 60%), radial-gradient(620px 520px at 82% 116%, rgba(59,130,246,.32), transparent 64%), radial-gradient(560px 480px at 8% 112%, rgba(139,92,246,.30), transparent 62%), radial-gradient(900px 620px at 50% 55%, rgba(14,159,110,.16), transparent 66%), linear-gradient(180deg, #0A1F18, #0C2B1F)',
}

/* ============ Formato (original: fmtQ, es-ES con puntos) ============ */

/* D-R5-05: agrupación manual determinista (el Intl es-ES de Android no
   separa los importes de 4 cifras: minimumGroupingDigits=2). */
const nf = { format: (v) => { const n = Math.round(Number(v) || 0); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') } }
function fmtDecEs(v, maxDec) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 0
  const neg = n < 0
  const abs = Math.abs(n)
  let entero = Math.floor(abs)
  let dec = Math.round((abs - entero) * 10 ** maxDec)
  if (dec >= 10 ** maxDec) { entero += 1; dec = 0 }
  let decStr = String(dec).padStart(maxDec, '0')
  while (decStr.length > 0 && decStr.endsWith('0')) decStr = decStr.slice(0, -1)
  return `${neg ? '-' : ''}${nf.format(entero)}${decStr ? ',' + decStr : ''}`
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export function fmtDoc(v) { return nf.format(Math.round(num(v))) }
export function fmtDocCUP(v) { return `${fmtDoc(v)} CUP` }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function monthLabelEs(monthKey) {
  const [y, m] = String(monthKey ?? '').split('-').map(Number)
  if (!y || !m) return String(monthKey ?? '')
  return `${MESES[m - 1]} de ${y}`
}
export function fmtFechaDoc(iso) {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(iso ?? '')
  return `${d} de ${MESES[m - 1]} de ${y}`
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* ============ Firmas y cuño (original: appendDocumentCertification) ============
   Flujo del dueño: todo documento sale firmado por el
   administrador y cuñado digitalmente; los que requieren firma
   del director llevan tres niveles — creado y revisado por
   Yadir (administrador), revisado por Economía (Yan) cuando
   aplica, y autorizado por Jesús (director) — y el cuño.
   El MENÚ queda EXCLUIDO (para clientes). */

export const DOC_SIGNERS = {
  admin: { label: 'CREADO Y REVISADO POR', name: 'Lic. Yadir Medina Oliva', role: 'Administración' },
  economico: { label: 'REVISADO POR ECONOMÍA', name: 'Yan Espinosa', role: 'Economía y contabilidad' },
  director: { label: 'AUTORIZADO POR', name: 'Jesús', role: 'Dirección' },
}
export const DOC_STAMP_TITLE = 'CUÑO DIGITAL APROBADO'
export const DOC_STAMP_SUBTITLE = 'PROYECTO DE DESARROLLO LOCAL · LA REINA RESTAURANTE - BAR'
export const SIGNATURE_PENDING_TEXT = 'Firma autorizada pendiente'
export const STAMP_MISSING_TEXT = 'Cuño no disponible en este dispositivo.'

/**
 * Bloque de firmas de un documento. kind: 'nomina' | 'informe' |
 * 'generico' | 'menu'. El menú devuelve null (excluido).
 * hasSignatureImage/hasStampImage: en el clon siempre false
 * (los trazos no viajan en el respaldo) — el bloque lo declara
 * con los textos del propio original.
 */
export function signatureBlockFor(kind) {
  if (kind === 'menu') return null
  const signers = [DOC_SIGNERS.admin]
  if (kind === 'nomina') signers.push(DOC_SIGNERS.economico, DOC_SIGNERS.director)
  if (kind === 'informe') signers.push(DOC_SIGNERS.director)
  return {
    title: 'Firmas y cuño',
    signers,
    stamp: {
      title: DOC_STAMP_TITLE,
      subtitle: DOC_STAMP_SUBTITLE,
      imageAvailable: false,
      missingText: STAMP_MISSING_TEXT,
    },
    signatureImageAvailable: false,
    pendingText: SIGNATURE_PENDING_TEXT,
  }
}

/* ============ Informe de Economía / cierre ============
   La lista completa del dueño, desde monthEconomy (el mismo
   núcleo que alimenta la pantalla de Economía): sin repetir
   información entre secciones. */

export function buildInformeData(data, monthKey, today) {
  const key = monthKey || (data?.days?.length ? monthKeyOf(data.days[data.days.length - 1].date) : monthKeyOf(today))
  const eco = monthEconomy(data, key, today)
  const cuadreTotal = (data?.days ?? [])
    .filter((d) => monthKeyOf(d.date) === key)
    .reduce((s, d) => s + num(d.cuadre), 0)
  return {
    kind: 'informe',
    title: 'Informe de Economía',
    monthKey: key,
    monthLabel: monthLabelEs(key),
    generatedAt: today,
    // Composición documental del original: el resultado de los
    // documentos suma los extras (neta − gastos + extras); el de la
    // pantalla (monthEconomy.resultado) no. Se recompone aquí, al
    // entrar al documento, sin tocar la fórmula de la pantalla.
    eco: { ...eco, resultado: eco.resultado + eco.ingresosExtras, cuadreTotal, zelle: eco.zelleCierre ?? 0, gastosTotal: eco.gastos, extrasTotal: eco.ingresosExtras },
    signatures: signatureBlockFor('informe'),
  }
}

/* ============ Nómina del ciclo RH ============
   Desde el historial registrado (payrollHistory) o derivada
   del ciclo con deriveCyclePayroll — las mismas cifras que la
   pantalla de RH. Orden alfabético como el PDF del original. */

function normPayrollEmployee(e) {
  return {
    name: String(e?.nombre ?? e?.name ?? ''),
    position: String(e?.ocupacion ?? e?.position ?? ''),
    daysWorked: num(e?.dias ?? e?.daysWorked),
    dailySalary: e?.salarioDiario != null ? num(e.salarioDiario) : (e?.dailySalary != null ? num(e.dailySalary) : null),
    total: num(e?.totalCobrar ?? e?.total),
    cashAmount: num(e?.pagoEfectivo ?? e?.cashAmount),
    transferAmount: num(e?.pagoTransferencia ?? e?.transferAmount),
  }
}

export function buildNominaDocumento(data, cycleStart) {
  const history = data?.payrollHistory ?? []
  const recordedList = history.slice().sort((a, b) => String(b.cycleStart).localeCompare(String(a.cycleStart)))
  let rec = cycleStart ? recordedPayroll(history, cycleStart) : recordedList[0] ?? null
  let derived = null
  if (!rec && cycleStart) {
    const d = deriveCyclePayroll(data?.days ?? [], cycleStart, {
      adjustment: data?.payrollAdjustments?.[cycleStart] ?? null,
      unpaidKeys: data?.unpaidWorkers ?? [],
    })
    if (d && d.employees.some((e) => !e.direccion && !e.noPagado)) derived = d
  }
  if (!rec && !derived) {
    // Sin ciclo pedido: la derivada más reciente con foto de RH.
    for (const c of payrollCyclesAvailable(data)) {
      if (c.recorded) continue
      const d = buildNominaDocumento(data, c.cycleStart)
      if (d) return d
    }
    return null
  }
  const source = rec ?? derived
  const rawEmployees = rec
    ? (rec.employees ?? [])
    : derived.employees.filter((e) => !e.direccion && !e.noPagado)
  const employees = rawEmployees.map(normPayrollEmployee)
    .filter((e) => e.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const totalEfectivo = employees.reduce((s, e) => s + e.cashAmount, 0)
  const totalTransferencia = employees.reduce((s, e) => s + e.transferAmount, 0)
  return {
    kind: 'nomina',
    title: 'Nómina de salarios',
    cycleStart: source.cycleStart,
    cycleEnd: source.cycleEnd,
    payDate: source.payDate,
    recorded: Boolean(rec),
    employees,
    total: num(source.total),
    totalDias: employees.reduce((s, e) => s + e.daysWorked, 0),
    totalEfectivo,
    totalTransferencia,
    mixed: totalEfectivo > 0 && totalTransferencia > 0,
    signatures: signatureBlockFor('nomina'),
  }
}

/** Ciclos disponibles para el documento de nómina (registrados + derivados). */
export function payrollCyclesAvailable(data) {
  const out = new Map()
  for (const r of data?.payrollHistory ?? []) {
    out.set(r.cycleStart, { cycleStart: r.cycleStart, cycleEnd: r.cycleEnd, payDate: r.payDate, total: num(r.total), recorded: true })
  }
  const days = data?.days ?? []
  if (days.length) {
    const anchor = data?.anchorDate || '2026-09-23'
    const first = cycleIndexFor(anchor, days[0].date)
    const last = cycleIndexFor(anchor, days[days.length - 1].date)
    for (let idx = first; idx <= last; idx++) {
      const win = cycleWindow(anchor, idx)
      if (out.has(win.start)) continue
      const d = deriveCyclePayroll(days, win.start, {
        adjustment: data?.payrollAdjustments?.[win.start] ?? null,
        unpaidKeys: data?.unpaidWorkers ?? [],
      })
      if (d && d.photoDate) {
        out.set(win.start, { cycleStart: win.start, cycleEnd: win.end, payDate: win.payDate, total: d.total, recorded: false })
      }
    }
  }
  return [...out.values()].sort((a, b) => String(b.cycleStart).localeCompare(String(a.cycleStart)))
}

/* ============ Menú para clientes ============
   Se genera solo desde Productos: lo que tiene existencia, a
   su precio de venta vigente, agrupado por sección y familia
   y alfabético dentro de cada familia. La regla de cocina del
   dueño (nunca camarón, langosta, res ni tortuga) EXCLUYE los
   productos señalados por findMenuRuleConflicts: se reportan
   aparte y nunca entran al menú. Sin firmas ni cuño. */

export const MENU_SECTION_ORDER = ['Entrantes y picaderas', 'Elaboración', 'Pizzas', 'Cantina', 'Bebidas alcohólicas', 'Bebidas no alcohólicas']

export function buildMenuData(data, today) {
  /* El catálogo del menú es el mismo de Existencias: con los
     ajustes manuales de existencia de esta copia aplicados, para
     que el menú nunca ofrezca lo que el almacén ya dio de baja
     ni esconda lo que se dio de alta a mano. */
  const catalog = buildProductsCatalog(data?.days ?? [], data?.inventoryAdjustments ?? [])
  const conflicts = findMenuRuleConflicts(catalog.products.map((p) => p.name))
  const conflictNames = new Set(conflicts.map((c) => c.name))
  const groups = new Map()
  for (const p of catalog.products) {
    if (conflictNames.has(p.name)) continue
    if (!(p.currentStock > 0.001)) continue
    if (p.precioVentaVigente == null) continue
    const section = menuDeptOf(p.dept)
    const family = p.menuFamily || 'Por clasificar'
    if (!groups.has(section)) groups.set(section, new Map())
    const fams = groups.get(section)
    if (!fams.has(family)) fams.set(family, [])
    fams.get(family).push({ name: p.name, price: p.precioVentaVigente, description: '' })
  }
  const sections = [...groups.entries()]
    .sort((a, b) => {
      const ia = MENU_SECTION_ORDER.indexOf(a[0]); const ib = MENU_SECTION_ORDER.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0], 'es')
    })
    .map(([section, fams]) => ({
      section,
      families: [...fams.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'es'))
        .map(([family, items]) => ({
          family,
          items: items.sort((a, b) => a.name.localeCompare(b.name, 'es')),
        })),
    }))
  const itemCount = sections.reduce((s, sec) => s + sec.families.reduce((t, f) => t + f.items.length, 0), 0)
  return {
    kind: 'menu',
    title: 'Menú del día',
    dateLabel: fmtFechaDoc(today),
    sections,
    itemCount,
    excluded: conflicts.map((c) => ({ name: c.name, rule: c.motivo })),
    signatures: null, // EXCLUIDO de firma y cuño por regla del dueño.
  }
}

/* ============ Respaldo exportable (ida y vuelta) ============
   Mismo formato del original: { backupOf, exportedAt, data }.
   El payload manda al reimportar (parseBackup del clon), así
   que aquí se vuelca el StoredData completo y se reconstruye
   un transferState.history desde los movimientos derivados
   (el respaldo original trae el historial crudo; el clon lo
   guarda derivado en transferMovements). */

export function buildBackupExport(data, exportedAt) {
  const movements = (data?.transferMovements ?? []).slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  // Historial de la tarjeta reconstruido en el formato del
  // original: mismos campos que trae el respaldo (el clon guarda
  // los movimientos ya normalizados; aquí se vuelcan de vuelta).
  let running = 0
  const history = movements.map((m) => {
    running += num(m.amount)
    return {
      amount: num(m.amount),
      balanceAfter: running,
      date: m.date,
      detail: m.detail ?? '',
      discountAmount: 0,
      discountPercent: 0,
      excluido: Boolean(m.excluded),
      extraId: m.extraId ?? null,
      manualId: m.manualId ?? null,
      paseId: m.paseId ?? null,
      paymentCreditId: m.paymentCreditId ?? null,
      source: m.source ?? 'manual',
      superseded: Boolean(m.superseded),
      transferExpenseId: m.transferExpenseId ?? null,
      type: m.type ?? 'abono',
    }
  })
  const bankTransfers = []
  const seenPase = new Set()
  for (const m of movements) {
    if (m.paseId == null || seenPase.has(m.paseId)) continue
    seenPase.add(m.paseId)
    bankTransfers.push({
      amount: Math.abs(num(m.amount)), date: m.date, excluido: Boolean(m.excluded),
      id: m.paseId, kind: m.paseKind ?? 'efectivo', note: m.detail ?? '',
    })
  }
  const transferExpenses = movements
    .filter((m) => m.transferExpenseId != null)
    .map((m) => ({ id: m.transferExpenseId, date: m.date, concept: m.detail ?? '', amount: Math.abs(num(m.amount)) }))
  const sum = transferSummary(movements)
  return {
    backupOf: 'SDA La Reina (panorama-mensual-la-reina)',
    exportedAt: String(exportedAt ?? '').slice(0, 10),
    data: {
      anchorDate: data?.anchorDate ?? null,
      appSettings: {},
      bankTransfers,
      cuentasEntries: [],
      days: data?.days ?? [],
      expenses: data?.expenses ?? [],
      exportedAt: String(exportedAt ?? '').slice(0, 10),
      ipvReceivableAccounts: [],
      // Las cinco colecciones viajan ÍNTEGRAS desde el StoredData
      // (oleada 2: antes salían [] y se perdían al reexportar —
      // fuga cerrada; parseBackup las conserva sin tocarlas).
      monthlyArchives: data?.monthlyArchives ?? [],
      payrollHistory: data?.payrollHistory ?? [],
      queenLearning: [],
      receivablePhotos: data?.receivablePhotos ?? [],
      receivables: data?.receivables ?? [],
      smsLogs: data?.smsLogs ?? [],
      smsOutbox: data?.smsOutbox ?? [],
      transferExpenses,
      transferState: {
        balance: sum.balance,
        expenses: transferExpenses,
        history,
        lastBankTransfer: sum.lastBankPase ? { date: sum.lastBankPase.date, amount: sum.lastBankPase.amount } : null,
        // registeredMovementsNet no se guarda como tal en el
        // clon (se deriva de los movimientos): se exporta 0.
        registeredMovementsNet: 0,
        totalBankPassed: sum.totalBankPassed,
        totalDiscountBenefit: 0,
        totalExpenses: sum.totalTransferExpenses,
        totalIpvReceived: sum.totalIpvReceived,
        totalReceived: sum.totalReceived,
        totalToBank: sum.totalPases,
      },
      workerPayments: data?.workerPayments ?? [],
      workers: data?.workers ?? [],
    },
  }
}

/* ============ Boletín diario (original: buildDailyBulletin) ============
   Sin gráficos; medidores de Economía como barras de progreso.
   Cifras del día + acumulados del mes HASTA ese día (el
   original los calcula con los datos vivos al generarlo; al
   regenerarlo desde una foto posterior, los saldos de cuentas
   reflejan el estado registrado en esa foto — se documenta). */

export const BULLETIN_RECIPIENTS = [
  'yadir.medina900710@gmail.com',
  'dayamifernandez584@gmail.com',
  'yanespinosa08@gmail.com',
  'jesusmmpatria@gmail.com',
]

export function bulletinSubject(dateISO) {
  /* Asunto del original, constatado en su bandeja: separador «·»
     también antes de la fecha (antes aquí salía «—»). */
  return `${DOC_STYLE.systemName} · Boletín diario · ${fmtFechaDoc(dateISO)}`
}

function dataUpTo(data, dateISO) {
  return {
    ...data,
    days: (data?.days ?? []).filter((d) => d.date <= dateISO),
    expenses: (data?.expenses ?? []).filter((e) => e.date <= dateISO),
    receivables: data?.receivables ?? [],
    localPayments: data?.localPayments ?? [],
  }
}

export function buildDailyBulletin(data, targetDate, opts = {}) {
  const day = (data?.days ?? []).find((d) => d.date === targetDate)
  if (!day) return null
  const upTo = dataUpTo(data, targetDate)
  const monthKey = monthKeyOf(targetDate)
  const eco = monthEconomy(upTo, monthKey, targetDate)
  const dayExpenses = (data?.expenses ?? []).filter((e) => e.date === targetDate)
  const gastosDia = dayExpenses.reduce((s, e) => s + num(e.total), 0)
  const resultadoDia = num(day.gananciaNeta) - gastosDia + (day.extras ?? []).reduce((s, e) => s + num(e.importe), 0)
  const topProducts = (day.departments ?? [])
    .flatMap((dep) => (dep.products ?? []).map((p) => ({ name: p.name, dept: dep.name, cantidad: num(p.cantidadVendida), importe: num(p.importeVenta) })))
    .filter((p) => p.importe > 0)
    .sort((a, b) => b.importe - a.importe)
    .slice(0, 5)
  /* Dinero en la calle A LA FECHA del boletín, no con la foto de
     hoy: a cada cuenta de cliente nacida hasta ese día se le
     re-suman los pagos posteriores a la fecha (los de su propio
     historial, que el saldoBase ya trae descontados) y se le
     restan solo los pagos locales (Cobrar de esta copia) hechos
     hasta ese día — la misma aritmética de saldoEfectivo en
     Economía, cortada a la fecha. Sin este corte, un boletín
     regenerado días después perdía las cuentas pagadas entretanto
     (al 18-oct: −13.080 frente al original). El corte por
     morosidad (clientes: 7 días naturales desde el nacimiento)
     también se recalcula a la fecha, por la regla, como hace el
     original al componer el boletín de ese día. */
  const saldoAlDia = (r) => {
    const pagosPosteriores = (r.payments ?? []).filter((p) => p.paidDate > targetDate).reduce((s, p) => s + num(p.amount), 0)
    const localesHastaElDia = (data?.localPayments ?? []).filter((p) => p.receivableId === r.id && p.date <= targetDate).reduce((s, p) => s + num(p.amount), 0)
    return Math.max(0, num(r.saldoBase) + pagosPosteriores - localesHastaElDia)
  }
  const vencimientoCliente = (dateISO) => {
    const d = new Date(`${dateISO}T12:00:00`)
    d.setDate(d.getDate() + 7)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  /* Solo quedan fuera las cuentas «ipv»: la lápida que la
     sincronización pone a la versión vieja de una cuenta cuando un
     IPV más nuevo la sustituye (contarla duplicaría la deuda). El
     closeKind «manual» del original es solo el sello de «cerrada a
     mano» de una cuenta pagada: si pagó después de la fecha del
     boletín, a esa fecha estaba viva y cuenta. */
  const clientesAlDia = (data?.receivables ?? [])
    .filter((r) => r.category === 'cliente' && r.closeKind !== 'ipv' && r.date <= targetDate)
    .map((r) => ({ rec: r, saldo: saldoAlDia(r) }))
    .filter((x) => x.saldo > 0)
  const calle = clientesAlDia.reduce((s, x) => s + x.saldo, 0)
  const calleMorosas = clientesAlDia.filter((x) => targetDate > vencimientoCliente(x.rec.date)).reduce((s, x) => s + x.saldo, 0)
  const calleEnCobrar = calle - calleMorosas
  const callePorNombre = new Map()
  for (const x of clientesAlDia) callePorNombre.set(x.rec.client, (callePorNombre.get(x.rec.client) ?? 0) + x.saldo)
  const calleDetalle = [...callePorNombre.entries()].map(([name, saldo]) => ({ name, saldo })).sort((a, b) => b.saldo - a.saldo)
  const deptTotals = {}
  for (const dep of day.departments ?? []) deptTotals[dep.name] = num(dep.ventas ?? dep.venta)
  const extrasDia = (day.extras ?? []).reduce((s, e) => s + num(e.importe), 0)

  /* ===== Bloques completos del boletín del original (17) =====
     Reconstrucción de la oleada del 26-oct contra la comparativa
     validada del día 18: cada bloque sale de los mismos datos y
     reglas del original; lo no reproducible desde el respaldo
     (Elaboración y Existencias con descuadre, en tablas del
     servidor) se omite y queda declarado en el informe. */
  const DEPT_ORDER = ['Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Cocina (Elaboración)', 'Pizzería (Pizzas)', 'Cantina', 'Billar / Juegos (mesas)']
  const deptNameB = (n) => (n === 'Elaboración' ? 'Cocina (Elaboración)' : n === 'Pizzas' ? 'Pizzería (Pizzas)' : n)
  const deptSort = (a, b) => DEPT_ORDER.indexOf(a.name) - DEPT_ORDER.indexOf(b.name)

  // Línea de estado del IPV (honestLine del original).
  const isoFromMs = (ms) => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
      const g = (t) => parts.find((p) => p.type === t)?.value ?? ''
      return `${g('year')}-${g('month')}-${g('day')}`
    } catch { return null }
  }
  const importedISO = day.importedAtMs ? isoFromMs(day.importedAtMs) : null
  const ipvLine = importedISO
    ? `El IPV del ${fmtFechaDoc(targetDate)} sí está importado. IPV importado el ${fmtFechaDoc(importedISO)}; este es el boletín correspondiente al ${fmtFechaDoc(targetDate)}.`
    : `El IPV del ${fmtFechaDoc(targetDate)} sí está importado; este es el boletín correspondiente al ${fmtFechaDoc(targetDate)}.`

  // RH del ciclo (foto del último IPV del ciclo hasta la fecha).
  const anchor = data?.anchorDate ?? '2026-09-23'
  const cyc = cycleForDate(anchor, targetDate)
  const inCycle = upTo.days.filter((d) => d.date >= cyc.start && d.date <= cyc.end)
  const lastCycleDay = inCycle.length ? inCycle[inCycle.length - 1] : null
  const adjRaw = (data?.payrollAdjustments ?? {})[cyc.start]
  const adjEmps = Array.isArray(adjRaw) ? adjRaw : (adjRaw?.employees ?? null)
  const rhSource = adjEmps ?? (lastCycleDay?.rh ?? [])
  const marks = buildMarksByWorker(upTo.days)
  const fichaByKey = new Map((data?.workers ?? []).map((w) => [canonicalPersonKey(w.key, w.nombre), w]))
  const expectedFor = (emp) => {
    const key = canonicalPersonKey(null, emp.nombre)
    return diasEsperadosCiclo(fichaByKey.get(key) ?? {}, key, marks, new Set(), cyc.start, cyc.end, targetDate)
  }
  const rhEmployees = rhSource
    .map((emp) => ({ nombre: emp.nombre, ocupacion: emp.ocupacion ?? '', dias: Math.max(0, num(emp.dias)), ...rhBulletinValues(emp, expectedFor(emp)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const rhTotal = rhEmployees.reduce((s, e) => s + e.acumulado, 0)
  const rhDailyRows = (() => {
    if (!day.rh?.length) return []
    const sortEs = (arr) => [...arr].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
    const dateIndex = (day.rhFechas ?? []).indexOf(targetDate)
    if (dateIndex >= 0 && day.rh.some((e) => (e.marcas?.length ?? 0) > dateIndex)) {
      return sortEs(day.rh).flatMap((emp) => {
        const jornada = Math.max(0, num(emp.marcas[dateIndex]))
        if (jornada <= 0) return []
        const vd = rhBulletinValues(emp, expectedFor(emp)).valorDia
        return [{ nombre: emp.nombre, ocupacion: emp.ocupacion ?? '', jornada, valorDia: vd, importe: jornada * vd }]
      })
    }
    const prev = [...inCycle].filter((d) => d.date < targetDate).at(-1) ?? null
    if (!prev) return []
    const prevByKey = new Map((prev.rh ?? []).map((e) => [clientKeyOf(e.nombre), e]))
    return sortEs(day.rh).flatMap((emp) => {
      const p = prevByKey.get(clientKeyOf(emp.nombre))
      const jornada = Math.max(0, num(emp.dias) - (p ? num(p.dias) : num(emp.dias)))
      if (jornada <= 0) return []
      const vd = rhBulletinValues(emp, expectedFor(emp)).valorDia
      return [{ nombre: emp.nombre, ocupacion: emp.ocupacion ?? '', jornada, valorDia: vd, importe: jornada * vd }]
    })
  })()
  const rhDailyTotal = rhDailyRows.reduce((s, r) => s + r.importe, 0)

  // Economía con contexto (porcentajes, rentabilidad ordenada como
  // el original, gastos por categoría, medidores con su base).
  const pctD = (part, total) => (total > 0 ? (part / total) * 100 : 0)
  const economia = {
    brutaPct: pctD(eco.bruta, eco.ventas),
    netaPct: pctD(eco.neta, eco.ventas),
    gastosPctNeta: pctD(eco.gastos, eco.neta),
    rentabilidad: (eco.rentabilidad ?? [])
      .map((r) => ({ name: deptNameB(r.name), ventas: num(r.ventas), ganancia: num(r.ganancia), margen: r.margen }))
      // Orden del original (categoryProfitability): margen desc,
      // sin margen al final, y a igual margen mayor ganancia.
      .sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity) || b.ganancia - a.ganancia),
    gastosPorCategoria: (eco.gastosPorCategoria ?? [])
      .map((g) => ({ name: g.name ?? g[0] ?? 'Otros', total: num(g.total ?? g[1]) }))
      .sort((a, b) => b.total - a.total),
    fondoVentasBase: `${eco.daysCount} de ${[31, (Number(monthKey.slice(0, 4)) % 4 === 0 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(monthKey.slice(5, 7)) - 1]} días con IPV`,
    trimestre: (() => {
      const y = Number(monthKey.slice(0, 4))
      const q = Math.floor((Number(monthKey.slice(5, 7)) - 1) / 3)
      const months = [0, 1, 2].map((i) => q * 3 + i + 1)
      const dim = (yy, mm) => [31, (yy % 4 === 0 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]
      const keys = months.map((mm) => `${y}-${String(mm).padStart(2, '0')}`)
      return {
        label: `${keys.map((k) => monthLabelEs(k).replace(/ de \d+$/, '')).join(', ')} de ${y}`,
        dias: months.reduce((s, mm) => s + dim(y, mm), 0),
        importados: (upTo.days ?? []).filter((d) => keys.includes(monthKeyOf(d.date))).length,
      }
    })(),
  }

  // El día en barras + ventas por departamento (venta y ganancia).
  const billarDia = day.billar ?? null
  const deptRows = (day.departments ?? [])
    .map((dep) => ({ name: deptNameB(dep.name), venta: num(dep.ventas ?? dep.venta), ganancia: num(dep.ganancia) }))
  if (billarDia) deptRows.push({ name: 'Billar / Juegos (mesas)', venta: num(billarDia.venta), ganancia: num(billarDia.utilidad) })
  deptRows.sort(deptSort)
  const fondosBarras = (() => {
    if (!day.fondos) return []
    // Composición del original: efectivo, transferencias, cuentas
    // por cobrar y divisas+Zelle, solo los positivos, y el % de cada
    // uno sobre la suma de esos positivos («de los fondos»).
    const items = [
      { label: 'Efectivo', valor: num(day.fondos.efectivo) },
      { label: 'Transferencias', valor: num(day.fondos.transferencias) },
      { label: 'Cuentas por cobrar', valor: num(day.fondos.totalCuentasPorCobrar) },
      { label: 'Divisas y Zelle (CUP)', valor: num(day.fondos.divisasCUP) + num(day.fondos.zelle) },
    ].filter((i) => i.valor > 0)
    const totalPos = items.reduce((s, i) => s + i.valor, 0)
    return items.map((i) => ({ ...i, pct: pctD(i.valor, totalPos) }))
  })()

  // Transferencias del día + acumulado por pasar al banco al cierre.
  const movsHasta = (data?.transferMovements ?? []).filter((m) => m.date <= targetDate)
  const movsDia = (data?.transferMovements ?? []).filter((m) => m.date === targetDate && !m.superseded && !m.excluded && num(m.amount) !== 0)
  const abonosDia = movsDia.filter((m) => m.type === 'abono' && num(m.amount) > 0)
  const pasesDia = movsDia.filter((m) => m.type === 'pase')
  const transferencias = {
    entraron: abonosDia.reduce((s, m) => s + num(m.amount), 0),
    detalle: abonosDia.map((m) => ({ detalle: m.detail ?? '', importe: num(m.amount), source: m.source ?? '' })),
    // «Se pasó al banco»: los pases del día, importe a importe,
    // como los lista el original (7943 · 210 · 10.655 al 23-oct).
    pases: { amounts: pasesDia.map((m) => Math.abs(num(m.amount))), total: pasesDia.reduce((s, m) => s + Math.abs(num(m.amount)), 0) },
    porPasar: transferSummary(movsHasta).balance,
  }

  // Cuentas por cobrar COMPLETO a la fecha (grupos con cada cuenta
  // nombrada, registro general, casa por persona, nuevas, pagadas
  // hoy y salidas de caja del día).
  const alDia = (data?.receivables ?? [])
    .filter((r) => r.closeKind !== 'ipv' && r.date <= targetDate)
    .map((r) => ({ rec: r, saldo: saldoAlDia(r) }))
    .filter((x) => x.saldo > 0)
  const refOf = (name) => {
    const m = /[-–]\s*([a-záéíóúñ ]+)$/i.exec(String(name ?? ''))
    return m ? m[1].trim() : ''
  }
  const grupoDe = (cat, label) => {
    const items = alDia.filter((x) => x.rec.category === cat)
    return { label, total: items.reduce((s, x) => s + x.saldo, 0), count: items.length, items: items.map((x) => ({ name: x.rec.client, saldo: x.saldo, ref: refOf(x.rec.client) })) }
  }
  const regGeneral = alDia.filter((x) => x.rec.registro !== 'aparte')
  const casaPersona = (persona, label) => {
    const items = alDia.filter((x) => x.rec.persona === persona)
    return { label, total: items.reduce((s, x) => s + x.saldo, 0), count: items.length, items: items.map((x) => ({ name: x.rec.client, saldo: x.saldo, ref: refOf(x.rec.client), nuevaHoy: x.rec.date === targetDate })) }
  }
  const pagosHoy = []
  for (const r of data?.receivables ?? []) for (const p of r.payments ?? []) if (p.paidDate === targetDate) pagosHoy.push({ rec: r, amount: num(p.amount) })
  for (const p of data?.localPayments ?? []) if (p.date === targetDate) {
    const rec = (data?.receivables ?? []).find((r) => r.id === p.receivableId)
    if (rec) pagosHoy.push({ rec, amount: num(p.amount) })
  }
  const cobradoHoy = {
    general: pagosHoy.filter((x) => x.rec.registro !== 'aparte'),
    casa: pagosHoy.filter((x) => x.rec.registro === 'aparte'),
  }
  const salidasCaja = dayExpenses.filter((e) => e.origin === 'ipv-cuentas')
  const cobrar = {
    grupos: [grupoDe('administrativo', 'Administrativo'), grupoDe('cliente', 'Clientes'), grupoDe('trabajador', 'Trabajadores')],
    registroGeneral: {
      total: regGeneral.reduce((s, x) => s + x.saldo, 0),
      count: regGeneral.length,
      ipv: regGeneral.filter((x) => x.rec.origin === 'ipv').reduce((s, x) => s + x.saldo, 0),
      manuales: regGeneral.filter((x) => x.rec.origin !== 'ipv').reduce((s, x) => s + x.saldo, 0),
      items: regGeneral.map((x) => ({ name: x.rec.client, saldo: x.saldo, nuevaHoy: x.rec.date === targetDate })),
    },
    casa: [casaPersona('dayami', 'Dayami (Daya)'), casaPersona('alejandro', 'Alejandro'), casaPersona('jesus', 'Jesús')],
    nuevasHoy: alDia.filter((x) => x.rec.date === targetDate).map((x) => ({ name: x.rec.client, saldo: x.saldo, registro: x.rec.registro === 'aparte' ? 'aparte' : 'general', origin: x.rec.origin ?? 'manual' })),
    pagadasHoy: {
      hay: pagosHoy.length > 0,
      generalTotal: cobradoHoy.general.reduce((s, x) => s + x.amount, 0),
      generalCount: cobradoHoy.general.length,
      casaTotal: cobradoHoy.casa.reduce((s, x) => s + x.amount, 0),
      casaCount: cobradoHoy.casa.length,
    },
    salidasCaja: { count: salidasCaja.length, total: salidasCaja.reduce((s, e) => s + num(e.total), 0) },
  }

  // Entradas del día y saldo final al cierre (existencias del día).
  const entradas = (day.entriesDetail ?? day.entries ?? []).map((e) => ({
    dept: deptNameB(e.dept ?? ''), descripcion: e.descripcion ?? e.name ?? '', cantidad: num(e.cantidad), um: e.um ?? '',
    precioCompra: num(e.precioCompra ?? e.precioC), importe: num(e.importe), precioVenta: num(e.precioVenta), importeVenta: num(e.importeVenta),
    // Como el original: si la entrada no trae ganancia, es venta − compra.
    ganancia: num(e.ganancia) || num(e.importeVenta) - num(e.importe),
  }))
  const saldoCierre = (day.departments ?? []).map((dep) => {
    const prods = (dep.products ?? []).filter((p) => p.existenciaFinal != null).map((p) => ({ name: p.name, cantidad: num(p.existenciaFinal), um: p.um ?? 'U', fuente: p.existenciaFuente === 'fisica' ? 'conteo físico' : 'teórica' }))
    return {
      dept: deptNameB(dep.name),
      conExistencia: prods.filter((p) => p.cantidad > 0),
      agotados: prods.filter((p) => p.cantidad <= 0).length,
    }
  }).sort((a, b) => DEPT_ORDER.indexOf(a.dept) - DEPT_ORDER.indexOf(b.dept))
  const totalAgotados = saldoCierre.reduce((s, d) => s + d.agotados, 0)

  // Avisos de Queen reproducibles desde los datos (los de
  // Elaboración no lo son desde el respaldo: declarados en informe).
  const avisos = []
  if (Math.abs(num(day.cuadre)) > 0.5) avisos.push(`Cuadre del ${fmtFechaDoc(targetDate)}: ${fmtDoc(num(day.cuadre))} — cuadre ≠ 0 sin causa confirmada.`)
  if (day.fondos) {
    const comp = num(day.fondos.efectivo) + num(day.fondos.transferencias) + num(day.fondos.totalCuentasPorCobrar) + num(day.fondos.zelle) + num(day.fondos.divisasCUP)
    const gap = num(day.fondos.totalFondos) - comp
    if (Math.abs(gap) > 0.5) avisos.push(`Los componentes del Desglose del ${fmtFechaDoc(targetDate)} (efectivo, divisas, cuentas por cobrar, Zelle y transferencias) suman ${fmtDoc(comp)} y el Total de fondos dice ${fmtDoc(num(day.fondos.totalFondos))}: hay ${fmtDoc(gap)} que el total incluye y los componentes no desglosan. Pasa cuando ese IPV se importó antes de que el lector capturara la fila «Transferencias recibidas»: reimporta el IPV de ese día y se corrige solo.`)
  }
  const prodPorNombre = new Map()
  for (const dep of day.departments ?? []) for (const p of dep.products ?? []) {
    const cur = prodPorNombre.get(p.name) ?? { ganancia: 0 }
    cur.ganancia += num(p.ganancia)
    prodPorNombre.set(p.name, cur)
  }
  for (const [name, v] of [...prodPorNombre.entries()].filter(([, v]) => v.ganancia < -0.5).slice(0, 5)) avisos.push(`«${name}» se vendió bajo costo ese día: ganancia ${fmtDoc(v.ganancia)}.`)
  const excusados = excusadosCeroDias(upTo.days, new Map(), cyc.start, cyc.end, targetDate, undefined)
  if (lastCycleDay) {
    for (const e of rhSource.filter((x) => num(x.totalCobrar) > 0 && num(x.dias) === 0 && !excusados.has(canonicalPersonKey(null, x.nombre)))) {
      avisos.push(`${e.nombre} tiene salario quincenal asignado con 0 días trabajados.`)
    }
  }

  // Elaboración · rentabilidad y merma: las fichas viven en su
  // propio almacén (app_settings «elaboracion»), fuera del respaldo;
  // el llamador que las tenga las pasa en data.elaboracion con la
  // forma {perdida, bajoMeta, rentables, rows, merma}. Sin fichas a
  // la vista, el bloque sale con el estado cero EXACTO del original
  // («Aún no hay fichas de costo guardadas») — que es también lo que
  // el boletín real del 23-oct trajo, porque el original tampoco
  // tenía fichas guardadas a esa fecha.
  const elabIn = data?.elaboracion ?? null
  const elaboracion = {
    perdida: num(elabIn?.perdida), bajoMeta: num(elabIn?.bajoMeta), rentables: num(elabIn?.rentables),
    rows: Array.isArray(elabIn?.rows) ? elabIn.rows : [],
    merma: elabIn?.merma ?? null,
  }

  // Existencias con descuadre (libro continuo hasta la fecha, con
  // la semántica vigente del original): solo cuenta el cierre contra
  // conteo físico del ÚLTIMO día con conteo de cada producto; la
  // apertura que no enlaza ya no es descuadre (manda el último IPV).
  const existenciasDescuadre = (() => {
    try {
      const book = buildInventoryBook(upTo.days)
      const items = []
      for (const prod of book.products ?? []) {
        const lastFisica = [...(prod.history ?? [])].reverse().find((h) => h.ipvSaldoFinal != null && h.ipvFuente === 'fisica')
        if (lastFisica && lastFisica.diferencia != null && Math.abs(lastFisica.diferencia) > 0.001) {
          items.push({ name: prod.name, dept: prod.dept, um: prod.um ?? '', esperado: lastFisica.saldoFinal, contado: lastFisica.ipvSaldoFinal, diferencia: lastFisica.diferencia })
        }
      }
      return { count: items.length, items, hayProductos: (book.products ?? []).length > 0 }
    } catch { return { count: 0, items: [], hayProductos: false } }
  })()

  const subject = bulletinSubject(targetDate)
  const structured = {
    date: targetDate,
    monthKey,
    venta: num(day.ventasDia),
    bruta: num(day.gananciaBruta),
    neta: num(day.gananciaNeta),
    cuadre: num(day.cuadre),
    gastosDia,
    gastosDiaCount: dayExpenses.length,
    resultadoDia,
    inversionDia: num(day.entriesImporte),
    mermaDia: num(day.mermasCosto),
    extrasDia: (day.extras ?? []).reduce((s, e) => s + num(e.importe), 0),
    extrasDiaList: (day.extras ?? []).map((e) => ({ concepto: e.concepto ?? e.concept ?? '', importe: num(e.importe) })),
    fondos: day.fondos ?? null,
    deptTotals,
    topProducts,
    dineroEnLaCalle: calle,
    calleEnCobrar,
    calleMorosas,
    calleDetalle,
    mes: {
      ventas: eco.ventas, bruta: eco.bruta, neta: eco.neta, gastos: eco.gastos,
      extras: eco.ingresosExtras, resultado: eco.resultado + eco.ingresosExtras, billar: eco.billar?.venta ?? 0,
      barra: eco.barra, cocina: eco.cocina, inversion: eco.inversion,
      merma: eco.merma, totalCobrado: eco.totalCobrado, efectivoCaja: eco.efectivoCaja ?? 0,
      zelle: eco.zelleCierre ?? 0, diasConIpv: eco.daysCount,
      fondoVentas: eco.reservas.fondoVentasMes, fondoVentasProgreso: eco.reservas.fondoVentasProgreso,
      fondoUtilidades: eco.reservas.fondoUtilidadesTrimestre, fondoUtilidadesProgreso: eco.reservas.trimestreProgreso,
    },
    ipvLine,
    pdfFilename: `contabilidad-${targetDate}.pdf`,
    rh: {
      hayFoto: !!lastCycleDay,
      foto: lastCycleDay?.date ?? null,
      cicloStart: cyc.start, cicloEnd: cyc.end, pago: cyc.payDate,
      faltan: Math.max(0, diffDays(targetDate, cyc.end)),
      empleados: rhEmployees,
      total: rhTotal,
      valorDia: rhDailyRows,
      valorDiaTotal: rhDailyTotal,
    },
    economia,
    deptRows,
    fondosBarras,
    billarDia,
    transferencias,
    cobrar,
    entradas,
    entradasTotales: {
      inversion: entradas.reduce((s, e) => s + e.importe, 0),
      ventaPotencial: entradas.reduce((s, e) => s + e.importeVenta, 0),
      gananciaPotencial: entradas.reduce((s, e) => s + e.ganancia, 0),
    },
    saldoCierre,
    totalAgotados,
    elaboracion,
    existenciasDescuadre,
    avisos,
  }
  const html = bulletinHtml(structured, subject)
  const text = bulletinText(structured)
  return {
    id: `${targetDate}-${opts.trigger ?? 'import'}`,
    date: targetDate,
    status: 'pendiente',
    attempts: 0,
    lastError: null,
    recipients: BULLETIN_RECIPIENTS.slice(),
    subject,
    html,
    text,
    structured,
    pdfFilename: `contabilidad-${targetDate}.pdf`,
    createdAt: opts.now ?? null,
    sentAt: null,
  }
}

/* ============ Render del boletín: UN SOLO CUERPO (correo) ============
   Construcción segura para correo, como la del original: un solo
   cuerpo con tablas y estilos en línea; el <style> solo recolorea
   la página y la cabecera en modo oscuro del cliente — jamás
   oculta contenido (la versión anterior incrustaba DOS cuerpos y
   conmutaba con display:none por media query: la app de correo
   del dueño no evalúa esas consultas y el boletín del 18 se vio
   VACÍO; defecto confirmado por el dueño el 26-oct 19:29).
   Textos, orden de bloques y formatos: los del buildDailyBulletin
   del original, contrastados contra la MUESTRA REAL del boletín
   del 23-oct-2026 (correo + PDF del dueño): asunto con «·»,
   Economía con la Utilidad al final, barras ordenadas por venta
   con la ganancia en proporción a la mayor, «Se pasó al banco»,
   detalle de divisas del arqueo y pie completo. */

export function fmtRH(v) {
  const n = Math.round(num(v) * 100) / 100
  const neg = n < 0
  const abs = Math.abs(n)
  const entero = Math.floor(abs)
  let dec = Math.round((abs - entero) * 100)
  let decStr = String(dec).padStart(2, '0')
  while (decStr.length > 1 && decStr.endsWith('0')) decStr = decStr.slice(0, -1)
  return `${neg ? '-' : ''}${fmtDoc(entero)},${decStr}`
}
const fmtCant = (v) => fmtDecEs(num(v), 2)
const fmtPctD = (v) => (Math.round(num(v) * 10) / 10).toFixed(1)
const fmtPctC = (v) => fmtPctD(v).replace('.', ',')

const row = (label, value, strong = false) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #E3EEE7;color:#57705F;font-size:13px;">${esc(label)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #E3EEE7;text-align:right;font-size:13px;${strong ? 'font-weight:800;color:#0B3D2E;' : 'font-weight:600;color:#14231C;'}">${esc(value)}</td>
    </tr>`
const sectionCard = (title, inner) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 14px;"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #DDE8E1;border-radius:26px;padding:21px 22px;">
    <div style="font-size:18px;line-height:1.25;font-weight:800;color:#14231C;margin:0 0 12px;">${esc(title)}</div>
    ${inner}
  </td></tr></table>`
const subTitle = (t) => `<div style="font-size:15px;font-weight:800;color:#14231C;margin:14px 0 6px;">${esc(t)}</div>`
const para = (t) => `<p style="font-size:13px;line-height:1.55;color:#14231C;margin:0 0 8px;">${esc(t)}</p>`
const tableOf = (rowsHtml) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`
/* Barra de progreso del original: etiqueta y valor en una línea y
   la barra debajo, con su punto de color por departamento. */
const DEPT_BAR_COLORS = ['#0E9F6E', '#22B8CF', '#E9C46A', '#2A9D8F', '#E76F51', '#7C3AED', '#3B82F6', '#64748B']
const progressBar = (name, valueText, fillPct, color) => `
  <div style="margin:0 0 13px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:13px;font-weight:600;color:#14231C;padding:0 8px 4px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};margin-right:7px"></span>${esc(name)}</td>
      <td style="font-size:13px;font-weight:800;color:#0B3D2E;text-align:right;font-variant-numeric:tabular-nums;padding:0 0 4px;white-space:nowrap">${esc(valueText)}</td>
    </tr></table>
    <div style="background:#E5ECEE;border-radius:99px;height:10px;line-height:10px;font-size:0;"><div style="width:${Math.max(0, Math.min(100, num(fillPct))).toFixed(1)}%;background:${color};border-radius:99px;height:10px"></div></div>
  </div>`
const fundMeter = (label, rate, amount, baseLine, foot, pct, color) => `
  <div style="margin:0 0 16px;">
    <div style="font-size:13px;font-weight:800;color:#14231C;">${esc(label)} · ${esc(rate)}</div>
    <div style="font-size:25px;line-height:1.25;font-weight:800;color:${color};font-variant-numeric:tabular-nums;">${esc(amount)}</div>
    <div style="font-size:12px;line-height:1.5;color:#57705F;margin:2px 0 7px;">${esc(baseLine)}</div>
    <div style="height:12px;background:#E5ECEE;border-radius:999px;overflow:hidden;"><div style="height:12px;width:${Math.max(0, Math.min(100, num(pct))).toFixed(2)}%;background:${color};border-radius:999px"></div></div>
    <div style="font-size:11px;line-height:1.45;color:#57705F;margin-top:5px;">${esc(foot)}</div>
  </div>`

export function bulletinHtml(s, subject) {
  const f = s.fondos
  const e = s.economia
  const m = s.mes
  const fecha = fmtFechaDoc(s.date)
  const secs = []

  // — Economía —
  secs.push(sectionCard('Economía', `
    ${subTitle(`Resumen de ${monthLabelEs(s.monthKey)}`)}
    ${tableOf(`
      ${row('Venta bruta total', fmtDocCUP(m.ventas), true)}
      ${row('Ganancia bruta', `${fmtDocCUP(m.bruta)} · ${fmtPctD(e.brutaPct)}%`)}
      ${row('Ganancia neta', `${fmtDocCUP(m.neta)} · ${fmtPctD(e.netaPct)}%`)}
      ${row('Gastos operativos', `${fmtDocCUP(m.gastos)} · ${fmtPctD(e.gastosPctNeta)}% de la ganancia neta`)}
      ${row('Otros ingresos', fmtDocCUP(m.extras))}
      ${row('Billar del mes (venta de mesas)', fmtDocCUP(m.billar))}
      ${row('Venta en barra (bebidas y cantina)', fmtDocCUP(m.barra))}
      ${row('Venta en cocina (elaboración y pizzas)', fmtDocCUP(m.cocina))}
      ${row('Inversión del mes (entradas a precio de compra)', fmtDocCUP(m.inversion))}
      ${row('Merma del mes (costo registrado en el IPV)', fmtDocCUP(m.merma))}
      ${row('Total cobrado del mes (cuentas cobradas)', fmtDocCUP(m.totalCobrado))}
      ${row('Efectivo en caja (al cierre del último día del mes)', fmtDocCUP(m.efectivoCaja))}
      ${row('Zelle (al cierre del último día del mes)', fmtDocCUP(m.zelle))}
      ${row('Utilidad neta (resultado económico)', fmtDocCUP(m.resultado), true)}
    `)}
    ${subTitle('Datos verificables')}
    ${para('Este boletín no trae proyecciones ni estimaciones: cada cifra sale de un registro real —el IPV de su día, un gasto, una cuenta o una ficha guardada— y se puede rastrear hasta él. Lo que no tiene registro no aparece como cifra.')}
    ${subTitle('Rentabilidad por categoría')}
    ${e.rentabilidad.length ? tableOf(e.rentabilidad.map((r) => row(r.name, `${fmtDocCUP(r.ganancia)} · ${r.margen == null ? '—' : `${fmtPctC(r.margen)}%`}`)).join('')) : para('Sin categorías con ventas importadas en el mes.')}
    ${subTitle('Gastos por categoría')}
    ${e.gastosPorCategoria.length ? tableOf(e.gastosPorCategoria.map((g) => row(g.name, `${fmtDocCUP(g.total)} · ${fmtPctD(m.gastos > 0 ? (g.total / m.gastos) * 100 : 0)}%`)).join('')) : para('Sin gastos registrados en el mes hasta esta fecha.')}
    ${subTitle('Fondos acumulados')}
    ${fundMeter(`Ventas mensuales · ${monthLabelEs(s.monthKey)}`, '10%', fmtDocCUP(m.fondoVentas), `10% de ventas acumuladas: ${fmtDocCUP(m.ventas)}`, `${e.fondoVentasBase} · ${fmtPctD(m.fondoVentasProgreso)}% del período`, m.fondoVentasProgreso, '#0E9F6E')}
    ${fundMeter(`Utilidades trimestrales · ${e.trimestre.label}`, '15%', fmtDocCUP(m.fondoUtilidades), `15% de ganancia neta acumulada: ${fmtDocCUP(m.neta)}`, `${e.trimestre.importados} de ${e.trimestre.dias} días con IPV · ${fmtPctD(m.fondoUtilidadesProgreso)}% del período`, m.fondoUtilidadesProgreso, '#0EA5BD')}
    ${para('Las barras muestran los días con IPV dentro de cada período. Un día sin importar no se cuenta como cero. Todas las cifras son acumulados reales hasta esta fecha, sin proyecciones.')}
  `))

  // — Elaboración · rentabilidad y merma —
  {
    const el = s.elaboracion ?? { perdida: 0, bajoMeta: 0, rentables: 0, rows: [], merma: null }
    let inner = para(`${el.perdida} con pérdida · ${el.bajoMeta} bajo la meta · ${el.rentables} rentables. Comparación aproximada entre precio de venta vigente y costo por ración de la ficha.`)
    if (el.rows.length) {
      inner += tableOf(el.rows.slice(0, 20).map((r) => row(r.productName ?? r.nombre ?? '', `venta ${fmtDocCUP(r.salePrice ?? r.precioVenta)} · costo/ración ${fmtDocCUP(r.costPerServing ?? r.costoRacion)} · margen ${r.marginPct == null && r.margen == null ? '—' : `${fmtPctC(r.marginPct ?? r.margen)}%`}`)).join(''))
    } else {
      inner += para('Aún no hay fichas de costo guardadas.')
    }
    inner += para(el.merma ? String(el.merma) : 'Sin preparaciones con merma real registrada hasta esta fecha.')
    secs.push(sectionCard('Elaboración · rentabilidad y merma', inner))
  }

  // — Cierre del día —
  {
    const cuadreMal = Math.abs(num(s.cuadre)) > 0.5
    const cuadreTxt = cuadreMal ? `${s.cuadre < 0 ? '−' : '+'}${fmtDocCUP(Math.abs(num(s.cuadre)))} — cuadre ≠ 0 sin causa confirmada` : '0 CUP · cuadrado'
    secs.push(sectionCard(`Cierre del día (${fecha})`, `
    ${tableOf(`
      ${row('Ganancia bruta', fmtDocCUP(s.bruta))}
      ${row(`Gastos del día (${s.gastosDiaCount} registro${s.gastosDiaCount === 1 ? '' : 's'})`, fmtDocCUP(s.gastosDia))}
      ${(s.extrasDiaList ?? []).length ? row(`Otros ingresos del día: ${s.extrasDiaList.map((x) => `${x.concepto} ${fmtDocCUP(x.importe)}`).join(' · ')}`, `+${fmtDocCUP(s.extrasDia)}`) : ''}
      ${row('Inversión del día (entradas a precio de compra)', fmtDocCUP(s.inversionDia))}
      ${row('Resultado del día (neta − gastos + otros ingresos)', fmtDocCUP(s.resultadoDia), true)}
    `)}
    <div style="background:${cuadreMal ? '#FDECEA' : '#D6F0E2'};border:1px solid ${cuadreMal ? '#F3C6C0' : '#BDE8E4'};border-radius:18px;padding:12px 14px;margin-top:12px;">
      <span style="display:inline-block;background:${cuadreMal ? '#B3261E' : '#0E9F6E'};color:#FFFFFF;border-radius:999px;padding:4px 10px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Cuadre del día</span>
      <div style="font-size:18px;font-weight:800;color:${cuadreMal ? '#B3261E' : '#0B3D2E'};font-variant-numeric:tabular-nums;margin-top:6px;">${esc(cuadreTxt)}</div>
      <div style="font-size:12px;color:#57705F;margin-top:2px;">La diferencia no se ajusta ni se esconde en ningún total.</div>
    </div>`))
  }

  // — El día en barras (orden por venta, como el original) —
  {
    const byVenta = [...s.deptRows].sort((a, b) => b.venta - a.venta)
    const totalVentaPos = byVenta.reduce((sum, d) => sum + Math.max(0, d.venta), 0)
    const maxAbsGan = byVenta.reduce((mx, d) => Math.max(mx, Math.abs(d.ganancia)), 0)
    const FONDOS_COLORS = ['#0E9F6E', '#22B8CF', '#E9C46A', '#42D6FE']
    let inner = ''
    inner += subTitle(`Venta por departamento (${fecha})`)
    inner += byVenta.length && totalVentaPos > 0
      ? byVenta.map((d, i) => progressBar(d.name, `${fmtDocCUP(d.venta)} · ${fmtPctC(totalVentaPos > 0 ? (Math.max(0, d.venta) / totalVentaPos) * 100 : 0)}% de la venta del día`, totalVentaPos > 0 ? (Math.max(0, d.venta) / totalVentaPos) * 100 : 0, DEPT_BAR_COLORS[i % DEPT_BAR_COLORS.length])).join('')
      : para('Sin departamentos guardados ese día.')
    inner += subTitle(`Ganancia por departamento (${fecha})`)
    inner += byVenta.length && maxAbsGan > 0
      ? byVenta.map((d) => progressBar(d.name, `${fmtDocCUP(d.ganancia)} · ${d.venta > 0 ? `margen ${fmtPctC((d.ganancia / d.venta) * 100)}%` : 'sin venta ese día'}`, (Math.abs(d.ganancia) / maxAbsGan) * 100, d.ganancia < 0 ? '#B3261E' : '#0B7285')).join('') + para('El largo de cada barra va en proporción a la mayor ganancia del día; el porcentaje es el margen de ese departamento sobre su propia venta.')
      : para('Sin departamentos guardados ese día.')
    inner += subTitle(`Fondos al cierre (${fecha})`)
    inner += s.fondosBarras.length
      ? s.fondosBarras.map((b, i) => progressBar(b.label, `${fmtDocCUP(b.valor)} · ${fmtPctC(b.pct)}% de los fondos`, b.pct, FONDOS_COLORS[i % FONDOS_COLORS.length])).join('')
      : para('Sin composición de fondos guardada en el día de referencia: importa o reimporta ese IPV para verla aquí.')
    secs.push(sectionCard('El día en barras', inner))
  }

  // — Ventas por departamento (tabla, orden de departamentos) —
  if (s.deptRows.length) {
    const th = (t, align = 'left') => `<th style="text-align:${align};padding:6px;background:#D6F0E2;color:#0B3D2E;font-size:10px;letter-spacing:.06em;text-transform:uppercase;">${esc(t)}</th>`
    const td = (t, first = false) => `<td style="padding:7px 6px;border-top:1px solid #E3F0F0;${first ? 'font-weight:600;color:#14231C;' : 'font-variant-numeric:tabular-nums;'}">${esc(t)}</td>`
    secs.push(sectionCard(`Ventas por departamento (${fecha})`, `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;line-height:1.45;">
        <thead><tr>${th('Departamento')}${th('Venta')}${th('Ganancia')}</tr></thead>
        <tbody>${s.deptRows.map((d) => `<tr>${td(d.name, true)}${td(fmtDocCUP(d.venta))}${td(fmtDocCUP(d.ganancia))}</tr>`).join('')}</tbody>
      </table>`))
  }

  // — Billar del día —
  if (s.billarDia) {
    const b = s.billarDia
    const th = (t, align = 'left') => `<th style="text-align:${align};padding:6px;background:#D6F0E2;color:#0B3D2E;font-size:10px;letter-spacing:.06em;text-transform:uppercase;">${esc(t)}</th>`
    const td = (t, opts = {}) => `<td style="padding:7px 6px;border-top:1px solid #E3F0F0;${opts.right ? 'text-align:right;' : ''}${opts.strong ? 'font-weight:800;' : ''}font-variant-numeric:tabular-nums;">${esc(t)}</td>`
    secs.push(sectionCard(`Billar del día (${fecha})`, `
      <p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Billar — total de horas: ${fmtDoc(b.totalHoras)} · ${fmtDoc(b.horasDia)} h de día a ${fmtDocCUP(b.precioDia)} = ${fmtDocCUP(b.importeDia)} · ${fmtDoc(b.horasNoche)} h de noche a ${fmtDocCUP(b.precioNoche)} = ${fmtDocCUP(b.importeNoche)} · Total del día: ${fmtDocCUP(b.venta)} · Pago al encargado: ${fmtDocCUP(b.pagoEncargado)} · Utilidad del día: ${fmtDocCUP(b.utilidad)}.</strong></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;line-height:1.45;">
        <thead><tr>${th('Turno')}${th('Horas', 'right')}${th('Precio', 'right')}${th('Importe', 'right')}</tr></thead>
        <tbody>
          <tr>${td('Día')}${td(fmtDoc(b.horasDia), { right: true })}${td(fmtDocCUP(b.precioDia), { right: true })}${td(fmtDocCUP(b.importeDia), { right: true })}</tr>
          <tr>${td('Noche')}${td(fmtDoc(b.horasNoche), { right: true })}${td(fmtDocCUP(b.precioNoche), { right: true })}${td(fmtDocCUP(b.importeNoche), { right: true })}</tr>
          <tr style="background:#D6F0E2;">${td(`Total del día (${fmtDoc(b.totalHoras)} h)`, { strong: true })}<td colspan="2"></td>${td(fmtDocCUP(b.venta), { right: true, strong: true })}</tr>
        </tbody>
      </table>
      <p style="font-size:12.5px;margin:8px 0 0;">Pago al encargado de ese día: ${fmtDocCUP(b.pagoEncargado)} · Utilidad del billar del día: <strong>${fmtDocCUP(b.utilidad)}</strong>. En las barras y la tabla de departamentos el billar entra solo con este total del día.</p>`))
  }

  // — Lo más vendido (chips, como el original) —
  {
    const chipTop = (txt) => `<span style="display:inline-block;background:#D6F0E2;color:#0B3D2E;border-radius:999px;padding:5px 11px;font-size:11px;font-weight:700;margin:0 6px 6px 0;">${esc(txt)}</span>`
    secs.push(sectionCard('Lo más vendido del día', s.topProducts.length
      ? `<div>${s.topProducts.map((p) => chipTop(`«${p.name}» ${fmtDocCUP(p.importe)}`)).join('')}</div>`
      : para('Sin productos vendidos guardados ese día.')))
  }

  // — Desglose por denominación y Divisas —
  if (f) {
    const bil = (f.billetes ?? []).filter((b) => b.cantidad > 0)
    const mlc = (f.mlc ?? []).filter((x) => num(x.cantidad) !== 0 || num(x.conversionCup) !== 0)
    const mlcTxt = (x) => (num(x.denominacion) > 0
      ? `${fmtDoc(x.cantidad)} × ${fmtDoc(x.denominacion)} ${x.moneda} = ${fmtDocCUP(x.conversionCup)} (tasa ${fmtDoc(x.tasa)} CUP)`
      : `${fmtDoc(x.cantidad)} ${x.moneda} × ${fmtDoc(x.tasa)} CUP = ${fmtDocCUP(x.conversionCup)}`)
    let inner = ''
    if (f.arqueoGuardado === false && f.mlcGuardado === false) {
      inner = para('El desglose por denominación de ese día no quedó guardado, y la sección «Divisas» (USD/EUR) tampoco: reimporta ese IPV para verlos aquí.')
    } else {
      inner += bil.length
        ? `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>Billetes CUP:</strong> ${bil.map((b) => `${fmtDoc(b.cantidad)} × $${fmtDoc(b.denominacion)} = ${fmtDocCUP(b.subtotal)}`).join(' · ')}.<br><strong>Efectivo total contado: ${fmtDocCUP(f.efectivo)}.</strong></p>`
        : para('Sin billetes contados en el arqueo guardado de ese día.')
      inner += f.mlcGuardado === false
        ? para('La sección «Divisas» (USD/EUR) de ese IPV no quedó guardada; reimporta el IPV para verla aquí.')
        : mlc.length
          ? `<p style="font-size:12.5px;line-height:1.55;margin:0;"><strong>Divisas (USD/EUR):</strong> ${mlc.map(mlcTxt).join(' · ')}.<br><strong>Total Divisas convertido: ${fmtDocCUP(mlc.reduce((sum, x) => sum + num(x.conversionCup), 0))}.</strong></p>`
          : para('Sin divisas (USD/EUR) ese día.')
    }
    secs.push(sectionCard(`Desglose por denominación y Divisas (${fecha})`, inner))
  }

  // — Transferencias —
  {
    const t = s.transferencias
    const labelHtml = (d) => (d.source === 'manual' ? `abono manual${d.detalle ? `: ${d.detalle}` : ''}` : 'Desglose del IPV')
    let inner = `<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#57705F;">Acumulado por pasar al banco (estado al cierre)</div>
      <div style="font-size:24px;font-weight:800;color:#0B3D2E;font-variant-numeric:tabular-nums;line-height:1.25;">${fmtDocCUP(t.porPasar)}</div>`
    if (t.detalle.length || t.pases.amounts.length) {
      inner += `<p style="font-size:12.5px;line-height:1.55;margin:8px 0 0;">`
      if (t.detalle.length) inner += `<strong>Entraron por transferencias el ${esc(fecha)}:</strong> ${t.detalle.map((d) => `${fmtDocCUP(d.importe)} (${esc(labelHtml(d))})`).join(' · ')} — total ${fmtDocCUP(t.entraron)}.<br>`
      if (t.pases.amounts.length) inner += `<strong>Se pasó al banco el ${esc(fecha)}:</strong> ${t.pases.amounts.map((a) => fmtDocCUP(a)).join(' · ')} — total ${fmtDocCUP(t.pases.total)}.`
      inner += `</p>`
    } else {
      inner += para(`Sin transferencias ni pases al banco registrados el ${fecha}.`)
    }
    secs.push(sectionCard('Transferencias', inner))
  }

  // — Cuentas por cobrar —
  {
    const c = s.cobrar
    const lista = (items, conRef = false, conNueva = false) => items.map((x) => `«${esc(x.name)}» ${fmtDocCUP(x.saldo)}${conRef && x.ref ? ` (referencia: ${esc(x.ref)})` : ''}${conNueva && x.nuevaHoy ? ' (nueva hoy)' : ''}`).join(' · ')
    let inner = ''
    for (const g of c.grupos) {
      inner += `<p style="font-size:12.5px;line-height:1.55;margin:0 0 8px;"><strong>${esc(g.label)} — ${fmtDocCUP(g.total)} (${g.count} cuenta${g.count === 1 ? '' : 's'}):</strong> ${g.count ? lista(g.items) : 'sin pendientes'}.</p>`
    }
    inner += c.registroGeneral.count
      ? `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>Cuentas por cobrar pendientes — registro general (acumuladas al cierre):</strong> ${lista(c.registroGeneral.items, false, true)}.<br><strong>Subtotal registro general: ${fmtDocCUP(c.registroGeneral.total)} (${c.registroGeneral.count} cuentas; IPV ${fmtDocCUP(c.registroGeneral.ipv)} + manuales ${fmtDocCUP(c.registroGeneral.manuales)}).</strong></p>`
      : para('Sin cuentas por cobrar pendientes del registro general al cierre de ese día.')
    for (const p of c.casa) {
      inner += p.count
        ? `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>${esc(p.label)} — consumo de la casa (acumuladas al cierre):</strong> ${lista(p.items, true, true)}.<br><strong>Total ${esc(p.label)}: ${fmtDocCUP(p.total)} (${p.count} cuentas).</strong></p>`
        : `<p style="font-size:12.5px;margin:0 0 6px;">${esc(p.label)} (consumo de la casa): sin pendientes al cierre de ese día. Total: 0 CUP.</p>`
    }
    const trab = c.grupos.find((g) => g.label === 'Trabajadores')
    const adm = c.grupos.find((g) => g.label === 'Administrativo')
    inner += `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>Dinero en la calle: ${fmtDocCUP(s.dineroEnLaCalle)}</strong> — Clientes en Cobrar: ${fmtDocCUP(s.calleEnCobrar)} · Clientes en morosas: ${fmtDocCUP(s.calleMorosas)}. Trabajadores (${fmtDocCUP(trab?.total ?? 0)}) y Administrativo (${fmtDocCUP(adm?.total ?? 0)}) se muestran en su desglose, pero no se suman a dinero en la calle.</p>`
    inner += c.nuevasHoy.length
      ? `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>Nuevas de hoy (${c.nuevasHoy.length}):</strong> ${c.nuevasHoy.map((x) => `«${esc(x.name)}» ${fmtDocCUP(x.saldo)} (${x.registro === 'aparte' ? 'registro aparte' : 'registro general'}, ${x.origin === 'ipv' ? 'del IPV' : 'manual'})`).join(' · ')}. Entran en la lista acumulada y quedan ahí hasta que se paguen.</p>`
      : para('Sin cuentas nuevas ese día.')
    inner += para(c.pagadasHoy.hay
      ? `Cobrado el día — registro general: ${fmtDocCUP(c.pagadasHoy.generalTotal)} (${c.pagadasHoy.generalCount}); pestañas de la casa: ${fmtDocCUP(c.pagadasHoy.casaTotal)} (${c.pagadasHoy.casaCount}).`
      : `Sin cuentas marcadas como pagadas el ${fecha}. Cobrado el día — registro general: 0 CUP (0); pestañas de la casa: 0 CUP (0).`)
    if (c.salidasCaja.count) {
      inner += `<p style="font-size:12.5px;line-height:1.55;margin:6px 0 0;"><strong>Salidas de caja detectadas en «Cuentas» del IPV de ese día:</strong> ${c.salidasCaja.count} entrada${c.salidasCaja.count === 1 ? '' : 's'} · ${fmtDocCUP(c.salidasCaja.total)} el ${esc(fecha)}. Ya están dentro de «Gastos del día» (restan en el Resultado); no son deudas ni suman en la calle.</p>`
    }
    secs.push(sectionCard('Cuentas por cobrar', inner))
  }

  // — Entradas del día (tabla del original) —
  if (s.entradas.length) {
    const th = (t) => `<th style="text-align:left;padding:4px 6px;color:#57705F;">${esc(t)}</th>`
    const td = (t, strong = false) => `<td style="padding:5px 6px;border-top:1px solid #E3F0F0;${strong ? 'font-weight:600;' : ''}">${esc(t)}</td>`
    secs.push(sectionCard(`Entradas del ${fecha}`, `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11.5px;line-height:1.4;">
        <thead><tr>${th('Departamento')}${th('Producto')}${th('Cantidad')}${th('P. compra')}${th('Imp. compra')}${th('P. venta')}${th('Imp. venta')}${th('Ganancia')}</tr></thead>
        <tbody>${s.entradas.map((e2) => `<tr>${td(e2.dept)}${td(e2.descripcion, true)}${td(`${fmtCant(e2.cantidad)}${e2.um ? ` ${e2.um}` : ''}`)}${td(fmtDocCUP(e2.precioCompra))}${td(fmtDocCUP(e2.importe))}${td(fmtDocCUP(e2.precioVenta))}${td(fmtDocCUP(e2.importeVenta))}${td(fmtDocCUP(e2.ganancia))}</tr>`).join('')}</tbody>
      </table>
      <p style="font-size:12.5px;margin:8px 0 0;"><strong>Total de inversión del día: ${fmtDocCUP(s.entradasTotales.inversion)} · Total de ganancia potencial: ${fmtDocCUP(s.entradasTotales.gananciaPotencial)}</strong> (venta potencial ${fmtDocCUP(s.entradasTotales.ventaPotencial)}).</p>`))
  }

  // — Existencias con descuadre —
  {
    const xd = s.existenciasDescuadre
    if (xd && xd.hayProductos) {
      const fmtInv = (v) => fmtCant(v)
      const inner = xd.count > 0
        ? `<p style="font-size:13px;line-height:1.55;margin:0 0 4px;"><strong>Existencias con descuadre: ${xd.count}</strong> (saldo final esperado contra saldo final contado, hasta el ${esc(fecha)}).</p>`
          + xd.items.map((d) => `<p style="font-size:12.5px;line-height:1.55;margin:0 0 3px;">⚠ «${esc(d.name)}» (${esc(d.dept)}${d.um ? `, ${esc(d.um)}` : ''}): saldo final esperado ${fmtInv(d.esperado)}, contado ${fmtInv(d.contado)} — ${d.diferencia < 0 ? 'faltan' : 'sobran'} ${fmtInv(Math.abs(d.diferencia))}</p>`).join('')
          + `<p style="font-size:12px;color:#57705F;margin:4px 0 0;">La diferencia se muestra hasta explicarla: baja, traslado, corrección del saldo inicial o reimportar el día (en «Productos» o en «Sugerencias» de Queen).</p>`
        : `<p style="font-size:13px;margin:0;">Existencias con descuadre: 0 — el saldo final esperado coincide con el contado y cada saldo inicial abre como cerró ayer.</p>`
      secs.push(sectionCard('Existencias con descuadre', inner))
    }
  }

  // — Saldo final al cierre —
  if (s.saldoCierre.length) {
    let inner = ''
    for (const d of s.saldoCierre) {
      if (d.conExistencia.length) inner += `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>${esc(d.dept)}:</strong> ${d.conExistencia.map((p) => `${esc(p.name)}: ${fmtCant(p.cantidad)}${p.um ? ` ${esc(p.um)}` : ''} (${esc(p.fuente)})`).join(' · ')}</p>`
      if (d.agotados) inner += `<p style="font-size:12.5px;line-height:1.55;margin:0 0 6px;"><strong>${esc(d.dept)}:</strong> ${d.agotados} producto${d.agotados === 1 ? '' : 's'} en 0 (agotados hoy).</p>`
    }
    inner += `<p style="font-size:12.5px;margin:6px 0 0;"><strong>Total agotados hoy: ${fmtDoc(s.totalAgotados)}.</strong></p>`
    secs.push(sectionCard(`Saldo final al cierre (${fecha})`, inner))
  }

  // — Trabajadores y Recursos Humanos —
  {
    let inner = ''
    if (s.rh.valorDia.length) {
      const th = (t, align = 'left') => `<th style="text-align:${align};padding:6px;color:#42636B;">${esc(t)}</th>`
      const tdN = (t, opts = {}) => `<td style="padding:7px 6px;border-top:1px solid #CBE7E8;${opts.right ? 'text-align:right;' : ''}${opts.strong ? 'font-weight:800;' : ''}font-variant-numeric:tabular-nums;">${esc(t)}</td>`
      inner += `<div style="background:#E7F6F7;border-radius:18px;padding:14px 15px;margin:0 0 16px;">
        <div style="font-size:16px;font-weight:800;color:#0B3D2E;margin:0 0 8px;">Valor del día de los trabajadores · ${esc(fecha)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;line-height:1.45;">
          <thead><tr>${th('Trabajador')}${th('Jornada', 'right')}${th('Valor/día', 'right')}${th('Importe del día', 'right')}</tr></thead>
          <tbody>${s.rh.valorDia.map((r) => `<tr><td style="padding:7px 6px;border-top:1px solid #CBE7E8;font-weight:700;color:#14231C;">${esc(r.nombre)}${r.ocupacion ? `<div style="font-size:10.5px;font-weight:400;color:#57705F;">${esc(r.ocupacion)}</div>` : ''}</td>${tdN(fmtCant(r.jornada), { right: true })}${tdN(`${fmtRH(r.valorDia)} CUP`, { right: true })}${tdN(`${fmtRH(r.importe)} CUP`, { right: true, strong: true })}</tr>`).join('')}</tbody>
        </table>
        <div style="font-size:17px;font-weight:800;color:#0B3D2E;text-align:right;margin-top:10px;">Total del día: ${fmtRH(s.rh.valorDiaTotal)} CUP</div>
      </div>`
    }
    if (s.rh.hayFoto) {
      const th = (t, align = 'right') => `<th style="text-align:${align};padding:7px 6px;background:#EFF5F6;color:#42636B;font-size:10.5px;">${esc(t)}</th>`
      const tdN = (t, opts = {}) => `<td style="padding:7px 6px;border-top:1px solid #E3ECEF;text-align:right;font-variant-numeric:tabular-nums;${opts.strong ? 'font-weight:700;' : ''}">${esc(t)}</td>`
      inner += `<div style="font-size:16px;font-weight:800;color:#14231C;margin:0 0 5px;">Acumulado de la quincena</div>
      <p style="font-size:12.5px;line-height:1.55;margin:0 0 8px;color:#42636B;">Foto del ${esc(fmtFechaDoc(s.rh.foto ?? s.date))} · Ciclo ${esc(fmtFechaDoc(s.rh.cicloStart))} — ${esc(fmtFechaDoc(s.rh.cicloEnd))} · faltan ${fmtDoc(s.rh.faltan)} día${s.rh.faltan === 1 ? '' : 's'} para cerrar · pago el <strong>${esc(fmtFechaDoc(s.rh.pago))}</strong>. Valor del día = salario quincenal ÷ días previstos para esa persona; el acumulado usa la precisión completa y se redondea al CUP al multiplicarlo por sus días realmente trabajados.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;line-height:1.45;">
        <thead><tr>${th('Trabajador', 'left')}${th('Días trabajados')}${th('Días previstos')}${th('Salario quincenal')}${th('Valor/día')}${th('Acumulado')}</tr></thead>
        <tbody>${s.rh.empleados.map((emp) => `<tr><td style="padding:7px 6px;border-top:1px solid #E3ECEF;font-weight:600;color:#14231C;">${esc(emp.nombre)}${emp.ocupacion ? `<div style="font-size:10.5px;font-weight:400;color:#57705F;">${esc(emp.ocupacion)}</div>` : ''}</td>${tdN(fmtDoc(emp.dias))}${tdN(fmtDoc(emp.diasEsperados))}${tdN(`${fmtRH(emp.salarioQuincenal)} CUP`)}${tdN(`${fmtRH(emp.valorDia)} CUP`)}${tdN(fmtDocCUP(emp.acumulado), { strong: true })}</tr>`).join('')}</tbody>
      </table>
      <p style="font-size:13px;margin:10px 0 0;"><strong>TOTAL ACUMULADO DE RH: ${fmtDocCUP(s.rh.total)}</strong> (${s.rh.empleados.length} trabajadores en la foto).</p>`
    } else if (!s.rh.valorDia.length) {
      inner += para(`Sin foto RH del ciclo en curso todavía. Ciclo ${fmtFechaDoc(s.rh.cicloStart)} — ${fmtFechaDoc(s.rh.cicloEnd)}; próximo pago el ${fmtFechaDoc(s.rh.pago)}.`)
    }
    secs.push(sectionCard('Trabajadores y Recursos Humanos', inner))
  }

  // — Avisos de Queen (tarjeta amarilla, siempre presente) —
  secs.push(`
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 14px;"><tr><td bgcolor="#FFF4D6" style="background:#FFF4D6;border:1px solid #F0D78B;border-radius:26px;padding:21px 22px;">
    <div style="font-size:18px;line-height:1.25;font-weight:800;color:#604A00;margin:0 0 10px;">Avisos de Queen</div>
    ${s.avisos.length ? `<ul style="font-size:13px;line-height:1.55;margin:0;padding-left:18px;color:#14231C;">${s.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : `<p style="font-size:13px;margin:0;color:#14231C;">Sin avisos detectados en los datos de ese día.</p>`}
  </td></tr></table>`)

  const chip = (txt) => `<span class="blt-chip" style="display:inline-block;background:#D6F0E2;color:#0B3D2E;border-radius:999px;padding:5px 11px;font-size:11px;font-weight:700;margin:0 6px 6px 0;">${esc(txt)}</span>`
  const kpiCell = (label, value, small = false) => `<td width="50%" style="width:50%;padding:5px" valign="top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #DDE8E1;border-radius:24px;padding:16px 17px;"><div style="font-size:12px;font-weight:700;color:#57705F;margin-bottom:3px;">${esc(label)}</div><div style="font-size:${small ? '16px' : '22px'};font-weight:800;color:#0B3D2E;font-variant-numeric:tabular-nums;line-height:1.25;">${esc(value)}</div></td></tr></table></td>`
  const kpiGrid = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 9px;">
    <tr>${kpiCell('Venta del día', fmtDocCUP(s.venta))}${kpiCell('Ganancia neta del día', fmtDocCUP(s.neta))}</tr>
    <tr>${kpiCell('Dinero en la calle', `${fmtDocCUP(s.dineroEnLaCalle)} (Clientes en Cobrar ${fmtDocCUP(s.calleEnCobrar)} + Clientes en morosas ${fmtDocCUP(s.calleMorosas)}; las cuentas de trabajadores y administrativas no se cuentan)`, true)}${kpiCell('RH acumulado', s.rh.hayFoto ? `${fmtDocCUP(s.rh.total)} · pago ${fmtFechaDoc(s.rh.pago)}` : `Sin foto · pago ${fmtFechaDoc(s.rh.pago)}`, true)}</tr>
  </table>`

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .blt-page { background-color:#0A1411 !important; }
    .blt-hdr { background:#0B3D2E !important; border-color:#0B3D2E !important; }
    .blt-kicker { color:#BFE3CE !important; }
    .blt-title { color:#FFFFFF !important; }
    .blt-date { color:#FFFFFF !important; }
    .blt-line { color:#D6F0E2 !important; }
    .blt-hdr .blt-chip { background:#145C40 !important; color:#D6F0E2 !important; }
  }
</style></head>
<body class="blt-page" style="margin:0;padding:0;background:#F2F7F4;background-image:${DOC_AURORA.css};font-family:'SamsungOne',Roboto,'Segoe UI',Arial,Helvetica,sans-serif;color:#14231C;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F2F7F4" class="blt-page" style="background:#F2F7F4;background-image:${DOC_AURORA.css};"><tr><td align="center" style="padding:18px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;"><tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0;"><tr><td class="blt-hdr" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #DDE8E1;border-radius:30px;padding:28px;">
    <div class="blt-kicker" style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#0B6B4A;">${esc(DOC_STYLE.systemName)}</div>
    <h1 class="blt-title" style="margin:7px 0;font-size:30px;line-height:1.12;font-weight:800;letter-spacing:-.02em;color:#0B3D2E;">Boletín diario</h1>
    <div class="blt-date" style="font-size:18px;line-height:1.3;font-weight:700;margin:0 0 10px;color:#14231C;">${esc(fecha)}</div>
    <p class="blt-line" style="font-size:13.5px;line-height:1.55;color:#42604D;margin:0 0 13px;">${esc(s.ipvLine)}</p>
    <div>${chip('IPV del día importado')}${chip('Solo la información de este día')}</div>
    <div style="height:4px;border-radius:99px;background:linear-gradient(90deg,#16A34A 0%,#0EA5BD 62%,#C9A227 100%);margin-top:12px;"></div>
  </td></tr></table>
  <div style="padding-top:14px;">
  ${kpiGrid}
  ${secs.join('')}
  <p style="font-size:11px;line-height:1.5;color:#57705F;text-align:center;margin:4px 0 0;">Generado desde ${esc(DOC_STYLE.systemName)} · Adjunto: PDF del día ${esc(s.pdfFilename)} con el detalle completo de este día. Este boletín trae la información de su día, el estado acumulado de las cuentas, el resumen actualizado de Economía y la rentabilidad y merma registradas en Elaboración.</p>
  </div>
</td></tr></table>
</td></tr></table>
</body></html>`
}

export function bulletinText(s) {
  const L = []
  const e = s.economia
  const m = s.mes
  const f = s.fondos
  const fecha = fmtFechaDoc(s.date)
  L.push(`${DOC_STYLE.systemName} · Boletín diario — ${fecha}`)
  L.push(s.ipvLine)
  L.push(`Día de referencia: ${fecha}.`)
  L.push(`Venta del día: ${fmtDocCUP(s.venta)}; ganancia bruta: ${fmtDocCUP(s.bruta)}; ganancia neta: ${fmtDocCUP(s.neta)}; gastos del día: ${fmtDocCUP(s.gastosDia)}; otros ingresos del día: ${fmtDocCUP(s.extrasDia)}${(s.extrasDiaList ?? []).length ? ` (${s.extrasDiaList.map((x) => `${x.concepto} ${fmtDocCUP(x.importe)}`).join('; ')})` : ''}; resultado del día (neta − gastos + otros ingresos): ${fmtDocCUP(s.resultadoDia)}; inversión del día: ${fmtDocCUP(s.inversionDia)}; Dinero en la calle: ${fmtDocCUP(s.dineroEnLaCalle)} (Clientes en Cobrar ${fmtDocCUP(s.calleEnCobrar)} + Clientes en morosas ${fmtDocCUP(s.calleMorosas)}; las cuentas de trabajadores y administrativas no se cuentan).`)
  L.push(`Economía — resumen de ${monthLabelEs(s.monthKey)}: venta bruta total ${fmtDocCUP(m.ventas)}; ganancia bruta ${fmtDocCUP(m.bruta)} (${fmtPctD(e.brutaPct)}%); ganancia neta ${fmtDocCUP(m.neta)} (${fmtPctD(e.netaPct)}%); gastos ${fmtDocCUP(m.gastos)} (${fmtPctD(e.gastosPctNeta)}% de la ganancia neta); ingresos extras ${fmtDocCUP(m.extras)}; utilidad neta (resultado económico) ${fmtDocCUP(m.resultado)}; billar del mes ${fmtDocCUP(m.billar)}; venta en barra ${fmtDocCUP(m.barra)}; venta en cocina ${fmtDocCUP(m.cocina)}; inversión del mes ${fmtDocCUP(m.inversion)}; merma del mes ${fmtDocCUP(m.merma)}; total cobrado del mes ${fmtDocCUP(m.totalCobrado)}; efectivo en caja al cierre del último día del mes ${fmtDocCUP(m.efectivoCaja)}; zelle al cierre ${fmtDocCUP(m.zelle)}.`)
  L.push('Sin proyecciones ni estimaciones: cada cifra sale de un registro real (IPV, gasto, cuenta o ficha guardada); lo que no tiene registro no aparece como cifra.')
  if (e.rentabilidad.length) L.push(`Rentabilidad por categoría: ${e.rentabilidad.map((r) => `${r.name}: ganancia ${fmtDocCUP(r.ganancia)}, margen ${r.margen == null ? '—' : `${fmtPctD(r.margen)}%`}`).join('; ')}.`)
  if (e.gastosPorCategoria.length) L.push(`Gastos por categoría: ${e.gastosPorCategoria.map((g) => `${g.name} ${fmtDocCUP(g.total)} (${fmtPctD(m.gastos > 0 ? (g.total / m.gastos) * 100 : 0)}%)`).join('; ')}.`)
  L.push(`Economía — ${monthLabelEs(s.monthKey)}: 10% de las ventas mensuales = ${fmtDocCUP(m.fondoVentas)} sobre ventas acumuladas de ${fmtDocCUP(m.ventas)}. Avance: ${e.fondoVentasBase} (${fmtPctD(m.fondoVentasProgreso)}%).`)
  L.push(`Economía — trimestre ${e.trimestre.label}: 15% de la ganancia neta = ${fmtDocCUP(m.fondoUtilidades)} sobre ganancia neta acumulada de ${fmtDocCUP(m.neta)}. Avance: ${e.trimestre.importados} de ${e.trimestre.dias} días con IPV (${fmtPctD(m.fondoUtilidadesProgreso)}%).`)
  L.push('Los días sin IPV no se cuentan como cero.')
  {
    const el = s.elaboracion ?? { perdida: 0, bajoMeta: 0, rentables: 0, rows: [], merma: null }
    L.push(el.rows.length
      ? `Elaboración — rentabilidad aproximada: ${el.perdida} con pérdida; ${el.bajoMeta} bajo la meta; ${el.rentables} rentables.`
      : 'Elaboración: aún no hay fichas de costo guardadas; no se inventaron cifras.')
  }
  L.push('Cierre del día:')
  L.push(`Ganancia bruta: ${fmtDocCUP(s.bruta)}.`)
  L.push(`Gastos del día (${s.gastosDiaCount} registros): ${fmtDocCUP(s.gastosDia)}.`)
  if ((s.extrasDiaList ?? []).length) L.push(`Otros ingresos del día: ${s.extrasDiaList.map((x) => `${x.concepto} ${fmtDocCUP(x.importe)}`).join('; ')}.`)
  L.push(`Inversión del día (entradas a precio de compra): ${fmtDocCUP(s.inversionDia)}.`)
  L.push(`Resultado del día (neta − gastos + otros ingresos): ${fmtDocCUP(s.resultadoDia)}.`)
  L.push(Math.abs(num(s.cuadre)) > 0.5
    ? `Cuadre: ${s.cuadre < 0 ? '−' : '+'}${fmtDocCUP(Math.abs(num(s.cuadre)))} — cuadre ≠ 0 sin causa confirmada. La diferencia no se ajusta ni se esconde en ningún total.`
    : 'Cuadre: 0 CUP. La diferencia no se ajusta ni se esconde en ningún total.')
  L.push('Ventas por departamento:')
  if (s.deptRows.length) for (const d of s.deptRows) L.push(`- ${d.name}: venta ${fmtDocCUP(d.venta)}, ganancia ${fmtDocCUP(d.ganancia)}.`)
  else L.push('Sin departamentos guardados ese día.')
  if (s.billarDia) {
    const b = s.billarDia
    L.push(`Billar del día (${fecha}):`)
    L.push(`Billar — total de horas: ${fmtDoc(b.totalHoras)} · ${fmtDoc(b.horasDia)} h de día a ${fmtDocCUP(b.precioDia)} = ${fmtDocCUP(b.importeDia)} · ${fmtDoc(b.horasNoche)} h de noche a ${fmtDocCUP(b.precioNoche)} = ${fmtDocCUP(b.importeNoche)} · Total del día: ${fmtDocCUP(b.venta)} · Pago al encargado: ${fmtDocCUP(b.pagoEncargado)} · Utilidad del día: ${fmtDocCUP(b.utilidad)}.`)
  }
  L.push(`Lo más vendido del día: ${s.topProducts.length ? s.topProducts.map((p) => `«${p.name}» ${fmtDocCUP(p.importe)}`).join('; ') : 'sin productos vendidos guardados ese día'}.`)
  if (f) {
    const bil = (f.billetes ?? []).filter((b) => b.cantidad > 0)
    const mlc = (f.mlc ?? []).filter((x) => num(x.cantidad) !== 0 || num(x.conversionCup) !== 0)
    L.push(`Desglose por denominación y Divisas (${fecha}):`)
    if (f.arqueoGuardado === false && f.mlcGuardado === false) {
      L.push('El desglose por denominación de ese día no quedó guardado, y la sección Divisas (USD/EUR) tampoco: reimporta ese IPV para verlos aquí.')
    } else {
      L.push(bil.length ? `Billetes CUP: ${bil.map((b) => `${fmtDoc(b.cantidad)} × $${fmtDoc(b.denominacion)} = ${fmtDocCUP(b.subtotal)}`).join('; ')}. Efectivo total contado: ${fmtDocCUP(f.efectivo)}.` : 'Sin billetes contados en el arqueo guardado de ese día.')
      if (f.mlcGuardado === false) L.push('La sección «Divisas» (USD/EUR) de ese IPV no quedó guardada; reimporta el IPV para verla aquí.')
      else if (!mlc.length) L.push('Sin divisas (USD/EUR) ese día.')
      else L.push(`Divisas (USD/EUR): ${mlc.map((x) => (num(x.denominacion) > 0 ? `${fmtDoc(x.cantidad)} × ${fmtDoc(x.denominacion)} ${x.moneda} (tasa ${fmtDoc(x.tasa)} CUP) = ${fmtDocCUP(x.conversionCup)}` : `${fmtDoc(x.cantidad)} ${x.moneda} × ${fmtDoc(x.tasa)} CUP = ${fmtDocCUP(x.conversionCup)}`)).join('; ')}. Total Divisas convertido: ${fmtDocCUP(mlc.reduce((sum, x) => sum + num(x.conversionCup), 0))}.`)
    }
  }
  {
    const t = s.transferencias
    const labelTxt = (d) => (d.source === 'manual' ? 'manual' : 'del Desglose del IPV')
    const partes = []
    if (t.detalle.length) partes.push(`entraron ${fmtDocCUP(t.entraron)} (${t.detalle.map((d) => `${fmtDocCUP(d.importe)} ${labelTxt(d)}`).join('; ')})`)
    if (t.pases.amounts.length) partes.push(`se pasó al banco ${fmtDocCUP(t.pases.total)}`)
    L.push(`Transferencias del ${fecha}: ${partes.length ? partes.join('; ') : 'sin movimientos registrados ese día'}. Acumulado por pasar al banco (estado al cierre): ${fmtDocCUP(t.porPasar)}.`)
  }
  {
    const c = s.cobrar
    L.push('Cuentas por cobrar:')
    const lista = (items, conRef = false, conNueva = false) => items.map((x) => `«${x.name}» ${fmtDocCUP(x.saldo)}${conRef && x.ref ? ` (referencia: ${x.ref})` : ''}${conNueva && x.nuevaHoy ? ' (nueva hoy)' : ''}`).join('; ')
    for (const g of c.grupos) L.push(`${g.label} — ${fmtDocCUP(g.total)} (${g.count} cuentas): ${g.count ? lista(g.items) : 'sin pendientes'}.`)
    L.push(c.registroGeneral.count
      ? `Cuentas por cobrar pendientes — registro general (acumuladas al cierre): ${lista(c.registroGeneral.items, false, true)}. Subtotal registro general: ${fmtDocCUP(c.registroGeneral.total)} (${c.registroGeneral.count} cuentas; IPV ${fmtDocCUP(c.registroGeneral.ipv)} + manuales ${fmtDocCUP(c.registroGeneral.manuales)}).`
      : 'Sin cuentas por cobrar pendientes del registro general al cierre de ese día.')
    for (const p of c.casa) L.push(p.count
      ? `${p.label} — consumo de la casa (acumuladas al cierre): ${lista(p.items, true, true)}. Total ${p.label}: ${fmtDocCUP(p.total)} (${p.count} cuentas).`
      : `${p.label} (consumo de la casa): sin pendientes al cierre de ese día. Total: 0 CUP.`)
    L.push(`Dinero en la calle: ${fmtDocCUP(s.dineroEnLaCalle)} — Clientes en Cobrar: ${fmtDocCUP(s.calleEnCobrar)} · Clientes en morosas: ${fmtDocCUP(s.calleMorosas)}. Las cuentas de trabajadores y administrativas no se cuentan.`)
    L.push(c.nuevasHoy.length
      ? `Nuevas de hoy (${c.nuevasHoy.length}): ${c.nuevasHoy.map((x) => `«${x.name}» ${fmtDocCUP(x.saldo)} (${x.registro === 'aparte' ? 'registro aparte' : 'registro general'}, ${x.origin === 'ipv' ? 'del IPV' : 'manual'})`).join('; ')}. Entran en la lista acumulada y quedan ahí hasta que se paguen.`
      : 'Sin cuentas nuevas ese día.')
    L.push(c.pagadasHoy.hay
      ? `Cobrado el día — registro general: ${fmtDocCUP(c.pagadasHoy.generalTotal)} (${c.pagadasHoy.generalCount}); pestañas de la casa: ${fmtDocCUP(c.pagadasHoy.casaTotal)} (${c.pagadasHoy.casaCount}).`
      : `Sin cuentas marcadas como pagadas el ${fecha}. Cobrado el día — registro general: 0 CUP (0); pestañas de la casa: 0 CUP (0).`)
    if (c.salidasCaja.count) L.push(`Salidas de caja detectadas en «Cuentas» del IPV de ese día: ${c.salidasCaja.count} entradas · ${fmtDocCUP(c.salidasCaja.total)} el ${fecha}. Ya están dentro de Gastos del día (restan en el Resultado); no son deudas ni suman en la calle.`)
  }
  if (s.entradas.length) {
    L.push(`Entradas del ${fecha}:`)
    for (const e2 of s.entradas) L.push(`- ${e2.dept} · ${e2.descripcion}: ${fmtCant(e2.cantidad)}${e2.um ? ` ${e2.um}` : ''}; compra ${fmtDocCUP(e2.precioCompra)} (inversión ${fmtDocCUP(e2.importe)}); venta ${fmtDocCUP(e2.precioVenta)} (importe ${fmtDocCUP(e2.importeVenta)}); ganancia ${fmtDocCUP(e2.ganancia)}.`)
    L.push(`Total de inversión del día: ${fmtDocCUP(s.entradasTotales.inversion)} · Total de ganancia potencial: ${fmtDocCUP(s.entradasTotales.gananciaPotencial)} (venta potencial ${fmtDocCUP(s.entradasTotales.ventaPotencial)}).`)
  }
  {
    const xd = s.existenciasDescuadre
    if (xd && xd.hayProductos) {
      if (xd.count > 0) {
        L.push(`Existencias con descuadre: ${xd.count}.`)
        for (const d of xd.items) L.push(`- «${d.name}» (${d.dept}${d.um ? `, ${d.um}` : ''}): saldo final esperado ${fmtCant(d.esperado)}, contado ${fmtCant(d.contado)} — ${d.diferencia < 0 ? 'faltan' : 'sobran'} ${fmtCant(Math.abs(d.diferencia))}`)
        L.push('La diferencia se muestra hasta explicarla (baja, traslado, corrección del saldo inicial o reimportar el día).')
      } else {
        L.push('Existencias con descuadre: 0.')
      }
    }
  }
  if (s.saldoCierre.length) {
    L.push(`Saldo final al cierre (${fecha}):`)
    for (const d of s.saldoCierre) {
      if (d.conExistencia.length) L.push(`${d.dept}: ${d.conExistencia.map((p) => `${p.name}: ${fmtCant(p.cantidad)}${p.um ? ` ${p.um}` : ''} (${p.fuente})`).join('; ')}.`)
      if (d.agotados) L.push(`${d.dept}: ${d.agotados} producto${d.agotados === 1 ? '' : 's'} en 0 (agotados hoy).`)
    }
    L.push(`Total agotados hoy: ${fmtDoc(s.totalAgotados)}.`)
  }
  if (s.rh.hayFoto || s.rh.valorDia.length) {
    if (s.rh.valorDia.length) {
      L.push(`Valor del día de los trabajadores — ${fecha}:`)
      for (const r of s.rh.valorDia) L.push(`- ${r.nombre}: jornada ${fmtCant(r.jornada)} × ${fmtRH(r.valorDia)} CUP = ${fmtRH(r.importe)} CUP.`)
      L.push(`TOTAL DEL DÍA DE LOS TRABAJADORES: ${fmtRH(s.rh.valorDiaTotal)} CUP.`)
    }
    if (s.rh.hayFoto) {
      L.push(`Acumulado de la quincena — Foto del ${fmtFechaDoc(s.rh.foto ?? s.date)} · Ciclo ${fmtFechaDoc(s.rh.cicloStart)} — ${fmtFechaDoc(s.rh.cicloEnd)} · faltan ${fmtDoc(s.rh.faltan)} días para cerrar · pago el ${fmtFechaDoc(s.rh.pago)}. Valor del día = salario quincenal ÷ días previstos para esa persona; el acumulado usa la precisión completa y se redondea al CUP al multiplicarlo por sus días realmente trabajados:`)
      for (const emp of s.rh.empleados) L.push(`- ${emp.nombre} (${emp.ocupacion || '—'}): salario quincenal ${fmtRH(emp.salarioQuincenal)} CUP ÷ ${fmtDoc(emp.diasEsperados)} días previstos = ${fmtRH(emp.valorDia)} CUP por día; ${fmtDoc(emp.dias)} días trabajados × ${fmtRH(emp.valorDia)} CUP = ${fmtDoc(emp.acumulado)} CUP acumulados.`)
      L.push(`TOTAL ACUMULADO DE RH: ${fmtDocCUP(s.rh.total)} (${s.rh.empleados.length} trabajadores en la foto).`)
    } else {
      L.push(`Recursos Humanos: sin foto RH del ciclo en curso todavía. Ciclo ${fmtFechaDoc(s.rh.cicloStart)} — ${fmtFechaDoc(s.rh.cicloEnd)}; próximo pago el ${fmtFechaDoc(s.rh.pago)}.`)
    }
  }
  L.push(s.avisos.length ? `Avisos de Queen: ${s.avisos.join(' ')}` : 'Avisos de Queen: ninguno en los datos de ese día.')
  return L.join('\n')
}

/* ============ PDF del día (adjunto del boletín) ============
   El PDF «contabilidad-AAAA-MM-DD.pdf» del original se genera en
   su servidor desde los mismos datos. Aquí: escritor PDF mínimo
   propio (Helvetica, texto), sin dependencias, válido en el
   navegador, en Deno (función de despacho) y en Node (baterías). */

const PDF_WINANSI = { 'á': 225, 'é': 233, 'í': 237, 'ó': 243, 'ú': 250, 'ñ': 241, 'ü': 252, 'Á': 193, 'É': 201, 'Í': 205, 'Ó': 211, 'Ú': 218, 'Ñ': 209, '¡': 161, '¿': 191, '·': 183, '«': 171, '»': 187, '÷': 247, '×': 215, '−': 150, '—': 151, '–': 150, '€': 128, '$': 36 }
function pdfBytes(text) {
  const out = []
  for (const ch of String(text)) {
    const code = ch.codePointAt(0)
    if (code < 128) out.push(code)
    else if (PDF_WINANSI[ch] != null) out.push(PDF_WINANSI[ch])
    else out.push(63)
  }
  return out
}
function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function buildBulletinPdfBase64(data, targetDate) {
  const b = buildDailyBulletin(data, targetDate, { trigger: 'import' })
  if (!b) return null
  return buildBulletinPdfBase64FromStructured(b.structured)
}

/* El mismo PDF, desde el `structured` ya compuesto y guardado con
   el boletín: es la vía del despacho (la función de boletines no
   recompone nada: el adjunto sale de los mismos datos que el
   cuerpo del correo que lo anuncia). */
export function buildBulletinPdfBase64FromStructured(s) {
  if (!s) return null
  const f = s.fondos
  const lines = []
  const T = (t, size = 10.5, bold = false, gap = 6) => lines.push({ t: String(t), size, bold, gap })
  T(DOC_STYLE.systemName, 15, true, 2)
  T(`Contabilidad del día — ${fmtFechaDoc(s.date)}`, 12.5, true, 4)
  T(s.ipvLine, 9.5, false, 8)
  T(`Venta del día: ${fmtDocCUP(s.venta)} · Ganancia bruta: ${fmtDocCUP(s.bruta)} · Ganancia neta: ${fmtDocCUP(s.neta)}`, 10.5, false, 2)
  T(`Gastos del día (${s.gastosDiaCount}): ${fmtDocCUP(s.gastosDia)} · Resultado del día: ${fmtDocCUP(s.resultadoDia)} · Cuadre: ${fmtDocCUP(s.cuadre)}`, 10.5, false, 8)
  T('Resumen del mes', 12, true, 3)
  T(`Ventas: ${fmtDocCUP(s.mes.ventas)} · Bruta: ${fmtDocCUP(s.mes.bruta)} · Neta: ${fmtDocCUP(s.mes.neta)} · Gastos: ${fmtDocCUP(s.mes.gastos)} · Extras: ${fmtDocCUP(s.mes.extras)} · Utilidad: ${fmtDocCUP(s.mes.resultado)}`, 10.5, false, 2)
  T(`Billar: ${fmtDocCUP(s.mes.billar)} · Barra: ${fmtDocCUP(s.mes.barra)} · Cocina: ${fmtDocCUP(s.mes.cocina)} · Cobrado: ${fmtDocCUP(s.mes.totalCobrado)}`, 10.5, false, 8)
  T('Ventas por departamento', 12, true, 3)
  for (const d of s.deptRows) T(`- ${d.name}: venta ${fmtDocCUP(d.venta)} · ganancia ${fmtDocCUP(d.ganancia)}`, 10.5, false, 1.5)
  if (s.billarDia) T(`- Billar: ${fmtDoc(s.billarDia.totalHoras)} h (${fmtDoc(s.billarDia.horasDia)} día + ${fmtDoc(s.billarDia.horasNoche)} noche) · venta ${fmtDocCUP(s.billarDia.venta)} · pago encargado ${fmtDocCUP(s.billarDia.pagoEncargado)} · utilidad ${fmtDocCUP(s.billarDia.utilidad)}`, 10.5, false, 1.5)
  if (s.topProducts.length) {
    T('Lo más vendido', 12, true, 8)
    for (const p of s.topProducts) T(`- ${p.name}: ${fmtDocCUP(p.importe)}`, 10.5, false, 1.5)
  }
  if (f) {
    T('Cierre del día (Desglose)', 12, true, 8)
    T(`Efectivo: ${fmtDocCUP(f.efectivo)} · Transferencias: ${fmtDocCUP(f.transferencias)} · Cuentas por cobrar: ${fmtDocCUP(f.totalCuentasPorCobrar)} · Zelle: ${fmtDocCUP(f.zelle)} · Total: ${fmtDocCUP(f.totalFondos)}`, 10.5, false, 2)
    const bil = (f.billetes ?? []).filter((x) => x.cantidad > 0)
    if (bil.length) T(`Billetes CUP: ${bil.map((x) => `${fmtDoc(x.cantidad)} × $${fmtDoc(x.denominacion)} = ${fmtDocCUP(x.subtotal)}`).join('; ')}.`, 9.5, false, 2)
    const mlc = (f.mlc ?? []).filter((x) => num(x.cantidad) !== 0 || num(x.conversionCup) !== 0)
    T(mlc.length ? `Divisas (USD/EUR): ${mlc.map((x) => `${fmtDoc(x.cantidad)} ${x.moneda} × ${fmtDoc(x.tasa)} CUP = ${fmtDocCUP(x.conversionCup)}`).join('; ')}.` : 'Sin divisas (USD/EUR) ese día.', 9.5, false, 6)
  }
  if (s.entradas.length) {
    T('Entradas del día', 12, true, 4)
    for (const e2 of s.entradas) T(`- ${e2.dept} · ${e2.descripcion}: ${fmtCant(e2.cantidad)} ${e2.um} · compra ${fmtDocCUP(e2.precioCompra)} · inversión ${fmtDocCUP(e2.importe)} · venta ${fmtDocCUP(e2.precioVenta)} · ganancia ${fmtDocCUP(e2.ganancia)}`, 10.5, false, 1.5)
    T(`Inversión total: ${fmtDocCUP(s.entradasTotales.inversion)} · Ganancia potencial: ${fmtDocCUP(s.entradasTotales.gananciaPotencial)} (venta potencial ${fmtDocCUP(s.entradasTotales.ventaPotencial)})`, 10.5, false, 6)
  }
  T('Cuentas por cobrar', 12, true, 8)
  T(`Dinero en la calle: ${fmtDocCUP(s.dineroEnLaCalle)} (en Cobrar ${fmtDocCUP(s.calleEnCobrar)} + en morosas ${fmtDocCUP(s.calleMorosas)}).`, 10.5, false, 2)
  for (const g of s.cobrar.grupos) if (g.count) T(`- ${g.label}: ${fmtDocCUP(g.total)} (${g.count} cuentas)`, 10.5, false, 1.5)
  T(`RH acumulado: ${fmtDocCUP(s.rh.total)} (pago ${fmtFechaDoc(s.rh.pago)}) · Total del día RH: ${fmtRH(s.rh.valorDiaTotal)} CUP`, 10.5, false, 8)
  T(`Documento generado por ${DOC_STYLE.systemName} desde los datos reales del IPV. Ninguna cifra se ajusta.`, 9, false, 10)

  // Paginación simple: A4, márgenes 42pt, líneas con su tamaño.
  const perPage = []
  let page = []
  let y = 800
  for (const ln of lines) {
    const h = ln.size * 1.45 + ln.gap
    if (y - h < 42 && page.length) { perPage.push(page); page = []; y = 800 }
    page.push(ln)
    y -= h
  }
  if (page.length) perPage.push(page)

  const objects = []
  const addObj = (body) => { objects.push(body); return objects.length }
  const pagesIds = []
  // IDs provisionales: 1 catálogo, 2 páginas, luego por página 2 objetos, fuentes al final.
  let nextId = 3
  const pageObjs = perPage.map(() => { const pid = nextId++; const cid = nextId++; pagesIds.push(pid); return { pid, cid } })
  const fontReg = nextId++
  const fontBold = nextId++
  addObj('<< /Type /Catalog /Pages 2 0 R >>')
  addObj(`<< /Type /Pages /Kids [${pageObjs.map((p) => `${p.pid} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`)
  perPage.forEach((pageLines, i) => {
    const { pid, cid } = pageObjs[i]
    let cy = 800
    const ops = []
    for (const ln of pageLines) {
      cy -= ln.size * 1.45 + ln.gap
      ops.push(`BT /${ln.bold ? 'F2' : 'F1'} ${ln.size} Tf 42 ${cy.toFixed(1)} Td (${pdfEscape(ln.t)}) Tj ET`)
    }
    const content = ops.join('\n')
    objects[pid - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${cid} 0 R >>`
    const bytes = pdfBytes(content)
    objects[cid - 1] = { stream: bytes }
  })
  objects[fontReg - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[fontBold - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

  // Serialización con offsets en bytes.
  const chunks = []
  let offset = 0
  const push = (arr) => { chunks.push(arr); offset += arr.length }
  push(pdfBytes('%PDF-1.4\n'))
  const offsets = [0]
  objects.forEach((obj, i) => {
    offsets.push(offset)
    push(pdfBytes(`${i + 1} 0 obj\n`))
    if (typeof obj === 'string') {
      push(pdfBytes(obj))
    } else {
      push(pdfBytes(`<< /Length ${obj.stream.length} >>\nstream\n`))
      push(obj.stream)
      push(pdfBytes('\nendstream'))
    }
    push(pdfBytes('\nendobj\n'))
  })
  const xrefAt = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(pdfBytes(xref))
  push(pdfBytes(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`))
  const all = []
  for (const c of chunks) all.push(...c)
  let bin = ''
  const CH = 8192
  for (let i = 0; i < all.length; i += CH) bin += String.fromCharCode(...all.slice(i, i + CH))
  return btoa(bin)
}

/* ============ Cola de boletines ============
   Un boletín por día importado (id estable `${date}-import`,
   como el trigger 'import' del original): si ya existe para
   esa fecha, se reutiliza y no se duplica. */

export function ensureBulletinsForDays(data, existing, opts = {}) {
  const out = [...(existing ?? [])]
  const byDate = new Map(out.map((b) => [b.date, b]))
  for (const day of data?.days ?? []) {
    if (byDate.has(day.date)) continue
    const b = buildDailyBulletin(data, day.date, { trigger: 'import', now: opts.now ?? null })
    if (b) { out.push(b); byDate.set(day.date, b) }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

export function regenerateBulletin(data, bulletin) {
  const fresh = buildDailyBulletin(data, bulletin.date, { trigger: 'import', now: bulletin.createdAt ?? null })
  if (!fresh) return bulletin
  return {
    ...fresh,
    status: bulletin.status === 'enviado' ? 'enviado' : 'pendiente',
    attempts: bulletin.attempts ?? 0,
    sentAt: bulletin.sentAt ?? null,
    lastError: null,
  }
}

export function bulletinQueueSummary(bulletins) {
  const list = bulletins ?? []
  return {
    total: list.length,
    pendientes: list.filter((b) => b.status === 'pendiente').length,
    enviados: list.filter((b) => b.status === 'enviado').length,
    conError: list.filter((b) => b.status === 'error').length,
  }
}

/**
 * Intento de envío con la REGLA ANTI-DUPLICADO del dueño:
 * la comprobación de duplicados (¿ya hay un boletín ENVIADO
 * de esta fecha?) se hace inmediatamente antes de enviar, y
 * un boletín ya enviado jamás se reenvía. Sin transporte
 * (servicio de correo no configurado) NO se marca enviado:
 * queda pendiente con el motivo declarado.
 * transport: null | { send: async (bulletin) => void }
 */
export async function attemptBulletinSend(queue, bulletinId, transport, now) {
  const list = [...(queue ?? [])]
  const idx = list.findIndex((b) => b.id === bulletinId)
  if (idx < 0) return { queue: list, sent: false, reason: 'Boletín no encontrado en la cola.' }
  const b = list[idx]
  if (b.status === 'enviado') {
    return { queue: list, sent: false, reason: 'Ya está marcado como enviado: no se reenvía (regla anti-duplicado).' }
  }
  // Comprobación de duplicados INMEDIATAMENTE antes del envío.
  const duplicado = list.some((x) => x.id !== b.id && x.date === b.date && x.status === 'enviado')
  if (duplicado) {
    list[idx] = { ...b, status: 'enviado', lastError: null }
    return { queue: list, sent: false, reason: 'Ya existe un boletín enviado de esta fecha: se marca sin reenviar (regla anti-duplicado).' }
  }
  if (!transport || typeof transport.send !== 'function') {
    list[idx] = { ...b, attempts: (b.attempts ?? 0) + 1, lastError: 'Sin servicio de correo configurado en el sistema externo: el boletín queda en cola, listo para descargar o enviar cuando se conecte el servicio.' }
    return { queue: list, sent: false, reason: list[idx].lastError }
  }
  try {
    await transport.send(b)
    list[idx] = { ...b, status: 'enviado', sentAt: now ?? null, lastError: null, attempts: (b.attempts ?? 0) + 1 }
    return { queue: list, sent: true, reason: 'Enviado.' }
  } catch (e) {
    list[idx] = { ...b, status: 'error', attempts: (b.attempts ?? 0) + 1, lastError: e instanceof Error ? e.message : 'Error de envío.' }
    return { queue: list, sent: false, reason: list[idx].lastError }
  }
}

/* ============ Documento HTML imprimible (el «PDF» del navegador) ============
   Hoja A4 con la franja y el fondo aurora de DOC_STYLE; el
   navegador la imprime/guarda como PDF (window.print), como
   hace el clon con sus documentos. El bloque de firmas va en
   hoja aparte («Firmas y cuño»), igual que el original. */

function docShell({ title, subtitle, body, signatures, menu = false }) {
  const S = DOC_STYLE
  const sig = signatures ? `
  <section class="sig-page">
    <h2 class="sig-title">${esc(signatures.title)}</h2>
    <div class="sig-grid">
      ${signatures.signers.map((sg) => `
      <div class="sig-box">
        <div class="sig-label">${esc(sg.label)}</div>
        <div class="sig-line"></div>
        <div class="sig-name">${esc(sg.name)}</div>
        <div class="sig-role">${esc(sg.role)}</div>
        <div class="sig-pending">${esc(signatures.pendingText)}</div>
      </div>`).join('')}
      <div class="sig-box stamp">
        <!--stamp-zone-->
        <div class="stamp-ring">
          <div class="stamp-title">${esc(signatures.stamp.title)}</div>
          <div class="stamp-sub">${esc(signatures.stamp.subtitle)}</div>
        </div>
        <div class="sig-pending">${esc(signatures.stamp.missingText)}</div>
        <!--/stamp-zone-->
      </div>
    </div>
  </section>` : ''
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: ${S.ink}; background: ${DOC_AURORA.css}; -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 22px; }
  .sheet { max-width: 760px; margin: 0 auto; background: rgba(255,255,255,.82); border: 1px solid ${S.border}; border-radius: 14px; padding: 26px 28px; }
  .stripe-emerald { height: 6px; border-radius: 99px; background: ${S.emerald}; }
  .stripe-turq { height: 3.4px; border-radius: 99px; background: ${S.turquoise}; margin-top: 3px; }
  .stripe-gold { height: 2.2px; border-radius: 99px; background: ${S.gold}; margin-top: 2px; }
  .sys { font-size: 10.5px; font-weight: 800; letter-spacing: .13em; color: ${S.accent}; text-transform: uppercase; margin-top: 14px; }
  h1 { font-size: ${menu ? '30px' : '24px'}; margin: 4px 0 2px; color: ${menu ? S.menuDeep : S.deep}; ${menu ? "font-family: Georgia, 'Times New Roman', serif;" : ''} }
  .subtitle { font-size: 13px; color: ${S.dim}; margin: 0 0 14px; }
  h2.sec { font-size: 14px; color: ${S.deep}; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 6px 4px; font-size: 12.5px; border-bottom: 1px solid ${S.border}; text-align: left; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 800; color: ${S.deep}; border-top: 2px solid ${S.deep}; border-bottom: none; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0 4px; }
  .kpi { border: 1px solid ${S.border}; border-radius: 12px; padding: 10px; background: rgba(255,255,255,.6); }
  .kpi .l { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: ${S.dim}; }
  .kpi .v { font-size: 18px; font-weight: 800; color: ${S.kpiValue}; }
  .note { font-size: 11.5px; color: ${S.dim}; }
  .sig-page { break-before: page; margin-top: 26px; }
  .sig-title { font-size: 16px; color: ${S.deep}; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .sig-box { border: 1px solid ${S.border}; border-radius: 12px; padding: 16px; min-height: 120px; }
  .sig-label { font-size: 10px; font-weight: 800; letter-spacing: .1em; color: ${S.dim}; }
  .sig-line { border-bottom: 1.6px solid ${S.ink}; margin: 44px 0 8px; }
  .sig-name { font-weight: 700; font-size: 13px; }
  .sig-role { font-size: 11.5px; color: ${S.dim}; }
  .sig-pending { font-size: 11px; color: #B91C1C; margin-top: 8px; }
  .stamp-ring { border: 2.4px solid ${S.emerald}; border-radius: 50%; width: 168px; height: 168px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 14px; }
  .stamp-title { font-size: 13px; font-weight: 800; color: ${S.deep}; letter-spacing: .04em; }
  .stamp-sub { font-size: 8.5px; color: ${S.dim}; margin-top: 6px; letter-spacing: .05em; }
  .menu-sec { font-size: 19px; color: ${S.menuDeep}; font-family: Georgia, serif; margin: 20px 0 2px; }
  .menu-fam { font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: ${S.gold}; margin: 12px 0 4px; }
  .menu-item { display: flex; justify-content: space-between; gap: 14px; padding: 5px 0; border-bottom: 1px dotted ${S.border}; }
  .menu-item .nm { font-size: 13.5px; }
  .menu-item .ds { font-size: 11px; color: ${S.dim}; }
  .menu-item .pr { font-weight: 800; color: ${S.menuDeep}; white-space: nowrap; }
  @media screen and (max-width: 640px) {
    body { padding: 8px; }
    .sheet { padding: 18px 12px; border-radius: 12px; overflow-x: auto; }
    h1 { font-size: 21px; }
    .kpis { grid-template-columns: 1fr 1fr; }
    .sig-grid { grid-template-columns: 1fr; }
    td, th { padding: 5px 3px; font-size: 11.5px; }
    .stamp-ring { width: 132px; height: 132px; }
  }
  @media print { body { padding: 0; background: #fff; } .sheet { border: none; background: #fff; max-width: none; } }
</style></head>
<body><div class="sheet">
  <div class="stripe-emerald"></div><div class="stripe-turq"></div><div class="stripe-gold"></div>
  <div class="sys">${esc(S.systemName)}</div>
  <h1>${esc(title)}</h1>
  <p class="subtitle">${esc(subtitle)}</p>
  ${body}
  ${sig}
</div></body></html>`
}

/** Incrusta la imagen REAL del cuño aprobado en un documento
 * generado por docShell, sustituyendo de una pieza la zona del
 * cuño (el anillo dibujado + el texto de ausencia). El original
 * muestra la imagen del cuño o el aviso, nunca un anillo dibujado
 * ni ambos a la vez; como el cuño viaja empaquetado con la app,
 * TODAS las vías de impresión pasan por aquí y el documento nunca
 * sale con «Cuño no disponible» habiendo cuño. Sin url (o sin
 * zona), el documento queda como nació: con su aviso honesto. */
export function withStampImage(html, url) {
  const source = String(html ?? '')
  if (!url) return source
  return source.replace(
    /<!--stamp-zone-->[\s\S]*?<!--\/stamp-zone-->/,
    `<img src="${url}" alt="Cuño APROBADO de La Reina" style="width:132px;height:132px;object-fit:contain;display:block;margin:2px auto 0;">`,
  )
}

export function informeHtml(rep) {
  const e = rep.eco
  const rows = (pairs) => pairs.map(([l, v, strong]) => `<tr${strong ? ' class="total"' : ''}><td>${esc(l)}</td><td class="n">${esc(v)}</td></tr>`).join('')
  const body = `
  <div class="kpis">
    <div class="kpi"><div class="l">Venta bruta total</div><div class="v">${fmtDocCUP(e.ventas)}</div></div>
    <div class="kpi"><div class="l">Ganancia neta</div><div class="v">${fmtDocCUP(e.neta)}</div></div>
    <div class="kpi"><div class="l">Resultado del mes</div><div class="v">${fmtDocCUP(e.resultado)}</div></div>
  </div>
  <h2 class="sec">Resultados</h2>
  <table>${rows([
    ['Venta bruta total', fmtDocCUP(e.ventas), true],
    ['Ganancia bruta', fmtDocCUP(e.bruta)],
    ['Ganancia neta', fmtDocCUP(e.neta)],
    ['Gastos del mes', fmtDocCUP(e.gastosTotal)],
    ['Ingresos extras', fmtDocCUP(e.extrasTotal)],
    ['Utilidad (resultado del mes)', fmtDocCUP(e.resultado), true],
  ])}</table>
  <h2 class="sec">Ventas por área</h2>
  <table>${rows([
    ['Venta en barra (bebidas y cantina)', fmtDocCUP(e.barra)],
    ['Venta en cocina (elaboración y pizzas)', fmtDocCUP(e.cocina)],
    ['Billar', fmtDocCUP(e.billar?.venta ?? 0)],
  ])}</table>
  <h2 class="sec">Flujo y saldos</h2>
  <table>${rows([
    ['Inversión (entradas del mes)', fmtDocCUP(e.inversion)],
    ['Merma', fmtDocCUP(e.merma)],
    ['Total cobrado (sin cuentas por cobrar)', fmtDocCUP(e.totalCobrado), true],
    ['Efectivo en caja (último arqueo)', fmtDocCUP(e.efectivoCaja)],
    ['Zelle', fmtDocCUP(e.zelle)],
    ['Cuentas por cobrar — clientes (dinero en la calle)', fmtDocCUP(e.cuentasPorCobrar.clientes)],
    ['Cuentas por cobrar — trabajadores', fmtDocCUP(e.cuentasPorCobrar.trabajadores)],
    ['Cuentas por cobrar — administrativos', fmtDocCUP(e.cuentasPorCobrar.administrativos)],
    ['Cuentas por cobrar — total', fmtDocCUP(e.cuentasPorCobrar.total)],
    [`Morosas hoy (${e.cuentasPorCobrar.morosasCount})`, fmtDocCUP(e.cuentasPorCobrar.morosasTotal)],
  ])}</table>
  <h2 class="sec">Quincenas del mes (contabilidad)</h2>
  <table>${rows(e.quincenas.map((q, i) => [
    `${i === 0 ? 'Primera quincena (1–15)' : 'Segunda quincena (16–fin)'} — ventas`,
    `${fmtDocCUP(q.ventas)} · neta ${fmtDocCUP(q.neta)} · gastos ${fmtDocCUP(q.gastos)}${q.ingresosExtras ? ` · extras ${fmtDocCUP(q.ingresosExtras)}` : ''} · resultado ${fmtDocCUP(q.resultado ?? (q.neta - q.gastos))}`,
  ]))}</table>
  <p class="note">Informe generado desde los datos del IPV importados (${e.daysCount} días con IPV en ${esc(rep.monthLabel)}). Cuadre acumulado: ${fmtDocCUP(e.cuadreTotal)}.</p>`
  return docShell({
    title: `Informe de Economía — ${rep.monthLabel}`,
    subtitle: `${DOC_STYLE.business} · Cierre del mes`,
    body,
    signatures: rep.signatures,
  })
}

/* Informe de un PERÍODO arbitrario (Inicio: botones «PDF del período»
   y «Presentación PowerPoint» del original). Las cifras se agregan del
   rango [from, to] con LAS MISMAS primitivas de monthEconomy (ventas/
   bruta/neta de los días, gastos del rango, extras del IPV + registrados,
   barra/cocina por los mismos departamentos, billar, inversión =
   entriesImporte, merma = mermasCosto, cobrado = pagos con fecha en el
   rango, fondos del último día del rango, resultado = neta − gastos +
   extras). La foto de cuentas por cobrar es la de HOY, igual que en el
   informe del mes, y se toma de monthEconomy para que sea idéntica por
   construcción. La batería verify:reglas comprueba que, para el rango
   de un mes completo, este constructor da las mismas cifras que
   buildInformeData. */
const PERIODO_BARRA_DEPTS = ['Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Cantina']
const PERIODO_COCINA_DEPTS = ['Elaboración', 'Pizzas']

export function buildPeriodInformeData(data, from, to, label, today) {
  const inRange = (date) => typeof date === 'string' && date >= from && date <= to
  const days = (data?.days ?? []).filter((d) => inRange(d.date))
  const expenses = (data?.expenses ?? []).filter((e) => inRange(e.date))
  const sumDays = (f) => days.reduce((s, d) => s + num(f(d)), 0)
  const ventas = sumDays((d) => d.ventasDia)
  const bruta = sumDays((d) => d.gananciaBruta)
  const neta = sumDays((d) => d.gananciaNeta)
  const gastos = expenses.reduce((s, e) => s + num(e.total), 0)
  const extrasList = days.flatMap((d) => (d.extras ?? []).map((x) => ({ date: d.date, concepto: x.concepto, importe: num(x.importe) })))
  for (const x of data?.extraIncomes ?? []) if (inRange(x.date)) extrasList.push({ date: x.date, concepto: x.concept, importe: num(x.amount) })
  const ingresosExtras = extrasList.reduce((s, x) => s + x.importe, 0)
  const billarDays = days.filter((d) => d.billar)
  const billarVenta = billarDays.reduce((s, d) => s + num(d.billar.venta), 0)
  const billarUtilidad = billarDays.reduce((s, d) => s + num(d.billar.utilidad), 0)
  let barra = 0
  let cocina = 0
  for (const d of days) {
    for (const dep of d.departments ?? []) {
      const v = num(dep.ventas)
      if (PERIODO_BARRA_DEPTS.includes(dep.name)) barra += v
      if (PERIODO_COCINA_DEPTS.includes(dep.name)) cocina += v
    }
  }
  const inversion = sumDays((d) => d.entriesImporte)
  const merma = sumDays((d) => d.mermasCosto)
  let totalCobrado = 0
  for (const r of data?.receivables ?? []) {
    for (const p of r.payments ?? []) if (inRange(p.paidDate)) totalCobrado += num(p.amount)
  }
  for (const p of data?.localPayments ?? []) if (inRange(p.date)) totalCobrado += num(p.amount)
  const lastDay = days.length ? days[days.length - 1] : null
  const cuadreTotal = sumDays((d) => d.cuadre)
  const resultado = neta - gastos + ingresosExtras
  /* Quincenas naturales tocadas por el rango (1–15 y 16–fin de cada
     mes), con las cifras de los días del rango en cada mitad. */
  const quincenas = []
  const halves = new Map()
  for (const d of days) {
    const mk = monthKeyOf(d.date)
    const half = Number(d.date.slice(8, 10)) <= 15 ? 0 : 1
    const key = `${mk}|${half}`
    const cur = halves.get(key) ?? { from: half === 0 ? `${mk}-01` : `${mk}-16`, to: d.date, days: 0, ventas: 0, bruta: 0, neta: 0, gastos: 0 }
    cur.days += 1; cur.ventas += num(d.ventasDia); cur.bruta += num(d.gananciaBruta); cur.neta += num(d.gananciaNeta)
    if (d.date > cur.to) cur.to = d.date
    halves.set(key, cur)
  }
  for (const e of expenses) {
    const mk = monthKeyOf(e.date)
    const half = Number(e.date.slice(8, 10)) <= 15 ? 0 : 1
    const cur = halves.get(`${mk}|${half}`)
    if (cur) cur.gastos += num(e.total)
  }
  for (const key of [...halves.keys()].sort()) quincenas.push(halves.get(key))
  const snapshot = monthEconomy(data, monthKeyOf(today), today)
  return {
    kind: 'informe',
    title: 'Informe de Economía',
    monthKey: monthKeyOf(from),
    monthLabel: label,
    generatedAt: today,
    eco: {
      monthKey: monthKeyOf(from), daysCount: days.length,
      firstDay: days.length ? days[0].date : null, lastDay: lastDay ? lastDay.date : null,
      ventas, bruta, neta, gastos, gastosCount: expenses.length,
      ingresosExtras, ingresosExtrasCount: extrasList.length, extrasList,
      billar: { venta: billarVenta, utilidad: billarUtilidad, dias: billarDays.length },
      barra, cocina, deptSeen: days.some((d) => (d.departments ?? []).length > 0), rentabilidad: [],
      inversion, merma, totalCobrado, cobrosCount: 0,
      efectivoCaja: lastDay ? num(lastDay.fondos?.efectivo) : null,
      zelleCierre: lastDay ? num(lastDay.fondos?.zelle) : null,
      divisasCierre: lastDay ? num(lastDay.fondos?.divisasCUP) : null,
      cuentasPorCobrar: snapshot.cuentasPorCobrar,
      consumo: snapshot.consumo,
      resultado, resultadoEfectivo: resultado - (snapshot.consumo?.total ?? 0),
      reservas: snapshot.reservas,
      quincenas, gastosPorCategoria: [], gastosPorOrigen: [], expenses,
      cuadreTotal, zelle: lastDay ? num(lastDay.fondos?.zelle) : 0, gastosTotal: gastos, extrasTotal: ingresosExtras,
    },
    signatures: signatureBlockFor('informe'),
  }
}

/* Factura de otros ingresos del mes (Extras): los del IPV (hoja
   «Entrada y mesas») y los registrados a mano en esta copia, en un
   solo documento con el estilo premium y la firma del administrador.
   Es el documento que el original genera para los ingresos extras. */
export function buildExtrasInvoiceData(data, monthKey) {
  const rows = []
  for (const d of data.days ?? []) {
    if (!String(d.date ?? '').startsWith(monthKey)) continue
    for (const x of d.extras ?? []) rows.push({ date: d.date, concept: String(x.concepto ?? ''), note: '', amount: num(x.importe), method: '', source: 'Del IPV' })
  }
  for (const x of data.extraIncomes ?? []) {
    if (!String(x.date ?? '').startsWith(monthKey)) continue
    rows.push({ date: x.date, concept: String(x.concept ?? ''), note: String(x.note ?? ''), amount: num(x.amount), method: x.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo', source: 'Registro manual' })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept, 'es'))
  return {
    monthKey,
    monthLabel: monthLabelEs(monthKey),
    rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    signatures: signatureBlockFor('generico'),
  }
}

export function extrasInvoiceHtml(rep) {
  const body = `
  <h2 class="sec">Detalle de otros ingresos · ${esc(rep.monthLabel)}</h2>
  <table>
    <tr><th>Fecha</th><th>Concepto</th><th>Método</th><th>Origen</th><th class="n">Importe</th></tr>
    ${rep.rows.map((r) => `<tr><td>${esc(fmtFechaDoc(r.date))}</td><td>${esc(r.concept)}${r.note ? ` · ${esc(r.note)}` : ''}</td><td>${esc(r.method || '—')}</td><td>${esc(r.source)}</td><td class="n">${fmtDocCUP(r.amount)}</td></tr>`).join('')}
    <tr class="total"><td colspan="4">Total de otros ingresos</td><td class="n">${fmtDocCUP(rep.total)}</td></tr>
  </table>
  <p class="note">Documento generado desde los registros reales: los ingresos de la hoja «Entrada y mesas» de los IPV importados y los registrados a mano en el sistema. Ninguna cifra se ajusta.</p>`
  return docShell({
    title: `Factura de otros ingresos — ${rep.monthLabel}`,
    subtitle: `${DOC_STYLE.business} · Otros ingresos`,
    body,
    signatures: rep.signatures,
  })
}

/* Factura de gastos del mes (Archivo / Economía): el detalle de
   gastos con su total, en el estilo premium y con la firma del
   administrador — el documento «factura-gastos-<mes>» del original. */
export function buildGastosInvoiceData(data, monthKey) {
  const rows = (data.expenses ?? [])
    .filter((e) => String(e.date ?? '').startsWith(monthKey))
    .map((e) => ({ date: e.date, concept: String(e.concept ?? ''), category: String(e.category ?? ''), dept: String(e.dept ?? ''), quantity: num(e.quantity), total: num(e.total) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept, 'es'))
  return {
    monthKey,
    monthLabel: monthLabelEs(monthKey),
    rows,
    total: rows.reduce((s, r) => s + r.total, 0),
    signatures: signatureBlockFor('generico'),
  }
}

export function gastosInvoiceHtml(rep) {
  const body = `
  <h2 class="sec">Detalle de gastos · ${esc(rep.monthLabel)}</h2>
  <table>
    <tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Área</th><th class="n">Cantidad</th><th class="n">Importe</th></tr>
    ${rep.rows.map((r) => `<tr><td>${esc(fmtFechaDoc(r.date))}</td><td>${esc(r.concept)}</td><td>${esc(r.category || '—')}</td><td>${esc(r.dept || '—')}</td><td class="n">${esc(String(r.quantity))}</td><td class="n">${fmtDocCUP(r.total)}</td></tr>`).join('')}
    <tr class="total"><td colspan="5">Total de gastos</td><td class="n">${fmtDocCUP(rep.total)}</td></tr>
  </table>
  <p class="note">Documento generado desde los gastos reales registrados en el sistema. Ninguna cifra se ajusta.</p>`
  return docShell({
    title: `Factura de gastos — ${rep.monthLabel}`,
    subtitle: `${DOC_STYLE.business} · Gastos`,
    body,
    signatures: rep.signatures,
  })
}

/* Factura de entradas del mes (Archivo / Entradas): la mercancía que
   entró según los IPV, a precio de compra — el documento
   «factura-entradas-<mes>» del original. */
export function buildEntradasInvoiceData(data, monthKey) {
  const rows = []
  for (const d of data.days ?? []) {
    if (!String(d.date ?? '').startsWith(monthKey)) continue
    for (const e of d.entriesDetail ?? []) rows.push({
      date: d.date, dept: String(e.dept ?? ''), descripcion: String(e.descripcion ?? ''), um: String(e.um ?? ''),
      cantidad: num(e.cantidad), precioCompra: num(e.precioCompra), importe: num(e.importe),
    })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.descripcion.localeCompare(b.descripcion, 'es'))
  return {
    monthKey,
    monthLabel: monthLabelEs(monthKey),
    rows,
    total: rows.reduce((s, r) => s + r.importe, 0),
    signatures: signatureBlockFor('generico'),
  }
}

export function entradasInvoiceHtml(rep) {
  const body = `
  <h2 class="sec">Detalle de entradas · ${esc(rep.monthLabel)}</h2>
  <table>
    <tr><th>Fecha</th><th>Departamento</th><th>Descripción</th><th class="n">Cantidad</th><th class="n">Precio de compra</th><th class="n">Importe</th></tr>
    ${rep.rows.map((r) => `<tr><td>${esc(fmtFechaDoc(r.date))}</td><td>${esc(r.dept)}</td><td>${esc(r.descripcion)}${r.um ? ` · ${esc(r.um)}` : ''}</td><td class="n">${esc(String(r.cantidad))}</td><td class="n">${fmtDocCUP(r.precioCompra)}</td><td class="n">${fmtDocCUP(r.importe)}</td></tr>`).join('')}
    <tr class="total"><td colspan="5">Total de inversión en entradas</td><td class="n">${fmtDocCUP(rep.total)}</td></tr>
  </table>
  <p class="note">Documento generado desde las entradas reales de los IPV importados, a precio de compra. Ninguna cifra se ajusta.</p>`
  return docShell({
    title: `Factura de entradas — ${rep.monthLabel}`,
    subtitle: `${DOC_STYLE.business} · Entradas`,
    body,
    signatures: rep.signatures,
  })
}

export function nominaHtml(doc) {
  const emp = doc.employees.map((e) => `<tr>
    <td>${esc(e.name)}</td><td>${esc(e.position ?? '')}</td>
    <td class="n">${fmtDoc(e.daysWorked)}</td><td class="n">${e.dailySalary == null ? '—' : fmtDoc(e.dailySalary)}</td>
    <td class="n">${fmtDoc(e.cashAmount)}</td><td class="n">${fmtDoc(e.transferAmount)}</td>
    <td class="n"><strong>${fmtDoc(e.total)}</strong></td><td></td></tr>`).join('')
  const body = `
  <p class="note">Ciclo del ${esc(fmtFechaLarga(doc.cycleStart))} al ${esc(fmtFechaLarga(doc.cycleEnd))} · Pago: ${esc(fmtFechaLarga(doc.payDate))} · ${doc.recorded ? 'Nómina registrada en el historial.' : 'Nómina derivada del ciclo (aún sin registrar como pagada).'}</p>
  <table>
    <tr><th>Trabajador</th><th>Ocupación</th><th class="n">Días</th><th class="n">Tarifa / día</th><th class="n">Efectivo</th><th class="n">Transferencia</th><th class="n">Total</th><th>Firma</th></tr>
    ${emp}
    <tr class="total"><td colspan="2">Totales (${doc.employees.length} trabajadores)</td><td class="n">${fmtDoc(doc.totalDias)}</td><td></td><td class="n">${fmtDoc(doc.totalEfectivo)}</td><td class="n">${fmtDoc(doc.totalTransferencia)}</td><td class="n">${fmtDoc(doc.total)}</td><td></td></tr>
  </table>
  ${doc.mixed ? `<p class="note">Pago mixto: parte en efectivo (${fmtDocCUP(doc.totalEfectivo)}) y parte por transferencia (${fmtDocCUP(doc.totalTransferencia)}).</p>` : ''}`
  return docShell({
    title: 'Nómina de salarios',
    subtitle: `${DOC_STYLE.business} · Ciclo RH ${fmtFechaDoc(doc.cycleStart)} — ${fmtFechaDoc(doc.cycleEnd)}`,
    body,
    signatures: doc.signatures,
  })
}

export function menuHtml(menu) {
  const sectionsBody = menu.sections.map((sec) => `
  <div class="menu-sec">${esc(menuDeptOf(sec.section) === 'Elaboración' ? 'Cocina' : sec.section)}</div>
  ${sec.families.map((f) => `
  <div class="menu-fam">${esc(f.family)}</div>
  ${f.items.map((i) => `<div class="menu-item"><div><div class="nm">${esc(i.name)}</div>${i.description ? `<div class="ds">${esc(i.description)}</div>` : ''}</div><div class="pr">${fmtDocCUP(i.price)}</div></div>`).join('')}`).join('')}`).join('')
  /* D-R6-02: el documento del menú editado en la pestaña lleva su
     línea bajo el título y su pie (los «Textos del menú» del
     original), cuando el dato los trae; el menú derivado de
     Documentos no los trae y sale como siempre. */
  const subtitleLine = menu.subtitle ? `<p style="text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:13px;margin:2px 0 4px">${esc(menu.subtitle)}</p>` : ''
  const footerLine = menu.footerText ? `<p style="text-align:center;font-size:10px;color:#5B6F63;border-top:1px solid #D7EEF3;padding-top:10px;margin-top:24px">${esc(menu.footerText)}</p>` : ''
  const body = subtitleLine + (sectionsBody || '<p class="note">Sin productos con existencia para mostrar hoy.</p>') + footerLine
  return docShell({
    title: 'La Reina · Menú del día',
    subtitle: `${esc(menu.dateLabel)} · Precios en CUP`,
    body,
    signatures: null,
    menu: true,
  })
}

/* ============ PowerPoint (puerto reducido de generatePptx) ============
   OOXML mínimo escrito a mano, como el original: portada,
   cifras del mes, ventas por área, cuentas por cobrar,
   quincenas y cierre. Sin librerías nuevas. */

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    crc32.table = table
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function zipStore(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true)
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true)
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + data.length
  }
  let centralSize = 0
  for (const c of central) centralSize += c.length
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function txBox(x, y, w, h, text, size, color, bold = false, align = 'l') {
  const paras = String(text).split('\n').map((line) => `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="es-ES" sz="${size * 100}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xesc(line)}</a:t></a:r></a:p>`).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="${Math.floor(Math.random() * 1e9) + 2}" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`
}
function slideXml(shapes, bg = 'F2F7F4') {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

export function buildPptxBlob(rep) {
  const e = rep.eco
  const EMU = 914400
  const W = 13.333 * EMU; const H = 7.5 * EMU
  const title = (t, sub) => [
    txBox(0.6 * EMU, 0.35 * EMU, W - 1.2 * EMU, 0.7 * EMU, t, 30, '0B3D2E', true),
    txBox(0.6 * EMU, 1.05 * EMU, W - 1.2 * EMU, 0.45 * EMU, sub, 14, '57705F'),
  ].join('')
  const lines = (pairs, y0 = 1.9) => pairs.map(([l, v], i) =>
    txBox(0.6 * EMU, (y0 + i * 0.52) * EMU, 8.6 * EMU, 0.45 * EMU, l, 15, '14231C')
    + txBox(9.4 * EMU, (y0 + i * 0.52) * EMU, 3.3 * EMU, 0.45 * EMU, v, 15, '0B3D2E', true, 'r')).join('')
  const slides = [
    slideXml(
      txBox(0.6 * EMU, 1.5 * EMU, W - 1.2 * EMU, 1 * EMU, 'La Reina Restaurante - Bar', 40, '0B3D2E', true, 'ctr')
      + txBox(0.6 * EMU, 2.6 * EMU, W - 1.2 * EMU, 0.7 * EMU, `Informe de Economía — ${rep.monthLabel}`, 24, '0E9F6E', false, 'ctr')
      + txBox(0.6 * EMU, 3.5 * EMU, W - 1.2 * EMU, 0.5 * EMU, DOC_STYLE.systemName, 13, '57705F', false, 'ctr')
      + txBox(0.6 * EMU, 4.3 * EMU, W - 1.2 * EMU, 0.5 * EMU, `Generado el ${fmtFechaDoc(rep.generatedAt)} · ${e.daysCount} días con IPV importados`, 13, '57705F', false, 'ctr'),
      'EAF4EF'),
    slideXml(title('Cifras del mes', rep.monthLabel) + lines([
      ['Venta bruta total', fmtDocCUP(e.ventas)],
      ['Ganancia bruta', fmtDocCUP(e.bruta)],
      ['Ganancia neta', fmtDocCUP(e.neta)],
      ['Gastos del mes', fmtDocCUP(e.gastosTotal)],
      ['Ingresos extras', fmtDocCUP(e.extrasTotal)],
      ['Utilidad (resultado)', fmtDocCUP(e.resultado)],
      ['Cuadre acumulado', fmtDocCUP(e.cuadreTotal)],
    ])),
    slideXml(title('Ventas por área y flujo', rep.monthLabel) + lines([
      ['Venta en barra', fmtDocCUP(e.barra)],
      ['Venta en cocina', fmtDocCUP(e.cocina)],
      ['Billar', fmtDocCUP(e.billar?.venta ?? 0)],
      ['Inversión (entradas)', fmtDocCUP(e.inversion)],
      ['Merma', fmtDocCUP(e.merma)],
      ['Total cobrado (sin cuentas)', fmtDocCUP(e.totalCobrado)],
      ['Efectivo en caja (último arqueo)', fmtDocCUP(e.efectivoCaja)],
      ['Zelle', fmtDocCUP(e.zelle)],
    ])),
    slideXml(title('Cuentas por cobrar', `Foto al ${fmtFechaDoc(rep.generatedAt)} · el dinero en la calle es solo de clientes`) + lines([
      ['Clientes (dinero en la calle)', fmtDocCUP(e.cuentasPorCobrar.clientes)],
      ['Trabajadores', fmtDocCUP(e.cuentasPorCobrar.trabajadores)],
      ['Administrativos', fmtDocCUP(e.cuentasPorCobrar.administrativos)],
      ['Total por cobrar', fmtDocCUP(e.cuentasPorCobrar.total)],
      [`Morosas hoy (${e.cuentasPorCobrar.morosasCount})`, fmtDocCUP(e.cuentasPorCobrar.morosasTotal)],
      ['Primera quincena — ventas', fmtDocCUP(e.quincenas[0]?.ventas ?? 0)],
      ['Segunda quincena — ventas', fmtDocCUP(e.quincenas[1]?.ventas ?? 0)],
    ])),
    slideXml(
      txBox(0.6 * EMU, 2.2 * EMU, W - 1.2 * EMU, 0.8 * EMU, 'Cierre', 32, '0B3D2E', true, 'ctr')
      + txBox(0.6 * EMU, 3.1 * EMU, W - 1.2 * EMU, 0.6 * EMU, `Resultado del mes: ${fmtDocCUP(e.resultado)} · Neta: ${fmtDocCUP(e.neta)}`, 18, '14231C', false, 'ctr')
      + txBox(0.6 * EMU, 3.9 * EMU, W - 1.2 * EMU, 0.5 * EMU, 'Documento generado desde los datos reales del IPV. Firmas y cuño en el documento impreso.', 12, '57705F', false, 'ctr'),
      'EAF4EF'),
  ]
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${Math.round(W)}" cy="${Math.round(H)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
    { name: 'ppt/theme/theme1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Queen SDA"><a:themeElements><a:clrScheme name="Queen"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0B3D2E"/></a:dk2><a:lt2><a:srgbClr val="F2F7F4"/></a:lt2><a:accent1><a:srgbClr val="0E9F6E"/></a:accent1><a:accent2><a:srgbClr val="0EA5BD"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="C9A227"/></a:accent4><a:accent5><a:srgbClr val="3B82F6"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="0E9F6E"/></a:hlink><a:folHlink><a:srgbClr val="57705F"/></a:folHlink></a:clrScheme><a:fontScheme name="Queen"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Queen"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectLst/></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>` },
    ...slides.map((xml, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, data: xml })),
    ...slides.map((_, i) => ({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` })),
  ]
  return zipStore(files)
}
