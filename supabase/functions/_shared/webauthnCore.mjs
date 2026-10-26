/* Queen SDA — núcleo WebAuthn del SERVIDOR (compartido por la Edge
   Function queen-webauthn y por la prueba de ceremonia local).

   Verificación MANUAL, sin librerías: la ceremonia WebAuthn es un
   protocolo cerrado y verificable con WebCrypto —
   - Registro: se parsea el attestationObject (CBOR) y se extraen
     el id de credencial y la clave pública COSE del authData. El
     formato de atestación pedido es «none»: no se verifica la
     cadena de atestación porque el registro ocurre DENTRO de una
     sesión ya autenticada con contraseña (el vínculo cuenta↔
     credencial nace de esa sesión, no del fabricante del
     autenticador). Sí se verifican reto, origen, rpIdHash y los
     flags UP/AT.
   - Autenticación: se verifica la firma (ES256 o RS256) sobre
     authData ‖ SHA-256(clientDataJSON) con la clave pública
     guardada, además de reto, origen, rpIdHash, flags UP/UV y el
     contador de firma (anti-clonación cuando el autenticador lo
     incrementa).
   Nada biométrico llega aquí jamás: el navegador solo entrega la
   prueba criptográfica de que el autenticador de plataforma
   (huella/cara/PIN del dispositivo) autorizó la operación. */

/* ---------- base64url ---------- */

export function b64urlEncode(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function b64urlDecode(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
export const utf8Bytes = (s) => textEncoder.encode(s)
export const utf8Text = (bytes) => textDecoder.decode(bytes)

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

export function randomChallenge() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return b64urlEncode(bytes)
}

/* ---------- CBOR (decodificador mínimo, tipos mayores 0–5 y simples) ---------- */

export function cborDecode(bytes, offset = 0) {
  const first = bytes[offset]
  const major = first >> 5
  const info = first & 0x1f
  let pos = offset + 1
  const readLen = () => {
    if (info < 24) return info
    if (info === 24) { const v = bytes[pos]; pos += 1; return v }
    if (info === 25) { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v }
    if (info === 26) { const v = bytes[pos] * 2 ** 24 + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]; pos += 4; return v }
    if (info === 27) {
      let v = 0
      for (let i = 0; i < 8; i++) { v = v * 256 + bytes[pos]; pos += 1 }
      return v
    }
    throw new Error('CBOR: longitud indefinida no soportada')
  }
  if (major === 0) return { value: readLen(), next: pos }
  if (major === 1) return { value: -1 - readLen(), next: pos }
  if (major === 2 || major === 3) {
    const len = readLen()
    const slice = bytes.slice(pos, pos + len)
    return { value: major === 2 ? slice : utf8Text(slice), next: pos + len }
  }
  if (major === 4) {
    const len = readLen()
    const arr = []
    for (let i = 0; i < len; i++) { const item = cborDecode(bytes, pos); arr.push(item.value); pos = item.next }
    return { value: arr, next: pos }
  }
  if (major === 5) {
    const len = readLen()
    const map = new Map()
    for (let i = 0; i < len; i++) {
      const k = cborDecode(bytes, pos); pos = k.next
      const v = cborDecode(bytes, pos); pos = v.next
      map.set(k.value, v.value)
    }
    return { value: map, next: pos }
  }
  if (major === 6) { const inner = cborDecode(bytes, pos); return { value: inner.value, next: inner.next } }
  // major 7: valores simples y flotantes (suficiente para COSE/atestación).
  if (info === 20) return { value: false, next: pos }
  if (info === 21) return { value: true, next: pos }
  if (info === 22) return { value: null, next: pos }
  if (info === 25) {
    const half = (bytes[offset + 1] << 8) | bytes[offset + 2]
    const sign = (half & 0x8000) ? -1 : 1
    const exp = (half >> 10) & 0x1f
    const frac = half & 0x3ff
    const val = exp === 0 ? sign * (frac / 1024) * 2 ** -14
      : exp === 31 ? (frac ? NaN : sign * Infinity)
        : sign * (1 + frac / 1024) * 2 ** (exp - 15)
    return { value: val, next: offset + 3 }
  }
  if (info === 26) {
    const buf = new DataView(bytes.buffer, bytes.byteOffset + pos, 4)
    return { value: buf.getFloat32(0), next: pos + 4 }
  }
  if (info === 27) {
    const buf = new DataView(bytes.buffer, bytes.byteOffset + pos, 8)
    return { value: buf.getFloat64(0), next: pos + 8 }
  }
  throw new Error('CBOR: tipo no soportado')
}

