// Queen SDA — capa remota (Supabase): autenticación y datos.
//
// Se usa SOLO cuando Supabase está configurado (ver supabaseClient.ts).
// Diseño: esta capa NO reescribe las pantallas. Lee las tablas del esquema
// (days, receivables, payments) y las convierte al MISMO StoredData que ya
// consumen Inicio, Días, Cuentas, Cobrar y Sistema; el payload jsonb de cada
// fila guarda el registro completo tal como entró del respaldo, así que la
// reconstrucción pasa por el mismo parser de la app (backupCore) y ninguna
// cifra se recalcula ni se ajusta aquí.
//
// Seguridad real = Supabase Auth + RLS del servidor:
// - profiles / user_roles dicen el rol ('admin' | 'lectura') y si la persona
//   debe cambiar su contraseña al primer ingreso (must_change_password).
// - Lectura: cualquier usuario autenticado CON rol. Escritura: solo admin
//   (la base de datos lo impone; un perfil de lectura que intentara escribir
//   recibiría el rechazo del servidor, no solo el de la interfaz).
// - Los abonos de Cobrar se insertan en payments con origin='cobrar' y al
//   releer se aplican como capa sobre el saldo del respaldo, igual que los
//   abonos locales del modo local. Los pagos que ya trae el respaldo viven
//   dentro de receivables.payload (y de su saldo): NO se duplican en payments.
//
// Límite conocido del esquema aplicado: la política de escritura de
// `profiles` es solo-admin, así que un usuario de lectura puede cambiar su
// contraseña en Auth pero no puede marcar él mismo must_change_password=false
// (el admin sí puede). La app no se bloquea por eso: tras cambiarla, entra;
// el aviso volverá a salir en su próximo ingreso hasta que el admin lo marque.

import type { AutomationRun, Bulletin, DayData, ElaborationIngredientHistoryEntry, ElaborationRecipe, ElaborationStore, ElaborationWasteLog, Expense, ExtraIncome, InventoryAdjustment, LocalPayment, MonthlyArchive, PackageReference, PayrollEmployee, PayrollRecord, QueenEvolutionHistoryEntry, QueenEvolutionSnapshot, QueenLearningState, Receivable, ReceivablePhoto, Role, Session, SmsLog, SmsOutboxItem, StoredData, TransferMovement, VenueInventoryItem, WarehouseEntry, WarehouseProductMeta, Worker, WorkerExtended, WorkerHiringForm, WorkerPayment, WorkerWorkContract } from '../types'
import { EMPTY_DATA, type LoginResult } from './backend'
import { getSupabase, supabaseBaseUrl } from './supabaseClient'
import { enqueueOfflineOp, registerOfflineExecutor, type QueuedOp } from './offlineQueue'
import { normalizeDay, normalizeExpense, normalizePayroll, normalizeReceivable, normalizeWorkerRecord, parseBackup } from './backupCore.mjs'
import { applyImportedPaidAccounts, buildWorkersRegistry, canonicalPersonKey, clientKeyOf, deriveSuppressedEntries, firstNameKeyOf, syncDerivedData } from './syncCore.mjs'
import { venueItemFromRaw, warehouseEntryFromRaw, warehouseMetaFromRaw } from './modulosExtended'
import { defaultElaborationStore, ELABORATION_SETTINGS_FALLBACK } from './elaboracionCore.mjs'

/** Sesión remota ya resuelta: el Session de la app + si debe cambiar la contraseña. */
export interface RemoteSession {
  session: Session
  mustChange: boolean
}

interface ProfileRow {
  display_name: string | null
  email: string | null
  must_change_password: boolean | null
}

interface DayRow {
  date: string
  ventas_dia: number | string
  ganancia_bruta: number | string
  ganancia_neta: number | string
  cuadre: number | string
  payload: Record<string, unknown> | null
  imported_at: string | null
}

interface ReceivableRow {
  id: string
  client: string
  client_key: string
  category: string
  date: string
  original_amount: number | string
  saldo: number | string
  status: string
  close_kind: string | null
  detail: string | null
  payload: Record<string, unknown> | null
  imported_at: string | null
}

interface PaymentRow {
  id: string
  receivable_id: string
  amount: number | string
  paid_date: string
  payment_method: string
  origin: string
  created_at: string | null
}

interface ExpenseRow {
  id: string
  date: string
  concept: string | null
  category: string | null
  dept: string | null
  quantity: number | string | null
  unit_value: number | string | null
  total: number | string | null
  origin: string | null
  source_key: string | null
  cycle_start: string | null
  note: string | null
  payload: Record<string, unknown> | null
}

interface WorkerRow {
  key: string
  nombre: string
  ocupacion: string | null
  carnet: string | null
  cuenta_bancaria: string | null
  movil: string | null
  notas: string | null
  origen: string | null
  role_kind: string | null
  payload: Record<string, unknown> | null
}

interface PayrollRow {
  cycle_start: string
  cycle_end: string
  pay_date: string
  total: number | string
  payload: Record<string, unknown> | null
}

interface TransferRow {
  id: string
  date: string
  type: string
  source: string
  amount: number | string
  detail: string | null
  excluded: boolean | null
  superseded: boolean | null
  pase_id: number | null
  manual_id: number | null
  payment_credit_id: number | null
  extra_id: number | null
  transfer_expense_id: number | null
  pase_kind: string | null
  payload: Record<string, unknown> | null
}

/** Ajustes del núcleo guardados en app_settings (fila 'core'). */
interface CoreSettings {
  anchorDate?: string
  aliases?: StoredData['aliases']
  learnedKinds?: Record<string, string>
  cuentasOverrides?: Record<string, string>
  suppressedEntries?: string[]
  unpaidWorkers?: string[]
  payrollAdjustments?: Record<string, PayrollEmployee[]>
}

function sb() {
  const client = getSupabase()
  if (!client) throw new Error('Supabase no está configurado en este proyecto.')
  return client
}

// ---------- Cola offline de escrituras (D-03/D-68) ----------
// Las escrituras de las pantallas pasan por withOfflineQueue: sin red
// (o con la red caída a mitad de la escritura) NO se pierden ni se
// fingen guardadas: quedan en la cola durable de offlineQueue.ts y se
// reenvían EN ORDEN al volver la conexión; la píldora ConnectionStatus
// cuenta esos pendientes reales. Si el servidor RESPONDE y rechaza
// (RLS, tabla ausente), el error se propaga como siempre: encolar un
// rechazo solo lo repetiría. La sonda distingue ambos casos: cualquier
// respuesta HTTP del proyecto = servidor alcanzado = rechazo real.
async function supabaseReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const base = supabaseBaseUrl()
  if (!base) return false
  try {
    await fetch(`${base}/rest/v1/`, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
    return true
  } catch {
    return false
  }
}

async function withOfflineQueue(fn: string, args: unknown[], run: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await enqueueOfflineOp(fn, args)
    return
  }
  try {
    await run()
  } catch (e) {
    if (await supabaseReachable()) throw e
    await enqueueOfflineOp(fn, args)
  }
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function hasContent(payload: Record<string, unknown> | null): payload is Record<string, unknown> {
  return Boolean(payload && typeof payload === 'object' && Object.keys(payload).length > 0)
}

// ---------- Perfiles y sesión (Supabase Auth) ----------

async function loadRemoteSession(userId: string, emailFallback: string): Promise<RemoteSession> {
  const client = sb()
  const { data: prof } = await client
    .from('profiles')
    .select('display_name, email, must_change_password')
    .eq('id', userId)
    .maybeSingle<ProfileRow>()
  const { data: roleRow } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle<{ role: string }>()

  // Sin fila de rol todavía: se entra como lectura (RLS no dejará leer datos
  // hasta que el admin cree las filas de profiles/user_roles de esa cuenta).
  const role: Role = roleRow?.role === 'admin' ? 'admin' : 'lectura'
  const session: Session = {
    profileId: userId,
    name: prof?.display_name?.trim() || prof?.email || emailFallback,
    email: prof?.email || emailFallback,
    role,
  }
  return { session, mustChange: prof?.must_change_password ?? true }
}

/** Restaura la sesión guardada por Supabase Auth en este dispositivo, si la hay. */
export async function sbRestoreSession(): Promise<RemoteSession | null> {
  const client = sb()
  const { data } = await client.auth.getSession()
  const user = data.session?.user
  if (!user) return null
  return loadRemoteSession(user.id, user.email ?? '')
}

/** Ingreso con correo y contraseña contra Supabase Auth. */
export async function sbLogin(email: string, password: string): Promise<LoginResult & { mustChange?: boolean }> {
  const client = sb()
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error || !data.user) {
    const invalid = /invalid login credentials/i.test(error?.message ?? '')
    return { ok: false, error: invalid ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.' }
  }
  const remote = await loadRemoteSession(data.user.id, data.user.email ?? email.trim())
  return { ok: true, session: remote.session, mustChange: remote.mustChange }
}

export async function sbLogout(): Promise<void> {
  await sb().auth.signOut()
}

/**
 * Recuperación de contraseña por la vía nativa de Supabase Auth:
 * envía el correo con el enlace mágico de recuperación, que vuelve a
 * ESTA misma app (redirectTo = origen + ruta actuales). Supabase no
 * revela si el correo existe: la respuesta es la misma en ambos casos.
 */
export async function sbRequestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim()
  if (!clean || !clean.includes('@')) return { ok: false, error: 'Escribe tu correo electrónico.' }
  const redirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await sb().auth.resetPasswordForEmail(clean, { redirectTo })
  if (error) return { ok: false, error: 'No se pudo enviar el correo de recuperación. Revisa tu conexión e inténtalo de nuevo.' }
  return { ok: true }
}

/** ¿La URL actual trae un enlace de recuperación de Supabase?
 *  El éxito llega como `#access_token=…&type=recovery` (lo consume
 *  supabase-js al arrancar) y el enlace caducado como
 *  `#error=access_denied&error_code=otp_expired&error_description=…`. */
export function recoveryParamsFromUrl(): { isRecovery: boolean; error: string | null } {
  if (typeof window === 'undefined') return { isRecovery: false, error: null }
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const params = new URLSearchParams(hash)
  if (params.get('type') === 'recovery') return { isRecovery: true, error: null }
  const err = params.get('error')
  if (err) {
    const desc = params.get('error_description')?.replace(/\+/g, ' ') ?? ''
    return {
      isRecovery: true,
      error: /expired|otp/i.test(`${params.get('error_code') ?? ''} ${desc}`)
        ? 'El enlace de recuperación caducó o ya se usó. Pide uno nuevo desde «¿Olvidaste tu contraseña?».'
        : 'El enlace de recuperación no es válido. Pide uno nuevo desde «¿Olvidaste tu contraseña?».',
    }
  }
  return { isRecovery: false, error: null }
}

