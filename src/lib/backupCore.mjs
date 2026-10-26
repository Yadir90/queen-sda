// Queen SDA — núcleo del importador de respaldo del SDA.
// Módulo SIN dependencias, compartido por la app (Vite) y por la prueba
// scripts/verify-import.mjs (Node). El respaldo/IPV es la fuente de verdad:
// este módulo nunca ajusta cifras; solo lee, normaliza campos y suma.
//
// Estructura esperada del respaldo:
// { backupOf, exportedAt, data: { days, receivables, expenses, payrollHistory, workers, transferState } }
// Día: { date, ventasDia, gananciaBruta, gananciaNeta, cuadre, departments, entries, fondos, cuentasPagadas, rh }
// Cuenta: { id, client, clientKey, category, date, amount, originalAmount, saldo,
//           totalAbonado, payments: [{ id, amount, paidDate, paymentMethod }], status, paidDate, closeKind }

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// Como num, pero conserva el «no viene» (null): la cadena de
// existencias del IPV distingue la celda escrita de la ausente.
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function summarizeDays(days) {
  const list = Array.isArray(days) ? days : []
  const dates = list.map((d) => d.date).filter(Boolean).sort()
  return {
    count: list.length,
    from: dates.length ? dates[0] : null,
    to: dates.length ? dates[dates.length - 1] : null,
    ventas: list.reduce((s, d) => s + num(d.ventasDia), 0),
    gananciaBruta: list.reduce((s, d) => s + num(d.gananciaBruta), 0),
    gananciaNeta: list.reduce((s, d) => s + num(d.gananciaNeta), 0),
    cuadreTotal: list.reduce((s, d) => s + num(d.cuadre), 0),
    allSquared: list.every((d) => num(d.cuadre) === 0),
  }
}