/* ---------- authenticatorData ---------- */

export function parseAuthenticatorData(bytes) {
  if (bytes.length < 37) throw new Error('authData demasiado corto')
  const rpIdHash = bytes.slice(0, 32)
  const flagsByte = bytes[32]
  const flags = {
    up: !!(flagsByte & 0x01),
    uv: !!(flagsByte & 0x04),
    at: !!(flagsByte & 0x40),
    ed: !!(flagsByte & 0x80),
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + 33, 4)
  const signCount = view.getUint32(0)
  let attested = null
  if (flags.at) {
    let pos = 37
    const aaguid = bytes.slice(pos, pos + 16); pos += 16
    const credLen = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2
    const credentialId = bytes.slice(pos, pos + credLen); pos += credLen
    const keyStart = pos
    const key = cborDecode(bytes, pos)
    attested = {
      aaguid,
      credentialId,
      credentialPublicKey: key.value,
      credentialPublicKeyBytes: bytes.slice(keyStart, key.next),
    }
  }
  return { rpIdHash, flags, signCount, attested }
}

/* ---------- clave COSE → JWK ---------- */

export function cosePublicKeyToJwk(coseMap) {
  const kty = coseMap.get(1)
  const alg = coseMap.get(3)
  if (kty === 2) {
    // EC2: -1 curva (1 = P-256), -2 x, -3 y; algoritmo -7 (ES256).
    if (coseMap.get(-1) !== 1) throw new Error('Curva COSE no soportada (solo P-256)')
    return {
      jwk: { kty: 'EC', crv: 'P-256', x: b64urlEncode(coseMap.get(-2)), y: b64urlEncode(coseMap.get(-3)) },
      importAlg: { name: 'ECDSA', namedCurve: 'P-256' },
      verifyAlg: { name: 'ECDSA', hash: 'SHA-256' },
      ecdsa: true,
    }
  }
  if (kty === 3) {
    // RSA: -1 n, -2 e; algoritmo -257 (RS256).
    return {
      jwk: { kty: 'RSA', n: b64urlEncode(coseMap.get(-1)), e: b64urlEncode(coseMap.get(-2)) },
      importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      verifyAlg: { name: 'RSASSA-PKCS1-v1_5' },
      ecdsa: false,
    }
  }
  throw new Error(`Tipo de clave COSE no soportado (kty=${kty}, alg=${alg})`)
}

/* Firma ECDSA en DER (la entrega el autenticador) → cruda r‖s
   (la exige WebCrypto). */
export function derSignatureToRaw(der, size = 32) {
  let pos = 0
  if (der[pos++] !== 0x30) throw new Error('Firma DER inválida')
  let len = der[pos++]
  if (len & 0x80) { const n = len & 0x7f; pos += n }
  const readInt = () => {
    if (der[pos++] !== 0x02) throw new Error('Firma DER inválida')
    const l = der[pos++]
    let start = pos
    while (start < pos + l - 1 && der[start] === 0) start++
    const val = der.slice(start, pos + l)
    pos += l
    const out = new Uint8Array(size)
    out.set(val.slice(-size), size - Math.min(size, val.length))
    return out
  }
  const r = readInt()
  const s = readInt()
  const raw = new Uint8Array(size * 2)
  raw.set(r, 0)
  raw.set(s, size)
  return raw
}

/* ---------- opciones de ceremonia ---------- */

