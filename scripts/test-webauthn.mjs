#!/usr/bin/env node
/* Queen SDA — Prueba de ceremonia WebAuthn (añadido del dueño,
 * 2026-10-26).
 *
 * QUÉ PRUEBA
 *   La ceremonia COMPLETA de la biometría de esta copia en un
 *   Chromium headless real con AUTENTICADOR VIRTUAL (CDP WebAuthn:
 *   enable + addVirtualAuthenticator, ctap2, interno, con
 *   verificación de usuario): registro (create) y autenticación
 *   (get) verificados por el MISMO núcleo del servidor que usa la
 *   Edge Function (supabase/functions/_shared/webauthnCore.mjs) y
 *   con la (de)serialización EXACTA del cliente
 *   (src/lib/webauthnClientCore.mjs, servida tal cual a la página).
 *   La única sustitución es el almacén: la función guarda retos y
 *   credenciales en Supabase; aquí viven en memoria, replicando su
 *   lógica (reto de un solo uso quemado antes de verificar, vida
 *   corta, contador anti-clonación). La criptografía, el CBOR/COSE
 *   y la ceremonia son los reales, sin atajos.
 *   Negativos obligados: firma manipulada → rechazada; aserción
 *   contra un reto ya sustituido → rechazada; repetición de la
 *   misma aserción (reto quemado) → rechazada.
 *
 * QUÉ NO PRUEBA: la huella/cara real de un dispositivo (imposible
 * en headless: la prueba física será en el A16 del dueño) ni el
 * despliegue de la función en Supabase (lo hace Lórien por el panel).
 *
 * USO: node scripts/test-webauthn.mjs — sale 0 si todo pasa, 1 si
 * algo falla, 2 si no hay Chromium (nunca simula la prueba). */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAuthenticationOptions, buildRegistrationOptions, randomChallenge,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '../supabase/functions/_shared/webauthnCore.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* WebAuthn no acepta un rpId que sea una IP: la ceremonia va sobre
   «localhost» (contexto seguro en loopback y rpId válido). */
const RP_ID = 'localhost'
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'prueba@lareina.local' }

/* ---------- almacén en memoria (réplica de la lógica de la función) ---------- */
const challenges = []
const credentials = []
async function newChallenge(purpose) {
  const challenge = randomChallenge()
  challenges.push({ user_id: USER.id, challenge, purpose, expires_at: Date.now() + 5 * 60 * 1000, used_at: null })
  return challenge
}
async function takeChallenge(purpose) {
  const row = [...challenges].reverse().find(
    (c) => c.user_id === USER.id && c.purpose === purpose && !c.used_at && c.expires_at > Date.now(),
  )
  if (!row) throw new Error('No hay un reto vigente')
  row.used_at = Date.now() // un solo uso: se quema antes de verificar
  return row.challenge
}

async function handleAction(body, origin) {
  const action = body.action
  if (action === 'register-options') {
    const challenge = await newChallenge('register')
    return { ok: true, options: buildRegistrationOptions({ rpId: RP_ID, rpName: 'Queen SDA — La Reina', userId: USER.id, userEmail: USER.email, challenge, excludeCredentials: credentials }) }
  }
  if (action === 'register-verify') {
    const challenge = await takeChallenge('register')
    const verified = await verifyRegistrationResponse(body.credential.response, { challenge, rpId: RP_ID, origin })
    credentials.push({
      user_id: USER.id,
      credential_id: verified.credentialId,
      public_key: verified.publicKey,
      counter: verified.signCount,
      transports: body.credential.transports ?? [],
    })
    return { ok: true }
  }
  if (action === 'auth-options') {
    const challenge = await newChallenge('auth')
    return { ok: true, options: buildAuthenticationOptions({ rpId: RP_ID, challenge, allowCredentials: credentials }) }
  }
  if (action === 'auth-verify') {
    const stored = credentials.find((c) => c.credential_id === body.credential.id)
    if (!stored) return { ok: false, reason: 'Credencial no registrada' }
    const challenge = await takeChallenge('auth')
    const verified = await verifyAuthenticationResponse(body.credential.response, {
      challenge, rpId: RP_ID, origin, publicKey: stored.public_key, signCount: stored.counter,
    })
    stored.counter = verified.signCount
    return { ok: true }
  }
  return { ok: false, reason: 'Acción no reconocida' }
}

/* ---------- página de prueba (ejerce el núcleo cliente real) ---------- */
const TEST_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>webauthn-test</title></head>
<body><pre id="result">EN CURSO</pre>
<script type="module">
import {
  decodeCreationOptions, decodeRequestOptions,
  serializeRegistrationCredential, serializeAuthenticationCredential,
} from '/webauthnClientCore.mjs'

