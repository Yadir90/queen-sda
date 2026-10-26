// Queen SDA — Edge Function «queen-webauthn»: BIOMETRÍA WebAuthn
// de esta copia (AÑADIDO DEL DUEÑO, decisión del 2026-10-26; no
// forma parte de la paridad con el sistema original).
//
// Despliegue (lo hace Lórien por el panel tras esta entrega):
//   supabase functions deploy queen-webauthn
//   y aplicar antes supabase/webauthn-schema.sql (tablas
//   webauthn_credentials y webauthn_challenges).
//   Opcional: secreto WEBAUTHN_RP_ID (por defecto se deriva del
//   origen de la petición, que es el dominio de la app).
//
// Contrato y límites:
// - La huella/cara la verifica el AUTENTICADOR DE PLATAFORMA del
//   dispositivo (Android/Windows): aquí jamás llega nada biométrico,
//   solo la prueba criptográfica de WebAuthn.
// - Registro y verificación exigen sesión válida de Supabase Auth
//   con rol asignado (como queen-chat). Los retos son de UN SOLO
//   USO y vida corta (5 minutos) y se queman al primer intento de
//   verificación, acierte o falle.
// - El cliente NUNCA decide: registrar y verificar pasan por esta
//   función, que comprueba reto, origen, rpId, flags UP/UV y la
//   firma con la clave pública guardada (verificación manual en
//   _shared/webauthnCore.mjs, sin librerías).
// - Las credenciales se guardan con la clave de servicio (la tabla
//   tiene RLS: cada usuario lee/borra solo las suyas desde la app;
//   la escritura del registro y la lectura para verificar son de
//   esta función).
// - El candado de la app pide esta verificación para exportar
//   documentos y cambiar ajustes SOLO si el usuario tiene
//   credencial registrada; sin credencial, el flujo sigue como hoy.

// @ts-nocheck — Deno (Supabase Edge Functions); no forma parte del build de la app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildAuthenticationOptions, buildRegistrationOptions, randomChallenge,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '../_shared/webauthnCore.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const RP_NAME = 'Queen SDA — La Reina'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

function reply(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS } })
}

function rpIdFrom(req: Request): string {
  const fromEnv = Deno.env.get('WEBAUTHN_RP_ID') ?? ''
  if (fromEnv) return fromEnv
  const origin = req.headers.get('Origin') ?? ''
  try { return new URL(origin).hostname } catch { return 'localhost' }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return reply(405, { ok: false, reason: 'Método no permitido.' })

  // 1) Sesión válida y rol asignado (la función no es pública).
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return reply(401, { ok: false, reason: 'Sesión no válida: la biometría solo responde a usuarios del sistema.' })
  }
  const user = userData.user
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id)
  if (!roles || roles.length === 0) {
    return reply(403, { ok: false, reason: 'El usuario no tiene rol asignado en el sistema.' })
  }

  // Cliente de servicio para retos y credenciales (salta la RLS;
  // cada fila se filtra siempre por el user_id de la sesión).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let body: { action?: unknown; credential?: any; deviceLabel?: unknown }
  try { body = await req.json() } catch { body = {} }
  const action = typeof body.action === 'string' ? body.action : ''
  const rpId = rpIdFrom(req)
  const origin = req.headers.get('Origin') ?? ''

  const newChallengeRow = async (purpose: 'register' | 'auth') => {
    // Limpieza oportunista de retos caducados y emisión del nuevo.
    await admin.from('webauthn_challenges').delete().lt('expires_at', new Date().toISOString())
    const challenge = randomChallenge()
    const { error } = await admin.from('webauthn_challenges').insert({
      user_id: user.id,
      challenge,
      purpose,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    })
    if (error) throw new Error('No se pudo emitir el reto.')
    return challenge
  }

  const takeChallenge = async (purpose: 'register' | 'auth'): Promise<string> => {
    const { data: rows } = await admin
      .from('webauthn_challenges')
      .select('id, challenge, expires_at')
      .eq('user_id', user.id)
      .eq('purpose', purpose)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
    const row = rows?.[0]
    if (!row) throw new Error('No hay un reto vigente: pide uno nuevo e inténtalo otra vez.')
    // Un solo uso: el reto se quema ANTES de verificar, acierte o no.
    await admin.from('webauthn_challenges').update({ used_at: new Date().toISOString() }).eq('id', row.id)
    return row.challenge as string
  }

  try {
    if (action === 'register-options') {
      const { data: existing } = await admin
        .from('webauthn_credentials')
        .select('credential_id, transports')
        .eq('user_id', user.id)
      const challenge = await newChallengeRow('register')
      const options = buildRegistrationOptions({
        rpId,
        rpName: RP_NAME,
        userId: user.id,
        userEmail: user.email ?? user.id,
        challenge,
        excludeCredentials: existing ?? [],
      })
      return reply(200, { ok: true, options })
    }

    if (action === 'register-verify') {
      const credential = body.credential
      if (!credential?.response?.clientDataJSON || !credential?.response?.attestationObject) {
        return reply(400, { ok: false, reason: 'Falta la respuesta del autenticador.' })
      }
      const challenge = await takeChallenge('register')
      const verified = await verifyRegistrationResponse(credential.response, { challenge, rpId, origin })
      const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 80) : ''
      const transports = Array.isArray(credential.transports) ? credential.transports.map(String).slice(0, 6) : []
      const { error } = await admin.from('webauthn_credentials').insert({
        user_id: user.id,
        credential_id: verified.credentialId,
        public_key: verified.publicKey,
        counter: verified.signCount,
        transports,
        device_label: deviceLabel,
      })
      if (error) {
        return reply(200, { ok: false, reason: 'Esa credencial ya estaba registrada o no se pudo guardar.' })
      }
      return reply(200, { ok: true })
    }

    if (action === 'auth-options') {
      const { data: credentials } = await admin
        .from('webauthn_credentials')
        .select('credential_id, transports')
        .eq('user_id', user.id)
      if (!credentials || credentials.length === 0) {
        return reply(200, { ok: false, reason: 'Este usuario no tiene biometría registrada en ningún dispositivo.' })
      }
      const challenge = await newChallengeRow('auth')
      const options = buildAuthenticationOptions({ rpId, challenge, allowCredentials: credentials })
      return reply(200, { ok: true, options })
    }

    if (action === 'auth-verify') {
      const credential = body.credential
      if (!credential?.id || !credential?.response?.authenticatorData || !credential?.response?.signature) {
        return reply(400, { ok: false, reason: 'Falta la respuesta del autenticador.' })
      }
      const { data: rows } = await admin
        .from('webauthn_credentials')
        .select('id, public_key, counter')
        .eq('user_id', user.id)
        .eq('credential_id', credential.id)
        .limit(1)
      const stored = rows?.[0]
      if (!stored) {
        return reply(200, { ok: false, reason: 'Esa credencial no está registrada para este usuario.' })
      }
      const challenge = await takeChallenge('auth')
      const verified = await verifyAuthenticationResponse(credential.response, {
        challenge,
        rpId,
        origin,
        publicKey: stored.public_key,
        signCount: stored.counter,
      })
      await admin.from('webauthn_credentials')
        .update({ counter: verified.signCount, last_used_at: new Date().toISOString() })
        .eq('id', stored.id)
      return reply(200, { ok: true })
    }

    return reply(400, { ok: false, reason: 'Acción no reconocida.' })
  } catch (e) {
    return reply(200, { ok: false, reason: e instanceof Error ? e.message : 'La verificación biométrica falló.' })
  }
})
