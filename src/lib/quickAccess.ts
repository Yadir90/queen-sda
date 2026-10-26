/* Acceso rápido por dispositivo (decisión del dueño, 2026-10-26
 * 14:33): la contraseña sigue siendo la vía principal y la única
 * en un dispositivo nuevo. Tras el primer ingreso con contraseña,
 * cada usuario puede activar EN ESTE DISPOSITIVO un desbloqueo de
 * la sesión guardada: (a) un PIN creado por él, o (b) la biometría
 * WebAuthn (la misma credencial del candado). Si la sesión guardada
 * ya no es válida, manda la contraseña. Cerrar sesión apaga el
 * acceso rápido hasta el próximo ingreso con contraseña.
 *
 * Seguridad y límites, declarados:
 *  - El PIN nunca viaja ni se guarda en claro: se guarda en este
 *    dispositivo un hash SHA-256 con sal aleatoria por usuario
 *    (localStorage 'queen-sda:quick-access-v1'). Sin contexto
 *    seguro (crypto.subtle) no se ofrece crear el PIN.
 *  - Intentos limitados: 5 fallos seguidos DESACTIVAN el PIN de
 *    este dispositivo (se borra su hash) y se exige contraseña.
 *  - Es una puerta LOCAL sobre la sesión ya autenticada: en modo
 *    Supabase la sesión subyacente la emitió y la caduca el
 *    servidor; el PIN/la huella no crean sesión ni sustituyen la
 *    autenticación del servidor — protegen el acceso en el
 *    dispositivo, como el desbloqueo de un teléfono.
 *  - La vía biométrica reutiliza la ceremonia verificada en el
 *    servidor de lib/webauthn (requireBiometricUnlock): la huella
 *    la comprueba el dispositivo y el reto lo verifica el servidor.
 */

const KEY = 'queen-sda:quick-access-v1'
export const MAX_PIN_FAILURES = 5

export interface QuickAccessRecord {
  pinSalt: string | null
  pinHash: string | null
  pinEnabled: boolean
  biometricEnabled: boolean
  failures: number
}

type Store = Record<string, QuickAccessRecord>

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Store
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveStore(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* almacenamiento no disponible: el acceso rápido no se activa */
  }
}

export function getQuickAccess(profileId: string): QuickAccessRecord | null {
  return loadStore()[profileId] ?? null
}

/** ¿Este dispositivo ofrece acceso rápido para este usuario? */
export function hasQuickAccess(profileId: string): boolean {
  const rec = getQuickAccess(profileId)
  return !!rec && (rec.pinEnabled || rec.biometricEnabled)
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function pinStorageSupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && !!crypto.getRandomValues
}

/** Crea o cambia el PIN de este dispositivo para este usuario. */
export async function setQuickPin(profileId: string, pin: string): Promise<void> {
  if (!pinStorageSupported()) throw new Error('Este navegador no permite guardar el PIN con hash seguro en este contexto.')
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN debe tener entre 4 y 6 dígitos.')
  const salt = randomSalt()
  const hash = await sha256Hex(`${salt}:${pin}`)
  const store = loadStore()
  const prev = store[profileId]
  store[profileId] = {
    pinSalt: salt,
    pinHash: hash,
    pinEnabled: true,
    biometricEnabled: prev?.biometricEnabled ?? false,
    failures: 0,
  }
  saveStore(store)
}

export function clearQuickPin(profileId: string): void {
  const store = loadStore()
  const rec = store[profileId]
  if (!rec) return
  rec.pinSalt = null
  rec.pinHash = null
  rec.pinEnabled = false
  rec.failures = 0
  store[profileId] = rec
  saveStore(store)
}

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong' | 'locked' | 'none'; attemptsLeft?: number }

/** Verifica el PIN aplicando el límite de intentos: al llegar al
 *  máximo, el PIN se desactiva en este dispositivo (hash borrado)
 *  y solo queda entrar con contraseña (o biometría si está activa). */
export async function verifyQuickPin(profileId: string, pin: string): Promise<PinCheck> {
  const store = loadStore()
  const rec = store[profileId]
  if (!rec || !rec.pinEnabled || !rec.pinSalt || !rec.pinHash) return { ok: false, reason: 'none' }
  const hash = await sha256Hex(`${rec.pinSalt}:${pin}`)
  if (hash === rec.pinHash) {
    rec.failures = 0
    store[profileId] = rec
    saveStore(store)
    return { ok: true }
  }
  rec.failures = (rec.failures ?? 0) + 1
  if (rec.failures >= MAX_PIN_FAILURES) {
    rec.pinSalt = null
    rec.pinHash = null
    rec.pinEnabled = false
    rec.failures = 0
    store[profileId] = rec
    saveStore(store)
    return { ok: false, reason: 'locked' }
  }
  store[profileId] = rec
  saveStore(store)
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_PIN_FAILURES - rec.failures }
}

/** Activa o desactiva la apertura biométrica en este dispositivo
 *  (la credencial WebAuthn vive en el servidor; aquí solo la marca
 *  de que este dispositivo puede ofrecerla al abrir). */
export function setBiometricUnlock(profileId: string, enabled: boolean): void {
  const store = loadStore()
  const prev = store[profileId]
  store[profileId] = {
    pinSalt: prev?.pinSalt ?? null,
    pinHash: prev?.pinHash ?? null,
    pinEnabled: prev?.pinEnabled ?? false,
    biometricEnabled: enabled,
    failures: prev?.failures ?? 0,
  }
  saveStore(store)
}

/** Cerrar sesión apaga el acceso rápido de este usuario en este
 *  dispositivo hasta el próximo ingreso con contraseña. */
export function clearQuickAccess(profileId: string): void {
  const store = loadStore()
  delete store[profileId]
  saveStore(store)
}