export function normalizeDay(d) {
  const departments = (Array.isArray(d.departments) ? d.departments : []).map((dep) => ({
    name: String(dep.name ?? 'Sin departamento'),
    costo: num(dep.costo),
    ganancia: num(dep.ganancia),
    ventas: (Array.isArray(dep.products) ? dep.products : []).reduce((s, p) => s + num(p.importeVenta), 0),
    products: (Array.isArray(dep.products) ? dep.products : []).map((p) => ({
      name: String(p.name ?? ''),
      category: String(p.category ?? ''),
      cantidadVendida: num(p.cantidadVendida),
      precioVenta: num(p.precioVenta),
      importeVenta: num(p.importeVenta),
      ganancia: num(p.ganancia),
      // Cadena de existencias del producto en el IPV (Productos /
      // Almacén la leen tal como entró; null = la celda no venía).
      precioCosto: num(p.precioCosto),
      um: String(p.um ?? ''),
      saldoInicial: numOrNull(p.saldoInicial),
      disponible: numOrNull(p.disponible),
      aLaVenta: numOrNull(p.aLaVenta),
      bajas: num(p.bajas),
      traslados: num(p.traslados),
      existenciaFinal: numOrNull(p.existenciaFinal),
      existenciaFuente: String(p.existenciaFuente ?? ''),
    })),
  }))
  const fondos = d.fondos && typeof d.fondos === 'object' ? d.fondos : {}
  const day = {
    date: String(d.date),
    ventasDia: num(d.ventasDia),
    gananciaBruta: num(d.gananciaBruta),
    gananciaNeta: num(d.gananciaNeta),
    cuadre: num(d.cuadre),
    departments,
    entriesCount: Array.isArray(d.entries) ? d.entries.length : 0,
    // En el registro del día, «gastosIpv» viene como lista de líneas del
    // IPV (así lo guarda el sistema original); el total del día es la
    // suma de sus importes. Si viniera como número, se toma tal cual.
    gastosIpv: Array.isArray(d.gastosIpv)
      ? d.gastosIpv.reduce((s, g) => s + num(g && typeof g === 'object' ? g.total : g), 0)
      : num(d.gastosIpv),
    mermasCosto: num(d.mermasCosto),
    fondos: {
      efectivo: num(fondos.efectivo),
      transferencias: num(fondos.transferencias),
      totalCuentasPorCobrar: num(fondos.totalCuentasPorCobrar),
      divisasCUP: num(fondos.divisasCUP),
      zelle: num(fondos.zelle),
      totalFondos: num(fondos.totalFondos),
      ventas: num(fondos.ventas),
    },
    cuentasPagadas: Array.isArray(d.cuentasPagadas) ? d.cuentasPagadas : [],
    // Inversión del día: las «entries» del IPV son las entradas a
    // precio de compra; su suma es la inversión que el original
    // acumula en Economía/boletines. Solo se suman los «importe»
    // registrados — sin registro, cero, nunca estimado.
    entriesImporte: (Array.isArray(d.entries) ? d.entries : []).reduce(
      (s, e) => s + num(e && typeof e === 'object' ? e.importe : 0),
      0,
    ),
    // Billar: la tabla de juegos del IPV («juegos») con su venta y su
    // utilidad (venta − pago del encargado). Sin tabla o sin horas ni
    // venta registradas, el día no aporta billar (null), como el
    // «no disponible» del original.
    billar:
      d.juegos && typeof d.juegos === 'object' && (num(d.juegos.venta) > 0 || num(d.juegos.horas) > 0)
        ? { venta: num(d.juegos.venta), utilidad: num(d.juegos.utilidad) }
        : null,
    // Ingresos extras del día: filas de «ingresosEntradaMesas»
    // (cobro de entrada, alquiler de mesas…) con su importe real.
    extras: (Array.isArray(d.ingresosEntradaMesas) ? d.ingresosEntradaMesas : [])
      .map((x) => ({ concepto: String(x?.concepto ?? ''), importe: num(x?.importe) }))
      .filter((x) => x.importe !== 0),
    // Detalle de las entradas del día: la mercancía que entró con su
    // precio de compra (base del costo promedio ponderado del catálogo
    // y de la inversión del día; entriesImporte ya sumaba sus importes).
    entriesDetail: (Array.isArray(d.entries) ? d.entries : []).map((e) => ({
      dept: String(e?.dept ?? ''),
      descripcion: String(e?.descripcion ?? ''),
      cantidad: num(e?.cantidad),
      um: String(e?.um ?? ''),
      precioCompra: num(e?.precioCompra),
      precioVenta: num(e?.precioVenta),
      importe: num(e?.importe) || num(e?.cantidad) * num(e?.precioCompra),
      codigo: String(e?.codigo ?? ''),
    })),
    // Foto de almacén del día (hoja «Almacén» del IPV), tal como entró.
    warehouse: (Array.isArray(d.warehouse) ? d.warehouse : []).map((w) => ({
      product: String(w?.product ?? ''),
      um: String(w?.um ?? ''),
      saldoInicial: num(w?.saldoInicial),
      entrada: num(w?.entrada),
      baja: num(w?.baja),
      salida: num(w?.salida),
      saldoFinal: num(w?.saldoFinal),
      precioCompra: num(w?.precioCompra),
      valor: num(w?.valor),
      observacion: String(w?.observacion ?? ''),
    })),
  }
  // Cuentas del Desglose y foto de RH: viajan dentro del registro del día
  // (respaldo o importación directa del IPV) y se conservan tal como
  // entraron; las pantallas que no las usan simplemente las ignoran.
  if (Array.isArray(fondos.cuentasDetalle)) {
    day.fondos.cuentasDetalle = fondos.cuentasDetalle.map((c) => ({
      nombre: String(c?.nombre ?? ''),
      saldo: num(c?.saldo),
      observacion: String(c?.observacion ?? ''),
    }))
  }
  // Desglose por denominación del arqueo: lo usa el boletín diario.
  if (Array.isArray(fondos.billetes)) {
    day.fondos.billetes = fondos.billetes.map((b) => ({
      cantidad: num(b?.cantidad),
      denominacion: num(b?.denominacion),
      subtotal: num(b?.subtotal),
    }))
  }
  if (Array.isArray(d.rh)) {
    day.rh = d.rh.map((e) => ({
      nombre: String(e?.nombre ?? ''),
      ocupacion: String(e?.ocupacion ?? ''),
      dias: num(e?.dias),
      salarioDiario: num(e?.salarioDiario),
      totalCobrar: num(e?.totalCobrar),
      carnet: String(e?.carnet ?? ''),
      cuentaBancaria: String(e?.cuentaBancaria ?? ''),
      movil: String(e?.movil ?? ''),
      marcas: Array.isArray(e?.marcas) ? e.marcas.map(num) : [],
    }))
    day.rhFechas = Array.isArray(d.rhFechas) ? d.rhFechas.map(String) : []
  }
  return day
}

