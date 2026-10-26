// Queen SDA — cliente de Supabase (modo remoto opcional).
//
// La app es local-primero: SOLO usa Supabase cuando el proyecto define
// VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (en .env.local, nunca en el
// código ni en el repositorio). La clave publishable/anon está pensada para
// el navegador: la seguridad real la ponen las políticas RLS del esquema
// (supabase/schema.sql) — lectura solo con rol, escritura solo admin.
//
// Sin esas dos variables, getSupabase() devuelve null y toda la app sigue
// funcionando en modo local exactamente igual que antes.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** true cuando el proyecto trae la configuración de Supabase en el entorno. */
export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/** URL base del proyecto (sin clave): la usa la sonda de alcance de la
 *  cola offline para distinguir «sin red» de «el servidor rechazó». */
export function supabaseBaseUrl(): string | null {
  return url ?? null
}

let client: SupabaseClient | null = null

/** Cliente único de Supabase, o null si no está configurado (modo local). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}
