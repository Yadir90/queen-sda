// Queen SDA — generador del SQL de importación inicial a Supabase.
//
// Uso: node scripts/generate-import-sql.mjs [ruta-al-respaldo] [ruta-sql-salida]
// Lee el respaldo real del SDA y genera supabase/import-backup-2026-10-24.sql:
// inserts IDEMPOTENTES (on conflict do update) para TODAS las tablas
// que la app lee al arrancar: public.days, public.receivables,
// public.transfer_movements (el historial de la tarjeta del negocio
// que trae el respaldo), public.expenses, public.workers,
// public.payroll_history y la fila 'core' de public.app_settings
// (ancla, alias, aprendizaje y overrides de cuentas).
//
// HISTORIAL (defecto grave, 26-oct): la primera versión de este
// generador solo escribía días, cuentas y movimientos. La tabla de
// gastos quedó vacía en producción y el Informe de Economía y la
// presentación generados por la app viva salieron con «Gastos del
// mes: 0 CUP» (faltaban los 275.505 enteros) — la semilla tiene que
// escribir todo lo que la app lee, o la app lee ceros en silencio.
// Las columnas salen del MISMO parser de la app
// (src/lib/backupCore.mjs) y el payload jsonb de cada fila es el registro
// original completo del respaldo — cero datos inventados.
//
// Antes de escribir, comprueba los totales de control del respaldo de
// referencia y ABORTA si no cuadran. Al final imprime el resumen para
// contrastarlo con la verificación independiente del archivo generado.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBackup } from '../src/lib/backupCore.mjs'
import { canonicalPersonKey, clientKeyOf, deriveSuppressedEntries, firstNameKeyOf } from '../src/lib/syncCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const backupPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(here, '../../goals/panorama-mensual-la-reina/hidden_files/backups/backup-sda-2026-10-24.json')
const outPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(here, '../supabase/import-backup-2026-10-24.sql')

// Totales de control por respaldo (verificados contra fuente
// independiente: ver scripts/verify-import.mjs).
const EXPECTED_BY_FILE = {
  'backup-sda-2026-10-24.json': { count: 23, from: '2026-10-01', to: '2026-10-23', ventas: 2662090, gananciaBruta: 667141, gananciaNeta: 645576, cuadreTotal: 0, receivables: 115, cardMovements: 20, cardBalance: 32625, bankPassed: 107625, gastosCount: 51, gastosTotal: 262505, workersCount: 25, payrollTotal: 168500 },
  'backup-sda-2026-10-26.json': { count: 24, from: '2026-10-01', to: '2026-10-24', ventas: 2786190, gananciaBruta: 718191, gananciaNeta: 696096, cuadreTotal: 0, receivables: 119, cardMovements: 21, cardBalance: 33725, bankPassed: 107625, gastosCount: 51, gastosTotal: 275505, workersCount: 25, payrollTotal: 181500 },
}
const EXPECTED = EXPECTED_BY_FILE[backupPath.split('/').pop()]
if (!EXPECTED) { console.error(`Sin totales de control registrados para ${backupPath}: no se genera a ciegas.`); process.exit(1) }

const raw = JSON.parse(readFileSync(backupPath, 'utf8'))
const parsed = parseBackup(raw)
const s = parsed.summary

const checks = [
  ['n.º de días', s.count, EXPECTED.count],
  ['fecha inicial', s.from, EXPECTED.from],
  ['fecha final', s.to, EXPECTED.to],
  ['ventas totales', s.ventas, EXPECTED.ventas],
  ['ganancia bruta', s.gananciaBruta, EXPECTED.gananciaBruta],
  ['ganancia neta', s.gananciaNeta, EXPECTED.gananciaNeta],
  ['cuadre total', s.cuadreTotal, EXPECTED.cuadreTotal],
  ['n.º de cuentas', parsed.receivables.length, EXPECTED.receivables],
  ['n.º de movimientos de la tarjeta', parsed.transferMovements.length, EXPECTED.cardMovements],
  [
    'saldo derivado de la tarjeta',
    parsed.transferMovements.filter((m) => !m.excluded && !m.superseded).reduce((s, m) => s + m.amount, 0),
    EXPECTED.cardBalance,
  ],
  ['pasado al banco derivado', parsed.transferMovements.filter((m) => !m.excluded && !m.superseded && m.source === 'pase' && m.paseKind === 'banco').reduce((s, m) => s + Math.abs(m.amount), 0), EXPECTED.bankPassed],
  ['n.º de gastos', parsed.expenses.length, EXPECTED.gastosCount],
  ['total de gastos', parsed.expenses.reduce((s, e) => s + Number(e.total ?? 0), 0), EXPECTED.gastosTotal],
  ['n.º de trabajadores', parsed.workers.length, EXPECTED.workersCount],
  ['total de nómina registrada', parsed.payrollHistory.reduce((s, p) => s + Number(p.total ?? (p.employees ?? []).reduce((x, e) => x + Number(e.totalCobrar ?? 0), 0)), 0), EXPECTED.payrollTotal],
]
let failed = 0
for (const [label, got, want] of checks) {
  if (got !== want) {
    failed++
    console.error(`✗ FALLO ${label}: esperado ${want}, obtenido ${got}`)
  }
}
if (failed > 0) {
  console.error('ABORTADO: el respaldo no reproduce los totales de control; no se genera ningún SQL.')
  process.exit(1)
}

