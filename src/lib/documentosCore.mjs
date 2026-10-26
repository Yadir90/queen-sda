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
  buildProductsCatalog, findMenuRuleConflicts, menuDeptOf,
} from './productosCore.mjs'
import {
  deriveCyclePayroll, recordedPayroll, fmtFechaLarga, cycleIndexFor, cycleWindow,
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

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
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
    eco: { ...eco, cuadreTotal, zelle: eco.zelleCierre ?? 0, gastosTotal: eco.gastos, extrasTotal: eco.ingresosExtras },
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
  const catalog = buildProductsCatalog(data?.days ?? [])
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
  return `${DOC_STYLE.systemName} · Boletín diario — ${fmtFechaDoc(dateISO)}`
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
  const resultadoDia = num(day.gananciaNeta) - gastosDia
  const topProducts = (day.departments ?? [])
    .flatMap((dep) => (dep.products ?? []).map((p) => ({ name: p.name, dept: dep.name, cantidad: num(p.cantidadVendida), importe: num(p.importeVenta) })))
    .filter((p) => p.importe > 0)
    .sort((a, b) => b.importe - a.importe)
    .slice(0, 5)
  const clientesPend = (data?.receivables ?? []).filter((r) => r.category === 'cliente' && r.status !== 'pagada' && !r.closeKind && r.saldoBase > 0 && r.date <= targetDate)
  const calle = clientesPend.reduce((s, r) => s + num(r.saldoBase), 0)
  const callePorNombre = new Map()
  for (const r of clientesPend) callePorNombre.set(r.client, (callePorNombre.get(r.client) ?? 0) + num(r.saldoBase))
  const calleDetalle = [...callePorNombre.entries()].map(([name, saldo]) => ({ name, saldo })).sort((a, b) => b.saldo - a.saldo)
  const deptTotals = {}
  for (const dep of day.departments ?? []) deptTotals[dep.name] = num(dep.ventas ?? dep.venta)
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
    fondos: day.fondos ?? null,
    deptTotals,
    topProducts,
    dineroEnLaCalle: calle,
    calleDetalle,
    mes: {
      ventas: eco.ventas, bruta: eco.bruta, neta: eco.neta, gastos: eco.gastos,
      extras: eco.ingresosExtras, resultado: eco.resultado, billar: eco.billar?.venta ?? 0,
      barra: eco.barra, cocina: eco.cocina, inversion: eco.inversion,
      merma: eco.merma, totalCobrado: eco.totalCobrado, efectivoCaja: eco.efectivoCaja ?? 0,
      zelle: eco.zelleCierre ?? 0, diasConIpv: eco.daysCount,
      fondoVentas: eco.reservas.fondoVentasMes, fondoVentasProgreso: eco.reservas.fondoVentasProgreso,
      fondoUtilidades: eco.reservas.fondoUtilidadesTrimestre, fondoUtilidadesProgreso: eco.reservas.trimestreProgreso,
    },
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
    createdAt: opts.now ?? null,
    sentAt: null,
  }
}

const row = (label, value, strong = false) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #E3EEE7;color:#57705F;font-size:13px;">${esc(label)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #E3EEE7;text-align:right;font-size:13px;${strong ? 'font-weight:800;color:#0B3D2E;' : 'font-weight:600;color:#14231C;'}">${esc(value)}</td>
    </tr>`
const rowD = (label, value, strong = false) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #1E3A2E;color:#9DB8A8;font-size:13px;">${esc(label)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #1E3A2E;text-align:right;font-size:13px;${strong ? 'font-weight:800;color:#EAF7F0;' : 'font-weight:600;color:#DCEFE3;'}">${esc(value)}</td>
    </tr>`
