// Queen SDA — capa de datos y acceso (modo LOCAL).
//
// Implementación local (localStorage, claves versionadas). Es una
// demostración estructural del acceso: replica el comportamiento de la fase 1
// (4 perfiles, roles admin/lectura y cambio obligatorio al primer ingreso),
// pero NO es la seguridad final — las contraseñas locales solo se guardan
// con un hash simple porque viven en el propio dispositivo.
//
// MODO SUPABASE: cuando el proyecto define VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY (ver .env.example y supabase/schema.sql), la app usa
// src/lib/supabaseBackend.ts (Supabase Auth + tablas con RLS) y esta capa
// local queda como respaldo intacto para cuando NO hay configuración.
// Las pantallas consumen el mismo StoredData en ambos modos.

import type { Bulletin, Expense, LocalPayment, PackageReference, PayrollEmployee, Profile, Role, Session, StoredData, TransferMovement } from '../types'
import { normalizeDay, parseBackup } from './backupCore.mjs'
import { defaultElaborationStore } from './elaboracionCore.mjs'
import {
  applyImportedPaidAccounts, buildWorkersRegistry, canonicalPersonKey, clientKeyOf, deriveSuppressedEntries,
  firstNameKeyOf, syncDerivedData,
} from './syncCore.mjs'
import { supabaseConfigured } from './supabaseClient'

export { supabaseConfigured }

const NS = 'queen-sda:v1'
const K_PROFILES = `${NS}:profiles`
const K_SESSION = `${NS}:session`
const K_DATA = `${NS}:data`

/** Contraseña temporal inicial de los 4 perfiles (la de la fase 1). */
export const TEMP_PASSWORD = 'Admin1'

interface StoredProfile extends Profile {
  passHash: string
  mustChange: boolean
}

// Hash simple SOLO para la demo local (no es criptografía real; ver cabecera).
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)
}

const SEED_PROFILES: Array<Omit<StoredProfile, 'passHash' | 'mustChange'>> = [
  { id: 'yadir', name: 'Yadir Medina Oliva', email: 'yadir.medina900710@gmail.com', role: 'admin' },
  { id: 'jesus', name: 'Jesús', email: 'jesusmmpatria@gmail.com', role: 'lectura' },
  { id: 'dayami', name: 'Dayami Fernández', email: 'dayamifernandez584@gmail.com', role: 'lectura' },
  { id: 'yan', name: 'Yan Espinosa', email: 'yanespinosa08@gmail.com', role: 'lectura' },
]

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ---------- Perfiles y sesión (local) ----------

export function ensureProfiles(): StoredProfile[] {
  let profiles = readJSON<StoredProfile[]>(K_PROFILES)
  if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
    profiles = SEED_PROFILES.map((p) => ({ ...p, passHash: hash(TEMP_PASSWORD), mustChange: true }))
    writeJSON(K_PROFILES, profiles)
  }
  return profiles
}

export function listProfiles(): Profile[] {
  return ensureProfiles().map(({ id, name, email, role }) => ({ id, name, email, role }))
}

export function getSession(): Session | null {
  return readJSON<Session>(K_SESSION)
}

export function profileMustChange(profileId: string): boolean {
  return ensureProfiles().find((p) => p.id === profileId)?.mustChange ?? false
}

export type LoginResult =
  | { ok: true; session: Session; mustChange: boolean }
  | { ok: false; error: string }

export function login(email: string, password: string): LoginResult {
  const profile = ensureProfiles().find((p) => p.email.toLowerCase() === email.trim().toLowerCase())
  if (!profile || profile.passHash !== hash(password)) {
    return { ok: false, error: 'Correo o contraseña incorrectos.' }
  }
  const session: Session = { profileId: profile.id, name: profile.name, email: profile.email, role: profile.role }
  writeJSON(K_SESSION, session)
  return { ok: true, session, mustChange: profile.mustChange }
}

/**
 * Crea la sesión local de un perfil SIN contraseña: la usan las
 * vías ya autorizadas del dispositivo — el PIN del selector de
 * acceso (verificado contra su hash con sal en quickAccess) y el
 * «entrar como» del administrador. Con persist=false la sesión
 * vive solo en memoria (suplantación: al recargar vuelve la
 * sesión guardada, que sigue siendo la del administrador).
 */
export function startLocalSession(profileId: string, persist = true): Session | null {
  const profile = ensureProfiles().find((p) => p.id === profileId)
  if (!profile) return null
  const session: Session = { profileId: profile.id, name: profile.name, email: profile.email, role: profile.role }
  if (persist) writeJSON(K_SESSION, session)
  return session
}

