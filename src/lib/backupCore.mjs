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
    })),
  }))
  const fondos = d.fondos && typeof d.fondos === 'object' ? d.fondos : {}
  return {
    date: String(d.date),
    ventasDia: num(d.ventasDia),
    gananciaBruta: num(d.gananciaBruta),
    gananciaNeta: num(d.gananciaNeta),
    cuadre: num(d.cuadre),
    departments,
    entriesCount: Array.isArray(d.entries) ? d.entries.length : 0,
    gastosIpv: num(d.gastosIpv),
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
  }
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
  }
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
  return {
    meta: {
      backupOf: String(raw.backupOf ?? ''),
      exportedAt: String(raw.exportedAt ?? ''),
    },
    days,
    receivables,
    expensesCount: Array.isArray(data.expenses) ? data.expenses.length : 0,
    payrollCount: Array.isArray(data.payrollHistory) ? data.payrollHistory.length : 0,
    workersCount: Array.isArray(data.workers) ? data.workers.length : 0,
    summary: summarizeDays(days),
  }
}