const meter = (label, pct, figure, foot) => `
  <div style="margin:0 0 12px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
      <span style="font-size:12px;font-weight:700;color:#57705F;text-transform:uppercase;letter-spacing:.06em;">${esc(label)}</span>
      <span style="font-size:12px;font-weight:800;color:#0E9F6E;">${Math.round(pct)} %</span>
    </div>
    <div style="font-size:22px;font-weight:800;color:#0B3D2E;margin:2px 0;">${esc(figure)}</div>
    <div style="height:10px;border-radius:999px;background:#E3EEE7;overflow:hidden;">
      <div style="height:100%;width:${Math.max(2, Math.min(100, pct))}%;border-radius:999px;background:linear-gradient(90deg,#0EA5BD,#16A34A);"></div>
    </div>
    <div style="font-size:11.5px;color:#57705F;margin-top:4px;">${esc(foot)}</div>
  </div>`
const meterD = (label, pct, figure, foot) => `
  <div style="margin:0 0 12px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
      <span style="font-size:12px;font-weight:700;color:#9DB8A8;text-transform:uppercase;letter-spacing:.06em;">${esc(label)}</span>
      <span style="font-size:12px;font-weight:800;color:#34D399;">${Math.round(pct)} %</span>
    </div>
    <div style="font-size:22px;font-weight:800;color:#EAF7F0;margin:2px 0;">${esc(figure)}</div>
    <div style="height:10px;border-radius:999px;background:#1E3A2E;overflow:hidden;">
      <div style="height:100%;width:${Math.max(2, Math.min(100, pct))}%;border-radius:999px;background:linear-gradient(90deg,#0EA5BD,#16A34A);"></div>
    </div>
    <div style="font-size:11.5px;color:#9DB8A8;margin-top:4px;">${esc(foot)}</div>
  </div>`