/** Avisa cuando Supabase confirma el evento PASSWORD_RECOVERY de la
 *  sesión (el enlace abrió la app y la sesión de recuperación quedó
 *  activa). Devuelve la función para cancelar la suscripción. */
export function sbOnPasswordRecovery(callback: () => void): () => void {
  const { data } = sb().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') callback()
  })
  return () => data.subscription.unsubscribe()
}

/**
 * Cambia la contraseña del usuario autenticado (Auth) y, si RLS lo permite,
 * apaga su marca de cambio obligatorio en profiles (hoy: solo el admin puede
 * escribir en profiles; ver la nota de límites al inicio de este archivo).
 */
export async function sbChangePassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 6) return { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' }
  const client = sb()
  const { data: userData, error } = await client.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }
  const userId = userData.user?.id
  if (userId) {
    // Mejor esfuerzo: si RLS lo deniega (usuario de lectura), la contraseña
    // ya quedó cambiada en Auth y la app continúa; queda documentado arriba.
    await client.from('profiles').update({ must_change_password: false }).eq('id', userId)
  }
  return { ok: true }
}

// ---------- Datos del negocio (tablas con RLS) ----------

function dayFromRow(row: DayRow): DayData {
  if (hasContent(row.payload)) return normalizeDay(row.payload)
  return {
    date: row.date,
    ventasDia: num(row.ventas_dia),
    gananciaBruta: num(row.ganancia_bruta),
    gananciaNeta: num(row.ganancia_neta),
    cuadre: num(row.cuadre),
    departments: [],
    entriesCount: 0,
    gastosIpv: 0,
    mermasCosto: 0,
    fondos: { efectivo: 0, transferencias: 0, totalCuentasPorCobrar: 0, divisasCUP: 0, zelle: 0, totalFondos: 0, ventas: 0 },
    cuentasPagadas: [],
    entriesImporte: 0,
    billar: null,
    extras: [],
  }
}

function receivableFromRow(row: ReceivableRow): Receivable {
  if (hasContent(row.payload)) return normalizeReceivable(row.payload)
  const category: Receivable['category'] = ['cliente', 'trabajador', 'administrativo'].includes(row.category)
    ? (row.category as Receivable['category'])
    : 'cliente'
  return {
    id: row.id,
    client: row.client,
    clientKey: row.client_key,
    category,
    date: row.date,
    originalAmount: num(row.original_amount),
    amount: num(row.original_amount),
    saldoBase: num(row.saldo),
    totalAbonadoBase: 0,
    payments: [],
    status: row.status,
    paidDate: null,
    paymentMethod: null,
    closeKind: row.close_kind,
    detail: row.detail ?? '',
    origin: '',
  }
}

function expenseFromRow(row: ExpenseRow): Expense {
  if (hasContent(row.payload)) return normalizeExpense(row.payload)
  return {
    id: row.id,
    date: row.date,
    concept: row.concept ?? '',
    category: row.category ?? '',
    dept: row.dept ?? '',
    quantity: num(row.quantity) || 1,
    unitValue: num(row.unit_value),
    total: num(row.total),
    origin: row.origin ?? 'manual',
    sourceKey: row.source_key,
    cycleStart: row.cycle_start,
    note: row.note ?? '',
  }
}

function workerFromRow(row: WorkerRow): Worker {
  const base = hasContent(row.payload)
    ? normalizeWorkerRecord(row.payload)
    : normalizeWorkerRecord({
        key: row.key, nombre: row.nombre, ocupacion: row.ocupacion ?? '', carnet: row.carnet ?? '',
        cuentaBancaria: row.cuenta_bancaria ?? '', movil: row.movil ?? '', notas: row.notas ?? '', origen: row.origen ?? 'ipv',
      })
  return { ...base, roleKind: row.role_kind === 'direccion' ? 'direccion' : 'trabajador' }
}

function movementFromRow(row: TransferRow): TransferMovement {
  if (hasContent(row.payload)) {
    const p = row.payload as unknown as TransferMovement
    return {
      id: row.id,
      date: String(p.date ?? row.date),
      type: ['abono', 'pase', 'gasto', 'reversion'].includes(p.type) ? p.type : 'abono',
      source: ['ipv', 'pago-cuenta', 'manual', 'pase', 'extra', 'gasto-transferencia'].includes(p.source) ? p.source : 'manual',
      amount: num(p.amount),
      detail: String(p.detail ?? ''),
      // La marca «No es de La Reina» manda desde la columna: es el
      // campo que el administrador cambia sin reimportar el respaldo.
      excluded: Boolean(row.excluded),
      superseded: Boolean(row.superseded),
      paseId: row.pase_id ?? (p.paseId ?? null),
      manualId: row.manual_id ?? (p.manualId ?? null),
      paymentCreditId: row.payment_credit_id ?? (p.paymentCreditId ?? null),
      extraId: row.extra_id ?? (p.extraId ?? null),
      transferExpenseId: row.transfer_expense_id ?? (p.transferExpenseId ?? null),
      paseKind: row.pase_kind === 'banco' || row.pase_kind === 'efectivo' ? row.pase_kind : (p.paseKind ?? null),
      local: Boolean(p.local),
    }
  }
  return {
    id: row.id,
    date: row.date,
    type: ['abono', 'pase', 'gasto', 'reversion'].includes(row.type) ? (row.type as TransferMovement['type']) : 'abono',
    source: ['ipv', 'pago-cuenta', 'manual', 'pase', 'extra', 'gasto-transferencia'].includes(row.source)
      ? (row.source as TransferMovement['source'])
      : 'manual',
    amount: num(row.amount),
    detail: row.detail ?? '',
    excluded: Boolean(row.excluded),
    superseded: Boolean(row.superseded),
    paseId: row.pase_id,
    manualId: row.manual_id,
    paymentCreditId: row.payment_credit_id,
    extraId: row.extra_id,
    transferExpenseId: row.transfer_expense_id,
    paseKind: row.pase_kind === 'banco' || row.pase_kind === 'efectivo' ? row.pase_kind : null,
    local: false,
  }
}

function movementToRow(m: TransferMovement) {
  return {
    id: m.id,
    date: m.date,
    type: m.type,
    source: m.source,
    amount: m.amount,
    detail: m.detail,
    excluded: m.excluded,
    superseded: m.superseded,
    pase_id: m.paseId,
    manual_id: m.manualId,
    payment_credit_id: m.paymentCreditId,
    extra_id: m.extraId,
    transfer_expense_id: m.transferExpenseId,
    pase_kind: m.paseKind,
    payload: m,
  }
}

function payrollFromRow(row: PayrollRow): PayrollRecord {
  if (hasContent(row.payload)) return normalizePayroll(row.payload)
  return {
    id: row.cycle_start,
    cycleStart: row.cycle_start,
    cycleEnd: row.cycle_end,
    payDate: row.pay_date,
    total: num(row.total),
    workersCount: 0,
    employees: [],
  }
}

async function fetchCoreSettings(): Promise<CoreSettings> {
  const client = sb()
  const { data, error } = await client.from('app_settings').select('value').eq('key', 'core').maybeSingle<{ value: CoreSettings }>()
  if (error || !data?.value) return {}
  return data.value
}

/** Estado extendido de trabajadores + historial de evolución de
 *  Queen: dos claves propias de app_settings, extraídas del servidor
 *  original (no viajan en el respaldo). Si la fila no existe aún en
 *  el proyecto, se leen como vacías y la app sigue. */
interface RawExtendedWorker {
  id?: number
  worker_key?: string
  nombre?: string
  ocupacion?: string
  rest_weekday?: number | null
  work_weekday?: number | null
  work_weekdays?: number[] | string | null
  turno_asignado?: number | null
  turno_correccion?: number | null
  estrellas?: number | null
  genero?: string
  escolaridad?: string
  contrato_cancelado_el?: string | null
  contrato_cancelado_ciclo?: string | null
  ausencias?: Array<{ id?: string; fecha?: string; motivo?: string }> | null
  fecha_contratacion?: string | null
  /** Documento único de contratación (asistente en 6 pasos): objetos
   *  de texto completos, tal como se guardan desde la ficha. Las filas
   *  escritas antes de existir el asistente no los traen: se leen
   *  como null y el asistente nace del autocompletado. */
  hiring_form?: Record<string, unknown> | null
  work_contract?: Record<string, unknown> | null
}

const HIRING_FORM_KEYS = [
  'fechaContratacion', 'nombre', 'primerApellido', 'segundoApellido', 'calle', 'numero', 'codigoPostal',
  'carnet', 'municipio', 'provincia', 'sexo', 'edad', 'estudiosTerminados', 'campoEstudios', 'enfermedad',
  'medicamentos', 'correo', 'telefono', 'estadoCivil', 'hijos', 'cantidadHijos', 'cuentaBancaria', 'idiomas',
  'firmaTrabajador', 'institucion', 'direccionInstitucion', 'correoInstitucion', 'telefonoInstitucion',
  'ocupacion', 'departamento', 'horasTrabajo', 'salario', 'anosExperiencia', 'evaluacion', 'curriculum',
  'rhNombre', 'rhPrimerApellido', 'rhSegundoApellido', 'rhCargo', 'firmaRh', 'updatedAt',
] as const
const WORK_CONTRACT_KEYS = [
  'nombreTrabajador', 'carnet', 'profesionOficio', 'direccion', 'municipio', 'provincia', 'tipoContrato',
  'pruebaDesde', 'pruebaHasta', 'ocupacion', 'grupoEscala', 'escalaSalarial', 'categoriaOcupacional',
  'lugarTrabajo', 'jornada', 'horario', 'fechaFirma', 'firmaAdministracion', 'firmaTrabajador', 'updatedAt',
] as const

/** Objeto de texto del extendido (formulario/contrato): solo pasan
 *  las claves conocidas y solo como texto; cualquier otra forma se
 *  lee como ausente, nunca rompe la carga de la ficha. */
function stringRecordFromRaw<T extends object>(raw: unknown, keys: readonly string[]): T | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of keys) out[k] = typeof src[k] === 'string' ? (src[k] as string) : ''
  return out as T
}