// Registros originales completos para el payload (por fecha / por id).
const rawDayByDate = new Map(raw.data.days.map((d) => [String(d.date), d]))
const rawRecById = new Map(raw.data.receivables.map((r) => [String(r.id), r]))
const embeddedPayments = raw.data.receivables.reduce(
  (n, r) => n + (Array.isArray(r.payments) ? r.payments.length : 0),
  0,
)

// ---------- utilidades de escape SQL ----------
const sqlText = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`
const sqlTextOrNull = (v) => (v === null || v === undefined || v === '' ? 'NULL' : sqlText(v))
const sqlJson = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
const sqlDate = (v) => {
  const d = String(v ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Fecha inválida en el respaldo: ${v}`)
  return `'${d}'`
}
const sqlNum = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`Número inválido en el respaldo: ${v}`)
  return String(n)
}

// ---------- filas ----------
const dayRows = parsed.days.map((d) => {
  const payload = rawDayByDate.get(d.date) ?? d
  return `(${sqlDate(d.date)}, ${sqlNum(d.ventasDia)}, ${sqlNum(d.gananciaBruta)}, ${sqlNum(d.gananciaNeta)}, ${sqlNum(d.cuadre)}, ${sqlJson(payload)})`
})

const recRows = parsed.receivables.map((r) => {
  const payload = rawRecById.get(r.id) ?? r
  const status = r.status || 'pendiente'
  return `(${sqlText(r.id)}, ${sqlText(r.client)}, ${sqlText(r.clientKey)}, ${sqlText(r.category)}, ${sqlDate(r.date)}, ${sqlNum(r.originalAmount)}, ${sqlNum(r.saldoBase)}, ${sqlText(status)}, ${sqlTextOrNull(r.closeKind)}, ${sqlText(r.detail)}, ${sqlJson(payload)})`
})

const movRows = parsed.transferMovements.map((m) => {
  const intOrNull = (v) => (v === null || v === undefined ? 'NULL' : String(Math.trunc(Number(v))))
  return `(${sqlText(m.id)}, ${sqlDate(m.date)}, ${sqlText(m.type)}, ${sqlText(m.source)}, ${sqlNum(m.amount)}, ${sqlText(m.detail)}, ${m.excluded ? 'true' : 'false'}, ${m.superseded ? 'true' : 'false'}, ${intOrNull(m.paseId)}, ${intOrNull(m.manualId)}, ${intOrNull(m.paymentCreditId)}, ${intOrNull(m.extraId)}, ${intOrNull(m.transferExpenseId)}, ${sqlTextOrNull(m.paseKind)}, ${sqlJson(m)})`
})

const sqlDateOrNull = (v) => (v === null || v === undefined || v === '' ? 'NULL' : sqlDate(v))

const rawExpById = new Map((raw.data.expenses ?? []).map((e) => [String(e.id), e]))
const expenseRows = parsed.expenses.map((e) => {
  const payload = rawExpById.get(String(e.id)) ?? e
  return `(${sqlText(e.id)}, ${sqlDate(e.date)}, ${sqlText(e.concept)}, ${sqlText(e.category)}, ${sqlText(e.dept)}, ${sqlNum(e.quantity ?? 1)}, ${sqlNum(e.unitValue ?? 0)}, ${sqlNum(e.total)}, ${sqlText(e.origin ?? 'manual')}, ${sqlTextOrNull(e.sourceKey)}, ${sqlDateOrNull(e.cycleStart)}, ${sqlText(e.note ?? '')}, ${sqlJson(payload)})`
})