function bulletinBodies(s) {
  const f = s.fondos
  const kpis = [
    ['Venta del día', fmtDocCUP(s.venta)],
    ['Ganancia neta', fmtDocCUP(s.neta)],
    ['Resultado del día', fmtDocCUP(s.resultadoDia)],
    ['Dinero en la calle', fmtDocCUP(s.dineroEnLaCalle)],
  ]
  const build = (R, M, dark) => `
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">El día</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${R('Ventas del día', fmtDocCUP(s.venta), true)}
    ${R('Ganancia bruta', fmtDocCUP(s.bruta))}
    ${R('Ganancia neta', fmtDocCUP(s.neta), true)}
    ${R(`Gastos del día (${s.gastosDiaCount} registro${s.gastosDiaCount === 1 ? '' : 's'})`, fmtDocCUP(s.gastosDia))}
    ${R('Resultado del día (neta − gastos)', fmtDocCUP(s.resultadoDia), true)}
    ${R('Inversión del día (entradas)', fmtDocCUP(s.inversionDia))}
    ${R('Merma del día', fmtDocCUP(s.mermaDia))}
    ${s.extrasDia ? R('Ingresos extras del día', fmtDocCUP(s.extrasDia)) : ''}
    ${R('Cuadre del IPV', s.cuadre === 0 ? '0 — CUADRE OK' : fmtDocCUP(s.cuadre))}
  </table>
  ${f ? `
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Cierre del día (Desglose)</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${R('Efectivo en caja', fmtDocCUP(f.efectivo))}
    ${R('Transferencias', fmtDocCUP(f.transferencias))}
    ${R('Cuentas por cobrar del día', fmtDocCUP(f.totalCuentasPorCobrar))}
    ${R('Zelle', fmtDocCUP(f.zelle))}
    ${R('Total de fondos', fmtDocCUP(f.totalFondos), true)}
  </table>
  ${(f.billetes ?? []).some((b) => b.cantidad > 0) ? `
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Desglose por denominación</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${(f.billetes ?? []).filter((b) => b.cantidad > 0).map((b) => R(`${fmtDoc(b.cantidad)} × ${fmtDoc(b.denominacion)} CUP`, fmtDocCUP(b.subtotal))).join('')}
  </table>` : ''}` : ''}
  ${Object.keys(s.deptTotals).length ? `
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Ventas por departamento</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${Object.entries(s.deptTotals).map(([n, v]) => R(n, fmtDocCUP(v))).join('')}
  </table>` : ''}
  ${s.topProducts.length ? `
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Más vendidos del día</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${s.topProducts.map((p) => R(`${p.name} (${p.dept})`, fmtDocCUP(p.importe))).join('')}
  </table>` : ''}
  <h2 style="margin:18px 0 4px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Cuentas por cobrar</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${R('Dinero en la calle (solo clientes)', fmtDocCUP(s.dineroEnLaCalle), true)}
    ${s.calleDetalle.map((c) => R(c.name, fmtDocCUP(c.saldo))).join('')}
  </table>
  <h2 style="margin:18px 0 8px;font-size:15px;color:${dark ? '#EAF7F0' : '#0B3D2E'};">Economía — acumulados de ${esc(monthLabelEs(s.monthKey))}</h2>
  ${M('Fondo de ventas del mes · 10 % de las ventas', s.mes.fondoVentasProgreso, fmtDocCUP(s.mes.fondoVentas), `${fmtDoc(s.mes.diasConIpv)} días con IPV · avance del mes ${Math.round(s.mes.fondoVentasProgreso)} %`)}
  ${M('Fondo de utilidades del trimestre · 15 % de la neta', s.mes.fondoUtilidadesProgreso, fmtDocCUP(s.mes.fondoUtilidades), 'Reserva del trimestre en curso')}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${R('Ventas del mes', fmtDocCUP(s.mes.ventas), true)}
    ${R('Ganancia bruta del mes', fmtDocCUP(s.mes.bruta))}
    ${R('Ganancia neta del mes', fmtDocCUP(s.mes.neta))}
    ${R('Gastos del mes', fmtDocCUP(s.mes.gastos))}
    ${R('Ingresos extras del mes', fmtDocCUP(s.mes.extras))}
    ${R('Resultado del mes', fmtDocCUP(s.mes.resultado), true)}
    ${R('Billar del mes', fmtDocCUP(s.mes.billar))}
    ${R('Venta en barra del mes', fmtDocCUP(s.mes.barra))}
    ${R('Venta en cocina del mes', fmtDocCUP(s.mes.cocina))}
    ${R('Inversión del mes', fmtDocCUP(s.mes.inversion))}
    ${R('Merma del mes', fmtDocCUP(s.mes.merma))}
    ${R('Total cobrado (sin cuentas por cobrar)', fmtDocCUP(s.mes.totalCobrado))}
    ${R('Efectivo en caja (último arqueo)', fmtDocCUP(s.mes.efectivoCaja))}
    ${R('Zelle del mes', fmtDocCUP(s.mes.zelle))}
  </table>`
  const chips = (dark) => kpis.map(([l, v]) => `
      <td style="padding:6px;">
        <div style="border:1px solid ${dark ? '#1E3A2E' : '#DDE8E1'};border-radius:14px;padding:10px 8px;text-align:center;background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.55)'};">
          <div style="font-size:10.5px;font-weight:700;color:${dark ? '#9DB8A8' : '#57705F'};text-transform:uppercase;letter-spacing:.05em;">${esc(l)}</div>
          <div style="font-size:16px;font-weight:800;color:${dark ? '#EAF7F0' : '#0B3D2E'};">${esc(v)}</div>
        </div>
      </td>`).join('')
  return { light: build(row, meter, false), dark: build(rowD, meterD, true), chipsLight: chips(false), chipsDark: chips(true) }
}

export function bulletinHtml(s, subject) {
  const b = bulletinBodies(s)
  const head = (aurora, dark) => `
  <div style="background:${aurora};border-radius:18px;padding:20px 18px 14px;">
    <div style="height:4px;border-radius:99px;background:#16A34A;margin-bottom:3px;"></div>
    <div style="height:2.5px;border-radius:99px;background:#0EA5BD;margin-bottom:2px;"></div>
    <div style="height:1.6px;border-radius:99px;background:#C9A227;margin-bottom:14px;"></div>
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:${dark ? '#7EE2B8' : '#0E9F6E'};text-transform:uppercase;">${esc(DOC_STYLE.systemName)}</div>
    <div style="font-size:23px;font-weight:800;color:${dark ? '#EAF7F0' : '#0B3D2E'};margin-top:4px;">Boletín diario</div>
    <div style="font-size:14px;color:${dark ? '#9DB8A8' : '#57705F'};">${esc(fmtFechaDoc(s.date))} · ${esc(DOC_STYLE.business)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr>${dark ? b.chipsDark : b.chipsLight}</tr></table>
  </div>`
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) { .bs-light { display: none !important; } }
  @media (prefers-color-scheme: light) { .bs-dark { display: none !important; } }