const out = { pasos: {}, errores: [] }
const post = async (payload) => {
  const res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  return res.json()
}
const tamperB64 = (text) => {
  const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  bytes[bytes.length - 3] ^= 0xff
  return btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')
}
try {
  // 1) Registro completo
  const regOpts = await post({ action: 'register-options' })
  out.pasos.opcionesRegistro = regOpts.ok === true
  const created = await navigator.credentials.create({ publicKey: decodeCreationOptions(regOpts.options) })
  out.pasos.createDevuelto = !!created
  const regVerify = await post({ action: 'register-verify', credential: serializeRegistrationCredential(created), deviceLabel: 'Autenticador virtual' })
  out.pasos.registroVerificado = regVerify.ok === true
  if (!regVerify.ok) out.errores.push('register-verify: ' + (regVerify.reason ?? ''))

  // 2) Autenticación completa
  const authOpts = await post({ action: 'auth-options' })
  const assertion = await navigator.credentials.get({ publicKey: decodeRequestOptions(authOpts.options) })
  out.pasos.getDevuelto = !!assertion
  const serialized = serializeAuthenticationCredential(assertion)
  const authVerify = await post({ action: 'auth-verify', credential: serialized })
  out.pasos.autenticacionVerificada = authVerify.ok === true
  if (!authVerify.ok) out.errores.push('auth-verify: ' + (authVerify.reason ?? ''))

  // 3) Negativo: repetición de la misma aserción (el reto ya se quemó)
  const replay = await post({ action: 'auth-verify', credential: serialized })
  out.pasos.replayRechazado = replay.ok === false

  // 4) Negativo: firma manipulada
  const authOpts2 = await post({ action: 'auth-options' })
  const assertion2 = await navigator.credentials.get({ publicKey: decodeRequestOptions(authOpts2.options) })
  const ser2 = serializeAuthenticationCredential(assertion2)
  ser2.response.signature = tamperB64(ser2.response.signature)
  const tampered = await post({ action: 'auth-verify', credential: ser2 })
  out.pasos.firmaManipuladaRechazada = tampered.ok === false

  // 5) Negativo: aserción firmada contra un reto ya sustituido
  const authOpts3 = await post({ action: 'auth-options' })
  const assertion3 = await navigator.credentials.get({ publicKey: decodeRequestOptions(authOpts3.options) })
  const ser3 = serializeAuthenticationCredential(assertion3)
  await post({ action: 'auth-options' }) // emite otro reto: el vigente pasa a ser este
  const stale = await post({ action: 'auth-verify', credential: ser3 })
  out.pasos.retoSustituidoRechazado = stale.ok === false
} catch (e) {
  out.errores.push(String(e && e.message ? e.message : e))
}
document.getElementById('result').textContent = 'DONE ' + JSON.stringify(out)
</script></body></html>`

function findChromium() {
  const cands = []
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH)
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium'))) {
      cands.push(path.join(cache, d, 'chrome-linux64/chrome'))
      cands.push(path.join(cache, d, 'chrome-linux/chrome'))
      cands.push(path.join(cache, d, 'chrome-linux64/headless_shell'))
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable')
  return cands.find((c) => fs.existsSync(c)) || null
}

const exe = findChromium()
if (!exe) {
  console.error('SIN CHROMIUM: prueba NO ejecutada.')
  process.exit(2)
}

const clientCorePath = path.join(REPO, 'src/lib/webauthnClientCore.mjs')
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/api' && req.method === 'POST') {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', async () => {
      let payload = { ok: false, reason: 'Error del servidor de prueba' }
      try {
        payload = await handleAction(JSON.parse(raw || '{}'), req.headers.origin ?? '')
      } catch (e) {
        payload = { ok: false, reason: e instanceof Error ? e.message : 'error' }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
    return
  }
  if (url.pathname === '/webauthnClientCore.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' })
    fs.createReadStream(clientCorePath).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(TEST_PAGE)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
let exitCode = 1
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  console.log(`Autenticador virtual CDP: ${authenticatorId}`)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.getElementById('result')?.textContent?.startsWith('DONE'), null, { timeout: 30000 })
  const text = await page.locator('#result').innerText()
  const result = JSON.parse(text.slice('DONE '.length))
  console.log(JSON.stringify(result, null, 2))
  console.log(`Credenciales en el almacén de prueba: ${credentials.length} · contador final: ${credentials[0]?.counter}`)
  const allOk = Object.values(result.pasos).every(Boolean) && result.errores.length === 0
  console.log(allOk ? 'PRUEBA WEBAUTHN: SUPERADA (registro + autenticación verificados; 3 negativos rechazados)' : 'PRUEBA WEBAUTHN: FALLIDA')
  exitCode = allOk ? 0 : 1
} catch (e) {
  console.error(`PRUEBA WEBAUTHN: ERROR — ${e instanceof Error ? e.message : e}`)
} finally {
  await browser.close()
  server.close()
}
process.exit(exitCode)
