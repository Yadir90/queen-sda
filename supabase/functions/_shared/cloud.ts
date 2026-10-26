// @ts-nocheck
/* Ayudante compartido de las tareas programadas (Edge Functions).
 *
 * Habla con PostgREST usando la clave de servicio que Supabase
 * inyecta en el entorno de la función (SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY llegan solos; ningún secreto se escribe
 * en este archivo). Arma el mismo StoredData que consume la app
 * desde los payload completos de cada tabla — espejo de
 * sbFetchStoredData (src/lib/supabaseBackend.ts): si mañana cambia
 * el armado en la app, hay que espejarlo aquí.
 *
 * Los núcleos .mjs compartidos (automatizacionesCore y su cadena)
 * se copian desde src/lib/ a esta carpeta _shared/ en el paso de
 * despliegue de la puerta final: son ESM puro con importaciones
 * relativas, así que la copia funciona tal cual en Deno.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

export function cloudConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY)
}

/** Comprueba el secreto compartido con pg_cron (CRON_SECRET, creado
 *  por el dueño como secreto de la función; aquí solo se nombra). */
export function cronAuthorized(req) {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  if (!expected) return false
  return req.headers.get('x-cron-secret') === expected
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`PostgREST ${res.status} en ${path}: ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const payloads = (rows) => (Array.isArray(rows) ? rows : [])
  .map((r) => (r && typeof r.payload === 'object' ? r.payload : null))
  .filter(Boolean)

/** Arma el StoredData desde las tablas (payloads completos). */
export async function loadStoredData() {
  const [days, receivables, payments, expenses, workers, payroll, movements, packages, bulletins, queen, auto, settingsRows] = await Promise.all([
    rest('days?select=payload&order=date.asc'),
    rest('receivables?select=payload'),
    rest('payments?select=id,receivable_id,amount,paid_date,payment_method,origin,created_at'),
    rest('expenses?select=payload'),
    rest('workers?select=payload'),
    rest('payroll_history?select=payload'),
    rest('transfer_movements?select=payload&order=date.asc'),
    rest('package_references?select=payload'),
    rest('bulletins?select=payload'),
    rest('queen_state?select=id,payload'),
    rest('automation_state?select=id,payload').catch(() => []),
    rest("app_settings?select=value&key=eq.core").catch(() => []),
  ])
  const recList = payloads(receivables)
  const byId = new Map(recList.map((r) => [r.id, r]))
  const localPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p.origin === 'cobrar')
    .map((p) => ({
      id: p.id, receivableId: p.receivable_id,
      clientKey: byId.get(p.receivable_id)?.clientKey ?? '',
      amount: Number(p.amount ?? 0), date: p.paid_date,
      method: p.payment_method === 'transferencia' ? 'transferencia' : 'efectivo',
      createdAt: p.created_at ?? '',
    }))
  const settings = (Array.isArray(settingsRows) && settingsRows[0]?.value) || {}
  const queenRow = (Array.isArray(queen) ? queen : []).find((r) => r.id === 'evolution')
  const runsRow = (Array.isArray(auto) ? auto : []).find((r) => r.id === 'runs')
  const learningRow = (Array.isArray(auto) ? auto : []).find((r) => r.id === 'learning')
  const data = {
    version: 2,
    importedAt: null,
    exportedAt: null,
    backupOf: 'Supabase',
    days: payloads(days),
    receivables: recList,
    localPayments,
    expenses: payloads(expenses),
    workers: payloads(workers),
    payrollHistory: payloads(payroll),
    anchorDate: settings.anchorDate ?? '2026-09-23',
    aliases: settings.aliases ?? {},
    learnedKinds: settings.learnedKinds ?? {},
    cuentasOverrides: settings.cuentasOverrides ?? {},
    suppressedEntries: settings.suppressedEntries ?? [],
    unpaidWorkers: settings.unpaidWorkers ?? [],
    payrollAdjustments: settings.payrollAdjustments ?? {},
    transferMovements: payloads(movements),
    packageReferences: payloads(packages),
    bulletins: payloads(bulletins),
    queenEvolution: queenRow?.payload ?? null,
    automationRuns: Array.isArray(runsRow?.payload) ? runsRow.payload : [],
    queenLearning: learningRow?.payload && typeof learningRow.payload === 'object' ? learningRow.payload : null,
    expensesCount: 0, payrollCount: 0, workersCount: 0,
  }
  data.expensesCount = data.expenses.length
  data.payrollCount = data.payrollHistory.length
  data.workersCount = data.workers.length
  return data
}

/** Guarda filas de automation_state (upsert por id). */
export async function saveAutomationRows(rows) {
  if (!rows.length) return
  await rest('automation_state?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows.map((r) => ({ id: r.id, payload: r.payload, updated_at: new Date().toISOString() }))),
  })
}

/** Añade una corrida al registro persistido y aplica la poda del
 *  núcleo (se conservan las últimas 90 por tarea). */
export async function appendAutomationRun(run, currentRuns, pruneAutomationRuns) {
  const next = pruneAutomationRuns([...(currentRuns ?? []), run])
  await saveAutomationRows([{ id: 'runs', payload: next }])
  return next
}

/** Guarda la cola de boletines actualizada (upsert por id). */
export async function saveBulletins(bulletins) {
  if (!bulletins.length) return
  await rest('bulletins?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(bulletins.map((b) => ({ id: b.id, date: b.date, payload: b, updated_at: new Date().toISOString() }))),
  })
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
