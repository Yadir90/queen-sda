/* Biometría WebAuthn de esta copia — AÑADIDO DEL DUEÑO (decisión
   del 2026-10-26, 12:14). No forma parte de la paridad con el
   sistema original: es la capa que el dueño activó para esta copia.

   Cómo funciona:
   - El registro (Ajustes → Seguridad) y cada verificación pasan
     por la Edge Function queen-webauthn: el servidor emite un reto
     de un solo uso y verifica la firma con la clave pública
     guardada (tabla webauthn_credentials). NADA se decide solo en
     el cliente y nada biométrico sale del dispositivo: la huella
     o la cara las comprueba el propio teléfono.
   - Candado: exportar documentos (Documentos) y guardar cambios
     en Ajustes piden la verificación SOLO si el usuario tiene
     credencial registrada. Sin credencial — o sin la tabla/función
     desplegadas todavía — el flujo sigue exactamente como hoy:
     nadie queda bloqueado por no haberla activado.
   - Tras verificar, queda una ventana corta de desbloqueo
     (5 minutos, solo en la sesión de la pestaña) para no pedir la
     huella en cada clic seguido. */

import { getSupabase, supabaseConfigured } from './supabaseClient'
import {
  decodeCreationOptions, decodeRequestOptions,
  serializeAuthenticationCredential, serializeRegistrationCredential,
  type AuthenticationOptionsJson, type RegistrationOptionsJson,
} from './webauthnClientCore.mjs'

export interface MyCredential {
  credential_id: string
  device_label: string
  created_at: string
  last_used_at: string | null
}

export function webauthnSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && !!navigator.credentials?.create
    && !!navigator.credentials?.get
}

/** ¿El autenticador de este dispositivo es de plataforma (huella/
 *  cara integrados)? Si la API no lo sabe decir, se asume que sí:
 *  el registro lo comprobará de verdad. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!webauthnSupported()) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return true }
}

async function invokeWebauthn(body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; options?: unknown }> {
  const client = getSupabase()
  if (!client) return { ok: false, reason: 'Sin conexión con Supabase en esta copia.' }
  const { data, error } = await client.functions.invoke('queen-webauthn', { body })
  if (error) {
    return { ok: false, reason: 'La función de biometría (queen-webauthn) no respondió. Si aún no está desplegada, la biometría queda en espera y el resto sigue como hoy.' }
  }
  const payload = (data ?? {}) as { ok?: boolean; reason?: string; options?: unknown }
  return { ok: !!payload.ok, reason: payload.reason, options: payload.options }
}

function ceremonyError(e: unknown, phase: 'registro' | 'verificación'): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return `La ${phase} se canceló o expiró el tiempo. No se guardó ni se desbloqueó nada.`
  }
  if (e instanceof DOMException && e.name === 'InvalidStateError') {
    return 'Este dispositivo ya tiene una credencial registrada para tu usuario.'
  }
  return `La ${phase} biométrica no pudo completarse en este dispositivo.`
}

/** Registra la huella/cara de ESTE dispositivo para el usuario de
 *  la sesión. Debe llamarse desde un gesto del usuario (clic). */
export async function registerBiometric(deviceLabel: string): Promise<{ ok: boolean; reason?: string }> {
  if (!webauthnSupported()) return { ok: false, reason: 'Este navegador no soporta WebAuthn.' }
  const start = await invokeWebauthn({ action: 'register-options' })
  if (!start.ok || !start.options) return { ok: false, reason: start.reason ?? 'El servidor no emitió el reto de registro.' }
  let credential: PublicKeyCredential | null
  try {
    credential = await navigator.credentials.create({
      publicKey: decodeCreationOptions(start.options as RegistrationOptionsJson),
    }) as PublicKeyCredential | null
  } catch (e) {
    return { ok: false, reason: ceremonyError(e, 'registro') }
  }
  if (!credential) return { ok: false, reason: 'El registro se canceló.' }
  const serialized = serializeRegistrationCredential(credential)
  const finish = await invokeWebauthn({ action: 'register-verify', credential: serialized, deviceLabel })
  return finish.ok ? { ok: true } : { ok: false, reason: finish.reason ?? 'El servidor no aceptó el registro.' }
}

/** Verifica la huella/cara contra el servidor y, si sale bien,
 *  abre la ventana corta de desbloqueo. */
export async function verifyBiometric(): Promise<{ ok: boolean; reason?: string }> {
  if (!webauthnSupported()) return { ok: false, reason: 'Este navegador no soporta WebAuthn.' }
  const start = await invokeWebauthn({ action: 'auth-options' })
  if (!start.ok || !start.options) return { ok: false, reason: start.reason ?? 'El servidor no emitió el reto de verificación.' }
  let credential: PublicKeyCredential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: decodeRequestOptions(start.options as AuthenticationOptionsJson),
    }) as PublicKeyCredential | null
  } catch (e) {
    return { ok: false, reason: ceremonyError(e, 'verificación') }
  }
  if (!credential) return { ok: false, reason: 'La verificación se canceló.' }
  const serialized = serializeAuthenticationCredential(credential)
  const finish = await invokeWebauthn({ action: 'auth-verify', credential: serialized })
  if (!finish.ok) return { ok: false, reason: finish.reason ?? 'El servidor no aceptó la verificación.' }
  openUnlockWindow()
  return { ok: true }
}

/* ---------- lista y borrado (tabla con RLS: solo las propias) ---------- */

/** Lista las credenciales del usuario. `unavailable` = la tabla
 *  aún no existe o no se pudo leer: la biometría se trata como no
 *  activada (degradación honesta, el flujo sigue como hoy). */
export async function listMyCredentials(): Promise<{ rows: MyCredential[]; unavailable: boolean }> {
  const client = getSupabase()
  if (!client) return { rows: [], unavailable: true }
  const { data, error } = await client
    .from('webauthn_credentials')
    .select('credential_id, device_label, created_at, last_used_at')
    .order('created_at', { ascending: true })
  if (error) return { rows: [], unavailable: true }
  return { rows: (data ?? []) as MyCredential[], unavailable: false }
}

export async function deleteMyCredential(credentialId: string): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false
  const { error } = await client.from('webauthn_credentials').delete().eq('credential_id', credentialId)
  return !error
}

/* ---------- ventana de desbloqueo y candado ---------- */

const UNLOCK_KEY = 'queen-webauthn-unlock-until'
export const UNLOCK_MS = 5 * 60 * 1000

export function openUnlockWindow(): void {
  try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_MS)) } catch { /* noop */ }
}

export function biometricUnlocked(): boolean {
  try {
    const until = Number(sessionStorage.getItem(UNLOCK_KEY) ?? 0)
    return Number.isFinite(until) && until > Date.now()
  } catch { return false }
}

export function closeUnlockWindow(): void {
  try { sessionStorage.removeItem(UNLOCK_KEY) } catch { /* noop */ }
}

/** El candado de las acciones sensibles (exportar documentos y
 *  cambios en ajustes). Sin modo Supabase, sin tabla o sin
 *  credencial registrada: pasa sin pedir nada (flujo como hoy).
 *  Con credencial: pide la verificación al servidor; la ventana
 *  de desbloqueo evita repetirla en clics seguidos. */
export async function requireBiometricUnlock(): Promise<{ ok: boolean; reason?: string }> {
  if (!supabaseConfigured()) return { ok: true }
  if (biometricUnlocked()) return { ok: true }
  const { rows, unavailable } = await listMyCredentials()
  if (unavailable || rows.length === 0) return { ok: true }
  return verifyBiometric()
}
