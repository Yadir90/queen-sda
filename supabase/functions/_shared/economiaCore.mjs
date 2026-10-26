// Queen SDA — núcleo de Economía y Transferencias.
// Módulo SIN dependencias, compartido por la app (Vite) y por la prueba
// scripts/verify-economia.mjs (Node). TODAS las cifras salen de
// registros reales del núcleo (días del IPV, gastos, cuentas, historial
// de la tarjeta): lo que no tiene registro se devuelve como null o
// cero declarado, nunca estimado ni extrapolado — es la regla de datos
// permanente del sistema original.
//
// Definiciones (las del propio original, verificadas en su código):
// - Saldo de la tarjeta = suma de los movimientos EFECTIVOS del
//   historial (sin los marcados «No es de La Reina» y sin los que el
//   propio original anuló — superseded). El importe registrado de un
//   pase es el que afecta a la tarjeta; la comisión del banco es FIJA
//   de 210 CUP por pase y nunca un porcentaje ni un descuento
//   automático sobre el importe.
// - Total pasado al banco = suma de los importes registrados de los
//   pases con clase «banco» efectivos.
// - Barra = Bebidas alcohólicas + Bebidas no alcohólicas + Cantina.
//   Cocina = Elaboración + Pizzas.
// - Inversión del mes = suma de «importe» de las entradas de los IPV.
// - Efectivo en caja y Zelle «al cierre» = la foto de fondos del
//   ÚLTIMO día importado del mes (no una suma).
// - Total cobrado del mes = suma de los PAGOS de cuentas cuya fecha de
//   pago cae en el mes (abonos del respaldo + abonos de Cobrar).
// - Resultado (utilidad neta económica) = ganancia neta − gastos +
//   ingresos extras. Resultado en efectivo = resultado sin extras −
//   consumo de la casa (cuentas pendientes de Jesús/Dayami/Alejandro
//   nacidas en el mes: ese dinero nunca entró en caja).
// - Fondos/reservas: 10 % de las ventas del mes y 15 % de la ganancia
//   neta del trimestre (los medidores de Inicio del original).
// - Quincena de CONTABILIDAD = quincena natural del mes (1–15 y
//   16–fin). NO es la quincena de RH (ciclos de 15 días desde el
//   ancla, pago el día 16): no se mezclan en ninguna cifra.

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export const BANK_COMMISSION = 210

// ---------- Transferencias ----------

/** Efectivo = entra en el saldo y en los totales (ni excluido ni anulado). */
export function isEffectiveMovement(m) {
  return Boolean(m) && !m.excluded && !m.superseded
}

export function transferSummary(movements) {
  const list = Array.isArray(movements) ? movements : []
  const eff = list.filter(isEffectiveMovement)
  const sum = (rows) => rows.reduce((s, m) => s + num(m.amount), 0)
  const abonos = eff.filter((m) => m.amount > 0)
  const pases = eff.filter((m) => m.type === 'pase')
  const pasesBanco = pases.filter((m) => m.paseKind === 'banco')
  const manualExtra = eff.filter((m) => (m.source === 'manual' || m.source === 'extra') && m.amount > 0)
  const lastPaseBanco = pasesBanco.length ? pasesBanco[pasesBanco.length - 1] : null
  return {
    balance: sum(eff),
    totalReceived: sum(abonos),
    totalIpvReceived: sum(abonos.filter((m) => m.source === 'ipv')),
    totalPagoCuenta: sum(abonos.filter((m) => m.source === 'pago-cuenta')),
    totalManualExtra: sum(manualExtra),
    manualExtraCount: manualExtra.length,
    totalOut: Math.abs(sum(eff.filter((m) => m.amount < 0))),
    totalPases: Math.abs(sum(pases)),
    totalBankPassed: Math.abs(sum(pasesBanco)),
    totalTransferExpenses: Math.abs(sum(eff.filter((m) => m.source === 'gasto-transferencia'))),
    lastBankPase: lastPaseBanco ? { date: lastPaseBanco.date, amount: Math.abs(num(lastPaseBanco.amount)) } : null,
    movementsCount: list.length,
    effectiveCount: eff.length,
    excludedCount: list.filter((m) => m.excluded && !m.superseded).length,
    supersededCount: list.filter((m) => m.superseded).length,
  }
}