export function changePassword(profileId: string, tempPassword: string, newPassword: string): { ok: boolean; error?: string } {
  const profiles = ensureProfiles()
  const profile = profiles.find((p) => p.id === profileId)
  if (!profile) return { ok: false, error: 'Perfil no encontrado.' }
  if (profile.passHash !== hash(tempPassword)) return { ok: false, error: 'La contraseña temporal no coincide.' }
  if (newPassword.length < 6) return { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' }
  if (newPassword === tempPassword) return { ok: false, error: 'La contraseña nueva debe ser distinta de la temporal.' }
  profile.passHash = hash(newPassword)
  profile.mustChange = false
  writeJSON(K_PROFILES, profiles)
  return { ok: true }
}

export function logout() {
  localStorage.removeItem(K_SESSION)
}

// ---------- Datos del negocio (local, versionado) ----------

export const EMPTY_DATA: StoredData = {
  version: 2,
  importedAt: null,
  exportedAt: null,
  backupOf: '',
  days: [],
  receivables: [],
  localPayments: [],
  expenses: [],
  workers: [],
  payrollHistory: [],
  anchorDate: '2026-09-23',
  aliases: {},
  learnedKinds: {},
  cuentasOverrides: {},
  suppressedEntries: [],
  unpaidWorkers: [],
  payrollAdjustments: {},
  transferMovements: [],
  packageReferences: [],
  bulletins: [],
  queenEvolution: null,
  automationRuns: [],
  queenLearning: null,
  workersExtended: [],
  workersHistorial: [],
  queenEvolutionHistory: [],
  warehouseEntries: [],
  warehouseMeta: {},
  venueInventory: [],
  elaboration: defaultElaborationStore(),
  extraIncomes: [],
  inventoryAdjustments: [],
  receivablePhotos: [],
  smsLogs: [],
  smsOutbox: [],
  monthlyArchives: [],
  workerPayments: [],
  expensesCount: 0,
  payrollCount: 0,
  workersCount: 0,
}

function withCounts(data: StoredData): StoredData {
  return {
    ...data,
    expensesCount: data.expenses.length,
    payrollCount: data.payrollHistory.length,
    workersCount: data.workers.length,
  }
}

/**
 * Corre la SINCRONIZACIÓN DERIVADA sobre el estado (puerto del original):
 * las fotos de los días alimentan a la vez las cuentas de Cobrar, los
 * gastos del Desglose («ipv-cuentas»), el gasto de cada nómina
 * («auto-rh») y el registro único de trabajadores. Idempotente: correrla
 * dos veces no cambia nada la segunda. `paidDays`: días cuya hoja
 * «Cuentas pagadas» se concilia en esta pasada (el recién importado).
 */
function runSync(data: StoredData, paidDays: StoredData['days'] = [], accountSyncDates: string[] = []): StoredData {
  const workers = buildWorkersRegistry(data.workers, data.days, data.payrollHistory, data.anchorDate)
  const synced = syncDerivedData({
    days: data.days,
    receivables: data.receivables,
    localPayments: data.localPayments,
    expenses: data.expenses,
    workers,
    aliases: data.aliases,
    learnedKinds: data.learnedKinds,
    cuentasOverrides: data.cuentasOverrides,
    suppressedEntries: data.suppressedEntries,
    payrollHistory: data.payrollHistory,
    accountSyncDates,
  })
  let receivables = synced.receivables
  for (const day of paidDays) {
    receivables = applyImportedPaidAccounts(receivables, day).receivables
  }
  return withCounts({
    ...data,
    workers,
    receivables,
    localPayments: synced.localPayments,
    expenses: synced.expenses,
    aliases: synced.aliases,
  })
}

export function loadData(): StoredData {
  const data = readJSON<StoredData>(K_DATA)
  if (!data || (data.version !== 1 && data.version !== 2)) return { ...EMPTY_DATA }
  const merged: StoredData = { ...EMPTY_DATA, ...data, version: 2 }
  if (data.version === 1) {
    // Migración v1 → v2: se conservan días, cuentas y abonos locales;
    // la sincronización deriva gastos, registro de RH y conteos.
    const migrated = runSync(merged)
    saveData(migrated)
    return migrated
  }
  return merged
}

function saveData(data: StoredData) {
  writeJSON(K_DATA, data)
}

/**
 * Importa un respaldo del SDA ya verificado por el admin.
 * Idempotente: los días se fusionan por fecha, las cuentas por id, los
 * gastos por id, las nóminas por ciclo y los trabajadores por clave
 * (reimportar el mismo respaldo no duplica). Después corre la
 * sincronización derivada completa, igual que el sistema original.
 * Los abonos locales de Cobrar se conservan y se siguen aplicando.
 */
export function importBackup(raw: unknown): StoredData {
  const parsed = parseBackup(raw)
  const current = loadData()
  const daysByDate = new Map(current.days.map((d) => [d.date, d]))
  for (const day of parsed.days) daysByDate.set(day.date, day)
  const recById = new Map(current.receivables.map((r) => [r.id, r]))
  for (const rec of parsed.receivables) recById.set(rec.id, rec)
  const expById = new Map(current.expenses.map((e) => [e.id, e]))
  for (const exp of parsed.expenses) expById.set(exp.id, exp)
  const workerByKey = new Map(current.workers.map((w) => [w.key, w]))
  for (const w of parsed.workers) {
    const existing = workerByKey.get(w.key)
    if (existing) {
      // La ficha guardada manda: el respaldo solo rellena huecos.
      for (const f of ['ocupacion', 'carnet', 'cuentaBancaria', 'movil', 'notas'] as const) {
        if (!existing[f] && w[f]) existing[f] = w[f]
      }
    } else {
      workerByKey.set(w.key, w as StoredData['workers'][number])
    }
  }
  const payrollByCycle = new Map(current.payrollHistory.map((p) => [p.cycleStart, p]))
  for (const p of parsed.payrollHistory) payrollByCycle.set(p.cycleStart, p)
  // Historial de la tarjeta (Transferencias): se fusiona por id
  // estable; la fila del respaldo manda en sus campos de origen, pero
  // la marca «No es de La Reina» puesta en esta copia se conserva
  // (es una decisión del dueño sobre ese movimiento, no un dato del
  // respaldo). Los movimientos locales (local: true) no se tocan.
  const movById = new Map(current.transferMovements.map((m) => [m.id, m]))
  for (const m of parsed.transferMovements) {
    const existing = movById.get(m.id)
    movById.set(m.id, existing ? { ...m, excluded: existing.excluded } : m)
  }
  const transferMovements = [...movById.values()].sort((a, b) => a.date.localeCompare(b.date))
  // Supresiones del original que el respaldo no exporta como tabla: se
  // derivan de sus propias entradas finales (ver syncCore).
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
  const learnedKinds = { ...current.learnedKinds, ...parsed.learnedKinds }
  const cuentasOverrides = { ...current.cuentasOverrides, ...parsed.cuentasOverrides }
  const derivedSuppressed = deriveSuppressedEntries(parsed.days, parsed.entrySourceKeys, { learnedKinds, overrides: cuentasOverrides, knownPersons })
  const days = [...daysByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const base: StoredData = {
    ...current,
    version: 2,
    importedAt: new Date().toISOString(),
    exportedAt: parsed.meta.exportedAt || current.exportedAt,
    backupOf: parsed.meta.backupOf || current.backupOf,
    days,
    receivables: [...recById.values()],
    expenses: [...expById.values()],
    workers: [...workerByKey.values()],
    payrollHistory: [...payrollByCycle.values()],
    anchorDate: parsed.anchorDate ?? current.anchorDate,
    transferMovements,
    // Las cinco colecciones del respaldo mandan tal como vienen
    // (oleada 2): antes se descartaban y al reexportar salían [].
    receivablePhotos: parsed.receivablePhotos,
    smsLogs: parsed.smsLogs,
    smsOutbox: parsed.smsOutbox,
    monthlyArchives: parsed.monthlyArchives,
    workerPayments: parsed.workerPayments,
    learnedKinds,
    cuentasOverrides,
    suppressedEntries: [...new Set([...current.suppressedEntries, ...derivedSuppressed])],
  }
  // El respaldo es una foto ya conciliada por el sistema original: sus
  // cuentas mandan tal como vienen (la hoja «Cuentas pagadas» de cada
  // día ya hizo su efecto allí); la sincronización solo deriva lo que
  // falte (gastos, registro de RH, identidades) sin re-aplicar pagos.
  const next = runSync(base)
  saveData(next)
  return next
}

/**
 * Importa UN día leído de su IPV en Excel (registro crudo del lector,
 * src/lib/ipvCore.mjs). Si la fecha ya existe, el día nuevo la REEMPLAZA
 * (misma fecha, sin duplicar): es el equivalente al «Editar este IPV»
 * del sistema original, y el reemplazo RE-SINCRONIZA ese día (cuentas,
 * gastos y foto de RH), no acumula. Las cifras se guardan tal como
 * vienen del IPV.
 */
export function importIpvDay(rawDay: Record<string, unknown>): StoredData {
  const day = normalizeDay(rawDay)
  const current = loadData()
  const daysByDate = new Map(current.days.map((d) => [d.date, d]))
  daysByDate.set(day.date, day)
  const days = [...daysByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const next = runSync({ ...current, importedAt: new Date().toISOString(), days }, [day], [day.date])
  saveData(next)
  return next
}

/**
 * Elimina un día importado (puerto de `deleteDay` del original, D-07):
 * sale el registro del día con todo lo que vive en su foto (ventas,
 * departamentos, productos, entradas, foto de RH y de fondos), la foto
 * de cuentas de ese día, las decisiones de «Cuentas» tomadas sobre ese
 * día (overrides y supresiones con su fecha) y su abono de
 * Transferencias derivado del IPV (los movimientos locales o de pagos
 * de cuentas de esa fecha NO se tocan). Un boletín pendiente de ese
 * día sale de la cola; los ya enviados quedan como historial. Todo lo
 * derivado se recalcula sin ese día corriendo la sincronización con
 * esa fecha «viva»: los gastos automáticos de «Cuentas» y de nómina
 * se retiran o recalculan solos, y las cuentas PAGADAS no se borran
 * jamás (la limpieza de la sincronización las protege, como el
 * original). En el original la acción exige autorización reforzada
 * (ámbito «delete-ipv», nivel explícito): aquí la impone la pantalla
 * con confirmación expresa y la sesión de administrador.
 */
export function deleteDay(date: string): StoredData {
  const current = loadData()
  const days = current.days.filter((d) => d.date !== date)
  const bulletins = current.bulletins.filter((b) => b.date !== date || b.status === 'enviado')
  const receivablePhotos = current.receivablePhotos.filter((p) => p.date !== date)
  const transferMovements = current.transferMovements.filter((m) => !(m.source === 'ipv' && m.date === date && !m.local))
  const cuentasOverrides = Object.fromEntries(Object.entries(current.cuentasOverrides).filter(([k]) => !k.startsWith(`${date}::`)))
  const suppressedEntries = current.suppressedEntries.filter((k) => !k.startsWith(`${date}::`))
  const next = runSync(
    { ...current, days, bulletins, receivablePhotos, transferMovements, cuentasOverrides, suppressedEntries },
    [],
    [date],
  )
  saveData(next)
  return next
}

/** Registra abonos locales (Cobrar). `allocations` ya viene repartido a la cuenta más antigua primero. */
export function addLocalPayments(allocations: Array<Omit<LocalPayment, 'id' | 'createdAt'>>): StoredData {
  const current = loadData()
  const now = new Date().toISOString()
  const news: LocalPayment[] = allocations.map((a, i) => ({
    ...a,
    id: `local-${Date.now()}-${i}`,
    createdAt: now,
  }))
  const next = { ...current, localPayments: [...current.localPayments, ...news] }
  saveData(next)
  return next
}

/**
 * Guarda ajustes de RH del admin: ancla de ciclos, interruptor
 * «No pagado» por trabajador y ajuste manual de nómina de un ciclo
 * (manda sobre la foto; `null` lo retira y vuelve la foto).
 */
export function saveRhSettings(patch: {
  anchorDate?: string
  unpaidWorkers?: string[]
  payrollAdjustment?: { cycleStart: string; employees: PayrollEmployee[] | null }
}): StoredData {
  const current = loadData()
  const next: StoredData = { ...current }
  if (patch.anchorDate) next.anchorDate = patch.anchorDate
  if (patch.unpaidWorkers) next.unpaidWorkers = patch.unpaidWorkers
  if (patch.payrollAdjustment) {
    const adjustments = { ...current.payrollAdjustments }
    if (patch.payrollAdjustment.employees) adjustments[patch.payrollAdjustment.cycleStart] = patch.payrollAdjustment.employees
    else delete adjustments[patch.payrollAdjustment.cycleStart]
    next.payrollAdjustments = adjustments
  }
  saveData(next)
  return next
}

/**
 * Registra un movimiento nuevo de la tarjeta del negocio (abono
 * manual, pase o gasto por transferencia) en esta copia. El saldo y
 * los totales se DERIVAN del historial: aquí solo se añade la fila,
 * con el importe con signo que corresponda, y nada más se toca.
 */
/** Guarda piezas del registro de trabajadores (fichas base, estado
 *  extendido — estrellas, turno, descanso, días fijos, ausencias,
 *  contrato —, pagos manuales e historial) sustituyendo SOLO las
 *  colecciones nombradas en el parche. */
export function saveWorkersRegistry(patch: {
  workers?: StoredData['workers']
  workersExtended?: StoredData['workersExtended']
  workerPayments?: StoredData['workerPayments']
  workersHistorial?: StoredData['workersHistorial']
}): StoredData {
  const current = loadData()
  const next: StoredData = { ...current }
  if (patch.workers) next.workers = patch.workers
  if (patch.workersExtended) next.workersExtended = patch.workersExtended
  if (patch.workerPayments) next.workerPayments = patch.workerPayments
  if (patch.workersHistorial) next.workersHistorial = patch.workersHistorial
  saveData(next)
  return next
}

export function addTransferMovement(m: Omit<TransferMovement, 'id' | 'local' | 'superseded'>): StoredData {
  const current = loadData()
  const movement: TransferMovement = {
    ...m,
    id: `ts-local-${Date.now()}`,
    local: true,
    superseded: false,
  }
  const transferMovements = [...current.transferMovements, movement].sort((a, b) => a.date.localeCompare(b.date))
  const next = { ...current, transferMovements }
  saveData(next)
  return next
}

/**
 * Marca o desmarca un movimiento como «No es de La Reina»: sigue
 * visible en el historial (tachado), pero su importe sale del saldo y
 * de los totales. Reversible; no borra ni altera el importe.
 */
export function setTransferMovementExcluded(id: string, excluded: boolean): StoredData {
  const current = loadData()
  const transferMovements = current.transferMovements.map((m) => (m.id === id ? { ...m, excluded } : m))
  const next = { ...current, transferMovements }
  saveData(next)
  return next
}

/** Edita un movimiento registrado (fecha, importe con signo y
 *  detalle), como el «Editar movimiento» del original: los que
 *  vienen del IPV no se editan aquí — se corrige el Excel. */
export function updateTransferMovement(id: string, patch: { date: string; amount: number; detail: string }): StoredData {
  const current = loadData()
  const transferMovements = current.transferMovements
    .map((m) => (m.id === id ? { ...m, date: patch.date, amount: patch.amount, detail: patch.detail } : m))
    .sort((a, b) => a.date.localeCompare(b.date))
  const next = { ...current, transferMovements }
  saveData(next)
  return next
}

/** Borra un movimiento registrado (el original lo permite para
 *  pases, abonos manuales, pagos y abonos de cuenta/extra). */
export function deleteTransferMovement(id: string): StoredData {
  const current = loadData()
  const next = { ...current, transferMovements: current.transferMovements.filter((m) => m.id !== id) }
  saveData(next)
  return next
}

/** Alta manual de un gasto por el administrador (Economía). */
export function addManualExpense(input: {
  date: string
  concept: string
  category: string
  dept: string
  quantity: number
  unitValue: number
  note: string
}): StoredData {
  const current = loadData()
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
  const next = withCounts({ ...current, expenses: [...current.expenses, expense] })
  saveData(next)
  return next
}

/**
 * Guarda (crea o actualiza) una referencia de compra de Elaboración
 * (paquetes y rendimientos) en esta copia. Las referencias se guardan
 * SOLO cuando el dueño las confirma: lo que Queen aprende de Gastos se
 * calcula al leer y no escribe nada solo.
 */
export function savePackageReference(ref: PackageReference): StoredData {
  const current = loadData()
  const exists = current.packageReferences.some((r) => r.id === ref.id)
  const packageReferences = exists
    ? current.packageReferences.map((r) => (r.id === ref.id ? ref : r))
    : [...current.packageReferences, ref]
  const next = { ...current, packageReferences }
  saveData(next)
  return next
}

/** Borra una referencia de compra guardada (con su historial). */
export function deletePackageReference(id: string): StoredData {
  const current = loadData()
  const next = { ...current, packageReferences: current.packageReferences.filter((r) => r.id !== id) }
  saveData(next)
  return next
}

/**
 * Guarda los movimientos del almacén MANUAL y/o sus metadatos
 * (modo local). En modo Supabase la misma estructura se guarda en
 * app_settings 'almacen-extended' (sbSaveWarehouseExtended).
 */
export function saveWarehouseExtended(patch: {
  entries?: StoredData['warehouseEntries']
  meta?: StoredData['warehouseMeta']
}): StoredData {
  const current = loadData()
  const next: StoredData = { ...current }
  if (patch.entries) next.warehouseEntries = patch.entries
  if (patch.meta) next.warehouseMeta = patch.meta
  saveData(next)
  return next
}

/**
 * Guarda la lista completa de bienes del Inventario (modo local).
 * En modo Supabase va a app_settings 'venue-inventory'
 * (sbSaveVenueInventory).
 */
export function saveVenueInventory(items: StoredData['venueInventory']): StoredData {
  const current = loadData()
  const next = { ...current, venueInventory: items }
  saveData(next)
  return next
}

/** Sustituye la lista completa de cuentas por cobrar (editar, mover a
 *  morosas o eliminar una cuenta desde su tarjeta, como en el
 *  original). Los abonos locales de cuentas eliminadas quedan
 *  huérfanos e inertes: effectiveSaldo los busca por id de cuenta. */
export function saveReceivables(receivables: StoredData['receivables']): StoredData {
  const current = loadData()
  const next = { ...current, receivables }
  saveData(next)
  return next
}

/**
 * Guarda el almacén COMPLETO de Elaboración (fichas, ajustes, mermas,
 * historial) en modo local. En modo Supabase va a app_settings
 * 'elaboracion' (sbSaveElaborationStore, con cola offline).
 */
export function saveElaborationStore(store: StoredData['elaboration']): StoredData {
  const current = loadData()
  const next = { ...current, elaboration: store }
  saveData(next)
  return next
}

/** Guarda los otros ingresos registrados a mano (Extras) en modo local. */
export function saveExtraIncomes(extraIncomes: StoredData['extraIncomes']): StoredData {
  const current = loadData()
  const next = { ...current, extraIncomes }
  saveData(next)
  return next
}

/** Guarda los ajustes manuales del libro (Existencias) en modo local. */
export function saveInventoryAdjustments(inventoryAdjustments: StoredData['inventoryAdjustments']): StoredData {
  const current = loadData()
  const next = { ...current, inventoryAdjustments }
  saveData(next)
  return next
}

export function resetLocalData(): StoredData {
  saveData({ ...EMPTY_DATA })
  return { ...EMPTY_DATA }
}

/**
 * Guarda la cola de boletines completa (modo local). Los boletines se
 * generan al leer (uno por día importado) y aquí solo se persisten
 * sus estados: pendiente/enviado/error, intentos y regeneraciones.
 */
export function saveBulletins(bulletins: Bulletin[]): StoredData {
  const current = loadData()
  const next = { ...current, bulletins }
  saveData(next)
  return next
}

/** Guarda la última medición de evolución de Queen (modo local). La
 *  medición la calcula queenCore al leer; aquí solo se persiste el
 *  resumen (etapa, índice y señales) para que conste como dato. */
export function saveQueenEvolution(evolution: StoredData['queenEvolution']): StoredData {
  const current = loadData()
  const next = { ...current, queenEvolution: evolution }
  saveData(next)
  return next
}

/** Guarda el registro de corridas de automatizaciones y/o el estado
 *  del aprendizaje nocturno (modo local). Las tareas programadas
 *  corren en la nube; en local, las corridas manuales desde Sistema
 *  dejan aquí su constancia, con el mismo núcleo. */
export function saveAutomationState(
  patch: Partial<Pick<StoredData, 'automationRuns' | 'queenLearning'>>,
): StoredData {
  const current = loadData()
  const next = { ...current }
  if (patch.automationRuns) next.automationRuns = patch.automationRuns
  if ('queenLearning' in patch) next.queenLearning = patch.queenLearning ?? null
  saveData(next)
  return next
}

export type { Role }

/** Sustituye la lista completa de gastos en modo local (la usa la
 *  reconciliación de gastos enlazados de Almacén). */
export function replaceExpenses(expenses: StoredData['expenses']): StoredData {
  const current = loadData()
  const next = { ...current, expenses }
  saveData(next)
  return next
}

/** Guarda los resúmenes mensuales del Archivo en modo local. */
export function saveMonthlyArchives(monthlyArchives: StoredData['monthlyArchives']): StoredData {
  const current = loadData()
  const next = { ...current, monthlyArchives }
  saveData(next)
  return next
}