export function buildRegistrationOptions({ rpId, rpName, userId, userEmail, challenge, excludeCredentials = [] }) {
  return {
    challenge,
    rp: { name: rpName, id: rpId },
    user: { id: b64urlEncode(utf8Bytes(userId)), name: userEmail, displayName: userEmail },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: excludeCredentials.map((c) => ({
      id: c.credential_id,
      type: 'public-key',
      ...(Array.isArray(c.transports) && c.transports.length ? { transports: c.transports } : {}),
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      requireResidentKey: false,
      userVerification: 'required',
    },
  }
}

export function buildAuthenticationOptions({ rpId, challenge, allowCredentials = [] }) {
  return {
    challenge,
    rpId,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: allowCredentials.map((c) => ({
      id: c.credential_id,
      type: 'public-key',
      ...(Array.isArray(c.transports) && c.transports.length ? { transports: c.transports } : {}),
    })),
  }
}

/* ---------- verificación ---------- */

function parseClientData(clientDataJSONBytes) {
  let data
  try { data = JSON.parse(utf8Text(clientDataJSONBytes)) } catch { throw new Error('clientDataJSON ilegible') }
  return data
}

function checkClientData(data, { type, challenge, origin }) {
  if (data.type !== type) throw new Error('Tipo de ceremonia inesperado')
  if (!bytesEqual(b64urlDecode(data.challenge ?? ''), b64urlDecode(challenge))) {
    throw new Error('El reto no coincide (posible reutilización)')
  }
  if (origin && data.origin !== origin) throw new Error('El origen no coincide')
}

async function checkRpAndFlags(authData, { rpId, needAttested, needUv }) {
  const expected = await sha256(utf8Bytes(rpId))
  if (!bytesEqual(authData.rpIdHash, expected)) throw new Error('El rpId no coincide')
  if (!authData.flags.up) throw new Error('Falta la presencia del usuario (UP)')
  if (needUv && !authData.flags.uv) throw new Error('Falta la verificación del usuario (UV)')
  if (needAttested && !authData.flags.at) throw new Error('Faltan los datos atestiguados (AT)')
}

/** Verifica una respuesta de registro. Devuelve la credencial a
 *  guardar: id y clave pública COSE, ambos en base64url. */
export async function verifyRegistrationResponse(response, expected) {
  const clientDataJSON = b64urlDecode(response.clientDataJSON)
  const data = parseClientData(clientDataJSON)
  checkClientData(data, { type: 'webauthn.create', challenge: expected.challenge, origin: expected.origin })
  const attestationObject = b64urlDecode(response.attestationObject)
  const att = cborDecode(attestationObject, 0).value
  const authDataBytes = att.get('authData')
  if (!authDataBytes) throw new Error('La atestación no trae authData')
  const authData = parseAuthenticatorData(authDataBytes)
  await checkRpAndFlags(authData, { rpId: expected.rpId, needAttested: true, needUv: true })
  if (!authData.attested) throw new Error('Sin credencial atestiguada')
  return {
    credentialId: b64urlEncode(authData.attested.credentialId),
    publicKey: b64urlEncode(authData.attested.credentialPublicKeyBytes),
    signCount: authData.signCount,
  }
}

/** Verifica una aserción de autenticación contra la clave guardada. */
export async function verifyAuthenticationResponse(response, expected) {
  const clientDataJSON = b64urlDecode(response.clientDataJSON)
  const data = parseClientData(clientDataJSON)
  checkClientData(data, { type: 'webauthn.get', challenge: expected.challenge, origin: expected.origin })
  const authenticatorData = b64urlDecode(response.authenticatorData)
  const authData = parseAuthenticatorData(authenticatorData)
  await checkRpAndFlags(authData, { rpId: expected.rpId, needAttested: false, needUv: true })

  const cose = cborDecode(b64urlDecode(expected.publicKey), 0).value
  const { jwk, importAlg, verifyAlg, ecdsa } = cosePublicKeyToJwk(cose)
  const key = await crypto.subtle.importKey('jwk', jwk, importAlg, false, ['verify'])
  const clientHash = await sha256(clientDataJSON)
  const signed = new Uint8Array(authenticatorData.length + clientHash.length)
  signed.set(authenticatorData, 0)
  signed.set(clientHash, authenticatorData.length)
  let signature = b64urlDecode(response.signature)
  if (ecdsa) signature = derSignatureToRaw(signature)
  const valid = await crypto.subtle.verify(verifyAlg, key, signature, signed)
  if (!valid) throw new Error('La firma no verifica')
  // Anti-clonación: si ambos contadores avanzan, el recibido debe
  // superar al guardado. Muchos autenticadores de plataforma
  // mantienen 0: en ese caso no hay señal y se acepta.
  const stored = Number(expected.signCount ?? 0)
  if (stored > 0 && authData.signCount > 0 && authData.signCount <= stored) {
    throw new Error('Contador de firma sin avanzar (posible clonación)')
  }
  return { signCount: authData.signCount }
}