/**
 * Conciliación de UN día, con la clave del dueño: las entradas a la
 * tarjeta por SMS deben cuadrar SIN duplicar con el total de
 * transferencias del IPV del día MÁS los pagos de cuentas por
 * transferencia MÁS otras entradas identificadas que no son del IPV.
 * Aquí se compara lo registrado en la tarjeta ese día contra esa
 * composición: si la diferencia no es cero, hay un descuadre que
 * señalar antes de dar el día por cuadrado.
 */
export function conciliationForDay(data, date) {
  const day = (data?.days ?? []).find((d) => d.date === date) ?? null
  const movs = (data?.transferMovements ?? []).filter((m) => m.date === date)
  const eff = movs.filter(isEffectiveMovement)
  const sumSrc = (src) => eff.filter((m) => m.source === src).reduce((s, m) => s + num(m.amount), 0)
  const registradas = eff.filter((m) => m.amount > 0).reduce((s, m) => s + num(m.amount), 0)
  const ipv = day ? num(day.fondos?.transferencias) : null
  const pagosCuenta = sumSrc('pago-cuenta')
  const otras = sumSrc('manual') + sumSrc('extra')
  const identificadas = ipv == null ? null : ipv + pagosCuenta + otras
  return {
    date,
    dayImported: Boolean(day),
    ipv,
    pagosCuenta,
    otras,
    registradas,
    identificadas,
    diferencia: identificadas == null ? null : registradas - identificadas,
    movements: movs,
  }
}

/** Fechas con movimientos o con IPV, de la más reciente a la más antigua (para conciliar). */
export function conciliationDates(data, limit = 31) {
  const set = new Set()
  for (const m of data?.transferMovements ?? []) if (m.date) set.add(m.date)
  for (const d of data?.days ?? []) if (d.date) set.add(d.date)
  return [...set].sort().reverse().slice(0, limit)
}

// ---------- Economía ----------

export function monthKeyOf(date) {
  return String(date ?? '').slice(0, 7)
}

export function daysInMonthOf(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number)
  if (!y || !m) return 0
  return new Date(y, m, 0).getDate()
}

/** Los tres meses del trimestre natural que contiene a `monthKey`. */
export function quarterMonthsOf(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number)
  if (!y || !m) return []
  const first = Math.floor((m - 1) / 3) * 3 + 1
  return [0, 1, 2].map((i) => `${y}-${String(first + i).padStart(2, '0')}`)
}

const BARRA_DEPTS = ['Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Cantina']
const COCINA_DEPTS = ['Elaboración', 'Pizzas']

function plazoDias(category) {
  if (category === 'cliente') return 7
  if (category === 'trabajador') return 15
  return null
}

function saldoEfectivo(rec, localPayments) {
  const local = (localPayments ?? []).filter((p) => p.receivableId === rec.id).reduce((s, p) => s + num(p.amount), 0)
  return Math.max(0, num(rec.saldoBase) - local)
}

function esPendiente(rec, saldo) {
  return rec.status !== 'pagada' && !rec.closeKind && saldo > 0
}

function esMorosa(rec, saldo, refDate) {
  if (!esPendiente(rec, saldo)) return false
  const plazo = plazoDias(rec.category)
  if (plazo === null || !rec.date) return false
  const d = new Date(`${rec.date}T12:00:00`)
  d.setDate(d.getDate() + plazo)
  return refDate > d.toISOString().slice(0, 10)
}

/**
 * Panel de cierre de un mes (la lista del dueño) calculado SOLO del
 * núcleo real. `today` es la fecha de referencia para morosidad y
 * avances: los días sin IPV no se cuentan como cero.
 */