const rawWorkerByKey = new Map((raw.data.workers ?? []).map((w) => [String(w.key), w]))
const workerRows = parsed.workers.map((w) => {
  const payload = rawWorkerByKey.get(String(w.key)) ?? w
  return `(${sqlText(w.key)}, ${sqlText(w.nombre)}, ${sqlText(w.ocupacion ?? '')}, ${sqlText(w.carnet ?? '')}, ${sqlText(w.cuentaBancaria ?? '')}, ${sqlText(w.movil ?? '')}, ${sqlText(w.notas ?? '')}, ${sqlText(w.origen ?? 'ipv')}, ${sqlText(w.roleKind ?? 'trabajador')}, ${sqlJson(payload)})`
})

const rawPayrollByStart = new Map((raw.data.payrollHistory ?? []).map((p) => [String(p.cycleStart), p]))
const payrollRows = parsed.payrollHistory.map((p) => {
  const payload = rawPayrollByStart.get(String(p.cycleStart)) ?? p
  const total = Number(p.total ?? (p.employees ?? []).reduce((x, e) => x + Number(e.totalCobrar ?? 0), 0))
  return `(${sqlDate(p.cycleStart)}, ${sqlDate(p.cycleEnd)}, ${sqlDate(p.payDate)}, ${sqlNum(total)}, ${sqlJson(payload)})`
})

// La fila 'core' de app_settings: sin ella la app arranca en Supabase
// sin ancla ni aprendizaje — y la sincronización clasifica las
// cuentas del Desglose sin las decisiones del dueño (la otra mitad
// del defecto de los gastos). suppressedEntries se deriva igual que
// en la app al importar (deriveSuppressedEntries con las personas
// conocidas del propio respaldo).
const knownPersons = (() => {
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
})()
const coreSettings = {
  anchorDate: parsed.anchorDate ?? undefined,
  aliases: {},
  learnedKinds: parsed.learnedKinds,
  cuentasOverrides: parsed.cuentasOverrides,
  suppressedEntries: deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, {
    learnedKinds: parsed.learnedKinds, overrides: parsed.cuentasOverrides, knownPersons,
  }),
  unpaidWorkers: [],
  payrollAdjustments: {},
}

