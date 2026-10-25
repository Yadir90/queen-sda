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

import type { LocalPayment, Profile, Role, Session, StoredData } from '../types'
import { parseBackup } from './backupCore.mjs'
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
  version: 1,
  importedAt: null,
  exportedAt: null,
  backupOf: '',
  days: [],
  receivables: [],
  localPayments: [],
  expensesCount: 0,
  payrollCount: 0,
  workersCount: 0,
}

export function loadData(): StoredData {
  const data = readJSON<StoredData>(K_DATA)
  if (!data || data.version !== 1) return { ...EMPTY_DATA }
  return { ...EMPTY_DATA, ...data }
}

function saveData(data: StoredData) {
  writeJSON(K_DATA, data)
}

/**
 * Importa un respaldo del SDA ya verificado por el admin.
 * Idempotente: los días se fusionan por fecha y las cuentas por id
 * (reimportar el mismo respaldo no duplica). Los abonos locales de Cobrar
 * se conservan y se siguen aplicando sobre las cuentas importadas.
 */
export function importBackup(raw: unknown): StoredData {
  const parsed = parseBackup(raw)
  const current = loadData()
  const daysByDate = new Map(current.days.map((d) => [d.date, d]))
  for (const day of parsed.days) daysByDate.set(day.date, day)
  const recById = new Map(current.receivables.map((r) => [r.id, r]))
  for (const rec of parsed.receivables) recById.set(rec.id, rec)
  const next: StoredData = {
    version: 1,
    importedAt: new Date().toISOString(),
    exportedAt: parsed.meta.exportedAt || current.exportedAt,
    backupOf: parsed.meta.backupOf || current.backupOf,
    days: [...daysByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    receivables: [...recById.values()],
    localPayments: current.localPayments,
    expensesCount: parsed.expensesCount,
    payrollCount: parsed.payrollCount,
    workersCount: parsed.workersCount,
  }
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

export function resetLocalData(): StoredData {
  saveData({ ...EMPTY_DATA })
  return { ...EMPTY_DATA }
}

export type { Role }