function parseWeekdays(raw: RawExtendedWorker['work_weekdays']): number[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw) as unknown; return Array.isArray(p) ? p : [] } catch { return [] } })() : []
  return list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
}

function extendedFromRaw(r: RawExtendedWorker): WorkerExtended {
  const turno = (v: number | null | undefined): 1 | 2 | null => (v === 1 || v === 2 ? v : null)
  return {
    id: typeof r.id === 'number' ? r.id : 0,
    workerKey: String(r.worker_key ?? ''),
    nombre: String(r.nombre ?? ''),
    ocupacion: String(r.ocupacion ?? ''),
    restWeekday: typeof r.rest_weekday === 'number' ? r.rest_weekday : null,
    workWeekday: typeof r.work_weekday === 'number' ? r.work_weekday : null,
    workWeekdays: parseWeekdays(r.work_weekdays),
    turnoAsignado: turno(r.turno_asignado),
    turnoCorreccion: turno(r.turno_correccion),
    estrellas: typeof r.estrellas === 'number' && Number.isFinite(r.estrellas) ? Math.max(0, Math.min(5, Math.round(r.estrellas))) : 0,
    genero: String(r.genero ?? ''),
    escolaridad: String(r.escolaridad ?? ''),
    contratoCanceladoEl: r.contrato_cancelado_el ?? null,
    contratoCanceladoCiclo: r.contrato_cancelado_ciclo ?? null,
    ausencias: Array.isArray(r.ausencias)
      ? r.ausencias.filter((a) => a && typeof a.fecha === 'string').map((a, i) => ({ id: String(a.id ?? `aus-${i}`), fecha: String(a.fecha), motivo: String(a.motivo ?? '') }))
      : [],
    fechaContratacion: r.fecha_contratacion ?? '',
    hiringForm: stringRecordFromRaw<WorkerHiringForm>(r.hiring_form, HIRING_FORM_KEYS),
    workContract: stringRecordFromRaw<WorkerWorkContract>(r.work_contract, WORK_CONTRACT_KEYS),
  }
}

/** WorkerExtended → forma cruda de app_settings 'workers-extended'. */
function extendedToRaw(e: WorkerExtended): RawExtendedWorker {
  return {
    id: e.id || undefined,
    worker_key: e.workerKey,
    nombre: e.nombre,
    ocupacion: e.ocupacion,
    rest_weekday: e.restWeekday,
    work_weekday: e.workWeekday,
    work_weekdays: e.workWeekdays,
    turno_asignado: e.turnoAsignado,
    turno_correccion: e.turnoCorreccion,
    estrellas: e.estrellas,
    genero: e.genero,
    escolaridad: e.escolaridad,
    contrato_cancelado_el: e.contratoCanceladoEl,
    contrato_cancelado_ciclo: e.contratoCanceladoCiclo,
    ausencias: (e.ausencias ?? []).map((a) => ({ id: a.id, fecha: a.fecha, motivo: a.motivo })),
    fecha_contratacion: e.fechaContratacion || null,
    hiring_form: e.hiringForm ? { ...e.hiringForm } : undefined,
    work_contract: e.workContract ? { ...e.workContract } : undefined,
  }
}

interface RawHistoryEntry {
  stage_id?: string
  stage_name?: string
  score?: number
  metrics?: Record<string, number> | string | null
  reason?: string
  reached_at?: number | string | null
}

function historyFromRaw(r: RawHistoryEntry): QueenEvolutionHistoryEntry {
  let metrics: Record<string, number> = {}
  if (typeof r.metrics === 'string') {
    try { metrics = JSON.parse(r.metrics) as Record<string, number> } catch { metrics = {} }
  } else if (r.metrics && typeof r.metrics === 'object') metrics = r.metrics
  const reached = typeof r.reached_at === 'number' && Number.isFinite(r.reached_at)
    ? new Date(r.reached_at).toISOString()
    : typeof r.reached_at === 'string' ? r.reached_at : null
  return {
    stageId: String(r.stage_id ?? ''),
    stageName: String(r.stage_name ?? ''),
    score: typeof r.score === 'number' ? r.score : 0,
    metrics: metrics && typeof metrics === 'object' ? metrics : {},
    reason: String(r.reason ?? ''),
    reachedAt: reached,
  }
}

export interface ExtendedSettings {
  workersExtended: WorkerExtended[]
  queenEvolutionHistory: QueenEvolutionHistoryEntry[]
  warehouseEntries: WarehouseEntry[]
  warehouseMeta: Record<string, WarehouseProductMeta>
  venueInventory: VenueInventoryItem[]
  receivablePhotos: ReceivablePhoto[]
  smsLogs: SmsLog[]
  smsOutbox: SmsOutboxItem[]
  monthlyArchives: MonthlyArchive[]
  workerPayments: WorkerPayment[]
  workersHistorial: import('../types').WorkerHistorialEntry[]
  elaboration: ElaborationStore
  extraIncomes: ExtraIncome[]
  inventoryAdjustments: InventoryAdjustment[]
}

const EMPTY_EXTENDED: ExtendedSettings = {
  workersExtended: [], queenEvolutionHistory: [],
  warehouseEntries: [], warehouseMeta: {}, venueInventory: [],
  receivablePhotos: [], smsLogs: [], smsOutbox: [], monthlyArchives: [], workerPayments: [], workersHistorial: [],
  elaboration: defaultElaborationStore(),
  extraIncomes: [],
  inventoryAdjustments: [],
}

async function fetchExtendedSettings(): Promise<ExtendedSettings> {
  const client = sb()
  const { data, error } = await client
    .from('app_settings')
    .select('key, value')
    .in('key', ['workers-extended', 'queen-evolution-history', 'almacen-extended', 'venue-inventory', 'backup-collections', 'elaboracion', 'extra-incomes', 'existencias-ajustes'])
  if (error || !data) return EMPTY_EXTENDED
  const rows = data as Array<{ key: string; value: Record<string, unknown> | null }>
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const extRow = byKey.get('workers-extended') as { workers?: RawExtendedWorker[] } | undefined
  const histRow = byKey.get('queen-evolution-history') as { history?: RawHistoryEntry[] } | undefined
  // Oleada 2: almacén manual e Inventario de bienes, extraídos del
  // servidor original por la coordinación (modulos-extended-import.sql).
  const almRow = byKey.get('almacen-extended') as { entries?: Array<Record<string, unknown>>; meta?: unknown } | undefined
  const venRow = byKey.get('venue-inventory') as { items?: Array<Record<string, unknown>> } | undefined
  const elabRow = byKey.get('elaboracion') as Partial<ElaborationStore> | undefined
  const extraRow = byKey.get('extra-incomes') as { items?: ExtraIncome[] } | undefined
  const adjRow = byKey.get('existencias-ajustes') as { items?: InventoryAdjustment[] } | undefined
  // Las cinco colecciones del respaldo, persistidas aquí al importar
  // (sbImportBackup): no tienen tabla propia en el clon.
  const colRow = byKey.get('backup-collections') as Partial<Pick<ExtendedSettings, 'receivablePhotos' | 'smsLogs' | 'smsOutbox' | 'monthlyArchives' | 'workerPayments' | 'workersHistorial'>> | undefined
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    workersExtended: Array.isArray(extRow?.workers) ? extRow.workers.map(extendedFromRaw) : [],
    queenEvolutionHistory: Array.isArray(histRow?.history) ? histRow.history.map(historyFromRaw) : [],
    warehouseEntries: Array.isArray(almRow?.entries) ? almRow.entries.map(warehouseEntryFromRaw) : [],
    warehouseMeta: warehouseMetaFromRaw(almRow?.meta),
    venueInventory: Array.isArray(venRow?.items) ? venRow.items.map(venueItemFromRaw) : [],
    elaboration: {
      ...defaultElaborationStore(),
      ...(elabRow ?? {}),
      settings: { ...ELABORATION_SETTINGS_FALLBACK, ...(elabRow?.settings ?? {}) },
      recipes: arr<ElaborationRecipe>(elabRow?.recipes),
      removedProducts: arr<ElaborationStore['removedProducts'][number]>(elabRow?.removedProducts),
      manualProducts: arr<ElaborationStore['manualProducts'][number]>(elabRow?.manualProducts),
      wasteLogs: arr<ElaborationWasteLog>(elabRow?.wasteLogs),
      ingredientHistory: arr<ElaborationIngredientHistoryEntry>(elabRow?.ingredientHistory),
    },
    receivablePhotos: arr<ReceivablePhoto>(colRow?.receivablePhotos),
    smsLogs: arr<SmsLog>(colRow?.smsLogs),
    smsOutbox: arr<SmsOutboxItem>(colRow?.smsOutbox),
    monthlyArchives: arr<MonthlyArchive>(colRow?.monthlyArchives),
    workerPayments: arr<WorkerPayment>(colRow?.workerPayments),
    workersHistorial: arr<import('../types').WorkerHistorialEntry>(colRow?.workersHistorial),
    extraIncomes: arr<ExtraIncome>(extraRow?.items),
    inventoryAdjustments: arr<InventoryAdjustment>(adjRow?.items),
  }
}

/** Guarda una clave completa de app_settings (solo admin, RLS). */
async function saveAppSetting(key: string, value: unknown, errorLabel: string): Promise<void> {
  const client = sb()
  const { error } = await client
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`El servidor rechazó guardar ${errorLabel}. Solo el administrador puede cambiarlo, o falló la conexión.`)
}

/**
 * Guarda el almacén manual completo (movimientos + metadatos) en
 * app_settings 'almacen-extended' — la misma clave de la que se lee.
 */
async function rawSbSaveWarehouseExtended(entries: WarehouseEntry[], meta: Record<string, WarehouseProductMeta>): Promise<void> {
  await saveAppSetting('almacen-extended', { entries, meta }, 'el almacén manual')
}

/**
 * Guarda el almacén COMPLETO de Elaboración (fichas de costo, ajustes
 * globales, productos manuales/eliminados, mermas e historial de
 * precios) en app_settings 'elaboracion' — la misma clave de la que
 * se lee. Las fichas no viajan en el respaldo: viven aquí.
 */
async function rawSbSaveElaborationStore(store: ElaborationStore): Promise<void> {
  await saveAppSetting('elaboracion', store, 'las fichas de costo de Elaboración')
}