</style></head>
<body style="margin:0;padding:16px;background:#EEF5F1;font-family:Arial, Helvetica, sans-serif;color:#14231C;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #DDE8E1;border-radius:20px;padding:18px;">
  <div class="bs-light">${head(DOC_AURORA.css, false)}${b.light}</div>
  <div class="bs-dark" style="display:none;">${head(DOC_AURORA.cssDark, true)}${b.dark}</div>
  <p style="font-size:11.5px;color:#57705F;margin:18px 0 0;">Boletín generado por ${esc(DOC_STYLE.systemName)} desde los datos del IPV importado. Sin gráficos: las cifras mandan.</p>
</div>
</body></html>`
}

export function bulletinText(s) {
  const L = []
  L.push(`${DOC_STYLE.systemName} · Boletín diario — ${fmtFechaDoc(s.date)}`)
  L.push(DOC_STYLE.business)
  L.push('')
  L.push('EL DÍA')
  L.push(`Ventas del día: ${fmtDocCUP(s.venta)}`)
  L.push(`Ganancia bruta: ${fmtDocCUP(s.bruta)}`)
  L.push(`Ganancia neta: ${fmtDocCUP(s.neta)}`)
  L.push(`Gastos del día (${s.gastosDiaCount}): ${fmtDocCUP(s.gastosDia)}`)
  L.push(`Resultado del día (neta − gastos): ${fmtDocCUP(s.resultadoDia)}`)
  L.push(`Inversión del día (entradas): ${fmtDocCUP(s.inversionDia)}`)
  L.push(`Merma del día: ${fmtDocCUP(s.mermaDia)}`)
  if (s.extrasDia) L.push(`Ingresos extras del día: ${fmtDocCUP(s.extrasDia)}`)
  L.push(`Cuadre del IPV: ${s.cuadre === 0 ? '0 — CUADRE OK' : fmtDocCUP(s.cuadre)}`)
  if (s.fondos) {
    L.push('')
    L.push('CIERRE DEL DÍA (DESGLOSE)')
    L.push(`Efectivo en caja: ${fmtDocCUP(s.fondos.efectivo)}`)
    L.push(`Transferencias: ${fmtDocCUP(s.fondos.transferencias)}`)
    L.push(`Cuentas por cobrar del día: ${fmtDocCUP(s.fondos.totalCuentasPorCobrar)}`)
    L.push(`Zelle: ${fmtDocCUP(s.fondos.zelle)}`)
    L.push(`Total de fondos: ${fmtDocCUP(s.fondos.totalFondos)}`)
    const bil = (s.fondos.billetes ?? []).filter((b) => b.cantidad > 0)
    if (bil.length) {
      L.push('Desglose por denominación:')
      for (const b of bil) L.push(`  ${fmtDoc(b.cantidad)} × ${fmtDoc(b.denominacion)} CUP: ${fmtDocCUP(b.subtotal)}`)
    }
  }
  if (Object.keys(s.deptTotals).length) {
    L.push('')
    L.push('VENTAS POR DEPARTAMENTO')
    for (const [n, v] of Object.entries(s.deptTotals)) L.push(`${n}: ${fmtDocCUP(v)}`)
  }
  if (s.topProducts.length) {
    L.push('')
    L.push('MÁS VENDIDOS DEL DÍA')
    for (const p of s.topProducts) L.push(`${p.name} (${p.dept}): ${fmtDocCUP(p.importe)}`)
  }
  L.push('')
  L.push('CUENTAS POR COBRAR')
  L.push(`Dinero en la calle (solo clientes): ${fmtDocCUP(s.dineroEnLaCalle)}`)
  for (const c of s.calleDetalle) L.push(`${c.name}: ${fmtDocCUP(c.saldo)}`)
  L.push('')
  L.push(`ECONOMÍA — ACUMULADOS DE ${monthLabelEs(s.monthKey).toUpperCase()}`)
  L.push(`Ventas del mes: ${fmtDocCUP(s.mes.ventas)}`)
  L.push(`Ganancia bruta del mes: ${fmtDocCUP(s.mes.bruta)}`)
  L.push(`Ganancia neta del mes: ${fmtDocCUP(s.mes.neta)}`)
  L.push(`Gastos del mes: ${fmtDocCUP(s.mes.gastos)}`)
  L.push(`Ingresos extras del mes: ${fmtDocCUP(s.mes.extras)}`)
  L.push(`Resultado del mes: ${fmtDocCUP(s.mes.resultado)}`)
  L.push(`Billar del mes: ${fmtDocCUP(s.mes.billar)}`)
  L.push(`Venta en barra: ${fmtDocCUP(s.mes.barra)} · Venta en cocina: ${fmtDocCUP(s.mes.cocina)}`)
  L.push(`Inversión del mes: ${fmtDocCUP(s.mes.inversion)} · Merma del mes: ${fmtDocCUP(s.mes.merma)}`)
  L.push(`Total cobrado (sin cuentas por cobrar): ${fmtDocCUP(s.mes.totalCobrado)}`)
  L.push(`Efectivo en caja (último arqueo): ${fmtDocCUP(s.mes.efectivoCaja)} · Zelle: ${fmtDocCUP(s.mes.zelle)}`)
  L.push(`Fondo de ventas del mes (10 %): ${fmtDocCUP(s.mes.fondoVentas)} · avance ${Math.round(s.mes.fondoVentasProgreso)} %`)
  L.push(`Fondo de utilidades del trimestre (15 %): ${fmtDocCUP(s.mes.fondoUtilidades)}`)
  return L.join('\n')
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
        <div class="stamp-ring">
          <div class="stamp-title">${esc(signatures.stamp.title)}</div>
          <div class="stamp-sub">${esc(signatures.stamp.subtitle)}</div>
        </div>
        <div class="sig-pending">${esc(signatures.stamp.missingText)}</div>
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
    `${fmtDocCUP(q.ventas)} · neta ${fmtDocCUP(q.neta)} · gastos ${fmtDocCUP(q.gastos)} · resultado ${fmtDocCUP(q.neta - q.gastos)}`,
  ]))}</table>
  <p class="note">Informe generado desde los datos del IPV importados (${e.daysCount} días con IPV en ${esc(rep.monthLabel)}). Cuadre acumulado: ${fmtDocCUP(e.cuadreTotal)}.</p>`
  return docShell({
    title: `Informe de Economía — ${rep.monthLabel}`,
    subtitle: `${DOC_STYLE.business} · Cierre del mes`,
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
  const body = menu.sections.map((sec) => `
  <div class="menu-sec">${esc(menuDeptOf(sec.section) === 'Elaboración' ? 'Cocina' : sec.section)}</div>
  ${sec.families.map((f) => `
  <div class="menu-fam">${esc(f.family)}</div>
  ${f.items.map((i) => `<div class="menu-item"><div><div class="nm">${esc(i.name)}</div>${i.description ? `<div class="ds">${esc(i.description)}</div>` : ''}</div><div class="pr">${fmtDocCUP(i.price)}</div></div>`).join('')}`).join('')}`).join('')
  return docShell({
    title: 'La Reina · Menú del día',
    subtitle: `${esc(menu.dateLabel)} · Precios en CUP`,
    body: body || '<p class="note">Sin productos con existencia para mostrar hoy.</p>',
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
