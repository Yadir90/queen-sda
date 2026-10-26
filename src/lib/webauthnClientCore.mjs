/* Queen SDA — núcleo WebAuthn del NAVEGADOR (añadido del dueño,
   2026-10-26): convierte entre el JSON de la Edge Function
   queen-webauthn y las estructuras de la API PublicKeyCredential.
   Sin dependencias: base64url y (de)serialización de la ceremonia.
   La verificación vive SOLO en el servidor
   (supabase/functions/_shared/webauthnCore.mjs): aquí no se decide
   nada de seguridad. Es un .mjs para que la prueba de ceremonia
   (scripts/test-webauthn.mjs) ejerza exactamente este código. */

export function b64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function b64urlToBuffer(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Opciones de registro del servidor → PublicKeyCredentialCreationOptions. */
export function decodeCreationOptions(json) {
  return {
    ...json,
    challenge: b64urlToBuffer(json.challenge),
    user: { ...json.user, id: b64urlToBuffer(json.user.id) },
    excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({ ...c, id: b64urlToBuffer(c.id) })),
  }
}

/** Opciones de autenticación del servidor → PublicKeyCredentialRequestOptions. */
export function decodeRequestOptions(json) {
  return {
    ...json,
    challenge: b64urlToBuffer(json.challenge),
    allowCredentials: (json.allowCredentials ?? []).map((c) => ({ ...c, id: b64urlToBuffer(c.id) })),
  }
}

/** Respuesta de navigator.credentials.create → JSON para el servidor. */
export function serializeRegistrationCredential(credential) {
  const response = credential.response
  return {
    id: credential.id,
    rawId: b64urlEncode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    response: {
      clientDataJSON: b64urlEncode(response.clientDataJSON),
      attestationObject: b64urlEncode(response.attestationObject),
    },
  }
}

/** Respuesta de navigator.credentials.get → JSON para el servidor. */
export function serializeAuthenticationCredential(credential) {
  const response = credential.response
  return {
    id: credential.id,
    rawId: b64urlEncode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: b64urlEncode(response.clientDataJSON),
      authenticatorData: b64urlEncode(response.authenticatorData),
      signature: b64urlEncode(response.signature),
      userHandle: response.userHandle ? b64urlEncode(response.userHandle) : null,
    },
  }
}