export function normalizeReceivable(r) {
  const payments = (Array.isArray(r.payments) ? r.payments : []).map((p, i) => ({
    id: String(p.id ?? `pago-${r.id}-${i}`),
    amount: num(p.amount),
    paidDate: String(p.paidDate ?? ''),
    paymentMethod: String(p.paymentMethod ?? ''),
    local: false,
  }))
  return {
    id: String(r.id),
    client: String(r.client ?? 'Sin nombre'),
    clientKey: String(r.clientKey ?? String(r.client ?? '').toLowerCase()),
    category: ['cliente', 'trabajador', 'administrativo'].includes(r.category) ? r.category : 'cliente',
    date: String(r.date ?? ''),
    originalAmount: num(r.originalAmount ?? r.amount),
    amount: num(r.amount),
    saldoBase: num(r.saldo),
    totalAbonadoBase: num(r.totalAbonado),
    payments,
    status: String(r.status ?? ''),
    paidDate: r.paidDate ? String(r.paidDate) : null,
    paymentMethod: r.paymentMethod ? String(r.paymentMethod) : null,
    closeKind: r.closeKind ? String(r.closeKind) : null,
    detail: String(r.detail ?? ''),
    origin: String(r.origin ?? ''),
    // Identidad estable de la cuenta del IPV («fecha::persona») y su
    // registro (casa/general), si el respaldo los trae: la
    // sincronización derivada los usa para no duplicar.
    entryKey: r.entryKey ? String(r.entryKey) : null,
    persona: r.persona ? String(r.persona) : null,
    registro: r.registro ? String(r.registro) : null,
    // Marca manual de morosa del original (toggleMorosa), si viaja.
    isMorosa: r.isMorosa === true,
    morosaSince: r.morosaSince ? String(r.morosaSince) : null,
  }
}

export function normalizeExpense(e) {
  return {
    id: String(e.id ?? ''),
    date: String(e.date ?? ''),
    concept: String(e.concept ?? ''),
    category: String(e.category ?? ''),
    dept: String(e.dept ?? ''),
    quantity: num(e.quantity) || 1,
    unitValue: num(e.unitValue),
    total: num(e.total),
    origin: String(e.origin ?? 'manual') || 'manual',
    sourceKey: e.sourceKey ? String(e.sourceKey) : null,
    cycleStart: e.cycleStart ? String(e.cycleStart) : null,
    note: String(e.note ?? ''),
  }
}

export function normalizeWorkerRecord(w) {
  return {
    key: String(w.key ?? ''),
    nombre: String(w.nombre ?? ''),
    ocupacion: String(w.ocupacion ?? ''),
    carnet: String(w.carnet ?? ''),
    cuentaBancaria: String(w.cuentaBancaria ?? ''),
    movil: String(w.movil ?? ''),
    notas: String(w.notas ?? ''),
    origen: w.origen === 'manual' ? 'manual' : 'ipv',
  }
}