// ---------- documento SQL ----------
const lines = []
lines.push('-- Queen SDA — Sistema de Automatización de Datos V2.0 · Restaurante-bar La Reina')
lines.push('-- Importación inicial a Supabase desde el respaldo real del SDA.')
lines.push(`-- Fuente: respaldo exportado el ${raw.exportedAt ?? '—'} (${raw.backupOf ?? 'SDA La Reina'}), archivo ${backupPath.split('/').pop()}.`)
lines.push('-- Generado por scripts/generate-import-sql.mjs usando el parser de la app')
lines.push('-- (src/lib/backupCore.mjs): las columnas salen del parser y el payload')
lines.push('-- jsonb de cada fila es el registro ORIGINAL completo del respaldo.')
lines.push('-- Cero datos inventados: ninguna cifra se ajusta ni se redondea aquí.')
lines.push('--')
lines.push('-- CÓMO APLICARLO: pégalo en el SQL Editor del proyecto Supabase «queen-sda»')
lines.push('-- y ejecútalo (el SQL Editor trabaja sin RLS; desde la app solo el admin')
lines.push('-- podría escribir). Es IDEMPOTENTE: se puede ejecutar las veces que sea')
lines.push('-- (insert ... on conflict do update por fecha en days y por id en receivables).')
lines.push('--')
lines.push('-- TOTALES DE CONTROL (verificados contra el respaldo antes de generar):')
lines.push(`--   Días: ${s.count} · Rango: ${s.from} → ${s.to}`)
lines.push(`--   Ventas totales: ${s.ventas} · Ganancia bruta: ${s.gananciaBruta} · Ganancia neta: ${s.gananciaNeta} · Cuadre total: ${s.cuadreTotal}`)
lines.push(`--   Cuentas: ${parsed.receivables.length}`)
lines.push(`--   Los ${embeddedPayments} abonos que ya trae el respaldo quedan dentro de`)
lines.push('--   receivables.payload (y de su saldo): la tabla payments es para los')
lines.push('--   abonos NUEVOS de Cobrar (origin=\'cobrar\'), no se duplican aquí.')
lines.push('')
lines.push('begin;')
lines.push('')
lines.push(`-- ===== Días (${dayRows.length}) =====`)
lines.push('insert into public.days (date, ventas_dia, ganancia_bruta, ganancia_neta, cuadre, payload) values')
lines.push(dayRows.map((r, i) => r + (i < dayRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (date) do update set')
lines.push('  ventas_dia = excluded.ventas_dia,')
lines.push('  ganancia_bruta = excluded.ganancia_bruta,')
lines.push('  ganancia_neta = excluded.ganancia_neta,')
lines.push('  cuadre = excluded.cuadre,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push(`-- ===== Cuentas por cobrar (${recRows.length}) =====`)
lines.push('insert into public.receivables (id, client, client_key, category, date, original_amount, saldo, status, close_kind, detail, payload) values')
lines.push(recRows.map((r, i) => r + (i < recRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (id) do update set')
lines.push('  client = excluded.client,')
lines.push('  client_key = excluded.client_key,')
lines.push('  category = excluded.category,')
lines.push('  date = excluded.date,')
lines.push('  original_amount = excluded.original_amount,')
lines.push('  saldo = excluded.saldo,')
lines.push('  status = excluded.status,')
lines.push('  close_kind = excluded.close_kind,')
lines.push('  detail = excluded.detail,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push(`-- ===== Movimientos de la tarjeta (${movRows.length}) =====`)
lines.push('-- El historial viaja TAL COMO el sistema original lo registró: la')
lines.push('-- marca «No es de La Reina» (excluded) de una fila que ya exista en el')
lines.push('-- servidor NO se pisa con la del respaldo (es decisión del dueño).')
lines.push('insert into public.transfer_movements (id, date, type, source, amount, detail, excluded, superseded, pase_id, manual_id, payment_credit_id, extra_id, transfer_expense_id, pase_kind, payload) values')
lines.push(movRows.map((r, i) => r + (i < movRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (id) do update set')
lines.push('  date = excluded.date,')
lines.push('  type = excluded.type,')
lines.push('  source = excluded.source,')
lines.push('  amount = excluded.amount,')
lines.push('  detail = excluded.detail,')
lines.push('  superseded = excluded.superseded,')
lines.push('  pase_id = excluded.pase_id,')
lines.push('  manual_id = excluded.manual_id,')
lines.push('  payment_credit_id = excluded.payment_credit_id,')
lines.push('  extra_id = excluded.extra_id,')
lines.push('  transfer_expense_id = excluded.transfer_expense_id,')
lines.push('  pase_kind = excluded.pase_kind,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push(`-- ===== Gastos (${expenseRows.length}) =====`)
lines.push('-- SIN esta tabla la app lee gastos = [] y el Informe sale con')
lines.push('-- «Gastos del mes: 0» (defecto del 26-oct en producción).')
lines.push('insert into public.expenses (id, date, concept, category, dept, quantity, unit_value, total, origin, source_key, cycle_start, note, payload) values')
lines.push(expenseRows.map((r, i) => r + (i < expenseRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (id) do update set')
lines.push('  date = excluded.date,')
lines.push('  concept = excluded.concept,')
lines.push('  category = excluded.category,')
lines.push('  dept = excluded.dept,')
lines.push('  quantity = excluded.quantity,')
lines.push('  unit_value = excluded.unit_value,')
lines.push('  total = excluded.total,')
lines.push('  origin = excluded.origin,')
lines.push('  source_key = excluded.source_key,')
lines.push('  cycle_start = excluded.cycle_start,')
lines.push('  note = excluded.note,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push(`-- ===== Trabajadores (${workerRows.length}) =====`)
lines.push('insert into public.workers (key, nombre, ocupacion, carnet, cuenta_bancaria, movil, notas, origen, role_kind, payload) values')
lines.push(workerRows.map((r, i) => r + (i < workerRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (key) do update set')
lines.push('  nombre = excluded.nombre,')
lines.push('  ocupacion = excluded.ocupacion,')
lines.push('  carnet = excluded.carnet,')
lines.push('  cuenta_bancaria = excluded.cuenta_bancaria,')
lines.push('  movil = excluded.movil,')
lines.push('  notas = excluded.notas,')
lines.push('  origen = excluded.origen,')
lines.push('  role_kind = excluded.role_kind,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push(`-- ===== Nómina registrada (${payrollRows.length} ciclos) =====`)
lines.push('insert into public.payroll_history (cycle_start, cycle_end, pay_date, total, payload) values')
lines.push(payrollRows.map((r, i) => r + (i < payrollRows.length - 1 ? ',' : '')).join('\n'))
lines.push('on conflict (cycle_start) do update set')
lines.push('  cycle_end = excluded.cycle_end,')
lines.push('  pay_date = excluded.pay_date,')
lines.push('  total = excluded.total,')
lines.push('  payload = excluded.payload,')
lines.push('  imported_at = now();')
lines.push('')
lines.push('-- ===== Ajustes del núcleo (app_settings «core») =====')
lines.push('-- Ancla de ciclos RH + aprendizaje de cuentas del Desglose +')
lines.push('-- overrides del dueño: sin esta fila la sync clasifica sin')
lines.push('-- sus decisiones y los gastos del IPV quedan a merced de la')
lines.push('-- heurística.')
lines.push('insert into public.app_settings (key, value) values')
lines.push(`('core', ${sqlJson(coreSettings)})`)
lines.push('on conflict (key) do update set')
lines.push('  value = excluded.value,')
lines.push('  updated_at = now();')
lines.push('')
lines.push('commit;')
lines.push('')
lines.push('-- ===== Verificación tras importar (ejecutar y contrastar con el control) =====')
lines.push("-- Control: 23 días · 2026-10-01 → 2026-10-23 · ventas 2662090 · bruta 667141 · neta 645576 · cuadre 0 · 115 cuentas")
lines.push('select count(*) as dias, min(date) as desde, max(date) as hasta,')
lines.push('       sum(ventas_dia) as ventas, sum(ganancia_bruta) as bruta,')
lines.push('       sum(ganancia_neta) as neta, sum(cuadre) as cuadre')
lines.push('from public.days;')
lines.push('select count(*) as cuentas from public.receivables;')
lines.push(`-- Control tarjeta: ${EXPECTED.cardMovements} movimientos · saldo derivado ${EXPECTED.cardBalance} · pasado al banco ${EXPECTED.bankPassed}`)
lines.push("select count(*) as movimientos,")
lines.push("       sum(case when not excluded and not superseded then amount else 0 end) as saldo")
lines.push('from public.transfer_movements;')
lines.push("select sum(abs(amount)) as pasado_al_banco from public.transfer_movements")
lines.push("where source = 'pase' and pase_kind = 'banco' and not excluded and not superseded;")
lines.push(`-- Control gastos: ${EXPECTED.gastosCount} · total ${EXPECTED.gastosTotal} · trabajadores ${EXPECTED.workersCount} · nómina registrada ${EXPECTED.payrollTotal}`)
lines.push('select count(*) as gastos, sum(total) as total_gastos from public.expenses;')
lines.push('select count(*) as trabajadores from public.workers;')
lines.push('select count(*) as ciclos, sum(total) as total_nomina from public.payroll_history;')
lines.push("select value ->> 'anchorDate' as ancla, (select count(*) from jsonb_object_keys(value -> 'learnedKinds')) as aprendidos from public.app_settings where key = 'core';")
lines.push('')

writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`SQL generado: ${outPath}`)
console.log(`Días escritos: ${dayRows.length} · Cuentas escritas: ${recRows.length} · Movimientos de la tarjeta: ${movRows.length} · Abonos embebidos (en payload): ${embeddedPayments}`)
console.log(`Gastos escritos: ${expenseRows.length} (total ${parsed.expenses.reduce((s, e) => s + Number(e.total ?? 0), 0)}) · Trabajadores: ${workerRows.length} · Ciclos de nómina: ${payrollRows.length} · app_settings «core»: ancla ${coreSettings.anchorDate ?? '—'}, ${Object.keys(coreSettings.learnedKinds).length} aprendidos, ${Object.keys(coreSettings.cuentasOverrides).length} overrides`)
console.log(`Totales de control OK: ventas ${s.ventas} · bruta ${s.gananciaBruta} · neta ${s.gananciaNeta} · cuadre ${s.cuadreTotal}`)