export function monthEconomy(data, monthKey, today) {
  const days = (data?.days ?? []).filter((d) => monthKeyOf(d.date) === monthKey)
  const expenses = (data?.expenses ?? []).filter((e) => monthKeyOf(e.date) === monthKey)
  const sumDays = (f) => days.reduce((s, d) => s + num(f(d)), 0)

  const ventas = sumDays((d) => d.ventasDia)
  const bruta = sumDays((d) => d.gananciaBruta)
  const neta = sumDays((d) => d.gananciaNeta)
  const gastos = expenses.reduce((s, e) => s + num(e.total), 0)

  const extrasList = days.flatMap((d) => (d.extras ?? []).map((x) => ({ date: d.date, concepto: x.concepto, importe: num(x.importe) })))
  const ingresosExtras = extrasList.reduce((s, x) => s + x.importe, 0)

  const billarDays = days.filter((d) => d.billar)
  const billarVenta = billarDays.reduce((s, d) => s + num(d.billar.venta), 0)
  const billarUtilidad = billarDays.reduce((s, d) => s + num(d.billar.utilidad), 0)

  let barra = 0
  let cocina = 0
  const deptMap = new Map()
  for (const d of days) {
    for (const dep of d.departments ?? []) {
      const v = num(dep.ventas)
      if (BARRA_DEPTS.includes(dep.name)) barra += v
      if (COCINA_DEPTS.includes(dep.name)) cocina += v
      const cur = deptMap.get(dep.name) ?? { name: dep.name, ventas: 0, ganancia: 0 }
      cur.ventas += v
      cur.ganancia += num(dep.ganancia)
      deptMap.set(dep.name, cur)
    }
  }
  const rentabilidad = [...deptMap.values()]
    .map((r) => ({ ...r, margen: r.ventas > 0 ? (r.ganancia / r.ventas) * 100 : null }))
    .sort((a, b) => b.ganancia - a.ganancia)
  if (billarDays.length) {
    rentabilidad.push({
      name: 'Billar / Juegos (mesas)',
      ventas: billarVenta,
      ganancia: billarUtilidad,
      margen: billarVenta > 0 ? (billarUtilidad / billarVenta) * 100 : null,
    })
  }

  const inversion = sumDays((d) => d.entriesImporte)
  const merma = sumDays((d) => d.mermasCosto)

  // Total cobrado del mes: pagos de cuentas con fecha de pago en el mes.
  const pagosMes = []
  for (const r of data?.receivables ?? []) {
    for (const p of r.payments ?? []) {
      if (monthKeyOf(p.paidDate) === monthKey) pagosMes.push({ ...p, client: r.client })
    }
  }
  for (const p of data?.localPayments ?? []) {
    if (monthKeyOf(p.date) === monthKey) {
      const rec = (data?.receivables ?? []).find((r) => r.id === p.receivableId)
      pagosMes.push({ id: p.id, amount: num(p.amount), paidDate: p.date, paymentMethod: p.method, client: rec?.client ?? '' })
    }
  }
  const totalCobrado = pagosMes.reduce((s, p) => s + num(p.amount), 0)

  // Foto de fondos del último día importado del mes.
  const lastDay = days.length ? days[days.length - 1] : null
  const efectivoCaja = lastDay ? num(lastDay.fondos?.efectivo) : null
  const zelleCierre = lastDay ? num(lastDay.fondos?.zelle) : null
  const divisasCierre = lastDay ? num(lastDay.fondos?.divisasCUP) : null

  // Cuentas por cobrar HOY (foto actual, no del mes): pendientes por
  // categoría con su saldo efectivo, morosas y dinero en la calle.
  const pendientes = (data?.receivables ?? [])
    .map((r) => ({ rec: r, saldo: saldoEfectivo(r, data?.localPayments ?? []) }))
    .filter((x) => esPendiente(x.rec, x.saldo))
  const porCategoria = (cat) => pendientes.filter((x) => x.rec.category === cat).reduce((s, x) => s + x.saldo, 0)
  const morosas = pendientes.filter((x) => esMorosa(x.rec, x.saldo, today))
  const cuentasPorCobrar = {
    total: pendientes.reduce((s, x) => s + x.saldo, 0),
    count: pendientes.length,
    clientes: porCategoria('cliente'),
    trabajadores: porCategoria('trabajador'),
    administrativos: porCategoria('administrativo'),
    dineroEnLaCalle: porCategoria('cliente'),
    morosasTotal: morosas.reduce((s, x) => s + x.saldo, 0),
    morosasCount: morosas.length,
  }

  // Consumo de la casa del mes: pendientes de las personas de la casa
  // (persona jesus/dayami/alejandro) nacidas en el mes.
  const consumoRows = pendientes.filter(
    (x) => x.rec.persona && x.rec.persona !== 'general' && monthKeyOf(x.rec.date) === monthKey,
  )
  const consumoDe = (p) => consumoRows.filter((x) => x.rec.persona === p).reduce((s, x) => s + x.saldo, 0)
  const consumoCasa = consumoRows.reduce((s, x) => s + x.saldo, 0)
  const consumo = { total: consumoCasa, jesus: consumoDe('jesus'), dayami: consumoDe('dayami'), alejandro: consumoDe('alejandro') }

  const resultado = neta - gastos + ingresosExtras
  const resultadoEfectivo = neta - gastos - consumoCasa

  // Fondos/reservas (los medidores del original).
  const totalDaysInMonth = daysInMonthOf(monthKey)
  const elapsedInMonth = monthKey < monthKeyOf(today) ? totalDaysInMonth : monthKey === monthKeyOf(today) ? Number(today.slice(8, 10)) : 0
  const quarterMonths = quarterMonthsOf(monthKey)
  const quarterDays = (data?.days ?? []).filter((d) => quarterMonths.includes(monthKeyOf(d.date)))
  const quarterNeta = quarterDays.reduce((s, d) => s + num(d.gananciaNeta), 0)
  const quarterTotalDays = quarterMonths.reduce((s, mk) => s + daysInMonthOf(mk), 0)
  const quarterElapsed = quarterMonths.reduce((s, mk) => {
    if (mk < monthKeyOf(today)) return s + daysInMonthOf(mk)
    if (mk === monthKeyOf(today)) return s + Number(today.slice(8, 10))
    return s
  }, 0)

  // Quincenas de CONTABILIDAD (naturales del mes): 1–15 y 16–fin.
  const period = (from, to) => {
    const pd = days.filter((d) => d.date >= from && d.date <= to)
    const pe = expenses.filter((e) => e.date >= from && e.date <= to)
    return {
      from,
      to,
      days: pd.length,
      ventas: pd.reduce((s, d) => s + num(d.ventasDia), 0),
      bruta: pd.reduce((s, d) => s + num(d.gananciaBruta), 0),
      neta: pd.reduce((s, d) => s + num(d.gananciaNeta), 0),
      gastos: pe.reduce((s, e) => s + num(e.total), 0),
    }
  }
  const lastDate = `${monthKey}-${String(totalDaysInMonth).padStart(2, '0')}`
  const quincenas = [period(`${monthKey}-01`, `${monthKey}-15`), period(`${monthKey}-16`, lastDate)]

  // Gastos por categoría y por origen (del mes).
  const groupBy = (rows, keyOf) => {
    const map = new Map()
    for (const r of rows) {
      const k = keyOf(r)
      map.set(k, (map.get(k) ?? 0) + num(r.total))
    }
    return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
  }

  return {
    monthKey,
    daysCount: days.length,
    firstDay: days.length ? days[0].date : null,
    lastDay: lastDay ? lastDay.date : null,
    ventas,
    bruta,
    neta,
    gastos,
    gastosCount: expenses.length,
    ingresosExtras,
    ingresosExtrasCount: extrasList.length,
    extrasList,
    billar: { venta: billarVenta, utilidad: billarUtilidad, dias: billarDays.length },
    barra,
    cocina,
    deptSeen: days.some((d) => (d.departments ?? []).length > 0),
    rentabilidad,
    inversion,
    merma,
    totalCobrado,
    cobrosCount: pagosMes.length,
    efectivoCaja,
    zelleCierre,
    divisasCierre,
    cuentasPorCobrar,
    consumo,
    resultado,
    resultadoEfectivo,
    reservas: {
      fondoVentasMes: ventas * 0.1,
      fondoVentasProgreso: totalDaysInMonth > 0 ? Math.min(100, (elapsedInMonth / totalDaysInMonth) * 100) : 0,
      diasConIpv: days.length,
      diasDelMes: totalDaysInMonth,
      fondoUtilidadesTrimestre: quarterNeta * 0.15,
      trimestreNeta: quarterNeta,
      trimestreDias: quarterDays.length,
      trimestreProgreso: quarterTotalDays > 0 ? Math.min(100, (quarterElapsed / quarterTotalDays) * 100) : 0,
      trimestreDiasTotal: quarterTotalDays,
      trimestreMeses: quarterMonths,
    },
    quincenas,
    gastosPorCategoria: groupBy(expenses, (e) => (e.category || '').trim() || 'Otros'),
    gastosPorOrigen: groupBy(expenses, (e) => e.origin || 'manual'),
    expenses,
  }
}

/** Meses con datos (días o gastos), más el mes en curso; del más reciente al más antiguo. */
export function availableMonths(data, today) {
  const set = new Set([monthKeyOf(today)])
  for (const d of data?.days ?? []) if (d.date) set.add(monthKeyOf(d.date))
  for (const e of data?.expenses ?? []) if (e.date) set.add(monthKeyOf(e.date))
  return [...set].filter(Boolean).sort().reverse()
}
