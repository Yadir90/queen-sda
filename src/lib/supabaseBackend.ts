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

import type { DayData, LocalPayment, Receivable, Role, Session, StoredData } from '../types'
import { EMPTY_DATA, type LoginResult } from './backend'
import { getSupabase } from './supabaseClient'
import { normalizeDay, normalizeReceivable, parseBackup } from './backupCore.mjs'

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

function sb() {
  const client = getSupabase()
  if (!client) throw new Error('Supabase no está configurado en este proyecto.')
  return client
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

/**
 * Lee days, receivables y payments del servidor y los entrega como el mismo
 * StoredData del modo local. Los abonos con origin='cobrar' se convierten en
 * la capa de abonos locales equivalente (se restan del saldo del respaldo).
 */
export async function sbFetchStoredData(): Promise<StoredData> {
  const client = sb()
  const [daysRes, recRes, payRes] = await Promise.all([
    client.from('days').select('date, ventas_dia, ganancia_bruta, ganancia_neta, cuadre, payload, imported_at').order('date'),
    client.from('receivables').select('id, client, client_key, category, date, original_amount, saldo, status, close_kind, detail, payload, imported_at'),
    client.from('payments').select('id, receivable_id, amount, paid_date, payment_method, origin, created_at').order('paid_date'),
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

  const stamps = [
    ...((daysRes.data ?? []) as DayRow[]).map((d) => d.imported_at),
    ...((recRes.data ?? []) as ReceivableRow[]).map((r) => r.imported_at),
  ].filter((s): s is string => Boolean(s)).sort()

  return {
    ...EMPTY_DATA,
    importedAt: stamps.length ? stamps[stamps.length - 1] : null,
    backupOf: 'Supabase',
    days,
    receivables,
    localPayments,
  }
}

/**
 * Registra abonos de Cobrar en la tabla payments (origin='cobrar').
 * RLS solo deja insertar al admin; el llamador debe ser admin en la interfaz
 * y el servidor impone la misma regla aunque alguien la saltara.
 */
export async function sbAddCobrarPayments(
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

  return { days: dayRows.length, receivables: recRows.length }
}