/** Guarda los otros ingresos registrados a mano (Extras) en
 *  app_settings 'extra-incomes' — la misma clave de la que se lee. */
async function rawSbSaveExtraIncomes(items: ExtraIncome[]): Promise<void> {
  await saveAppSetting('extra-incomes', { items }, 'los otros ingresos registrados')
}

/** Guarda los ajustes manuales del libro (Existencias) en
 *  app_settings 'existencias-ajustes' — la misma clave de la que se lee. */
async function rawSbSaveInventoryAdjustments(items: InventoryAdjustment[]): Promise<void> {
  await saveAppSetting('existencias-ajustes', { items }, 'los ajustes del libro de existencias')
}

/** Sustituye los resúmenes mensuales dentro de 'backup-collections'
 *  (archivar un mes desde Archivo): lee la clave completa, cambia
 *  SOLO monthlyArchives y la regraba — las demás colecciones del
 *  respaldo quedan intactas. */
async function rawSbSaveMonthlyArchives(archives: MonthlyArchive[]): Promise<void> {
  const client = sb()
  const { data, error } = await client.from('app_settings').select('value').eq('key', 'backup-collections').maybeSingle()
  if (error) throw new Error('No se pudo leer el archivo mensual para guardarlo.')
  const current = (data?.value ?? {}) as Record<string, unknown>
  await saveAppSetting('backup-collections', { ...current, monthlyArchives: archives }, 'el archivo mensual')
}

/** Guarda piezas del registro de trabajadores: fichas base en la
 *  tabla workers (upsert por key; el llamador declara los keys que
 *  salen del registro activo y SOLO esos se borran de la tabla — su
 *  ficha vive en el historial), estado extendido completo en
 *  'workers-extended', y pagos manuales + historial fusionados en
 *  'backup-collections' sin tocar sus demás colecciones. */
async function rawSbSaveWorkersRegistry(patch: {
  workers?: Worker[]
  removeWorkerKeys?: string[]
  workersExtended?: WorkerExtended[]
  workerPayments?: WorkerPayment[]
  workersHistorial?: import('../types').WorkerHistorialEntry[]
}): Promise<void> {
  const client = sb()
  if (patch.workers?.length) {
    const { error } = await client.from('workers').upsert(patch.workers.map(workerToRow), { onConflict: 'key' })
    if (error) throw new Error('El servidor rechazó guardar las fichas de trabajadores.')
  }
  if (patch.removeWorkerKeys?.length) {
    const { error } = await client.from('workers').delete().in('key', patch.removeWorkerKeys)
    if (error) throw new Error('El servidor rechazó retirar las fichas del registro.')
  }
  if (patch.workersExtended) {
    await saveAppSetting('workers-extended', { workers: patch.workersExtended.map(extendedToRaw) }, 'el estado extendido de trabajadores')
  }
  if (patch.workerPayments || patch.workersHistorial) {
    const { data, error } = await client.from('app_settings').select('value').eq('key', 'backup-collections').maybeSingle()
    if (error) throw new Error('No se pudieron leer las colecciones para guardar el registro.')
    const current = (data?.value ?? {}) as Record<string, unknown>
    await saveAppSetting('backup-collections', {
      ...current,
      ...(patch.workerPayments ? { workerPayments: patch.workerPayments } : {}),
      ...(patch.workersHistorial ? { workersHistorial: patch.workersHistorial } : {}),
    }, 'el registro de trabajadores')
  }
}

/** Guarda el Inventario de bienes completo en 'venue-inventory'. */
async function rawSbSaveVenueInventory(items: VenueInventoryItem[]): Promise<void> {
  await saveAppSetting('venue-inventory', { items }, 'el inventario de bienes')
}

/** Sustituye cuentas por cobrar (editar / mover a morosas / eliminar
 *  desde la tarjeta, como en el original): upsert de cada fila con su
 *  payload completo y borrado SOLO de los ids que el llamador declara
 *  eliminados — nunca se infiere un borrado de una lista parcial. */
async function rawSbSaveReceivables(receivables: Receivable[], deletedIds: string[]): Promise<void> {
  const client = sb()
  if (receivables.length) {
    const { error } = await client.from('receivables').upsert(receivables.map(receivableToRow), { onConflict: 'id' })
    if (error) throw new Error('El servidor rechazó guardar las cuentas. Solo el administrador puede cambiarlas, o falló la conexión.')
  }
  if (deletedIds.length) {
    const { error } = await client.from('receivables').delete().in('id', deletedIds)
    if (error) throw new Error('El servidor rechazó eliminar la cuenta. Solo el administrador puede hacerlo, o falló la conexión.')
  }
}