export function normalizePayroll(rec) {
  const employees = (Array.isArray(rec.employees) ? rec.employees : []).map((e) => ({
    nombre: String(e.nombre ?? ''),
    ocupacion: String(e.ocupacion ?? ''),
    dias: num(e.dias),
    salarioDiario: Math.round(num(e.salarioDiario)),
    totalCobrar: Math.round(num(e.totalCobrar)),
    pagoEfectivo: Math.round(num(e.pagoEfectivo)),
    pagoTransferencia: Math.round(num(e.pagoTransferencia)),
    carnet: String(e.carnet ?? ''),
    cuentaBancaria: String(e.cuentaBancaria ?? ''),
    movil: String(e.movil ?? ''),
  }))
  return {
    id: String(rec.id ?? rec.cycleStart ?? ''),
    cycleStart: String(rec.cycleStart ?? ''),
    cycleEnd: String(rec.cycleEnd ?? ''),
    payDate: String(rec.payDate ?? ''),
    total: Math.round(num(rec.total) || employees.reduce((s, e) => s + e.totalCobrar, 0)),
    workersCount: Math.round(num(rec.workers)) || employees.length,
    employees,
  }
}

// Clave suelta de un nombre, para derivar lo aprendido/decidido del
// respaldo: la foto de «Cuentas» del original guarda en cuentasEntries
// la clasificación final de cada fila de cada día.
function looseKey(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function deriveLearning(data) {
  const learnedKinds = {}
  const cuentasOverrides = {}
  // Memoria de conceptos de Queen (queenLearning del respaldo): lo que
  // el sistema ya aprendió que es cuenta o gasto, por concepto.
  for (const e of Array.isArray(data?.queenLearning) ? data.queenLearning : []) {
    const kind = e?.classification
    if (kind !== 'cuenta' && kind !== 'gasto') continue
    const key = looseKey(e?.conceptKey ?? e?.conceptDisplay ?? '')
    if (key) learnedKinds[key] = kind
  }
  for (const e of Array.isArray(data?.cuentasEntries) ? data.cuentasEntries : []) {
    const kind = e?.classification
    if (kind !== 'cuenta' && kind !== 'gasto' && kind !== 'pendiente') continue
    const key = looseKey(e?.rawName ?? e?.client ?? e?.name ?? '')
    if (!key) continue
    // Decisión del dueño para ESA entrada concreta (día + fila): manda
    // sobre heurística y marca «gasto», tal como en el original. La
    // clave exacta es el sourceKey que trae la propia entrada.
    const sourceKey = typeof e?.sourceKey === 'string' && e.sourceKey ? e.sourceKey : `${String(e?.date ?? '')}::${key}`
    cuentasOverrides[sourceKey] = kind
    // Concepto aprendido (marcado «learned») para filas futuras.
    if (e?.learned) {
      const conceptKey = looseKey(e?.concept ?? e?.client ?? '')
      if (conceptKey) learnedKinds[conceptKey] = kind
      learnedKinds[key] = kind
    }
  }
  return { learnedKinds, cuentasOverrides }
}

/**
 * Historial de la tarjeta del negocio, tal como viaja en el respaldo
 * (data.transferState.history) con la clase de cada pase tomada del
 * registro de pases (data.bankTransfers: kind 'banco' | 'efectivo').
 * NINGÚN importe se recalcula ni se recompone: los abonos manuales que
 * el original anuló (superseded) viajan anulados y con su detalle
 * intacto; las marcas «excluido» se conservan como vienen.
 */
export function normalizeTransferMovements(data) {
  const ts = data?.transferState && typeof data.transferState === 'object' ? data.transferState : null
  const history = Array.isArray(ts?.history) ? ts.history : []
  const kindByPaseId = new Map()
  for (const bt of Array.isArray(data?.bankTransfers) ? data.bankTransfers : []) {
    if (bt && bt.id != null) kindByPaseId.set(Number(bt.id), bt.kind === 'banco' ? 'banco' : 'efectivo')
  }
  const sources = ['ipv', 'pago-cuenta', 'manual', 'pase', 'extra', 'gasto-transferencia']
  const types = ['abono', 'pase', 'gasto', 'reversion']
  return history.map((h, i) => ({
    id: `ts-h${i}`,
    date: String(h?.date ?? ''),
    type: types.includes(h?.type) ? h.type : 'abono',
    source: sources.includes(h?.source) ? h.source : 'manual',
    amount: num(h?.amount),
    detail: String(h?.detail ?? ''),
    excluded: Boolean(h?.excluido),
    superseded: Boolean(h?.superseded),
    paseId: h?.paseId != null ? Number(h.paseId) : null,
    manualId: h?.manualId != null ? Number(h.manualId) : null,
    paymentCreditId: h?.paymentCreditId != null ? Number(h.paymentCreditId) : null,
    extraId: h?.extraId != null ? Number(h.extraId) : null,
    transferExpenseId: h?.transferExpenseId != null ? Number(h.transferExpenseId) : null,
    paseKind: h?.paseId != null ? kindByPaseId.get(Number(h.paseId)) ?? null : null,
    local: false,
  }))
}

// Una cuenta está pendiente si no está pagada, no está cerrada y conserva saldo.
export function isPending(rec, effectiveSaldo) {
  return rec.status !== 'pagada' && !rec.closeKind && effectiveSaldo > 0
}

// Parsea y valida el respaldo completo. Lanza Error con mensaje en español si no sirve.
export function parseBackup(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no contiene un respaldo válido.')
  const data = raw.data
  if (!data || typeof data !== 'object') throw new Error('Al respaldo le falta el bloque «data».')
  if (!Array.isArray(data.days)) throw new Error('Al respaldo le falta la lista de días («days»).')
  if (!Array.isArray(data.receivables)) throw new Error('Al respaldo le falta la lista de cuentas («receivables»).')

  const days = data.days.map(normalizeDay).sort((a, b) => a.date.localeCompare(b.date))
  const receivables = data.receivables.map(normalizeReceivable)
  const expenses = (Array.isArray(data.expenses) ? data.expenses : []).map(normalizeExpense)
  const workers = (Array.isArray(data.workers) ? data.workers : []).map(normalizeWorkerRecord)
  const payrollHistory = (Array.isArray(data.payrollHistory) ? data.payrollHistory : [])
    .map(normalizePayroll)
    .sort((a, b) => b.cycleStart.localeCompare(a.cycleStart))
  const { learnedKinds, cuentasOverrides } = deriveLearning(data)
  const transferMovements = normalizeTransferMovements(data)
  // Cinco colecciones que el respaldo SÍ trae y que este importador
  // DESCARTABA (fuga cerrada en la oleada 2): se conservan ÍNTEGRAS,
  // tal como vienen — sin normalizar, sin recalcular, sin filtrar —
  // para que la reexportación (documentosCore.buildBackupExport) las
  // devuelva byte a byte en contenido y las pantallas que las usan
  // (Cobrar: smsLogs y receivablePhotos · Queen/SMS: smsOutbox y
  // smsLogs · Historial: monthlyArchives · RH: workerPayments) las
  // lean de aquí. Si el archivo no las trae, quedan como [] (ausencia
  // honesta, no invención).
  const receivablePhotos = Array.isArray(data.receivablePhotos) ? data.receivablePhotos : []
  const smsLogs = Array.isArray(data.smsLogs) ? data.smsLogs : []
  const smsOutbox = Array.isArray(data.smsOutbox) ? data.smsOutbox : []
  const monthlyArchives = Array.isArray(data.monthlyArchives) ? data.monthlyArchives : []
  const workerPayments = Array.isArray(data.workerPayments) ? data.workerPayments : []
  const workersHistorial = Array.isArray(data.workersHistorial) ? data.workersHistorial : []
  return {
    receivablePhotos,
    smsLogs,
    smsOutbox,
    monthlyArchives,
    workerPayments,
    workersHistorial,
    meta: {
      backupOf: String(raw.backupOf ?? ''),
      exportedAt: String(raw.exportedAt ?? ''),
    },
    days,
    receivables,
    expenses,
    transferMovements,
    workers,
    payrollHistory,
    anchorDate: typeof data.anchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.anchorDate) ? data.anchorDate : null,
    learnedKinds,
    cuentasOverrides,
    entrySourceKeys: (Array.isArray(data.cuentasEntries) ? data.cuentasEntries : [])
      .map((e) => (typeof e?.sourceKey === 'string' ? e.sourceKey : null))
      .filter(Boolean),
    expensesCount: expenses.length,
    payrollCount: payrollHistory.length,
    workersCount: workers.length,
    summary: summarizeDays(days),
  }
}