async function saveCoreSettings(settings: CoreSettings): Promise<void> {
  const client = sb()
  const { error } = await client
    .from('app_settings')
    .upsert({ key: 'core', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error('El servidor rechazó guardar los ajustes de RH. Solo el administrador puede cambiarlos, o falló la conexión.')
}

function withCounts(data: StoredData): StoredData {
  return { ...data, expensesCount: data.expenses.length, payrollCount: data.payrollHistory.length, workersCount: data.workers.length }
}

/**
 * Lee el núcleo completo del servidor (días, cuentas, abonos de Cobrar,
 * gastos, trabajadores, nóminas y ajustes) y lo entrega como el mismo
 * StoredData del modo local. Los abonos con origin='cobrar' se
 * convierten en la capa de abonos locales equivalente. Las tablas de la
 * fase de integración pueden no existir aún en el proyecto: si faltan,
 * se leen como vacías (la app sigue funcionando con lo anterior).
 */
/**
 * Lectura completa del servidor con CACHÉ de lecturas sin conexión
 * (D-03): cada lectura buena se guarda en el dispositivo y, si la red
 * falla, se sirve la última foto que cargó bien — el comportamiento
 * del original («Tus datos están guardados: sigues viendo lo último
 * que cargó bien») — en vez de una pantalla vacía. La píldora de la
 * carcasa dice la verdad del estado («Sin conexión»/«Pendiente»).
 * Sin caché previa, el error de red se propaga como antes.
 */
const READ_CACHE_KEY = 'queen-sda:read-cache-v1'
export async function sbFetchStoredData(): Promise<StoredData> {
  try {
    const data = await rawFetchStoredData()
    try { localStorage.setItem(READ_CACHE_KEY, JSON.stringify(data)) } catch { /* cuota llena: la app sigue sin caché */ }
    return data
  } catch (e) {
    try {
      const raw = localStorage.getItem(READ_CACHE_KEY)
      if (raw) return JSON.parse(raw) as StoredData
    } catch { /* caché ilegible: se propaga el error original */ }
    throw e
  }
}

async function rawFetchStoredData(): Promise<StoredData> {
  const client = sb()
  const [daysRes, recRes, payRes, expRes, workRes, payrollRes, movRes, pkgRes, bulRes, queenRes, autoRes] = await Promise.all([
    client.from('days').select('date, ventas_dia, ganancia_bruta, ganancia_neta, cuadre, payload, imported_at').order('date'),
    client.from('receivables').select('id, client, client_key, category, date, original_amount, saldo, status, close_kind, detail, payload, imported_at'),
    client.from('payments').select('id, receivable_id, amount, paid_date, payment_method, origin, created_at').order('paid_date'),
    client.from('expenses').select('id, date, concept, category, dept, quantity, unit_value, total, origin, source_key, cycle_start, note, payload'),
    client.from('workers').select('key, nombre, ocupacion, carnet, cuenta_bancaria, movil, notas, origen, role_kind, payload'),
    client.from('payroll_history').select('cycle_start, cycle_end, pay_date, total, payload'),
    client.from('transfer_movements').select('id, date, type, source, amount, detail, excluded, superseded, pase_id, manual_id, payment_credit_id, extra_id, transfer_expense_id, pase_kind, payload').order('date'),
    client.from('package_references').select('id, name, payload').order('name'),
    client.from('bulletins').select('id, date, payload').order('date', { ascending: false }),
    client.from('queen_state').select('id, payload'),
    client.from('automation_state').select('id, payload'),
  ])
  if (daysRes.error || recRes.error || payRes.error) {
    throw new Error('No se pudieron leer los datos de Supabase. Revisa tu conexión e inténtalo de nuevo.')
  }

  const days = ((daysRes.data ?? []) as DayRow[]).map(dayFromRow)
  const receivables = ((recRes.data ?? []) as ReceivableRow[]).map(receivableFromRow)
  const byId = new Map(receivables.map((r) => [r.id, r]))

  const localPayments: LocalPayment[] = ((payRes.data ?? []) as PaymentRow[])
    .filter((p) => p.origin === 'cobrar')
    .map((p) => ({
      id: p.id,
      receivableId: p.receivable_id,
      clientKey: byId.get(p.receivable_id)?.clientKey ?? '',
      amount: num(p.amount),
      date: p.paid_date,
      method: p.payment_method === 'transferencia' ? 'transferencia' : 'efectivo',
      createdAt: p.created_at ?? '',
    }))

  // La tabla de movimientos de la tarjeta puede no existir aún en el
  // proyecto: se lee como vacía y la app sigue con lo demás. El orden
  // dentro del mismo día respeta la secuencia del historial original
  // (ids «ts-hN» del respaldo).
  const historyOrder = (id: string) => {
    const m = /^ts-h(\d+)$/.exec(id)
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
  }
  const transferMovements = movRes.error
    ? []
    : ((movRes.data ?? []) as TransferRow[]).map(movementFromRow).sort((a, b) => a.date.localeCompare(b.date) || historyOrder(a.id) - historyOrder(b.id))
  const expenses = expRes.error ? [] : ((expRes.data ?? []) as ExpenseRow[]).map(expenseFromRow)
  const rawWorkers = workRes.error ? [] : ((workRes.data ?? []) as WorkerRow[]).map(workerFromRow)
  const payrollHistory = payrollRes.error
    ? []
    : ((payrollRes.data ?? []) as PayrollRow[]).map(payrollFromRow).sort((a, b) => b.cycleStart.localeCompare(a.cycleStart))
  // Las referencias de paquetes de Elaboración pueden no tener tabla
  // aún en el proyecto: se leen como vacías y la app sigue.
  const packageReferences: PackageReference[] = pkgRes.error
    ? []
    : ((pkgRes.data ?? []) as Array<{ id: string; name: string; payload: PackageReference | null }>)
        .map((r) => (r.payload && typeof r.payload === 'object' ? { ...r.payload, id: r.id } : null))
        .filter((r): r is PackageReference => r != null)
  // La tabla de boletines puede no existir aún en el proyecto: se lee
  // como vacía y la app sigue (los boletines se derivan al leer).
  const bulletins: Bulletin[] = bulRes.error
    ? []
    : ((bulRes.data ?? []) as Array<{ id: string; date: string; payload: Bulletin | null }>)
        .map((r) => (r.payload && typeof r.payload === 'object' ? { ...r.payload, id: r.id, date: r.date } : null))
        .filter((b): b is Bulletin => b != null)
  // El estado de Queen (su medición de evolución) puede no tener
  // tabla aún en el proyecto: se lee como vacío y la app lo calcula
  // al leer, sin romper nada.
  const queenRow = queenRes.error
    ? null
    : ((queenRes.data ?? []) as Array<{ id: string; payload: QueenEvolutionSnapshot | null }>).find((r) => r.id === 'evolution')
  const queenEvolution: QueenEvolutionSnapshot | null = queenRow?.payload && typeof queenRow.payload === 'object' ? queenRow.payload : null
  // El estado de automatizaciones (registro de corridas + aprendizaje
  // nocturno) puede no tener tabla aún en el proyecto: se lee como
  // vacío y la app sigue; Sistema declara «pendiente de despliegue».
  const autoRows = autoRes.error
    ? []
    : ((autoRes.data ?? []) as Array<{ id: string; payload: unknown }>)
  const runsRow = autoRows.find((r) => r.id === 'runs')
  const automationRuns: AutomationRun[] = Array.isArray(runsRow?.payload) ? (runsRow.payload as AutomationRun[]) : []
  const learningRow = autoRows.find((r) => r.id === 'learning')
  const queenLearning: QueenLearningState | null = learningRow?.payload && typeof learningRow.payload === 'object'
    ? (learningRow.payload as QueenLearningState)
    : null
  const settings = await fetchCoreSettings().catch(() => ({} as CoreSettings))
  const extended = await fetchExtendedSettings().catch(() => EMPTY_EXTENDED)
  const workers = buildWorkersRegistry(rawWorkers, days, payrollHistory, settings.anchorDate ?? EMPTY_DATA.anchorDate) as Worker[]

  const stamps = [
    ...((daysRes.data ?? []) as DayRow[]).map((d) => d.imported_at),
    ...((recRes.data ?? []) as ReceivableRow[]).map((r) => r.imported_at),
  ].filter((s): s is string => Boolean(s)).sort()

  return withCounts({
    ...EMPTY_DATA,
    importedAt: stamps.length ? stamps[stamps.length - 1] : null,
    backupOf: 'Supabase',
    days,
    receivables,
    localPayments,
    expenses,
    workers,
    payrollHistory,
    anchorDate: settings.anchorDate ?? EMPTY_DATA.anchorDate,
    transferMovements,
    packageReferences,
    bulletins,
    queenEvolution,
    automationRuns,
    queenLearning,
    workersExtended: extended.workersExtended,
    queenEvolutionHistory: extended.queenEvolutionHistory,
    warehouseEntries: extended.warehouseEntries,
    warehouseMeta: extended.warehouseMeta,
    venueInventory: extended.venueInventory,
    receivablePhotos: extended.receivablePhotos,
    smsLogs: extended.smsLogs,
    smsOutbox: extended.smsOutbox,
    monthlyArchives: extended.monthlyArchives,
    workerPayments: extended.workerPayments,
    workersHistorial: extended.workersHistorial,
    extraIncomes: extended.extraIncomes,
    inventoryAdjustments: extended.inventoryAdjustments,
    aliases: settings.aliases ?? {},
    learnedKinds: settings.learnedKinds ?? {},
    cuentasOverrides: settings.cuentasOverrides ?? {},
    suppressedEntries: settings.suppressedEntries ?? [],
    unpaidWorkers: settings.unpaidWorkers ?? [],
    payrollAdjustments: settings.payrollAdjustments ?? {},
  })
}

// ---------- Referencias de paquetes de Elaboración ----------

/**
 * Guarda (crea o actualiza) una referencia de compra en el servidor.
 * Solo el administrador puede escribirla (RLS); la referencia completa
 * viaja en el payload y se reconstruye idéntica al releer.
 */
async function rawSbSavePackageReference(ref: PackageReference): Promise<void> {
  const client = sb()
  const { error } = await client
    .from('package_references')
    .upsert({ id: ref.id, name: ref.name, payload: ref, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw new Error('El servidor rechazó guardar la referencia. Solo el administrador puede guardarla, o falló la conexión.')
}

/** Borra una referencia de compra del servidor (solo administrador). */
async function rawSbDeletePackageReference(id: string): Promise<void> {
  const client = sb()
  const { error } = await client.from('package_references').delete().eq('id', id)
  if (error) throw new Error('El servidor rechazó borrar la referencia. Solo el administrador puede borrarla, o falló la conexión.')
}

// ---------- Escritura de la sincronización derivada ----------

function receivableToRow(r: Receivable) {
  return {
    id: r.id,
    client: r.client,
    client_key: r.clientKey,
    category: r.category,
    date: r.date,
    original_amount: r.originalAmount,
    saldo: r.saldoBase,
    status: r.status || 'pendiente',
    close_kind: r.closeKind,
    detail: r.detail,
    // El payload guarda el registro en la forma del respaldo para que
    // normalizeReceivable lo reconstruya idéntico al releer.
    payload: { ...r, saldo: r.saldoBase, totalAbonado: r.totalAbonadoBase },
  }
}

function expenseToRow(e: Expense) {
  return {
    id: e.id,
    date: e.date,
    concept: e.concept,
    category: e.category,
    dept: e.dept,
    quantity: e.quantity,
    unit_value: e.unitValue,
    total: e.total,
    origin: e.origin,
    source_key: e.sourceKey,
    cycle_start: e.cycleStart,
    note: e.note,
    payload: e,
  }
}

function workerToRow(w: Worker) {
  return {
    key: w.key,
    nombre: w.nombre,
    ocupacion: w.ocupacion,
    carnet: w.carnet,
    cuenta_bancaria: w.cuentaBancaria,
    movil: w.movil,
    notas: w.notas,
    origen: w.origen,
    role_kind: w.roleKind,
    payload: w,
  }
}

function payrollToRow(p: PayrollRecord) {
  return {
    cycle_start: p.cycleStart,
    cycle_end: p.cycleEnd,
    pay_date: p.payDate,
    total: p.total,
    payload: p,
  }
}

/**
 * Corre la sincronización derivada sobre el estado del servidor y
 * aplica SOLO el diff (altas/cambios/bajas de cuentas y gastos,
 * reapunte de abonos de Cobrar tras una fusión y alias aprendidos).
 * `paidDay`: el día recién importado cuya hoja «Cuentas pagadas» se
 * concilia en esta pasada (solo importaciones de Excel).
 */
async function sbSyncAndApply(paidDay?: DayData, accountSyncDates?: string[]): Promise<StoredData> {
  const client = sb()
  const state = await sbFetchStoredData()
  const synced = syncDerivedData({
    days: state.days,
    receivables: state.receivables,
    localPayments: state.localPayments,
    expenses: state.expenses,
    workers: state.workers,
    aliases: state.aliases,
    learnedKinds: state.learnedKinds,
    cuentasOverrides: state.cuentasOverrides,
    suppressedEntries: state.suppressedEntries,
    payrollHistory: state.payrollHistory,
    // Las cuentas solo se sincronizan para el día importado por Excel
    // (o para la fecha dada: p. ej. la de un día eliminado, D-07);
    // en una importación de respaldo quedan exactamente como vienen.
    accountSyncDates: accountSyncDates ?? (paidDay ? [paidDay.date] : []),
  })
  let receivables = synced.receivables
  if (paidDay) receivables = applyImportedPaidAccounts(receivables, paidDay).receivables

  const recById = new Map(receivables.map((r) => [r.id, r]))
  const changedIds = new Set<string>([...synced.createdReceivableIds, ...synced.updatedReceivableIds])
  if (paidDay) {
    // La conciliación de «Cuentas pagadas» puede tocar cuentas fuera de
    // la lista de la sincronización: se comparan saldos/estados.
    const before = new Map(state.receivables.map((r) => [r.id, r]))
    for (const r of receivables) {
      const b = before.get(r.id)
      if (b && (b.status !== r.status || b.saldoBase !== r.saldoBase)) changedIds.add(r.id)
    }
  }
  const changedRecs = [...changedIds].map((id) => recById.get(id)).filter((r): r is Receivable => Boolean(r))
  if (changedRecs.length) {
    const { error } = await client.from('receivables').upsert(changedRecs.map(receivableToRow), { onConflict: 'id' })
    if (error) throw new Error('El servidor rechazó la sincronización de cuentas del IPV.')
  }
  // Abonos de Cobrar reapuntados por una fusión verificada de cuentas:
  // ANTES de borrar las cuentas fusionadas — la FK de payments es
  // «on delete cascade» y borrar primero arrastraría el abono.
  const beforeLocal = new Map(state.localPayments.map((p) => [p.id, p.receivableId]))
  for (const p of synced.localPayments) {
    if (beforeLocal.has(p.id) && beforeLocal.get(p.id) !== p.receivableId) {
      await client.from('payments').update({ receivable_id: p.receivableId }).eq('id', p.id)
    }
  }

  if (synced.deletedReceivableIds.length) {
    const { error } = await client.from('receivables').delete().in('id', synced.deletedReceivableIds)
    if (error) throw new Error('El servidor rechazó la limpieza de cuentas del IPV.')
  }

  const expById = new Map(synced.expenses.map((e) => [e.id, e]))
  const changedExps = [...synced.createdExpenseIds, ...synced.updatedExpenseIds]
    .map((id) => expById.get(id))
    .filter((e): e is Expense => Boolean(e))
  if (changedExps.length) {
    const { error } = await client.from('expenses').upsert(changedExps.map(expenseToRow), { onConflict: 'id' })
    if (error) throw new Error('El servidor rechazó la sincronización de gastos del IPV.')
  }
  if (synced.deletedExpenseIds.length) {
    const { error } = await client.from('expenses').delete().in('id', synced.deletedExpenseIds)
    if (error) throw new Error('El servidor rechazó la limpieza de gastos del IPV.')
  }

  if (Object.keys(synced.newAliases).length) {
    const settings = await fetchCoreSettings()
    await saveCoreSettings({ ...settings, aliases: synced.aliases })
  }
  return sbFetchStoredData()
}

/**
 * Importa UN día leído de su IPV en Excel (registro crudo del lector,
 * src/lib/ipvCore.mjs): upsert por fecha en la tabla days, con el
 * registro completo como payload — al releerlo, dayFromRow lo reconstruye
 * con el mismo normalizeDay del respaldo. Si la fecha ya existe, el día
 * nuevo la REEMPLAZA (misma fecha, sin duplicar): es el equivalente al
 * «Editar este IPV» del sistema original. Solo admin (RLS); las cifras
 * viajan tal como vienen del IPV, sin recalcular ninguna.
 */
export async function sbImportIpvDay(rawDay: Record<string, unknown>): Promise<{ date: string }> {
  const day = normalizeDay(rawDay)
  const client = sb()
  const { error } = await client.from('days').upsert(
    {
      date: day.date,
      ventas_dia: day.ventasDia,
      ganancia_bruta: day.gananciaBruta,
      ganancia_neta: day.gananciaNeta,
      cuadre: day.cuadre,
      payload: rawDay,
      imported_at: new Date().toISOString(),
    },
    { onConflict: 'date' },
  )
  if (error) throw new Error('El servidor rechazó la importación del día. Solo el administrador puede importar el IPV, o falló la conexión.')
  // El día alimenta a la vez Cuentas/Cobrar, gastos y RH (todo integrado).
  await sbSyncAndApply(day)
  return { date: day.date }
}

/**
 * Elimina un día importado (puerto de `deleteDay` del original, D-07).
 * Solo admin (RLS). Orden: primero lo que cuelga de ese día y al final
 * el día y la re-derivación sin él:
 *  - boletines de esa fecha aún no enviados (los enviados quedan como
 *    historial, como en el original);
 *  - movimientos de la tarjeta derivados de ese IPV (source='ipv');
 *  - la foto de cuentas de ese día (app_settings 'backup-collections')
 *    y las decisiones de «Cuentas» de ese día (overrides/supresiones
 *    con su fecha, en los ajustes centrales);
 *  - la fila del día en `days`;
 *  - la sincronización derivada con esa fecha «viva»: retira las
 *    cuentas pendientes que solo ese día sostenía (las PAGADAS no se
 *    borran jamás) y recalcula los gastos automáticos y la nómina,
 *    igual que el syncCuentasExpenses/syncPayroll del original.
 */
export async function sbDeleteDay(date: string): Promise<void> {
  const client = sb()
  const { data: bulRows } = await client.from('bulletins').select('id, date, payload').eq('date', date)
  const pendingIds = ((bulRows ?? []) as Array<{ id: string; payload: Bulletin | null }>)
    .filter((r) => r.payload?.status !== 'enviado')
    .map((r) => r.id)
  if (pendingIds.length) {
    const { error } = await client.from('bulletins').delete().in('id', pendingIds)
    if (error) throw new Error('El servidor rechazó retirar los boletines de ese día.')
  }
  {
    const { error } = await client.from('transfer_movements').delete().eq('source', 'ipv').eq('date', date)
    if (error) throw new Error('El servidor rechazó retirar los movimientos del IPV de ese día.')
  }
  const extended = await fetchExtendedSettings().catch(() => EMPTY_EXTENDED)
  if (extended.receivablePhotos.some((p) => p.date === date)) {
    const { data: colRow } = await client.from('app_settings').select('value').eq('key', 'backup-collections').maybeSingle<{ value: Record<string, unknown> }>()
    const current = (colRow?.value ?? {}) as Record<string, unknown>
    await saveAppSetting('backup-collections', {
      ...current,
      receivablePhotos: extended.receivablePhotos.filter((p) => p.date !== date),
    }, 'la foto de cuentas del día')
  }
  const settings = await fetchCoreSettings()
  const cuentasOverrides = Object.fromEntries(Object.entries(settings.cuentasOverrides ?? {}).filter(([k]) => !k.startsWith(`${date}::`)))
  const suppressedEntries = (settings.suppressedEntries ?? []).filter((k) => !k.startsWith(`${date}::`))
  if (
    Object.keys(cuentasOverrides).length !== Object.keys(settings.cuentasOverrides ?? {}).length
    || suppressedEntries.length !== (settings.suppressedEntries ?? []).length
  ) {
    await saveCoreSettings({ ...settings, cuentasOverrides, suppressedEntries })
  }
  const { error } = await client.from('days').delete().eq('date', date)
  if (error) throw new Error('El servidor rechazó eliminar el día. Solo el administrador puede hacerlo, o falló la conexión.')
  await sbSyncAndApply(undefined, [date])
}

/**
 * Guarda ajustes de RH del admin (ancla de ciclos, interruptor
 * «No pagado», ajuste manual de nómina de un ciclo) en app_settings.
 */
export async function sbSaveRhSettings(patch: {
  anchorDate?: string
  unpaidWorkers?: string[]
  payrollAdjustment?: { cycleStart: string; employees: PayrollEmployee[] | null }
}): Promise<StoredData> {
  const settings = await fetchCoreSettings()
  const next: CoreSettings = { ...settings }
  if (patch.anchorDate) next.anchorDate = patch.anchorDate
  if (patch.unpaidWorkers) next.unpaidWorkers = patch.unpaidWorkers
  if (patch.payrollAdjustment) {
    const adjustments = { ...(settings.payrollAdjustments ?? {}) }
    if (patch.payrollAdjustment.employees) adjustments[patch.payrollAdjustment.cycleStart] = patch.payrollAdjustment.employees
    else delete adjustments[patch.payrollAdjustment.cycleStart]
    next.payrollAdjustments = adjustments
  }
  await saveCoreSettings(next)
  return sbFetchStoredData()
}

/**
 * Guardado del perfil propio desde Ajustes con Supabase (paridad
 * con el original: «Guardar perfil y acceso»): el nombre visible
 * se escribe en profiles.display_name de la cuenta autenticada y
 * el cambio de contraseña se hace con Supabase Auth tras
 * re-verificar la contraseña actual (nueva sesión de verificación
 * con signInWithPassword; si falla, no se toca nada). El correo
 * de acceso NO se cambia aquí: es la identidad de Supabase Auth y
 * su cambio exige el flujo de confirmación del servidor.
 */
export async function sbUpdateOwnProfile(patch: {
  name?: string
  currentPassword?: string
  newPassword?: string
}): Promise<{ ok: boolean; error?: string }> {
  const client = sb()
  const { data: userData } = await client.auth.getUser()
  const user = userData.user
  if (!user) return { ok: false, error: 'No hay sesión activa.' }
  if (patch.newPassword !== undefined) {
    if (!patch.currentPassword) return { ok: false, error: 'Escribe tu contraseña actual para cambiarla.' }
    if (patch.newPassword.length < 6) return { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' }
    if (!user.email) return { ok: false, error: 'La cuenta no tiene correo de acceso.' }
    const check = await client.auth.signInWithPassword({ email: user.email, password: patch.currentPassword })
    if (check.error) return { ok: false, error: 'La contraseña actual no coincide.' }
    const upd = await client.auth.updateUser({ password: patch.newPassword })
    if (upd.error) return { ok: false, error: `No se pudo cambiar la contraseña: ${upd.error.message}` }
  }
  const name = patch.name?.trim()
  if (name) {
    const { error } = await client.from('profiles').update({ display_name: name }).eq('id', user.id)
    if (error) return { ok: false, error: `No se pudo guardar el nombre: ${error.message}` }
  }
  return { ok: true }
}

/** Verifica la contraseña de la cuenta autenticada sin cambiar
 *  nada (la usa el restablecimiento del PIN de Ajustes). */
export async function sbVerifyPassword(password: string): Promise<boolean> {
  const client = sb()
  const { data } = await client.auth.getUser()
  const email = data.user?.email
  if (!email || !password) return false
  const check = await client.auth.signInWithPassword({ email, password })
  return !check.error
}

/**
 * Registra abonos de Cobrar en la tabla payments (origin='cobrar').
 * RLS solo deja insertar al admin; el llamador debe ser admin en la interfaz
 * y el servidor impone la misma regla aunque alguien la saltara.
 */
async function rawSbAddCobrarPayments(
  allocations: Array<{ receivableId: string; amount: number; date: string; method: 'efectivo' | 'transferencia' }>,
): Promise<void> {
  const client = sb()
  const { data: userData } = await client.auth.getUser()
  const rows = allocations.map((a) => ({
    receivable_id: a.receivableId,
    amount: a.amount,
    paid_date: a.date,
    payment_method: a.method,
    origin: 'cobrar',
    created_by: userData.user?.id ?? null,
  }))
  const { error } = await client.from('payments').insert(rows)
  if (error) throw new Error('El servidor rechazó el abono. Solo el administrador puede registrar abonos, o falló la conexión.')
}

/**
 * Importa un respaldo del SDA al servidor (upsert idempotente por fecha e id,
 * igual que el importador local). El payload de cada fila es el registro
 * original completo del respaldo; las columnas salen del mismo parser.
 * Solo admin (RLS). Los abonos de Cobrar ya registrados NO se tocan.
 */
export async function sbImportBackup(raw: unknown): Promise<{ days: number; receivables: number }> {
  const parsed = parseBackup(raw)
  const data = (raw as { data?: { days?: unknown[]; receivables?: unknown[] } }).data ?? {}
  const rawDayByDate = new Map((Array.isArray(data.days) ? data.days : []).map((d) => {
    const rec = d as Record<string, unknown>
    return [String(rec.date), rec] as const
  }))
  const rawRecById = new Map((Array.isArray(data.receivables) ? data.receivables : []).map((r) => {
    const rec = r as Record<string, unknown>
    return [String(rec.id), rec] as const
  }))

  const client = sb()
  const dayRows = parsed.days.map((d) => ({
    date: d.date,
    ventas_dia: d.ventasDia,
    ganancia_bruta: d.gananciaBruta,
    ganancia_neta: d.gananciaNeta,
    cuadre: d.cuadre,
    payload: rawDayByDate.get(d.date) ?? d,
  }))
  const { error: dayError } = await client.from('days').upsert(dayRows, { onConflict: 'date' })
  if (dayError) throw new Error('El servidor rechazó la importación de días. Solo el administrador puede importar, o falló la conexión.')

  const recRows = parsed.receivables.map((r) => ({
    id: r.id,
    client: r.client,
    client_key: r.clientKey,
    category: r.category,
    date: r.date,
    original_amount: r.originalAmount,
    saldo: r.saldoBase,
    status: r.status || 'pendiente',
    close_kind: r.closeKind,
    detail: r.detail,
    payload: rawRecById.get(r.id) ?? r,
  }))
  const { error: recError } = await client.from('receivables').upsert(recRows, { onConflict: 'id' })
  if (recError) throw new Error('El servidor rechazó la importación de cuentas. Solo el administrador puede importar, o falló la conexión.')

  // Colecciones de la fase de integración: gastos, registro de
  // trabajadores e historial de nóminas del respaldo (upsert por id /
  // clave / ciclo). Si las tablas aún no existen en el proyecto, la
  // importación principal ya quedó hecha y la sincronización las
  // derivará cuando el esquema esté aplicado.
  if (parsed.expenses.length) {
    await client.from('expenses').upsert(parsed.expenses.map(expenseToRow), { onConflict: 'id' })
  }
  if (parsed.payrollHistory.length) {
    await client.from('payroll_history').upsert(parsed.payrollHistory.map(payrollToRow), { onConflict: 'cycle_start' })
  }
  if (parsed.workers.length) {
    const registry = buildWorkersRegistry(parsed.workers, parsed.days, parsed.payrollHistory, parsed.anchorDate ?? undefined) as Worker[]
    await client.from('workers').upsert(registry.map(workerToRow), { onConflict: 'key' })
  }
  // Historial de la tarjeta (Transferencias) del respaldo: upsert por
  // id estable. La marca «No es de La Reina» que ya viva en el servidor
  // se conserva (la fila entrante no la pisa). Si la tabla aún no
  // existe en el proyecto, la importación principal ya quedó hecha.
  if (parsed.transferMovements.length) {
    const { data: existingMovs } = await client.from('transfer_movements').select('id, excluded')
    const excludedById = new Map(((existingMovs ?? []) as Array<{ id: string; excluded: boolean | null }>).map((r) => [r.id, Boolean(r.excluded)]))
    const rows = parsed.transferMovements.map((m) => movementToRow({ ...m, excluded: excludedById.get(m.id) ?? m.excluded }))
    const { error: movError } = await client.from('transfer_movements').upsert(rows, { onConflict: 'id' })
    if (movError) {
      // Tabla ausente o rechazo puntual: no tumba la importación.
      // Sin console.* (D-61): el original no registra nada en consola;
      // el fallo queda visible porque el historial simplemente no
      // aparece al releer, y la importación principal ya quedó hecha.
    }
  }
  // Las cinco colecciones sin tabla propia se persisten ÍNTEGRAS en
  // app_settings 'backup-collections' (oleada 2): sin esto, en modo
  // Supabase se perdían igual que antes en el importador local.
  await saveAppSetting('backup-collections', {
    receivablePhotos: parsed.receivablePhotos,
    smsLogs: parsed.smsLogs,
    smsOutbox: parsed.smsOutbox,
    monthlyArchives: parsed.monthlyArchives,
    workerPayments: parsed.workerPayments,
  }, 'las colecciones del respaldo').catch(() => undefined)
  const settings = await fetchCoreSettings().catch(() => ({} as CoreSettings))
  const knownPersons = new Set<string>()
  for (const r of parsed.receivables) {
    knownPersons.add(canonicalPersonKey(r.clientKey, r.client))
    if (r.origin === 'ipv') knownPersons.add(clientKeyOf(r.client))
  }
  for (const w of parsed.workers) {
    knownPersons.add(canonicalPersonKey(w.key, w.nombre))
    const first = firstNameKeyOf(w.nombre)
    if (first) knownPersons.add(first)
  }
  const learnedKinds = { ...(settings.learnedKinds ?? {}), ...parsed.learnedKinds }
  const cuentasOverrides = { ...(settings.cuentasOverrides ?? {}), ...parsed.cuentasOverrides }
  const derivedSuppressed = deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, { learnedKinds, overrides: cuentasOverrides, knownPersons })
  await saveCoreSettings({
    ...settings,
    anchorDate: parsed.anchorDate ?? settings.anchorDate,
    learnedKinds,
    cuentasOverrides,
    suppressedEntries: [...new Set([...(settings.suppressedEntries ?? []), ...derivedSuppressed])],
  }).catch(() => undefined)

  // Sincronización derivada completa (sin re-aplicar «Cuentas pagadas»:
  // el respaldo ya viene conciliado del sistema original).
  await sbSyncAndApply().catch(() => undefined)

  return { days: dayRows.length, receivables: recRows.length }
}

// ---------- Transferencias y gastos (Economía) ----------

/**
 * Registra un movimiento nuevo de la tarjeta (abono manual, pase o
 * gasto por transferencia) en el servidor. RLS: solo admin. El saldo
 * se deriva del historial al releer; aquí solo se inserta la fila.
 */
async function rawSbAddTransferMovement(m: Omit<TransferMovement, 'id' | 'local' | 'superseded'>): Promise<void> {
  const client = sb()
  const movement: TransferMovement = { ...m, id: `ts-local-${Date.now()}`, local: true, superseded: false }
  const { error } = await client.from('transfer_movements').insert(movementToRow(movement))
  if (error) throw new Error('El servidor rechazó el movimiento. Solo el administrador puede registrar movimientos de la tarjeta, o falló la conexión.')
}

/**
 * Marca o desmarca «No es de La Reina» en un movimiento (columna
 * excluded; el payload se actualiza en la misma fila para que ambas
 * lecturas coincidan). El importe no se toca. RLS: solo admin.
 */
async function rawSbSetTransferMovementExcluded(id: string, excluded: boolean, current: TransferMovement): Promise<void> {
  const client = sb()
  const { error } = await client
    .from('transfer_movements')
    .update({ excluded, payload: { ...current, excluded } })
    .eq('id', id)
  if (error) throw new Error('El servidor rechazó el cambio. Solo el administrador puede marcar movimientos, o falló la conexión.')
}

/** Edita un movimiento de la tarjeta (fecha, importe y detalle) en su
 *  fila: columnas y payload se actualizan juntos. RLS: solo admin. */
async function rawSbUpdateTransferMovement(id: string, patch: { date: string; amount: number; detail: string }, current: TransferMovement): Promise<void> {
  const client = sb()
  const next = { ...current, date: patch.date, amount: patch.amount, detail: patch.detail }
  const { error } = await client
    .from('transfer_movements')
    .update({ date: patch.date, amount: patch.amount, detail: patch.detail, payload: next })
    .eq('id', id)
  if (error) throw new Error('El servidor rechazó la edición. Solo el administrador puede editar movimientos, o falló la conexión.')
}

/** Borra un movimiento de la tarjeta. RLS: solo admin. */
async function rawSbDeleteTransferMovement(id: string): Promise<void> {
  const client = sb()
  const { error } = await client.from('transfer_movements').delete().eq('id', id)
  if (error) throw new Error('El servidor rechazó el borrado. Solo el administrador puede borrar movimientos, o falló la conexión.')
}

/** Sincroniza el gasto enlazado de UNA rebaja de almacén
 *  (origin='almacen', source_key='almacen:<id>'): lo crea o actualiza
 *  conservando su id si ya existe; con expense=null lo borra. */
async function rawSbSyncWarehouseExpense(expense: Expense | null, sourceKey: string): Promise<void> {
  const client = sb()
  const { data: existing, error: readError } = await client
    .from('expenses')
    .select('id')
    .eq('origin', 'almacen')
    .eq('source_key', sourceKey)
  if (readError) throw new Error('No se pudo comprobar el gasto enlazado de la rebaja.')
  const rows = (existing ?? []) as Array<{ id: string }>
  if (!expense) {
    for (const row of rows) {
      const { error } = await client.from('expenses').delete().eq('id', row.id)
      if (error) throw new Error('No se pudo eliminar el gasto enlazado de la rebaja.')
    }
    return
  }
  const keepId = rows[0]?.id ?? expense.id
  for (const extra of rows.slice(1)) await client.from('expenses').delete().eq('id', extra.id)
  const { error } = await client.from('expenses').upsert(expenseToRow({ ...expense, id: keepId }))
  if (error) throw new Error('No se pudo guardar el gasto enlazado de la rebaja.')
}

/** Alta manual de un gasto por el administrador (tabla expenses). RLS: solo admin. */
async function rawSbAddExpense(input: {
  date: string
  concept: string
  category: string
  dept: string
  quantity: number
  unitValue: number
  note: string
}): Promise<void> {
  const client = sb()
  const quantity = input.quantity > 0 ? input.quantity : 1
  const expense: Expense = {
    id: `manual-${Date.now()}`,
    date: input.date,
    concept: input.concept,
    category: input.category,
    dept: input.dept,
    quantity,
    unitValue: input.unitValue,
    total: Math.round(quantity * input.unitValue),
    origin: 'manual',
    sourceKey: null,
    cycleStart: null,
    note: input.note,
  }
  const { error } = await client.from('expenses').insert(expenseToRow(expense))
  if (error) throw new Error('El servidor rechazó el gasto. Solo el administrador puede registrar gastos, o falló la conexión.')
}

// ---------- Boletines diarios ----------

/**
 * Guarda la cola de boletines en el servidor (upsert por id estable).
 * Solo el administrador puede escribirla (RLS); el boletín completo
 * viaja en el payload y se reconstruye idéntico al releer. Si la
 * tabla aún no existe en el proyecto, el error se propaga y la
 * pantalla lo declara: nunca se finge un guardado.
 */
async function rawSbSaveBulletins(list: Bulletin[]): Promise<void> {
  if (!list.length) return
  const client = sb()
  const rows = list.map((b) => ({ id: b.id, date: b.date, payload: b, updated_at: new Date().toISOString() }))
  const { error } = await client.from('bulletins').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error('El servidor rechazó guardar los boletines. Solo el administrador puede cambiarlos, o la tabla «bulletins» aún no está creada en el proyecto.')
}

// ---------- Queen: estado y capa de lenguaje ----------

/**
 * Guarda la medición de evolución de Queen en el servidor (una fila
 * «evolution» con el resumen en el payload). Solo el administrador
 * puede escribirla (RLS); si la tabla aún no existe, el error se
 * propaga y el llamante lo trata como «queda en memoria».
 */
async function rawSbSaveQueenState(snapshot: QueenEvolutionSnapshot): Promise<void> {
  const client = sb()
  const { error } = await client.from('queen_state').upsert(
    { id: 'evolution', payload: snapshot, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) throw new Error('El servidor rechazó guardar el estado de Queen, o la tabla «queen_state» aún no está creada en el proyecto.')
}

/**
 * Guarda el estado de automatizaciones en el servidor: dos filas de
 * `automation_state` («runs» = registro de corridas, «learning» =
 * estado del aprendizaje nocturno). Solo el administrador puede
 * escribirlas (RLS); si la tabla aún no existe, el error se propaga
 * y el llamante lo trata como «queda en memoria», sin fingir.
 */
async function rawSbSaveAutomationState(
  patch: Partial<Pick<StoredData, 'automationRuns' | 'queenLearning'>>,
): Promise<void> {
  const client = sb()
  const rows: Array<{ id: string; payload: unknown; updated_at: string }> = []
  if (patch.automationRuns) rows.push({ id: 'runs', payload: patch.automationRuns, updated_at: new Date().toISOString() })
  if ('queenLearning' in patch) rows.push({ id: 'learning', payload: patch.queenLearning ?? null, updated_at: new Date().toISOString() })
  if (!rows.length) return
  const { error } = await client.from('automation_state').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error('El servidor rechazó guardar el estado de automatizaciones, o la tabla «automation_state» aún no está creada en el proyecto.')
}

// ---------- Exportaciones con cola offline (D-03/D-68) ----------
// Cada escritura pública pasa por withOfflineQueue con su descriptor
// serializable (nombre + argumentos JSON): el ejecutor de la cola
// reejecuta la implementación cruda correspondiente, en orden.
const OFFLINE_IMPLS: Record<string, (...args: never[]) => Promise<void>> = {
  sbSaveWarehouseExtended: rawSbSaveWarehouseExtended,
  sbSaveElaborationStore: rawSbSaveElaborationStore,
  sbSaveExtraIncomes: rawSbSaveExtraIncomes,
  sbSaveInventoryAdjustments: rawSbSaveInventoryAdjustments,
  sbSaveMonthlyArchives: rawSbSaveMonthlyArchives,
  sbSaveWorkersRegistry: rawSbSaveWorkersRegistry,
  sbSyncWarehouseExpense: rawSbSyncWarehouseExpense,
  sbSaveVenueInventory: rawSbSaveVenueInventory,
  sbSaveReceivables: rawSbSaveReceivables,
  sbSavePackageReference: rawSbSavePackageReference,
  sbDeletePackageReference: rawSbDeletePackageReference,
  sbAddCobrarPayments: rawSbAddCobrarPayments,
  sbAddTransferMovement: rawSbAddTransferMovement,
  sbSetTransferMovementExcluded: rawSbSetTransferMovementExcluded,
  sbUpdateTransferMovement: rawSbUpdateTransferMovement,
  sbDeleteTransferMovement: rawSbDeleteTransferMovement,
  sbAddExpense: rawSbAddExpense,
  sbSaveBulletins: rawSbSaveBulletins,
  sbSaveQueenState: rawSbSaveQueenState,
  sbSaveAutomationState: rawSbSaveAutomationState,
}
registerOfflineExecutor(async (op: QueuedOp) => {
  const impl = OFFLINE_IMPLS[op.fn]
  if (!impl) throw new Error(`Operación de la cola sin ejecutor: ${op.fn}`)
  await impl(...(op.args as never[]))
})

export async function sbSaveWarehouseExtended(entries: WarehouseEntry[], meta: Record<string, WarehouseProductMeta>): Promise<void> {
  return withOfflineQueue('sbSaveWarehouseExtended', [entries, meta], () => rawSbSaveWarehouseExtended(entries, meta))
}
export async function sbSaveElaborationStore(store: ElaborationStore): Promise<void> {
  return withOfflineQueue('sbSaveElaborationStore', [store], () => rawSbSaveElaborationStore(store))
}
export async function sbSaveExtraIncomes(items: ExtraIncome[]): Promise<void> {
  return withOfflineQueue('sbSaveExtraIncomes', [items], () => rawSbSaveExtraIncomes(items))
}
export async function sbSaveInventoryAdjustments(items: InventoryAdjustment[]): Promise<void> {
  return withOfflineQueue('sbSaveInventoryAdjustments', [items], () => rawSbSaveInventoryAdjustments(items))
}
export async function sbSaveMonthlyArchives(archives: MonthlyArchive[]): Promise<void> {
  return withOfflineQueue('sbSaveMonthlyArchives', [archives], () => rawSbSaveMonthlyArchives(archives))
}
export async function sbSaveWorkersRegistry(patch: {
  workers?: Worker[]
  removeWorkerKeys?: string[]
  workersExtended?: WorkerExtended[]
  workerPayments?: WorkerPayment[]
  workersHistorial?: import('../types').WorkerHistorialEntry[]
}): Promise<void> {
  return withOfflineQueue('sbSaveWorkersRegistry', [patch], () => rawSbSaveWorkersRegistry(patch))
}
export async function sbSyncWarehouseExpense(expense: Expense | null, sourceKey: string): Promise<void> {
  return withOfflineQueue('sbSyncWarehouseExpense', [expense, sourceKey], () => rawSbSyncWarehouseExpense(expense, sourceKey))
}
export async function sbSaveVenueInventory(items: VenueInventoryItem[]): Promise<void> {
  return withOfflineQueue('sbSaveVenueInventory', [items], () => rawSbSaveVenueInventory(items))
}
export async function sbSaveReceivables(receivables: Receivable[], deletedIds: string[] = []): Promise<void> {
  return withOfflineQueue('sbSaveReceivables', [receivables, deletedIds], () => rawSbSaveReceivables(receivables, deletedIds))
}
export async function sbSavePackageReference(ref: PackageReference): Promise<void> {
  return withOfflineQueue('sbSavePackageReference', [ref], () => rawSbSavePackageReference(ref))
}
export async function sbDeletePackageReference(id: string): Promise<void> {
  return withOfflineQueue('sbDeletePackageReference', [id], () => rawSbDeletePackageReference(id))
}
export async function sbAddCobrarPayments(
  allocations: Array<{ receivableId: string; amount: number; date: string; method: 'efectivo' | 'transferencia' }>,
): Promise<void> {
  return withOfflineQueue('sbAddCobrarPayments', [allocations], () => rawSbAddCobrarPayments(allocations))
}
export async function sbAddTransferMovement(m: Omit<TransferMovement, 'id' | 'local' | 'superseded'>): Promise<void> {
  return withOfflineQueue('sbAddTransferMovement', [m], () => rawSbAddTransferMovement(m))
}
export async function sbSetTransferMovementExcluded(id: string, excluded: boolean, current: TransferMovement): Promise<void> {
  return withOfflineQueue('sbSetTransferMovementExcluded', [id, excluded, current], () => rawSbSetTransferMovementExcluded(id, excluded, current))
}
export async function sbUpdateTransferMovement(id: string, patch: { date: string; amount: number; detail: string }, current: TransferMovement): Promise<void> {
  return withOfflineQueue('sbUpdateTransferMovement', [id, patch, current], () => rawSbUpdateTransferMovement(id, patch, current))
}
export async function sbDeleteTransferMovement(id: string): Promise<void> {
  return withOfflineQueue('sbDeleteTransferMovement', [id], () => rawSbDeleteTransferMovement(id))
}
export async function sbAddExpense(input: {
  date: string
  concept: string
  category: string
  dept: string
  quantity: number
  unitValue: number
  note: string
}): Promise<void> {
  return withOfflineQueue('sbAddExpense', [input], () => rawSbAddExpense(input))
}
export async function sbSaveBulletins(list: Bulletin[]): Promise<void> {
  return withOfflineQueue('sbSaveBulletins', [list], () => rawSbSaveBulletins(list))
}

/* Registro de actividad por usuario (decisión del dueño 15:02):
   vive en app_settings 'activity-log'. La lectura es abierta a
   cualquier sesión; la escritura puede estar limitada por RLS al
   administrador — si un rol de lectura no puede escribirla, sus
   entradas quedan en su dispositivo (activityLog.ts lo declara). */
export async function sbLoadActivityLog(): Promise<Array<Record<string, unknown>>> {
  const client = sb()
  if (!client) return []
  const { data, error } = await client.from('app_settings').select('value').eq('key', 'activity-log').maybeSingle()
  if (error || !data) return []
  const value = (data as { value: unknown }).value as { items?: unknown } | null
  return Array.isArray(value?.items) ? (value.items as Array<Record<string, unknown>>) : []
}
export async function sbSaveActivityLog(items: Array<Record<string, unknown>>): Promise<void> {
  await saveAppSetting('activity-log', { items: items.slice(0, 800) }, 'el registro de actividad')
}
export async function sbSaveQueenState(snapshot: QueenEvolutionSnapshot): Promise<void> {
  return withOfflineQueue('sbSaveQueenState', [snapshot], () => rawSbSaveQueenState(snapshot))
}
export async function sbSaveAutomationState(
  patch: Partial<Pick<StoredData, 'automationRuns' | 'queenLearning'>>,
): Promise<void> {
  return withOfflineQueue('sbSaveAutomationState', [patch], () => rawSbSaveAutomationState(patch))
}

export interface QueenChatResult {
  ok: boolean
  configured?: boolean
  provider?: string
  text?: string
  reason?: string
}

/**
 * Prueba la capa de lenguaje a través de la Edge Function
 * «queen-chat»: le manda SOLO la pregunta y las cifras verificadas
 * de la respuesta determinista (nunca la base entera). La función
 * exige sesión válida y lee su secreto en el servidor. Cualquier
 * fallo vuelve como motivo honesto, no como respuesta fingida.
 */
export async function sbQueenChat(question: string, figures: Array<{ label: string; value: number | string }>): Promise<QueenChatResult> {
  const client = sb()
  const { data, error } = await client.functions.invoke('queen-chat', { body: { question, figures } })
  if (error) {
    return { ok: false, reason: 'La función queen-chat no respondió: puede que aún no esté desplegada en el proyecto. Queen sigue en modo determinista.' }
  }
  const d = (data ?? {}) as QueenChatResult
  if (d.ok && typeof d.text === 'string') return { ok: true, provider: d.provider, text: d.text }
  return { ok: false, configured: d.configured, reason: typeof d.reason === 'string' ? d.reason : 'La capa de lenguaje no está configurada todavía.' }
}
